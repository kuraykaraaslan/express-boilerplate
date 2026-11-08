import { FLEET_TENANT_ID, FLEET_TENANT_NAME, ROOT_TENANT_ID, isPlatformTenantRange } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { TenantKeyColumnSet } from './db.tenant-key-columns';

/**
 * `npm run tenant:rekey` (docs/phases/46-module-placement, D46-6): moves every row of one tenant to another tenant id, in one transaction, with
 * nothing lost. Written for the seed customer that sat at the fleet tenant's id (`…8000-000000000001` → `…a000-000000000001`), generic otherwise.
 *
 *  - Dry run by default: a READ ONLY transaction that counts, per table and column, the rows that would move, and lists what the move would
 *    touch beside them (the Redis keys, the sessions it ends, the tenant-key envelopes it re-seals, the objects it copies, the hash chains it
 *    cannot rewrite). Nothing is written, in the database, in Redis or in the object store.
 *  - The columns are found from the catalog, never from a hand list: every column of a table of the app's schema named `tenantId`, `tenant_id`,
 *    `<something>TenantId` or `<something>_tenant_id`, of a uuid or text type or an array of one (`pg_attribute`, not `information_schema`,
 *    which hides the columns the connected role holds no privilege on). On top, the JSON locations that embed tenant ids as whole string values
 *    (`EMBEDDED_TENANT_REFERENCES`: a quoted `"<id>"` there is replaced, nothing else of the text is touched) and the polymorphic owner columns
 *    that name a tenant under another name (`POLYMORPHIC_TENANT_REFERENCES`: `ownerId` where `ownerType` is `TENANT`).
 *  - `--apply` runs it in ONE transaction: the foreign keys over the moved columns are made deferrable for the transaction (and restored before
 *    it commits), referencing tables move before the tables they reference, the tenant's sessions are ended (and handed to the session-revocation
 *    outbox, so the `session_revoked` hooks run: push tokens, SSO sessions, sockets), every moved column is counted again (a row left at the old
 *    id fails the run) and only then is it committed. Any failure rolls everything back.
 *  - Tenant data keys (P7-TDEK): an envelope `v2.tdek-<from>-<n>` names its tenant in the key id and is bound to it (the GCM additional data;
 *    `tenant_keys` refuses a change of its tenant). In the transaction each such value, in a declared column or embedded in any other text or JSON
 *    column (an HR change request's `payload.ibanEnc`), is opened under the old tenant's key and written back as a node-key envelope, which every
 *    reader opens in any tenant's context; after the commit the new tenant's own key seals the declared columns again (`reseal`, the backfill's
 *    per-tenant pass, which also fills the blind indexes for the new key). The old tenant's ACTIVE key is RETIRED in the same transaction, never
 *    destroyed (the backup taken before the move still opens with it): a tenant created at the old id afterwards gets a key of its own.
 *  - Objects (`OBJECT_KEY_COLUMNS`): a key `<from>/…` is addressed under the tenant prefix (storage `assertTenantObjectKey`), so before the rows
 *    move each such object is COPIED to `<to>/…` in the moving tenant's store and the column is rewritten; the original is never deleted.
 *  - After the commit, Redis (SCAN, never FLUSHDB, never a BullMQ key): a key whose name holds the old id is RENAMED to the new id (its data and
 *    TTL kept; a string or hash value naming the old id as a whole JSON string is rewritten); an expiring string of another name whose value names
 *    the old id (a cache) is deleted; anything else naming it (a hash or a durable key shared by several tenants) is listed and left as it is; the
 *    session cache of every user whose session ended is deleted.
 *  - Refused: `--to` in the platform tenant range or in use anywhere (a tenant row or any row naming it), `--from` ROOT, `--from` FLEET while that
 *    row is the fleet tenant (named Fleet, or any row there on a control plane), a `--from` that is no tenant, a tenant with its own database
 *    (`tenant_databases`), a tenant column that is a TimescaleDB partitioning dimension, `--apply` without `--confirm <database>@<host>`, a missing
 *    UPDATE privilege or row-level-security bypass, and, until acknowledged, rows in hash chains that cover the tenant id (`--accept-chain-break`),
 *    and object keys under `<from>/` when the object store cannot be reached here (`--keep-object-keys` leaves them where they are).
 */

export const REKEY_USAGE = [
  'usage: npm run tenant:rekey -- --from <tenant id> --to <tenant id> [--apply --confirm <database>@<host>]',
  '         [--accept-chain-break] [--keep-object-keys] [--exclude-table <table>]... [--scan-text]',
  '',
  '  Dry run unless --apply. The database is DATABASE_URL_UNPOOLED, else DATABASE_URL_ADMIN, else DATABASE_URL, a variable set in the shell',
  '  winning over .env (its ?schema= is the app schema); Redis is REDIS_URL / REDIS_SENTINELS. See modules/db/README.md, "Moving a tenant to another id".',
].join('\n');

export class RekeyUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RekeyUsageError';
  }
}

export class RekeyRefusedError extends Error {
  /** The dry-run result the refusal was decided on, when the planning got that far (the CLI prints its report). */
  constructor(readonly reasons: string[], readonly result?: RekeyResult) {
    super(`tenant:rekey refused:\n${reasons.map((r) => `  - ${r}`).join('\n')}`);
    this.name = 'RekeyRefusedError';
  }
}

export interface RekeyArgs {
  from: string;
  to: string;
  apply: boolean;
  /** `--confirm <database>@<host>`: required with --apply, must equal the connected database and host (the database alone without a host). */
  confirm: string | null;
  acceptChainBreak: boolean;
  keepObjectKeys: boolean;
  /** Tables whose rows stay at `from` (their rows are counted and left alone). */
  excludeTables: string[];
  /** Dry run: also list every text, JSON and uuid column of the schema that still holds the old id (slow on a large database). */
  scanText: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** Parses the CLI arguments; throws `RekeyUsageError` for anything malformed (the ids are lower-cased). */
export function parseRekeyArgs(argv: readonly string[]): RekeyArgs {
  const out: RekeyArgs = { from: '', to: '', apply: false, confirm: null, acceptChainBreak: false, keepObjectKeys: false, excludeTables: [], scanText: false };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new RekeyUsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const eq = a.indexOf('=');
    const [flag, inline] = a.startsWith('--') && eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, undefined];
    const take = (): string => { if (inline !== undefined) return inline; const v = value(i, flag); i += 1; return v; };
    switch (flag) {
      case '--from': out.from = take().trim().toLowerCase(); break;
      case '--to': out.to = take().trim().toLowerCase(); break;
      case '--confirm': out.confirm = take(); break;
      case '--exclude-table': out.excludeTables.push(take()); break;
      case '--apply': out.apply = true; break;
      case '--accept-chain-break': out.acceptChainBreak = true; break;
      case '--keep-object-keys': out.keepObjectKeys = true; break;
      case '--scan-text': out.scanText = true; break;
      // The connection comes from the environment only: a URL with its password on the command line ends up in the shell history and in ps.
      case '--database-url': throw new RekeyUsageError('--database-url is not taken on the command line: set DATABASE_URL_UNPOOLED (or DATABASE_URL) in the environment');
      default: throw new RekeyUsageError(`unknown argument ${a}`);
    }
  }
  if (!out.from || !out.to) throw new RekeyUsageError('--from and --to are required');
  if (!UUID_RE.test(out.from)) throw new RekeyUsageError(`--from is not a uuid: ${out.from}`);
  if (!UUID_RE.test(out.to)) throw new RekeyUsageError(`--to is not a uuid: ${out.to}`);
  if (out.from === out.to) throw new RekeyUsageError('--from and --to are the same id');
  if (out.confirm !== null && !out.apply) throw new RekeyUsageError('--confirm goes with --apply');
  for (const t of out.excludeTables) if (!IDENT_RE.test(t)) throw new RekeyUsageError(`--exclude-table is not a table name: ${t}`);
  return out;
}

/** The refusals that need no database: the ids alone. */
export function argumentRefusals(args: Pick<RekeyArgs, 'from' | 'to'>): string[] {
  const out: string[] = [];
  if (args.from === ROOT_TENANT_ID) out.push('--from is the root tenant: the platform tenant never moves');
  if (isPlatformTenantRange(args.to)) out.push(`--to ${args.to} lies in the platform tenant range (00000000-0000-4000-8000-0000000000xx): reserved for root and fleet`);
  return out;
}

// ── what the catalog and the data say ───────────────────────────────────────────────────────────────────────────────

