/**
 * A connection-level database failure (02 P0-T-21, P0-E8): the writer throws it as it is, so the engine abandons the run unsettled,
 * pauses reading until its probe is green and dead-letters nothing. Anything else a statement raises (a constraint, a bad value) is
 * a row error: the writer retries row by row and reports the rows that still fail. The same judgement as the automation engine's
 * `isConnectionFailure` (`engine/outage.ts`), by SQLSTATE where the driver gives one and by the drivers' texts otherwise; kept here
 * so this module does not need the engine.
 */
/** Class 08 (connection exception), 57P01-57P03 (admin or crash shutdown, cannot connect now), 53300 (too many connections). */
const CONNECTION_SQLSTATE = /^(08|57P0[1-3]|53300)/;
const CONNECTION_TEXT = new RegExp([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN',
  'connection (terminated|refused|closed|ended|lost)',
  'Connection is closed',
  'terminating connection',
  'the database system is (starting up|shutting down|in recovery)',
  'remaining connection slots',
  'pool.*(unavailable|timeout|exhausted|ended)',
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error',
  'DataSource is not initialized',
  'Query runner already released',
].join('|'), 'i');

export function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CONNECTION_SQLSTATE.test(code)) return true;
  const text = e instanceof Error ? `${e.name} ${e.message} ${typeof code === 'string' ? code : ''}` : String(e);
  return CONNECTION_TEXT.test(text);
}

/** The short reason of a row a statement refused: `save_failed:<SQLSTATE>` (never the message, which may carry a value). */
export function rowFailureReason(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `save_failed:${code}` : 'save_failed';
}
