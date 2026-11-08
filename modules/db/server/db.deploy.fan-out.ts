import { Client } from 'pg';
import { describeDatabase, migrateDatabase, type DatabaseDeployReport, type DeployOptions, type DeployTarget } from './db.deploy';
import { resolveTenantDatabaseUrl } from './db.tenant-database.url';
import { parseDbUrl } from './db.utils';
import type { PostDeployOutcome } from './db.post-deploy';
import { quoteSchema } from './db.schema-ident';

/**
 * Deploy over every dedicated tenant database (`tenant_databases` rows that are not `DROPPED`), after the control
 * database itself was deployed. One `migrateDatabase` per DISTINCT database: its own advisory lock, its own
 * `_sql_migrations` ledger, its own report. Tenants that share a database (or a schema) are one unit and are listed
 * together. A database that fails (unreadable DSN, unreachable, refused plan, failing SQL) is recorded and the run
 * goes on with the next; the caller turns `failed > 0` into a non-zero exit code once everything was attempted.
 *
 * Sequential on purpose: a deploy is a rare, supervised event and one slow database must not exhaust connections on
 * the host that runs it. Nothing here opens a tenant database for anything but the deploy.
 */

export type FanOutOutcome = 'migrated' | 'failed' | 'skipped';

export interface FanOutEntry {
  /** The tenants this database serves, ascending. */
  tenantIds: string[];
  /** Distinct region ids of those tenants (usually zero or one). */
  regionIds: string[];
  /** `host:port/db[#schema]`, never credentials; `<unreadable>` when the DSN could not be resolved. */
  database: string;
  outcome: FanOutOutcome;
  /** The per-database report; null when the database was never reached or was skipped. */
  report: DatabaseDeployReport | null;
  /** Why it failed or was skipped. Never contains a DSN. */
  error: string | null;
  /** The opted-in `db:post_deploy` steps run on this database (`tenantPostDeploy`); absent when none ran. Best effort, never fails the entry. */
  postDeploy?: PostDeployOutcome[];
}

export interface FanOutResult {
  entries: FanOutEntry[];
  migrated: number;
  failed: number;
  skipped: number;
}

interface RegistryRow {
  tenantId: string;
  databaseUrlEnc: string | null;
  regionId: string | null;
}