export type RekeyColumnKind = 'scalar' | 'array' | 'json' | 'owner';

export interface RekeyColumn {
  table: string;
  column: string;
  /** The column's type (`uuid`, `text`, `varchar`, `_uuid`, `jsonb`, ...). */
  type: string;
  kind: RekeyColumnKind;
  /** `owner` only: the column saying what the id names, and the value that makes it a tenant (`ownerType` = `TENANT`). */
  typeColumn?: string;
  typeValue?: string;
}

/**
 * JSON columns that embed tenant ids as whole string values (found in the code, 2026-10-27): a quoted `"<from>"` in them becomes `"<to>"`, in
 * every row (any tenant's row may name the moved tenant). Text that merely CONTAINS the id (a storage key, a URL, a seed label, a merge
 * snapshot, an audit resource id) is history or a pointer to something outside the database and is left as written; `--scan-text` lists it.
 */
export const EMBEDDED_TENANT_REFERENCES: ReadonlyArray<{ table: string; column: string; why: string }> = [
  { table: 'account_deletions', column: 'tenantIds', why: 'privacy: the workspaces a person belonged to when they asked for deletion' },
  { table: 'account_deletions', column: 'doneTenantIds', why: 'privacy: the workspaces whose erasure ran' },
  { table: 'feature_flags', column: 'targetingRules', why: 'feature_flags: a rule may target tenant ids' },
  { table: 'experiments', column: 'targetingRules', why: 'feature_flags: a rule may target tenant ids' },
  { table: 'session_revocation_outbox', column: 'sessions', why: 'user_session: pending revocations name their tenant' },
  { table: 'session_end_orders', column: 'payload', why: 'session_end: a pending device kick or socket order names its tenant' },
];

/**
 * Polymorphic owner columns that hold a tenant id under another name (found in the code, 2026-10-27): the column is rewritten in every row whose
 * type column says it names a tenant, whichever tenant the row belongs to (a platform wallet of a publisher tenant belongs to root).
 */
export const POLYMORPHIC_TENANT_REFERENCES: ReadonlyArray<{ table: string; column: string; typeColumn: string; typeValue: string; why: string }> = [
  { table: 'documents', column: 'ownerId', typeColumn: 'ownerType', typeValue: 'TENANT', why: 'document: the tenant\'s own policies (slot locks, compliance owners)' },
  { table: 'wallet_accounts', column: 'ownerId', typeColumn: 'ownerType', typeValue: 'TENANT', why: 'wallet: a publisher tenant\'s payout account' },
];

/**
 * Tables whose stored hashes or keyed references cover the tenant id: after the move their rows no longer verify (the audit chain, its heads,
 * checkpoints, anchors and actor references; the approval and wallet chains). Any other table with a `rowHash` column is counted too. Moving
 * them is no data loss, but the tenant's chain verification then reports a break: `--accept-chain-break` says that is understood.
 */
export const CHAIN_BOUND_TABLES: ReadonlySet<string> = new Set([
  'audit_logs', 'audit_legacy_chain_heads', 'audit_chain_checkpoints', 'audit_chain_anchors', 'audit_actor_identities',
  'approval_queue_items', 'approval_chain_heads', 'wallet_postings',
]);

/**
 * Columns holding storage object keys. A key `<from>/<folder>/...` is addressed under the tenant prefix (storage.operations
 * `assertTenantObjectKey`): the move copies each such object to `<to>/...` and rewrites the column, the original staying where it is.
 */
export const OBJECT_KEY_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'uploaded_files', column: 'key' },
  { table: 'drive_files', column: 'storageKey' },
  { table: 'documents', column: 'storageKey' },
  { table: 'esignature_archives', column: 'storageKey' },
  { table: 'telephony_prompts', column: 'storageKey' },
  { table: 'tenant_export_jobs', column: 'storageKey' },
  { table: 'import_jobs', column: 'fileKey' },
  { table: 'hr_employee_imports', column: 'fileKey' },
];

/** Never moved by the generic pass: `tenant_keys` refuses a change of its tenant (a key's identity); its envelopes are re-sealed instead. */
const NOT_MOVED_TABLES: ReadonlySet<string> = new Set(['tenant_keys']);

/** A column name that names a tenant: `tenantId`, `tenant_id`, `ownerTenantId`, `payer_tenant_id` (never `tenantMemberId`, `tenantStatus`). */
export function isTenantColumnName(name: string): boolean {
  return name === 'tenantId' || name === 'tenant_id' || /^[a-z][A-Za-z0-9]*TenantId$/.test(name) || /^[a-z][a-z0-9_]*_tenant_id$/.test(name);
}

const SCALAR_TYPES = new Set(['uuid', 'text', 'varchar', 'bpchar']);
const ARRAY_TYPES = new Set(['_uuid', '_text', '_varchar']);
const TEXT_TYPES = ['text', 'varchar', 'bpchar', 'json', 'jsonb'];

/** Minimal pg client: `pg.Client` fits. */
export interface RekeySql {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

/** The slice of an ioredis client the post-commit Redis pass uses. */
export interface RekeyRedis {
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
  type(key: string): Promise<string>;
  get(key: string): Promise<string | null>;
  hvals(key: string): Promise<string[]>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, values: Record<string, string>): Promise<number>;
  /** `SET key value [PX ms]`. */
  set(key: string, value: string, ...ttl: Array<string | number>): Promise<unknown>;
  pttl(key: string): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  renamenx(key: string, newKey: string): Promise<number>;
  unlink(...keys: string[]): Promise<number>;
  ping(): Promise<string>;
}

/** The tenant data keys, as the move needs them (P7-TDEK); the CLI builds it on `tenantKeys`, the backfill and the node field key. */
export interface RekeyTenantKeys {
  /** The declared column sets (`db:tenant_key_columns`). */
  sets(): Promise<TenantKeyColumnSet[]>;
  /** Whether a node-key envelope can be written (the node field key is configured). */
  canSealNodeKey(): boolean;
  /** Opens `value` in `tenantId`'s context (the owner's dual read). */
  open(tenantId: string, value: string): Promise<string>;
  /** Seals `plaintext` under the node key (an envelope any tenant's reader opens). */
  sealNodeKey(plaintext: string): string;
  /** After the commit: seals the tenant's node-key and legacy values under its own key (the backfill's per-tenant pass). */
  reseal(tenantId: string): Promise<{ sealed: number; unreadable: number }>;
}

/** The object store, as the move needs it; the CLI builds it on storage's own provider. */
export interface RekeyObjects {
  /** Copies the object at `key` (under `<from>/`) to the same path under `<to>/` in the store `from` resolves to now; null when there is none. */
  copy(from: string, to: string, key: string): Promise<string | null>;
}

/** Where the connection goes, as the report shows it and `--confirm` names it (never the password). */
export interface RekeyTarget {
  host: string;
  port: string;
  user: string;
  /** The variable the URL came from and whether the shell or .env set it. */
  source: string;
}

export interface RekeyDeps {
  sql: RekeySql;
  /** The app's schema (the `?schema=` of the URL), default `public`. */
  schema?: string;
  redis?: RekeyRedis | null;
  tenantKeys?: RekeyTenantKeys | null;
  objects?: RekeyObjects | null;
  /** FLEET_ROLE=fleet: the row at the fleet id is the fleet tenant whatever it is called (its operators are members there). */
  controlPlane?: boolean;
  target?: RekeyTarget | null;
  /** Redis instances of the app this run does not reach (AUTOMATION_REDIS_URL, AUTOMATION_OBS_REDIS_URL set apart from REDIS_URL): reported. */
  untouchedRedis?: string[];
  log?: (line: string) => void;
}

export interface RekeyCount extends RekeyColumn { rows: number }

