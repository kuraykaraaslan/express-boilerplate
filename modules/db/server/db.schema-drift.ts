/**
 * Pure comparator behind `npm run db:schema:drift` and the baseline adoption: it reads the statements `synchronize`
 * would still run against a schema (db.schema-scratch.ts `logEntitySync`) and says which of them are DRIFT.
 *
 * The entities are the intent, the migrations are how a database gets there. Drift is an entity that asks for something
 * the migrated database does not have: a table, a column, an index, a constraint, an enum value, a changed type or
 * default. Those statements are what a missing migration would contain, so any of them fails the check.
 *
 * What the database has beyond the entities is allowed: SQL migrations legitimately add indexes, exclusion and CHECK
 * constraints, RLS helpers and columns TypeORM does not model, and `synchronize` would drop them. Those statements are
 * reported separately (`extra`) and never fail the check; adoption refuses to run them without an explicit flag, because
 * running them is exactly the loss of such an object.
 */

/**
 * Remove the scratch schema qualifier TypeORM puts in front of every object (`"fleet_scratch_ab12"."users"` becomes
 * `"users"`), so the file builds in whatever schema the deploy targets. Throws when the scratch name survives anywhere
 * else: a schema-bound baseline would build into the wrong place.
 */
export function stripScratchSchema(statements: ReadonlyArray<string>, schema: string): string[] {
  if (!/^[a-z0-9_]{1,63}$/.test(schema)) throw new Error(`[db-baseline] invalid scratch schema name "${schema}"`);
  const stripped = statements.map((s) => s.split(`"${schema}".`).join(''));
  const leaked = stripped.find((s) => s.includes(schema));
  if (leaked) throw new Error(`[db-baseline] the scratch schema name is still present after stripping: ${leaked.slice(0, 160)}`);
  return stripped;
}

export type SyncStatementKind =
  /** Builds something the entities declare and the database lacks: CREATE ..., ALTER TABLE ... ADD ... */
  | 'missing'
  /** Changes something that exists differently: ALTER COLUMN, RENAME, ALTER TYPE, COMMENT ... */
  | 'changed'
  /** Removes something the database has and the entities do not: DROP ..., ALTER TABLE ... DROP ... */
  | 'extra';

export interface ClassifiedStatement {
  kind: SyncStatementKind;
  /** The statement as TypeORM rendered it (may carry the schema qualifier). */
  sql: string;
  /** Best-effort short description (`CREATE TABLE "users"`), safe to print: never carries literals. */
  summary: string;
}

export interface SchemaDrift {
  /** Entities ask for these and the database lacks them: a migration is missing. */
  missing: ClassifiedStatement[];
  /** Entities ask for a different shape than the database has: a migration is missing. */
  changed: ClassifiedStatement[];
  /** The database has these and the entities do not. Informational. */
  extra: ClassifiedStatement[];
  /** `missing` + `changed` is empty. */
  inSync: boolean;
  /** Statements ignored because a freshly synchronized schema needs them too (TypeORM never settles on them). */
  noise: number;
}

const WORD = '[A-Za-z_]+';
/** First two or three keywords plus the first quoted identifier after them, e.g. `ALTER TABLE "users" ADD`. */
const HEAD = new RegExp(`^\\s*(${WORD}(?:\\s+${WORD}){0,2})`);

function leadingKeywords(sql: string): string {
  return (HEAD.exec(sql)?.[1] ?? '').toUpperCase().replace(/\s+/g, ' ');
}

/** The last quoted identifier of the object part of a statement: the table or index name without any schema. */
function objectName(sql: string): string | null {
  const m = /^\s*(?:CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TYPE)|DROP\s+(?:TABLE|INDEX|TYPE)(?:\s+IF\s+EXISTS)?|ALTER\s+(?:TABLE|TYPE))\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"\.)?"[^"]+")/i.exec(sql);
  if (!m) return null;
  const parts = m[1]!.split('"').filter((p) => p !== '' && p !== '.');
  return parts[parts.length - 1] ?? null;
}

