import Logger from '@kuraykaraaslan-labs/logger';
import { env } from '@kuraykaraaslan-labs/env';
import { TenantContextLogger, tenantQueryContext } from './db.utils';

/** A SQL statement in a log line is capped: a generated bulk insert can be megabytes. */
const MAX_ERROR_QUERY_CHARS = 2000;
const MAX_SLOW_QUERY_CHARS = 200;

/**
 * The TypeORM logger of every DataSource: `TenantContextLogger` with its two query lines routed through the application
 * Logger instead of `console`.
 *
 * SQL text is restricted content (class X, docs/phases/02-fleet/01-data-classification): it can carry literals taken from
 * tenant data. So both lines are written inside `Logger.runRestricted`, which marks them `class=X` for the collector of a
 * node to keep out of the default stream, and they go through the Logger's value redaction (email, card, JWT, IBAN).
 * Bind PARAMETERS are never logged: the ORM hands them to these methods and nothing here reads them.
 *
 * On the single role the lines used to appear on stdout whatever the log transport. When the Logger writes to a file instead
 * (production, no LOG_TO_STDOUT), the original console line is kept as well, so an operator tailing the container sees what
 * they always saw. A node or fleet role has no such history and writes to the Logger only.
 */
export class LoggerRoutedQueryLogger extends TenantContextLogger {
  private static keepsConsoleLine(): boolean {
    return (env.FLEET_ROLE ?? 'single') === 'single' && !Logger.writesToConsole();
  }

  override logQueryError(error: string | Error, query: string, _parameters?: unknown[]): void {
    const msg = typeof error === 'string' ? error : error.message;
    const line = `[db] query error: ${msg} — ${query.slice(0, MAX_ERROR_QUERY_CHARS)}`;
    Logger.runRestricted(() => Logger.error(line));
    if (LoggerRoutedQueryLogger.keepsConsoleLine()) console.error(`[db] query error: ${msg} — ${query}`);
  }

  override logQuerySlow(time: number, query: string, _parameters?: unknown[]): void {
    const ctx = tenantQueryContext.getStore();
    const tag = ctx ? `tenant=${ctx.tenantId}` : 'tenant=unknown';
    const line = `[db] slow query (${time}ms) [${tag}]: ${query.slice(0, MAX_SLOW_QUERY_CHARS)}`;
    Logger.runRestricted(() => Logger.warn(line));
    if (LoggerRoutedQueryLogger.keepsConsoleLine()) console.warn(line);
  }
}