export interface RekeyPlan {
  database: string;
  schema: string;
  target: RekeyTarget | null;
  /** What `--confirm` must say: `<database>@<host>`, or the database alone without a host. */
  confirmAs: string;
  from: string;
  to: string;
  fromName: string | null;
  /** Rows to move, per table and column (zero-row columns left out). */
  moves: RekeyCount[];
  /** Rows of `--exclude-table` tables that stay at `from`. */
  excluded: RekeyCount[];
  /** Declared tenant-key columns holding envelopes under the old tenant's key: `table.column` → values. */
  tenantKeyValues: Record<string, number>;
  /** Other text and JSON columns embedding envelopes under the old tenant's key: `table.column` → rows. */
  embeddedEnvelopes: Record<string, number>;
  /** `tenant_keys` rows of the old tenant (kept; the ACTIVE one is retired). */
  tenantKeyRows: number;
  /** Rows of hash-chained tables that move: `table` → rows. */
  chainBound: Record<string, number>;
  /** Object keys under `<from>/`: `table.column` → rows. */
  objectKeys: Record<string, number>;
  /** Sessions of the tenant that the move ends. */
  sessions: number;
  /** Tables that move rows and carry user triggers (an update guard among them stops the apply, which then rolls back). */
  triggers: string[];
  /** Foreign keys over the moved columns that the transaction makes deferrable and restores. */
  foreignKeys: Array<{ name: string; table: string; deferrable: boolean }>;
  /** Hypertables among the moved tables with compressed chunks (the update decompresses them; an old TimescaleDB refuses and rolls back). */
  compressed: string[];
  /** `--scan-text`: text, JSON and uuid columns that still name the old id and are not rewritten: `table.column` → rows. */
  textMentions: Record<string, number> | null;
  /** What the Redis pass would do; null without Redis. */
  redis: RekeyRedisReport | null;
  /** The app's other Redis instances, which this run leaves as they are. */
  untouchedRedis: string[];
  /** Why the move cannot run (with --apply these refuse it; a dry run reports them). */
  refusals: string[];
  /** What an --apply needs beyond a clean plan (acknowledgements, --confirm, Redis): refusals with --apply, the to-do list of a dry run. */
  applyNeeds: string[];
}

export interface RekeyRedisReport {
  /** Keys whose name holds the old id: renamed to the same name with the new id (data and TTL kept). */
  renamed: number;
  /** Of those, the string and hash values that named the old id (as a whole JSON string, or as the whole value): rewritten. */
  valuesRewritten: number;
  /** Keys whose name holds the old id and that keep that name: the new name is taken, or the server refused the RENAME (a cluster across slots). */
  notRenamed: string[];
  /** Expiring string keys of another name whose value names the old id (a cache): deleted, they rebuild. */
  byValueDeleted: number;
  /** Keys of another name whose value names the old id and that are left as they are (a hash, or a key without a TTL: shared or durable). */
  byValueKept: string[];
  /** Session cache keys of the users whose sessions end (`session:<userId>:*`). */
  sessionCache: number;
  /** BullMQ keys that name or hold the old id: never touched, listed. */
  bullSkipped: string[];
  /** What to do by hand when Redis was not reachable. */
  patterns: string[];
}

export interface RekeyResult {
  plan: RekeyPlan;
  applied: boolean;
  /** Rows moved per `table.column`, as the UPDATEs reported them. */
  moved: Record<string, number>;
  tenantKeyValuesResealed: number;
  embeddedEnvelopesResealed: number;
  /** The old tenant's ACTIVE keys retired (0 or 1). */
  keysRetired: number;
  objectsCopied: number;
  /** Keys under `<from>/` with no object in the store (the rows are rewritten all the same). */
  objectsMissing: number;
  sessionsEnded: number;
  /** Ended sessions handed to the session-revocation outbox (the worker tells the `session_revoked` hooks). */
  sessionsAnnounced: number;
  redis: RekeyRedisReport | null;
  redisError: string | null;
  reseal: { sealed: number; unreadable: number } | null;
  resealError: string | null;
}

const qi = (name: string): string => {
  if (!IDENT_RE.test(name)) throw new Error(`tenant:rekey: unsafe identifier ${JSON.stringify(name)}`);
  return `"${name}"`;
};
const rel = (schema: string, table: string) => `${qi(schema)}.${qi(table)}`;
const num = (v: unknown): number => Number(v ?? 0);
const elementType = (type: string) => type.slice(1);
const quoted = (id: string) => JSON.stringify(id);
/** The literal of a declared owner type (a constant of this file, never input). */
const typeLiteral = (v: string): string => {
  if (!/^[A-Z_]+$/.test(v)) throw new Error(`tenant:rekey: unsafe owner type ${JSON.stringify(v)}`);
  return `'${v}'`;
};
/** What every envelope under the tenant's data key starts with. */
const envelopePrefix = (tenantId: string) => `v2.tdek-${tenantId}-`;
/** One whole envelope under the tenant's data key (common field-encryption: `v2.{kid}.{iv}.{ciphertext}.{tag}`, base64url segments). */
const envelopeRe = (tenantId: string) => new RegExp(`v2\\.tdek-${tenantId}-\\d+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+`, 'g');

/** The WHERE clause that selects the rows naming `$1` in one column. */
function matchSql(c: RekeyColumn): string {
  const col = qi(c.column);
  if (c.kind === 'array') return `$1::${elementType(c.type)} = ANY(${col})`;
  if (c.kind === 'json') return `strpos(${col}::text, $1) > 0`;
  const eq = c.type === 'uuid' ? `${col} = $1::uuid` : `${col} = $1`;
  if (c.kind === 'owner') return `${qi(c.typeColumn!)} = ${typeLiteral(c.typeValue!)} AND ${eq}`;
  return eq;
}

/** The value `$1` stands for in `matchSql`: the id, or its quoted JSON string. */
const matchParam = (c: RekeyColumn, id: string) => (c.kind === 'json' ? quoted(id) : id);

function updateSql(schema: string, c: RekeyColumn): string {
  const col = qi(c.column);
  const target = rel(schema, c.table);
  if (c.kind === 'array') return `UPDATE ${target} SET ${col} = array_replace(${col}, $1::${elementType(c.type)}, $2::${elementType(c.type)}) WHERE ${matchSql(c)}`;
  if (c.kind === 'json') return `UPDATE ${target} SET ${col} = replace(${col}::text, $1, $2)::${c.type} WHERE ${matchSql(c)}`;
  return `UPDATE ${target} SET ${col} = $2 WHERE ${matchSql(c)}`;
}

async function tableExists(sql: RekeySql, schema: string, table: string): Promise<boolean> {
  const r = await sql.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`${qi(schema)}.${qi(table)}`]);
  return r.rows[0]?.ok === true;
}

async function columnType(sql: RekeySql, schema: string, table: string, column: string): Promise<string | null> {
  const r = await sql.query(
    `SELECT t.typname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attname = $3 AND a.attnum > 0 AND NOT a.attisdropped`,
    [schema, table, column],
  );
  return r.rows[0] ? String(r.rows[0].typname) : null;
}

/** Every column of the schema's tables (partitions reached through their parent) whose type is one of `types`. */
async function columnsOfTypes(sql: RekeySql, schema: string, types: string[]): Promise<Array<{ table: string; column: string; type: string }>> {
  const r = await sql.query(
    `SELECT c.relname AS "table", a.attname AS "column", t.typname AS "type"
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND a.attnum > 0 AND NOT a.attisdropped
        AND t.typname = ANY($2::text[])
      ORDER BY c.relname, a.attname`,
    [schema, types],
  );
  return r.rows.map((row) => ({ table: String(row.table), column: String(row.column), type: String(row.type) }));
}

/** Every tenant column of the schema's tables, plus the declared JSON and polymorphic references present. */
export async function discoverTenantColumns(sql: RekeySql, schema: string): Promise<RekeyColumn[]> {
  const out: RekeyColumn[] = [];
  for (const { table, column, type } of await columnsOfTypes(sql, schema, [...SCALAR_TYPES, ...ARRAY_TYPES])) {
    if (!isTenantColumnName(column) || NOT_MOVED_TABLES.has(table)) continue;
    out.push({ table, column, type, kind: ARRAY_TYPES.has(type) ? 'array' : 'scalar' });
  }
  for (const ref of EMBEDDED_TENANT_REFERENCES) {
    const type = await columnType(sql, schema, ref.table, ref.column);
    if (type === 'json' || type === 'jsonb') out.push({ table: ref.table, column: ref.column, type, kind: 'json' });
  }
  for (const ref of POLYMORPHIC_TENANT_REFERENCES) {
    const type = await columnType(sql, schema, ref.table, ref.column);
    if (type && SCALAR_TYPES.has(type) && (await columnType(sql, schema, ref.table, ref.typeColumn))) {
      out.push({ table: ref.table, column: ref.column, type, kind: 'owner', typeColumn: ref.typeColumn, typeValue: ref.typeValue });
    }
  }
  return out;
}