/** What the statement does to the table or type it names, without ever echoing a literal from the statement. */
function describe(sql: string, kind: SyncStatementKind): string {
  const name = objectName(sql);
  const head = leadingKeywords(sql).replace(/\b(?:IF|NOT|EXISTS)\b\s*/g, '').trim();
  if (/^ALTER TABLE/.test(head)) {
    const action = /^\s*ALTER\s+TABLE\s+(?:"[^"]+"\.)?"[^"]+"\s+(ADD\s+CONSTRAINT|ADD\s+COLUMN|ADD|DROP\s+CONSTRAINT|DROP\s+COLUMN|DROP|ALTER\s+COLUMN|RENAME|OWNER)/i.exec(sql)?.[1];
    const verb = action ? action.toUpperCase().replace(/\s+/g, ' ') : 'ALTER';
    return `ALTER TABLE "${name ?? '?'}" ${verb}`;
  }
  if (name) return `${head} "${name}"`;
  return kind === 'extra' ? 'DROP (unrecognised object)' : `${head || 'statement'} (unrecognised)`;
}

/** `table.column` of an `ALTER TABLE "t" ALTER COLUMN "c" SET DEFAULT ...` statement (schema-neutral), else null. */
export function setDefaultTarget(sql: string): string | null {
  const m = /^\s*ALTER\s+TABLE\s+"([^"]+)"\s+ALTER\s+COLUMN\s+"([^"]+)"\s+SET\s+DEFAULT\b/i.exec(sql);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Kind of one statement. Anything that is not clearly a removal or an in-place change counts as missing (fail closed). */
export function classifySyncStatement(sql: string): ClassifiedStatement {
  const head = leadingKeywords(sql);
  let kind: SyncStatementKind;
  if (/^DROP\b/.test(head)) {
    kind = 'extra';
  } else if (/^ALTER TABLE/.test(head)) {
    const action = /^\s*ALTER\s+TABLE\s+(?:"[^"]+"\.)?"[^"]+"\s+(ADD|DROP|ALTER|RENAME|OWNER)\b/i.exec(sql)?.[1]?.toUpperCase();
    kind = action === 'DROP' ? 'extra' : action === 'ADD' ? 'missing' : 'changed';
  } else if (/^CREATE\b/.test(head)) {
    kind = 'missing';
  } else {
    kind = 'changed';
  }
  return { kind, sql, summary: describe(sql, kind) };
}

/**
 * Classify every statement `synchronize` would run. The order is kept inside each group.
 *
 * `reference` is what `synchronize` still wants to run against a schema it has just built itself. TypeORM never settles
 * on a few things (it re-issues `SET DEFAULT '{}'::jsonb` on every pass), so those statements say nothing about the
 * migrations: each one that also appears in `reference` is dropped, one for one, and counted in `noise`. Both lists must
 * be schema-neutral (`stripScratchSchema`). `isNoise` can veto a match: a statement that equals a reference statement
 * still counts as drift when it returns false for it (see `setDefaultTarget`: the reference only proves TypeORM re-issues
 * the statement, not that the migrated column already has the default).
 */
export function classifySyncStatements(
  statements: ReadonlyArray<string>,
  reference: ReadonlyArray<string> = [],
  isNoise: (sql: string) => boolean = () => true,
): SchemaDrift {
  const out: SchemaDrift = { missing: [], changed: [], extra: [], inSync: true, noise: 0 };
  const remaining = new Map<string, number>();
  for (const sql of reference) remaining.set(sql, (remaining.get(sql) ?? 0) + 1);
  for (const sql of statements) {
    const left = remaining.get(sql) ?? 0;
    if (left > 0 && isNoise(sql)) {
      remaining.set(sql, left - 1);
      out.noise += 1;
      continue;
    }
    const c = classifySyncStatement(sql);
    out[c.kind].push(c);
  }
  out.inSync = out.missing.length === 0 && out.changed.length === 0;
  return out;
}

/** Human-readable report. Summaries only: no literals, defaults or credentials from the statements are printed. */
export function formatSchemaDrift(drift: SchemaDrift, opts: { limit?: number } = {}): string {
  const limit = opts.limit ?? 50;
  const lines: string[] = [];
  const section = (title: string, items: ClassifiedStatement[]): void => {
    if (items.length === 0) return;
    lines.push(`${title} (${items.length}):`);
    for (const item of items.slice(0, limit)) lines.push(`  ${item.summary}`);
    if (items.length > limit) lines.push(`  ... and ${items.length - limit} more`);
  };
  section('Entities declare these and no migration creates them', drift.missing);
  section('Entities declare a different shape than the migrations produce', drift.changed);
  section('Present in the migrated database but not declared by an entity (allowed)', drift.extra);
  if (lines.length === 0) return `The migrated schema matches the entities (${drift.noise} TypeORM re-statement(s) ignored).`;
  if (!drift.inSync) {
    lines.push('', 'Add a migration (modules/<owner>/server/migrations/NNN_<name>.sql) that makes the database match the entity change.');
  }
  return lines.join('\n');
}