async function readRegistry(control: DeployTarget): Promise<RegistryRow[]> {
  const client = new Client({ connectionString: control.url });
  await client.connect();
  try {
    if (control.schema) await client.query(`SET search_path TO ${quoteSchema(control.schema)}, public`);
    const table = await client.query<{ present: boolean }>(`SELECT to_regclass('tenant_databases') IS NOT NULL AS present`);
    if (table.rows[0]?.present !== true) return [];
    const { rows } = await client.query<RegistryRow>(
      `SELECT "tenantId", "databaseUrlEnc", "regionId" FROM tenant_databases
       WHERE "status" IN ('PROVISIONING', 'ACTIVE') ORDER BY "tenantId"`,
    );
    return rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Copy the schema version a database was migrated to into its registry rows. Bookkeeping: a failure is a warning. */
async function recordSchemaVersion(control: DeployTarget, tenantIds: string[], schemaVersion: string): Promise<void> {
  const client = new Client({ connectionString: control.url });
  try {
    await client.connect();
    if (control.schema) await client.query(`SET search_path TO ${quoteSchema(control.schema)}, public`);
    await client.query(
      'UPDATE tenant_databases SET "schemaVersion" = $2 WHERE "tenantId" = ANY($1::uuid[])',
      [tenantIds, schemaVersion],
    );
  } catch (err) {
    console.warn(`[db-deploy] could not record schemaVersion in tenant_databases: ${(err as Error).message}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Server, port, database and schema: what makes two DSNs the same database. An absent schema is `public` and an absent
 * port is 5432, so `host/db` and `host:5432/db` are one database (a tenant row that spells the control database
 * differently must still be recognised as the control database, not migrated a second time with other credentials).
 * Credentials and query options are not part of it. A DSN that cannot be parsed is its own database: it must never be
 * merged with another unparseable one.
 */
function identityOf(target: DeployTarget): string {
  const schema = target.schema || 'public';
  try {
    const u = new URL(target.url);
    return `${u.hostname.toLowerCase()}:${u.port || '5432'}${u.pathname}#${schema}`;
  } catch {
    return `unparseable:${target.url}#${schema}`;
  }
}

const PLAIN_SCHEMA = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A failure while reading the DSN of one row: reported per row, the run continues. */
function unreadable(row: RegistryRow, error: string): FanOutEntry {
  return {
    tenantIds: [row.tenantId],
    regionIds: row.regionId ? [row.regionId] : [],
    database: '<unreadable>',
    outcome: 'failed',
    report: null,
    error,
  };
}

export async function fanOutDeploy(control: DeployTarget, opts: DeployOptions = {}): Promise<FanOutResult> {
  const rows = await readRegistry(control);
  const controlIdentity = identityOf(control);

  const entries: FanOutEntry[] = [];
  const groups = new Map<string, { target: DeployTarget; tenantIds: string[]; regionIds: Set<string> }>();
  for (const row of rows) {
    let target: DeployTarget;
    try {
      target = parseDbUrl(resolveTenantDatabaseUrl(row));
      // The schema is spliced into `SET search_path` / `CREATE SCHEMA` as a quoted identifier by the deploy runner; a
      // registry row (data, not operator configuration) must not be able to break out of the quotes.
      if (target.schema !== undefined && !PLAIN_SCHEMA.test(target.schema)) throw new Error('the schema name of the database URL is not a plain identifier');
    } catch (err) {
      entries.push(unreadable(row, message(err)));
      continue;
    }
    const key = identityOf(target);
    const group = groups.get(key) ?? { target, tenantIds: [], regionIds: new Set<string>() };
    group.tenantIds.push(row.tenantId);
    if (row.regionId) group.regionIds.add(row.regionId);
    groups.set(key, group);
  }

  for (const [identity, group] of groups) {
    const entry: FanOutEntry = {
      tenantIds: group.tenantIds,
      regionIds: [...group.regionIds].sort(),
      database: describeDatabase(group.target),
      outcome: 'migrated',
      report: null,
      error: null,
    };
    entries.push(entry);
    if (identity === controlIdentity) {
      // Tenants registered on the control database itself were just deployed with it.
      entry.outcome = 'skipped';
      entry.error = 'same database as the control database';
      continue;
    }
    try {
      entry.report = await migrateDatabase(group.target, opts);
      if (entry.report.failed.length > 0) {
        entry.outcome = 'failed';
        entry.error = entry.report.failed.map((f) => `${f.name}: ${f.message}`).join('; ');
      } else {
        if (entry.report.schemaVersion) await recordSchemaVersion(control, group.tenantIds, entry.report.schemaVersion);
        if (opts.tenantPostDeploy) {
          // Loaded lazily: the step loader needs the host runtime, which a fan-out without post-deploy steps never touches.
          const [{ postDeploy }, { ENTITIES }] = await Promise.all([import('./db.post-deploy'), import('@kuraykaraaslan-labs/db')]);
          entry.postDeploy = await postDeploy(group.target, ENTITIES, { tenantDatabase: true });
        }
      }
    } catch (err) {
      // Connection and lock errors throw out of migrateDatabase; they must not stop the databases after this one.
      entry.outcome = 'failed';
      entry.error = message(err);
    }
  }

  const count = (outcome: FanOutOutcome) => entries.filter((e) => e.outcome === outcome).length;
  return { entries, migrated: count('migrated'), failed: count('failed'), skipped: count('skipped') };
}

/** One line per database for the deploy log: what it is, how many tenants it serves, and what happened. */
export function describeFanOutEntry(entry: FanOutEntry): string {
  const regions = entry.regionIds.length > 0 ? ` region ${entry.regionIds.join(',')}` : '';
  const what = entry.outcome === 'migrated' && entry.report
    ? `applied ${entry.report.applied.length}, skipped ${entry.report.skipped.length}, stamped ${entry.report.stamped.length}`
    : (entry.error ?? '');
  const post = entry.postDeploy && entry.postDeploy.length > 0
    ? `; post-deploy ${entry.postDeploy.filter((o) => o.ok).length} ok, ${entry.postDeploy.filter((o) => !o.ok).length} failed`
    : '';
  return `tenant database ${entry.database}${regions} (${entry.tenantIds.length} tenant(s)): ${entry.outcome}${what ? ` - ${what}` : ''}${post}`;
}