async function countMatches(sql: RekeySql, schema: string, c: RekeyColumn, id: string): Promise<number> {
  const r = await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, c.table)} WHERE ${matchSql(c)}`, [matchParam(c, id)]);
  return num(r.rows[0]?.n);
}

/** The tenant column of a table that decides "the tenant's rows" (its `tenantId` or `tenant_id`). */
function ownerColumnOf(columns: RekeyColumn[], table: string): RekeyColumn | undefined {
  const own = columns.filter((c) => c.table === table && c.kind === 'scalar');
  return own.find((c) => c.column === 'tenantId' || c.column === 'tenant_id') ?? undefined;
}

/**
 * Whether the row at FLEET_TENANT_ID is the fleet tenant itself, told by what only the fleet row has: its name (fixed since phase 46:
 * TenantService.update refuses renaming the fleet tenant), and on a control plane any row there (its operators are members of it). The old
 * bootstrap seed's customer at that id was called Acme Corp. A guess from members or domains would let a fleet tenant someone gave a member
 * be moved away from its id, which this tool could not undo.
 */
function isFleetRow(name: string | null, controlPlane: boolean): boolean {
  return controlPlane || name === FLEET_TENANT_NAME;
}

async function redisScan(redis: RekeyRedis, pattern: string, visit: (keys: string[]) => Promise<void>): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    if (keys.length) await visit(keys);
  } while (cursor !== '0');
}

const isBullKey = (key: string) => key.startsWith('bull:');

/** Whether a Redis value names `id` as a whole JSON string or as the whole value (what the rename rewrites). */
const valueNames = (v: string, id: string) => v === id || v.includes(quoted(id));
const rewriteValue = (v: string, from: string, to: string) => (v === from ? to : v.split(quoted(from)).join(quoted(to)));

/** Rewrites (or with `write` false only finds) the string or hash values of `key` that name `from`; true when there was one. */
async function rewriteRedisValues(redis: RekeyRedis, key: string, from: string, to: string, write: boolean): Promise<boolean> {
  const type = await redis.type(key);
  if (type === 'string') {
    const v = await redis.get(key);
    if (v === null || !valueNames(v, from)) return false;
    if (write) {
      // the TTL as it was (SET drops it; KEEPTTL needs Redis 6)
      const ttl = await redis.pttl(key);
      await (ttl > 0 ? redis.set(key, rewriteValue(v, from, to), 'PX', ttl) : redis.set(key, rewriteValue(v, from, to)));
    }
    return true;
  }
  if (type === 'hash') {
    const changed = Object.entries(await redis.hgetall(key)).filter(([, v]) => valueNames(v, from));
    if (!changed.length) return false;
    if (write) await redis.hset(key, Object.fromEntries(changed.map(([f, v]) => [f, rewriteValue(v, from, to)])));
    return true;
  }
  return false;
}

/**
 * The old id's Redis keys, moved (`apply`) or only looked at. Nothing is deleted that is data: a key whose name holds the id is RENAMED (RENAMENX,
 * its TTL kept, and its string or hash values naming the id as a whole JSON string rewritten): the tenant's automation state, dead letters,
 * usage counters, in-app inbox and caches follow it. A key of another name is deleted only when it is an expiring string whose value names the
 * id (a cache, rebuilt on the next read); a hash or a key without a TTL that names it is shared or durable (an automation partition's schedules
 * hold every tenant's items) and is listed, never touched. The session cache of `userIds` (whose sessions ended) is deleted. BullMQ keys are
 * never touched. Never FLUSHDB.
 */
export async function rekeyRedis(redis: RekeyRedis, from: string, to: string, userIds: string[], apply: boolean): Promise<RekeyRedisReport> {
  const report: RekeyRedisReport = {
    renamed: 0, valuesRewritten: 0, notRenamed: [], byValueDeleted: 0, byValueKept: [], sessionCache: 0, bullSkipped: [],
    patterns: [
      `rename every key matching *${from}* to the same name with ${to} (RENAMENX; never delete it)`,
      `delete the expiring string keys whose value names ${from}`,
      ...userIds.map((u) => `delete session:${u}:*`),
    ],
  };
  const seen = new Set<string>();
  await redisScan(redis, `*${from}*`, async (keys) => {
    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (isBullKey(k)) { report.bullSkipped.push(k); continue; }
      const target = k.split(from).join(to);
      seen.add(target);
      if (!apply) {
        if ((await redis.exists(target)) > 0) { report.notRenamed.push(k); continue; }
        report.renamed += 1;
        if (await rewriteRedisValues(redis, k, from, to, false)) report.valuesRewritten += 1;
        continue;
      }
      let done = false;
      try {
        done = (await redis.renamenx(k, target)) === 1;
      } catch {
        // a Redis Cluster refuses a rename across hash slots: the key stays as it is, and is listed
      }
      if (!done) { report.notRenamed.push(k); continue; }
      report.renamed += 1;
      if (await rewriteRedisValues(redis, target, from, to, true)) report.valuesRewritten += 1;
    }
  });
  await redisScan(redis, '*', async (keys) => {
    const doomed: string[] = [];
    for (const k of keys) {
      if (seen.has(k) || isBullKey(k)) continue;
      const type = await redis.type(k);
      if (type === 'string') {
        if ((await redis.get(k))?.includes(from) !== true) continue;
        seen.add(k);
        if ((await redis.pttl(k)) > 0) doomed.push(k);
        else report.byValueKept.push(k);
      } else if (type === 'hash' && (await redis.hvals(k)).some((v) => v.includes(from))) {
        seen.add(k);
        report.byValueKept.push(k);
      }
    }
    report.byValueDeleted += doomed.length;
    if (apply && doomed.length) await redis.unlink(...doomed);
  });
  for (const userId of userIds) {
    await redisScan(redis, `session:${userId}:*`, async (keys) => {
      const doomed = keys.filter((k) => !seen.has(k));
      doomed.forEach((k) => seen.add(k));
      report.sessionCache += doomed.length;
      if (apply && doomed.length) await redis.unlink(...doomed);
    });
  }
  return report;
}

/** Reads everything the move depends on and decides the refusals. Runs inside the caller's transaction (READ ONLY for a dry run). */
export async function planRekey(args: RekeyArgs, deps: RekeyDeps): Promise<{ plan: RekeyPlan; columns: RekeyColumn[]; userIds: string[]; envelopeColumns: string[] }> {
  const { sql } = deps;
  const schema = deps.schema ?? 'public';
  qi(schema);
  const { from, to } = args;
  const refusals = argumentRefusals(args);
  const database = String((await sql.query('SELECT current_database() AS db')).rows[0]?.db ?? '');
  const target = deps.target ?? null;
  const confirmAs = target?.host ? `${database}@${target.host}` : database;

  // Row-level security: a role that is neither a superuser, nor BYPASSRLS, nor an app_admin member asking for the bypass would count and
  // move only the rows its policies show, and call that the tenant.
  const who = (await sql.query(
    `SELECT r.rolsuper OR r.rolbypassrls AS bypass,
            (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = 'app_rls_bypass' AND n.nspname = ANY(current_schemas(false))) > 0 AS has_fn
       FROM pg_roles r WHERE r.rolname = current_user`,
  )).rows[0] ?? {};
  let bypass = who.bypass === true;
  if (!bypass && who.has_fn === true) bypass = (await sql.query('SELECT app_rls_bypass() AS ok')).rows[0]?.ok === true;
  if (!bypass) refusals.push('the connected role cannot see every row (not a superuser, no BYPASSRLS, no app_admin bypass): connect as the table owner or a superuser');

  if (!(await tableExists(sql, schema, 'tenants'))) throw new RekeyRefusedError([`schema ${schema} has no tenants table: is it the app's schema?`]);
  const fromRow = (await sql.query(`SELECT name FROM ${rel(schema, 'tenants')} WHERE "tenantId" = $1::uuid`, [from])).rows[0];
  const fromName = fromRow ? String(fromRow.name ?? '') : null;
  if (!fromRow) refusals.push(`--from ${from} is no tenant here`);
  if (from === FLEET_TENANT_ID && fromRow && isFleetRow(fromName, deps.controlPlane === true)) {
    refusals.push(deps.controlPlane
      ? '--from is the fleet tenant itself: this is a control plane (FLEET_ROLE=fleet), where the row at the fleet id is always the fleet tenant'
      : `--from is the fleet tenant itself (named ${FLEET_TENANT_NAME}): only a customer that took the fleet id moves (the old seed's Acme Corp)`);
  }
  if ((await sql.query(`SELECT 1 FROM ${rel(schema, 'tenants')} WHERE "tenantId" = $1::uuid`, [to])).rows.length) refusals.push(`--to ${to} is a tenant already`);
  if (await tableExists(sql, schema, 'tenant_databases')) {
    const own = (await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, 'tenant_databases')} WHERE "tenantId" = $1::uuid AND status <> 'DROPPED'`, [from])).rows[0];
    if (num(own?.n) > 0) refusals.push('--from has its own database (tenant_databases): this tool moves the shared schema only');
  }

  const columns = await discoverTenantColumns(sql, schema);
  const excluded = new Set(args.excludeTables);
  for (const t of excluded) if (!columns.some((c) => c.table === t)) refusals.push(`--exclude-table ${t}: no tenant column of that name in ${schema}`);

  const moves: RekeyCount[] = [];
  const kept: RekeyCount[] = [];
  const inUse: string[] = [];
  for (const c of columns) {
    const rows = await countMatches(sql, schema, c, from);
    if (rows > 0) (excluded.has(c.table) ? kept : moves).push({ ...c, rows });
    if ((await countMatches(sql, schema, c, to)) > 0) inUse.push(`${c.table}.${c.column}`);
  }
  if (inUse.length) refusals.push(`--to ${to} is in use: rows name it in ${inUse.join(', ')}`);
  const movedTables = new Set(moves.map((m) => m.table));

  // Hash chains that cover the tenant id.
  const chainBound: Record<string, number> = {};
  const hashed = (await sql.query(
    `SELECT DISTINCT c.relname AS t FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND a.attname IN ('rowHash', 'prevHash') AND a.attnum > 0 AND NOT a.attisdropped`,
    [schema],
  )).rows.map((r) => String(r.t));
  for (const m of moves) {
    if (CHAIN_BOUND_TABLES.has(m.table) || hashed.includes(m.table)) chainBound[m.table] = Math.max(chainBound[m.table] ?? 0, m.rows);
  }
  const applyNeeds: string[] = [];
  if (Object.keys(chainBound).length && !args.acceptChainBreak) {
    applyNeeds.push(`hash chains cover the tenant id in ${Object.keys(chainBound).join(', ')}: after the move they no longer verify; pass --accept-chain-break to move them anyway`);
  }

  // Object keys under the old tenant prefix: copied by the move when the store can be reached here.
  const objectKeys: Record<string, number> = {};
  for (const o of OBJECT_KEY_COLUMNS) {
    const owner = ownerColumnOf(columns, o.table);
    if (!owner || excluded.has(o.table) || !(await columnType(sql, schema, o.table, o.column))) continue;
    const r = await sql.query(
      `SELECT count(*)::bigint AS n FROM ${rel(schema, o.table)} WHERE ${qi(owner.column)} = $1::${owner.type} AND starts_with(${qi(o.column)}::text, $2)`,
      [from, `${from}/`],
    );
    if (num(r.rows[0]?.n) > 0) objectKeys[`${o.table}.${o.column}`] = num(r.rows[0]?.n);
  }
  if (Object.keys(objectKeys).length && !args.keepObjectKeys && !deps.objects) {
    applyNeeds.push(`object keys under ${from}/ in ${Object.keys(objectKeys).join(', ')} need the object store to be copied to ${to}/ and it is not reachable here (run in the app's environment); `
      + `--keep-object-keys leaves them where they are instead, and then the moved tenant can no longer presign or delete those objects`);
  }

  // Tenant data keys: the declared columns, and envelopes embedded in any other text or JSON column.
  const tenantKeyValues: Record<string, number> = {};
  const embeddedEnvelopes: Record<string, number> = {};
  const envelopeColumns: string[] = [];
  let tenantKeyRows = 0;
  if (await tableExists(sql, schema, 'tenant_keys')) {
    tenantKeyRows = num((await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, 'tenant_keys')} WHERE "tenantId" = $1::uuid`, [from])).rows[0]?.n);
  }
  if (tenantKeyRows > 0) {
    if (!deps.tenantKeys) {
      refusals.push(`--from has ${tenantKeyRows} tenant data key(s) and this run cannot open them (no key service): run the CLI in the app's environment`);
    } else {
      const declared = new Set<string>();
      for (const set of await deps.tenantKeys.sets()) {
        if (set.keyScope === 'user') continue;
        for (const column of set.columns) declared.add(`${set.table}.${column}`);
        if (excluded.has(set.table)) continue;
        const owner = set.tenantColumn ?? 'tenantId';
        for (const column of set.columns) {
          if (!(await columnType(sql, schema, set.table, column)) || !(await columnType(sql, schema, set.table, owner))) continue;
          const r = await sql.query(
            `SELECT count(*)::bigint AS n FROM ${rel(schema, set.table)} WHERE ${qi(owner)} = $1::uuid AND starts_with(${qi(column)}::text, $2)`,
            [from, envelopePrefix(from)],
          );
          if (num(r.rows[0]?.n) > 0) tenantKeyValues[`${set.table}.${column}`] = num(r.rows[0]?.n);
        }
      }
      for (const { table, column } of await columnsOfTypes(sql, schema, TEXT_TYPES)) {
        const key = `${table}.${column}`;
        if (NOT_MOVED_TABLES.has(table) || excluded.has(table) || declared.has(key)) continue;
        // a value under the tenant's key sits in one of its own rows: a table with a tenant column is read through it (its index)
        const where = envelopeWhere(columns, table, column);
        const n = num((await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, table)} WHERE ${where}`, [envelopePrefix(from), from])).rows[0]?.n);
        if (n > 0) { embeddedEnvelopes[key] = n; envelopeColumns.push(key); }
      }
      if ((Object.keys(tenantKeyValues).length || envelopeColumns.length) && !deps.tenantKeys.canSealNodeKey()) {
        refusals.push('values sealed under the old tenant key need the node field key (SETTINGS_ENCRYPTION_KEY) to be carried over: none is configured');
      }
    }
  }

  // Sessions the move ends.
  let sessions = 0;
  let userIds: string[] = [];
  if (await tableExists(sql, schema, 'user_sessions')) {
    const r = await sql.query(`SELECT DISTINCT "userId"::text AS u FROM ${rel(schema, 'user_sessions')} WHERE "tenantId" = $1::uuid`, [from]);
    userIds = r.rows.map((x) => String(x.u));
    sessions = num((await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, 'user_sessions')} WHERE "tenantId" = $1::uuid`, [from])).rows[0]?.n);
  }

  // Triggers, privileges, TimescaleDB.
  const triggers: string[] = [];
  const noPrivilege: string[] = [];
  for (const table of movedTables) {
    const t = await sql.query(
      `SELECT string_agg(tg.tgname, ', ' ORDER BY tg.tgname) AS names, has_table_privilege(c.oid, 'UPDATE') AS can_update
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_trigger tg ON tg.tgrelid = c.oid AND NOT tg.tgisinternal
        WHERE n.nspname = $1 AND c.relname = $2 GROUP BY c.oid`,
      [schema, table],
    );
    if (t.rows[0]?.names) triggers.push(`${table} (${String(t.rows[0].names)})`);
    if (t.rows[0]?.can_update === false) noPrivilege.push(table);
  }
  if (noPrivilege.length) refusals.push(`the connected role may not UPDATE ${noPrivilege.join(', ')}`);
  const compressed: string[] = [];
  const timescale = (await sql.query(`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'timescaledb'`)).rows[0];
  if (num(timescale?.n) > 0) {
    const dims = await sql.query(`SELECT hypertable_name AS t, column_name AS c FROM timescaledb_information.dimensions WHERE hypertable_schema = $1`, [schema]);
    for (const d of dims.rows) {
      if (moves.some((m) => m.table === String(d.t) && m.column === String(d.c))) {
        refusals.push(`${String(d.t)}.${String(d.c)} partitions a hypertable: moving the id would move rows between chunks`);
      }
    }
    const comp = await sql.query(`SELECT DISTINCT hypertable_name AS t FROM timescaledb_information.chunks WHERE hypertable_schema = $1 AND is_compressed`, [schema]);
    for (const r of comp.rows) if (movedTables.has(String(r.t))) compressed.push(String(r.t));
  }

  // Foreign keys over moved columns.
  const fks = await foreignKeysOver(sql, schema, columns);

  // What still names the old id after the move (opt-in, slow): text and JSON, and uuid columns this tool does not know as tenant references.
  let textMentions: Record<string, number> | null = null;
  if (args.scanText) {
    textMentions = {};
    const rewritten = new Set([...columns.map((c) => `${c.table}.${c.column}`), ...Object.keys(tenantKeyValues), ...envelopeColumns]);
    // the object keys the move rewrites (`<from>/…`) are not "left as written"; another mention in the same column is
    const prefixed = new Set(args.keepObjectKeys ? [] : Object.keys(objectKeys));
    for (const r of await columnsOfTypes(sql, schema, [...TEXT_TYPES, '_text', '_varchar', 'uuid', '_uuid'])) {
      const key = `${r.table}.${r.column}`;
      if (rewritten.has(key)) continue;
      const where = r.type === 'uuid' ? `${qi(r.column)} = $1::uuid` : r.type === '_uuid' ? `$1::uuid = ANY(${qi(r.column)})`
        : `strpos(${qi(r.column)}::text, $1) > 0${prefixed.has(key) ? ` AND NOT starts_with(${qi(r.column)}::text, $1 || '/')` : ''}`;
      const n = num((await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, r.table)} WHERE ${where}`, [from])).rows[0]?.n);
      if (n > 0) textMentions[r.type === 'uuid' || r.type === '_uuid' ? `${key} [${r.type}]` : key] = n;
    }
  }

  let redis: RekeyRedisReport | null = null;
  if (deps.redis) {
    try {
      redis = await rekeyRedis(deps.redis, from, to, userIds, false);
    } catch (e) {
      applyNeeds.push(`Redis is not reachable (${e instanceof Error ? e.message : String(e)}): the old id's keys could not be moved after the move`);
    }
  } else {
    applyNeeds.push('no Redis connection (REDIS_URL / REDIS_SENTINELS): the old id\'s keys (automation state, inboxes, caches) and sessions would stay behind');
  }

  if (args.confirm !== confirmAs) applyNeeds.push(`--apply needs --confirm ${confirmAs} (the database it writes${target?.host ? ' and its host' : ''})`);
  if (args.apply) refusals.push(...applyNeeds);

  return {
    plan: {
      database, schema, target, confirmAs, from, to, fromName, moves, excluded: kept, tenantKeyValues, embeddedEnvelopes, tenantKeyRows, chainBound, objectKeys,
      sessions, triggers, foreignKeys: fks.map((f) => ({ name: f.name, table: f.table, deferrable: f.deferrable })), compressed, textMentions, redis,
      untouchedRedis: deps.untouchedRedis ?? [], refusals, applyNeeds,
    },
    columns,
    userIds,
    envelopeColumns,
  };
}

