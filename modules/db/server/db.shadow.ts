import { tenantQueryContext, setQueryObserver } from './db.utils';

/**
 * Shadow mode for the RLS rollout (docs/phases/10-db Faz 3 §3.2–§3.3).
 *
 * ## What it watches, and why now
 *
 * Faz 4 switches the application onto a role with no `BYPASSRLS`. On that day
 * every tenant-scoped query that did NOT run inside a transaction carrying
 * `SET LOCAL app.current_tenant` returns zero rows. There is no error, no stack
 * trace and no partial failure — the shop is simply empty.
 *
 * The only safe way to find those paths is to look for them while the policies
 * are still dormant, in real traffic, before the cutover. That is what this
 * counter is: every tenant-scoped table touched with no tenant in context is
 * one place that will go dark, counted by table so it can be traced back to the
 * code that did it.
 *
 * ## Why counting rather than throwing
 *
 * Throwing would turn a future outage into a present one, on paths nobody has
 * migrated yet — which is the opposite of the point. Shadow mode is the phase's
 * whole reason for existing: observe, migrate, then enforce. The acceptance
 * criterion the plan sets (§3.3) reads this counter: a migrated module's tables
 * must stay at zero for a week of production traffic before the next module
 * starts.
 *
 * ## Why it runs at all in production
 *
 * TypeORM calls `logger.logQuery` on a CUSTOM logger unconditionally — the
 * `logging` option only gates the built-in console logger's own printing
 * (`PostgresQueryRunner.query`). So `TenantContextLogger` sees every query even
 * though production logging is `['error']`, which is what makes this counter a
 * production instrument rather than a development one.
 *
 * ## Why it is cheap
 *
 * The check runs only when there is NO tenant in context, and it is a set
 * lookup on a table name pulled out of the SQL with one regex. Once the rollout
 * is finished this branch is taken by cross-tenant queries only.
 */

/** Tables whose rows belong to one tenant. Set once at boot; empty until then. */
let tenantScopedTables: Set<string> = new Set();

/** Told at boot which tables are in scope — see `db.ts`. */
export function registerTenantScopedTables(tables: Iterable<string>): void {
  tenantScopedTables = new Set(tables);
}

const counts = new Map<string, number>();
let total = 0;
let warned = 0;

/** How loud to be: the first few, then every thousandth. A log line per query would be its own outage. */
function shouldWarn(): boolean {
  warned += 1;
  return warned <= 5 || warned % 1000 === 0;
}

const TABLE_RE = /(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?/i;

/**
 * Record a query that ran with no tenant in context.
 *
 * Returns silently for anything that is not a tenant-scoped table: a query on
 * `users` or `tenant_databases` outside a tenant context is ordinary.
 */
export function observeQuery(query: string): void {
  if (tenantScopedTables.size === 0) return;
  if (tenantQueryContext.getStore()) return;

  const table = TABLE_RE.exec(query)?.[1]?.toLowerCase();
  if (!table || !tenantScopedTables.has(table)) return;

  total += 1;
  counts.set(table, (counts.get(table) ?? 0) + 1);
  if (shouldWarn()) {
    console.warn(
      `[db][shadow] tenant-scoped query with no tenant in context — table=${table} `
      + `(${total} so far; this query returns 0 rows after the Faz 4 cutover)`,
    );
  }
}

/** The counter, for the rollout's acceptance check and for an ops endpoint to read. */
export function shadowStats(): { total: number; byTable: Record<string, number> } {
  return { total, byTable: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])) };
}

/** Start again — a deploy boundary, or a test. */
export function resetShadowStats(): void {
  counts.clear();
  total = 0;
  warned = 0;
}

// Installed on import: `db.ts` pulls this module in at boot, and from then on
// every query passes through `observeQuery`. Registering here rather than in
// `db.ts` keeps the wiring beside the thing being wired.
setQueryObserver(observeQuery);
