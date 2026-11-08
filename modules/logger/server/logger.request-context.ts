import { randomUUID } from 'node:crypto';
import Logger, { type LogContext } from './logger.service';

/** What an inbound `x-request-id` must look like to be taken as is: short, and made of characters that cannot break a log line or a header. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * The request id for a request: the caller's `x-request-id` when it is well formed (so a trace can be followed across a
 * proxy or a node), otherwise a fresh uuid. An inbound value is attacker-controlled, hence the strict shape; anything else
 * is dropped, never sanitised into something that looks like the caller's.
 */
export function resolveRequestId(inbound?: string | null): string {
  return typeof inbound === 'string' && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();
}

/**
 * Opens a log context for an entry point that is not the tenant API dispatcher (an internal route, a cron route, the fleet
 * exec path): a request id from the inbound headers, and whatever else the caller already knows (`commandJti`, `tenantId`).
 * The node id needs no plumbing, the logger fills it from the env.
 */
export function runWithRequestContext<T>(
  headers: { get(name: string): string | null },
  fn: () => T,
  extra: LogContext = {},
): T {
  return Logger.runWithContext({ ...extra, requestId: resolveRequestId(headers.get('x-request-id')) }, fn);
}

/**
 * Opens a log context for one run of a background job (BullMQ handler, cron tick). There is no request, so the id is
 * `<job>.<8 hex>`: it groups the lines of one run and says which job wrote them.
 */
export function runWithJobContext<T>(job: string, fn: () => T, extra: LogContext = {}): T {
  const name = job.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40) || 'job';
  return Logger.runWithContext({ ...extra, requestId: `${name}.${randomUUID().slice(0, 8)}` }, fn);
}