interface ForeignKey { name: string; table: string; refTable: string; deferrable: boolean }

async function foreignKeysOver(sql: RekeySql, schema: string, columns: RekeyColumn[]): Promise<ForeignKey[]> {
  const tenantCols = new Set(columns.map((c) => `${c.table}.${c.column}`));
  const r = await sql.query(
    `SELECT con.conname AS name, src.relname AS "table", dst.relname AS "refTable", con.condeferrable AS deferrable,
            ARRAY(SELECT a.attname::text FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) AS cols,
            ARRAY(SELECT a.attname::text FROM unnest(con.confkey) k JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k) AS "refCols"
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid JOIN pg_namespace n ON n.oid = src.relnamespace
       JOIN pg_class dst ON dst.oid = con.confrelid
      WHERE con.contype = 'f' AND n.nspname = $1
      ORDER BY 2, 1`,
    [schema],
  );
  return r.rows
    .filter((f) => (f.cols as string[]).some((c) => tenantCols.has(`${String(f.table)}.${c}`)) || (f.refCols as string[]).some((c) => tenantCols.has(`${String(f.refTable)}.${c}`)))
    .map((f) => ({ name: String(f.name), table: String(f.table), refTable: String(f.refTable), deferrable: f.deferrable === true }));
}

/**
 * The moved columns in a safe order: a table that a foreign key over a tenant column references moves after the tables that reference it, so a
 * RESTRICT rule (checked at once, deferral or not) never sees a child still naming the old id. `tenants` itself is always last.
 */
export function moveOrder(moves: RekeyCount[], fks: Array<{ table: string; refTable: string }>): RekeyCount[] {
  const referenced = new Set(fks.filter((f) => f.table !== f.refTable).map((f) => f.refTable));
  const rank = (m: RekeyCount) => (m.table === 'tenants' ? 2 : referenced.has(m.table) ? 1 : 0);
  return [...moves].sort((a, b) => rank(a) - rank(b) || a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
}

/** Re-seals the old tenant's envelopes of the declared columns under the node key, guarded on the exact value read. Returns the count. */
async function carryTenantKeyValues(sql: RekeySql, schema: string, from: string, keys: RekeyTenantKeys, sets: TenantKeyColumnSet[], excluded: Set<string>): Promise<number> {
  let done = 0;
  for (const set of sets) {
    if (set.keyScope === 'user' || excluded.has(set.table)) continue;
    const owner = set.tenantColumn ?? 'tenantId';
    if (!(await columnType(sql, schema, set.table, owner)) || !(await columnType(sql, schema, set.table, set.idColumn))) continue;
    for (const column of set.columns) {
      if (!(await columnType(sql, schema, set.table, column))) continue;
      const rows = await sql.query(
        `SELECT ${qi(set.idColumn)}::text AS id, ${qi(column)} AS v FROM ${rel(schema, set.table)}
          WHERE ${qi(owner)} = $1::uuid AND starts_with(${qi(column)}::text, $2) FOR UPDATE`,
        [from, envelopePrefix(from)],
      );
      for (const row of rows.rows) {
        const sealed = keys.sealNodeKey(await keys.open(from, String(row.v)));
        const r = await sql.query(
          `UPDATE ${rel(schema, set.table)} SET ${qi(column)} = $1 WHERE ${qi(owner)} = $2::uuid AND ${qi(set.idColumn)}::text = $3 AND ${qi(column)} = $4`,
          [sealed, from, String(row.id), String(row.v)],
        );
        if ((r.rowCount ?? 0) !== 1) throw new Error(`tenant:rekey: ${set.table}.${column} row ${String(row.id)} changed while it was being carried over`);
        done += 1;
      }
    }
  }
  return done;
}

/** The rows of `table` that may embed an envelope of the tenant `$2` (prefix `$1`) in `column`: its own rows when the table has a tenant column. */
function envelopeWhere(columns: RekeyColumn[], table: string, column: string): string {
  const owner = ownerColumnOf(columns, table);
  const own = owner ? `${qi(owner.column)} = $2::${owner.type} AND ` : '$2::text IS NOT NULL AND ';
  return `${own}strpos(${qi(column)}::text, $1) > 0`;
}

/**
 * Re-seals every envelope under the old tenant's key embedded in the given text or JSON columns (`table.column`) under the node key, inside the
 * value (a JSON payload keeps its shape: an envelope is base64url and dots, never escaped). Rows are found by their partition and ctid inside this
 * transaction and written only if the value is still the one read. Returns the envelopes carried.
 */
async function carryEmbeddedEnvelopes(
  sql: RekeySql, schema: string, from: string, keys: RekeyTenantKeys, columns: RekeyColumn[], envelopeColumns: string[],
): Promise<number> {
  let done = 0;
  for (const key of envelopeColumns) {
    const [table, column] = key.split('.') as [string, string];
    const type = await columnType(sql, schema, table, column);
    if (!type) continue;
    const rows = await sql.query(
      `SELECT tableoid::regclass::text AS part, ctid::text AS at, ${qi(column)}::text AS v FROM ${rel(schema, table)} WHERE ${envelopeWhere(columns, table, column)} FOR UPDATE`,
      [envelopePrefix(from), from],
    );
    for (const row of rows.rows) {
      const before = String(row.v);
      let after = before;
      for (const envelope of new Set(before.match(envelopeRe(from)) ?? [])) {
        after = after.split(envelope).join(keys.sealNodeKey(await keys.open(from, envelope)));
        done += 1;
      }
      if (after === before) continue;
      const r = await sql.query(
        `UPDATE ${rel(schema, table)} SET ${qi(column)} = $1::${type} WHERE tableoid = $2::regclass AND ctid = $3::tid AND ${qi(column)}::text = $4`,
        [after, String(row.part), String(row.at), before],
      );
      if ((r.rowCount ?? 0) !== 1) throw new Error(`tenant:rekey: ${key} changed while its envelopes were being carried over`);
    }
  }
  return done;
}

/**
 * Copies every object of the old tenant prefix that the declared columns name to the new prefix (never deleting the original), then rewrites the
 * columns' `<from>/` to `<to>/`. Runs before anything else of the move writes or locks, so the store is read through the moving tenant's own
 * settings, still at the old id. Returns the objects copied and the keys that had no object.
 */
async function moveObjectKeys(
  sql: RekeySql, schema: string, args: RekeyArgs, columns: RekeyColumn[], objects: RekeyObjects, moved: Record<string, number>,
): Promise<{ copied: number; missing: number }> {
  const { from, to } = args;
  const copied = new Map<string, string | null>();
  for (const o of OBJECT_KEY_COLUMNS) {
    const owner = ownerColumnOf(columns, o.table);
    if (!owner || args.excludeTables.includes(o.table) || !(await columnType(sql, schema, o.table, o.column))) continue;
    const where = `${qi(owner.column)} = $1::${owner.type} AND starts_with(${qi(o.column)}::text, $2)`;
    const keys = await sql.query(`SELECT DISTINCT ${qi(o.column)}::text AS k FROM ${rel(schema, o.table)} WHERE ${where}`, [from, `${from}/`]);
    for (const row of keys.rows) {
      const key = String(row.k);
      if (copied.has(key)) continue;
      try {
        copied.set(key, await objects.copy(from, to, key));
      } catch (e) {
        throw new Error(`tenant:rekey: copying the object ${key} failed (${e instanceof Error ? e.message : String(e)}); the copies made so far stay under ${to}/ (a rerun writes them again), nothing moved`);
      }
    }
    const r = await sql.query(
      `UPDATE ${rel(schema, o.table)} SET ${qi(o.column)} = $3 || substr(${qi(o.column)}, $4) WHERE ${where}`,
      [from, `${from}/`, `${to}/`, from.length + 2],
    );
    moved[`${o.table}.${o.column} (object keys)`] = r.rowCount ?? 0;
  }
  const values = [...copied.values()];
  return { copied: values.filter((v) => v !== null).length, missing: values.filter((v) => v === null).length };
}

/** Hands the ended sessions to the session-revocation outbox in batches, so the worker tells the `session_revoked` hooks (they are idempotent). */
async function announceEndedSessions(sql: RekeySql, schema: string, tenantId: string, ended: Array<{ userSessionId: string; userId: string }>): Promise<number> {
  if (!ended.length || !(await tableExists(sql, schema, 'session_revocation_outbox'))) return 0;
  let done = 0;
  for (let i = 0; i < ended.length; i += 100) {
    const sessions = ended.slice(i, i + 100).map((s) => ({ ...s, tenantId }));
    await sql.query(
      `INSERT INTO ${rel(schema, 'session_revocation_outbox')} ("tenantId", "sessions", "failedContributions", "attempts", "nextAttemptAt", "lastError")
       VALUES ($1::uuid, $2::jsonb, $3::jsonb, 0, now(), $4)`,
      [tenantId, JSON.stringify(sessions), JSON.stringify(['*']), 'tenant:rekey ended these sessions; the session_revoked hooks run from this outbox'],
    );
    done += sessions.length;
  }
  return done;
}

/**
 * The whole run: plan inside a transaction (READ ONLY unless --apply), refuse or report, apply in the same transaction, commit, then Redis and
 * the re-seal under the new key. Throws `RekeyRefusedError` (nothing written) or the error that rolled the move back.
 */
export async function runTenantRekey(args: RekeyArgs, deps: RekeyDeps): Promise<RekeyResult> {
  const { sql } = deps;
  const schema = deps.schema ?? 'public';
  const log = deps.log ?? ((line: string) => console.log(line));
  await sql.query(args.apply ? 'BEGIN' : 'BEGIN READ ONLY');
  let open = true;
  try {
    // The bypass is asked for by an app_admin member; for a superuser or the table owner it changes nothing. A lock the running app holds
    // fails the run after 30 s instead of hanging it (stop the app first); no statement limit for the move itself. All transaction-local.
    await sql.query(`SELECT set_config('app.bypass_rls', 'on', true), set_config('lock_timeout', '30s', true), set_config('statement_timeout', '0', true)`);
    const { plan, columns, userIds, envelopeColumns } = await planRekey(args, deps);
    const result: RekeyResult = {
      plan, applied: false, moved: {}, tenantKeyValuesResealed: 0, embeddedEnvelopesResealed: 0, keysRetired: 0, objectsCopied: 0, objectsMissing: 0,
      sessionsEnded: 0, sessionsAnnounced: 0, redis: plan.redis, redisError: null, reseal: null, resealError: null,
    };
    if (!args.apply || plan.refusals.length) {
      await sql.query('ROLLBACK');
      open = false;
      if (plan.refusals.length && args.apply) throw new RekeyRefusedError(plan.refusals, result);
      return result;
    }

    // ── the move ──
    const excluded = new Set(args.excludeTables);
    // First, before any lock: the objects, read through the moving tenant's own store settings.
    if (Object.keys(plan.objectKeys).length && !args.keepObjectKeys && deps.objects) {
      const o = await moveObjectKeys(sql, schema, args, columns, deps.objects, result.moved);
      result.objectsCopied = o.copied;
      result.objectsMissing = o.missing;
      log(`[tenant:rekey] ${o.copied} object(s) copied to ${args.to}/ (${o.missing} key(s) without an object), the originals kept`);
    }

    const fks = await foreignKeysOver(sql, schema, columns);
    const altered: ForeignKey[] = [];
    for (const fk of fks) {
      if (fk.deferrable) continue;
      await sql.query(`ALTER TABLE ${rel(schema, fk.table)} ALTER CONSTRAINT ${qi(fk.name)} DEFERRABLE INITIALLY IMMEDIATE`);
      altered.push(fk);
    }
    await sql.query('SET CONSTRAINTS ALL DEFERRED');

    if (deps.tenantKeys && (Object.keys(plan.tenantKeyValues).length || envelopeColumns.length)) {
      result.tenantKeyValuesResealed = await carryTenantKeyValues(sql, schema, args.from, deps.tenantKeys, await deps.tenantKeys.sets(), excluded);
      result.embeddedEnvelopesResealed = await carryEmbeddedEnvelopes(sql, schema, args.from, deps.tenantKeys, columns, envelopeColumns);
      log(`[tenant:rekey] ${result.tenantKeyValuesResealed + result.embeddedEnvelopesResealed} value(s) under the old tenant key carried over under the node key`);
    }
    if (plan.tenantKeyRows > 0) {
      // Nothing is sealed under the old key any more: it is retired, never destroyed (the pre-move backup opens with it), and a tenant created at
      // the old id later (the fleet tenant) gets a key of its own instead of this one.
      const r = await sql.query(`UPDATE ${rel(schema, 'tenant_keys')} SET "state" = 'RETIRED', "retiredAt" = now() WHERE "tenantId" = $1::uuid AND "state" = 'ACTIVE'`, [args.from]);
      result.keysRetired = r.rowCount ?? 0;
    }

    for (const m of moveOrder(plan.moves, fks)) {
      const r = await sql.query(updateSql(schema, m), [matchParam(m, args.from), m.kind === 'json' ? quoted(args.to) : args.to]);
      result.moved[`${m.table}.${m.column}`] = r.rowCount ?? 0;
    }

    if (await tableExists(sql, schema, 'user_sessions')) {
      const r = await sql.query(
        `DELETE FROM ${rel(schema, 'user_sessions')} WHERE "tenantId" = $1::uuid RETURNING "userSessionId"::text AS s, "userId"::text AS u`, [args.to],
      );
      const ended = r.rows.map((x) => ({ userSessionId: String(x.s), userId: String(x.u) }));
      result.sessionsEnded = ended.length;
      result.sessionsAnnounced = await announceEndedSessions(sql, schema, args.to, ended);
    }

    // Every foreign key is checked now, while the transaction can still roll back; then the constraints are put back as they were.
    await sql.query('SET CONSTRAINTS ALL IMMEDIATE');
    for (const fk of altered) await sql.query(`ALTER TABLE ${rel(schema, fk.table)} ALTER CONSTRAINT ${qi(fk.name)} NOT DEFERRABLE`);

    const left: string[] = [];
    for (const c of columns) {
      if (excluded.has(c.table)) continue;
      const n = await countMatches(sql, schema, c, args.from);
      if (n > 0) left.push(`${c.table}.${c.column} (${n})`);
    }
    for (const key of [...Object.keys(plan.tenantKeyValues), ...envelopeColumns]) {
      const [table, column] = key.split('.') as [string, string];
      const n = num((await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, table)} WHERE strpos(${qi(column)}::text, $1) > 0`, [envelopePrefix(args.from)])).rows[0]?.n);
      if (n > 0) left.push(`${key} (${n} under the old key)`);
    }
    if (!args.keepObjectKeys) {
      for (const key of Object.keys(plan.objectKeys)) {
        const [table, column] = key.split('.') as [string, string];
        const n = num((await sql.query(`SELECT count(*)::bigint AS n FROM ${rel(schema, table)} WHERE starts_with(${qi(column)}::text, $1)`, [`${args.from}/`])).rows[0]?.n);
        if (n > 0) left.push(`${key} (${n} object key(s) under ${args.from}/)`);
      }
    }
    if (left.length) throw new Error(`tenant:rekey: rows still name ${args.from} after the move, rolled back: ${left.join(', ')}`);

    await sql.query('COMMIT');
    open = false;
    result.applied = true;
    log(`[tenant:rekey] committed: ${args.from} -> ${args.to}`);

    // ── after the commit: nothing here can undo the move, and a failure is reported with what is left to do ──
    if (deps.redis) {
      try {
        result.redis = await rekeyRedis(deps.redis, args.from, args.to, userIds, true);
      } catch (e) {
        result.redisError = e instanceof Error ? e.message : String(e);
      }
    }
    if (result.tenantKeyValuesResealed > 0 && deps.tenantKeys) {
      try {
        result.reseal = await deps.tenantKeys.reseal(args.to);
      } catch (e) {
        result.resealError = e instanceof Error ? e.message : String(e);
      }
    }
    return result;
  } catch (e) {
    if (open) await sql.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/** The report a person reads: what moved (or would), what was left, what is left to do. */
export function formatRekeyReport(result: RekeyResult): string {
  const { plan } = result;
  const lines: string[] = [];
  const head = result.applied ? 'APPLIED' : 'DRY RUN (nothing written)';
  const where = plan.target ? `${plan.target.user}@${plan.target.host}:${plan.target.port} (${plan.target.source}), ` : '';
  lines.push(`tenant:rekey ${head}: ${plan.from} (${plan.fromName ?? 'no tenant row'}) -> ${plan.to}  ${where}database ${plan.database}, schema ${plan.schema}`);
  const total = plan.moves.reduce((s, m) => s + m.rows, 0);
  lines.push(`rows ${result.applied ? 'moved' : 'to move'}: ${total} in ${new Set(plan.moves.map((m) => m.table)).size} table(s)`);
  for (const m of plan.moves) {
    const done = result.moved[`${m.table}.${m.column}`];
    const kind = m.kind === 'json' ? `${m.type}, embedded` : m.kind === 'owner' ? `${m.type}, where ${m.typeColumn} = ${m.typeValue}` : m.type;
    lines.push(`  ${m.table}.${m.column} [${kind}]: ${result.applied ? `${done ?? 0} moved (planned ${m.rows})` : m.rows}`);
  }
  if (plan.excluded.length) {
    lines.push('left at the old id (--exclude-table):');
    for (const m of plan.excluded) lines.push(`  ${m.table}.${m.column}: ${m.rows}`);
  }
  lines.push(`sessions ${result.applied ? 'ended' : 'to end'}: ${result.applied ? result.sessionsEnded : plan.sessions} (people sign in again; the session_revoked hooks run from the outbox${result.applied ? `: ${result.sessionsAnnounced} handed over` : ''})`);
  if (plan.tenantKeyRows || Object.keys(plan.tenantKeyValues).length) {
    lines.push(`tenant data keys of the old id: ${plan.tenantKeyRows} key row(s), kept in tenant_keys (never destroyed: the backup taken before the move opens with them); the ACTIVE one ${result.applied ? `retired (${result.keysRetired})` : 'is retired'}`);
    for (const [k, n] of Object.entries(plan.tenantKeyValues)) lines.push(`  ${k}: ${n} value(s) under the old key ${result.applied ? 'carried over' : 'to carry over'} (node key, then the new tenant's key)`);
    for (const [k, n] of Object.entries(plan.embeddedEnvelopes)) lines.push(`  ${k}: ${n} row(s) embedding envelopes under the old key, ${result.applied ? 'carried over' : 'to carry over'} (node key)`);
    if (result.applied && result.tenantKeyValuesResealed) {
      lines.push(result.resealError
        ? `  re-seal under the new tenant's key FAILED (${result.resealError}): the values stay under the node key, readable; the db-tenant-key-backfill job seals them`
        : `  re-sealed under the new tenant's key: ${result.reseal?.sealed ?? 0}${result.reseal?.unreadable ? `, ${result.reseal.unreadable} unreadable` : ''}`);
    }
  }
  if (Object.keys(plan.chainBound).length) {
    lines.push('hash chains that cover the tenant id (their verification reports a break after the move):');
    for (const [t, n] of Object.entries(plan.chainBound)) lines.push(`  ${t}: ${n}`);
  }
  if (Object.keys(plan.objectKeys).length) {
    lines.push(result.applied
      ? (result.objectsCopied || result.objectsMissing
        ? `object keys under the old tenant prefix: ${result.objectsCopied} object(s) copied to ${plan.to}/ and the rows rewritten (${result.objectsMissing} key(s) had no object); the originals stay under ${plan.from}/, never deleted`
        : 'object keys under the old tenant prefix, left where they are (--keep-object-keys): the moved tenant can no longer presign or delete them, and a tenant created at the old id can:')
      : 'object keys under the old tenant prefix (copied to the new prefix by the move, the originals kept; with --keep-object-keys left where they are):');
    for (const [k, n] of Object.entries(plan.objectKeys)) lines.push(`  ${k}: ${n}`);
  }
  if (plan.foreignKeys.length) lines.push(`foreign keys over moved columns: ${plan.foreignKeys.map((f) => `${f.table}.${f.name}${f.deferrable ? '' : ' (made deferrable for the move, restored)'}`).join(', ')}`);
  if (plan.triggers.length) lines.push(`tables with triggers (an update guard among them stops the apply, which rolls back): ${plan.triggers.join('; ')}`);
  if (plan.compressed.length) lines.push(`hypertables with compressed chunks (the update decompresses them): ${plan.compressed.join(', ')}`);
  const redis = result.redis;
  if (redis) {
    const verb = result.applied ? 'renamed' : 'to rename';
    lines.push(`redis ${verb} to the new id: ${redis.renamed} key(s) (${redis.valuesRewritten} with values naming the old id rewritten); `
      + `${redis.byValueDeleted} expiring cache key(s) ${result.applied ? 'deleted' : 'to delete'}; ${redis.sessionCache} session cache key(s); never FLUSHDB`);
    const list = (xs: string[]) => `${xs.slice(0, 20).join(', ')}${xs.length > 20 ? ', ...' : ''}`;
    if (redis.notRenamed.length) lines.push(`  kept under the old name (the new name is taken, or the server refused the rename) (${redis.notRenamed.length}): ${list(redis.notRenamed)}`);
    if (redis.byValueKept.length) lines.push(`  shared or durable keys whose values name the old id, left as they are (${redis.byValueKept.length}): ${list(redis.byValueKept)}`);
    if (redis.bullSkipped.length) lines.push(`  BullMQ keys left alone (${redis.bullSkipped.length}): ${list(redis.bullSkipped)}`);
  } else {
    lines.push('redis: not checked (no connection)');
  }
  if (plan.untouchedRedis.length) {
    lines.push(`redis instances this run does not reach, left as they are (the old id's keys there stay under it; nothing is deleted): ${plan.untouchedRedis.join(', ')}`);
  }
  if (result.redisError) lines.push(`redis pass FAILED after the commit (${result.redisError}): finish it by hand with SCAN: ${(redis?.patterns ?? [`rename every key matching *${plan.from}* to the new id`]).join('; ')}`);
  if (plan.textMentions) {
    const entries = Object.entries(plan.textMentions);
    lines.push(`columns that still name the old id and are left as written (history, labels, pointers; a [uuid] column may be a reference this tool does not know: check it): ${entries.length ? '' : 'none'}`);
    for (const [k, n] of entries) lines.push(`  ${k}: ${n}`);
  }
  if (plan.refusals.length) {
    lines.push('REFUSED:');
    for (const r of plan.refusals) lines.push(`  - ${r}`);
  } else if (!result.applied) {
    const needs = plan.applyNeeds.filter((n) => !/--confirm|--accept-chain-break/.test(n));
    lines.push(`nothing refuses it: run again with --apply --confirm ${plan.confirmAs}${Object.keys(plan.chainBound).length ? ' --accept-chain-break' : ''}`);
    for (const n of needs) lines.push(`  and first: ${n}`);
  }
  if (result.applied) lines.push('next: restart the app and the worker (in-process caches), then deploy: the fleet tenant row is created when the fleet id is free.');
  return lines.join('\n');
}
