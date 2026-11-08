/**
 * The timing rules of the platform-held certificates (phase 51), pure so the queue, the sweep and the tests share one answer.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Owner's number (2026-10-31): renew three days before expiry. A setting may move it within these bounds. */
export const DEFAULT_RENEW_BEFORE_DAYS = 3;
export const MIN_RENEW_BEFORE_DAYS = 1;
export const MAX_RENEW_BEFORE_DAYS = 30;

export function clampRenewBeforeDays(days: unknown): number {
  if (days === null || days === undefined || days === '') return DEFAULT_RENEW_BEFORE_DAYS;
  const n = typeof days === 'number' ? days : Number(days);
  if (!Number.isFinite(n)) return DEFAULT_RENEW_BEFORE_DAYS;
  return Math.min(MAX_RENEW_BEFORE_DAYS, Math.max(MIN_RENEW_BEFORE_DAYS, Math.floor(n)));
}

/** When the sweep starts renewing a certificate that expires at `notAfter`. */
export function renewAfterOf(notAfter: Date, renewBeforeDays: number = DEFAULT_RENEW_BEFORE_DAYS): Date {
  return new Date(notAfter.getTime() - clampRenewBeforeDays(renewBeforeDays) * DAY_MS);
}

/** Back-off after the n-th failed order in a row (n >= 1): 15 min, 1 h, 4 h, then 12 h. */
export function backoffMs(attempts: number): number {
  const steps = [15 * MINUTE_MS, HOUR_MS, 4 * HOUR_MS, 12 * HOUR_MS];
  return steps[Math.min(Math.max(attempts, 1), steps.length) - 1];
}

/** A rate limit waits at least this long even when the CA's Retry-After is shorter or absent (Let's Encrypt windows are a week). */
export const RATE_LIMIT_MIN_BACKOFF_MS = 6 * HOUR_MS;

/** The stored `lastError`: bounded, and never a PEM block (a key must not reach a column that an API or an audit row reads). */
export function sanitizeOrderError(message: string): string {
  return message.replace(/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g, '[pem removed]').slice(0, 500);
}

export type CertificateAction = 'issue' | 'renew' | 'wait' | 'none';

export interface HeldCertificateState {
  certPem?: string | null;
  notAfter?: Date | null;
  renewAfter?: Date | null;
  retryAt?: Date | null;
}

/**
 * What the sweep (and an order that was asked for) does with a domain that may hold a certificate, at `now`:
 *  - `issue`: none held, or the held one has expired;
 *  - `renew`: held, and inside the renew-before window;
 *  - `wait`: one of the above is due, but the last order failed and its back-off has not passed (`force` ignores the wait);
 *  - `none`: a good certificate with time to spare.
 * A renewal that keeps failing is retried on the back-off ladder for the whole window, so the certificate is still tried until it expires.
 */
export function certificateAction(held: HeldCertificateState | null | undefined, now: Date, force = false): CertificateAction {
  const hasCert = !!held?.certPem && !!held.notAfter;
  const expired = hasCert && held!.notAfter!.getTime() <= now.getTime();
  const due = !hasCert || expired || (!!held!.renewAfter && held!.renewAfter.getTime() <= now.getTime());
  if (!due) return 'none';
  if (!force && held?.retryAt && held.retryAt.getTime() > now.getTime()) return 'wait';
  return hasCert && !expired ? 'renew' : 'issue';
}

/**
 * The certificate row that counts for `domain` under the directory the installation orders from now (`null` = the platform does not order,
 * nothing to compare): the row of another name (a renamed free subdomain) and the row another authority issued (the staging directory of a
 * first round, a replaced CA) are no certificate for this host.
 */
export function ownCertificate<T extends { domain: string; directoryUrl?: string | null }>(row: T | null | undefined, domain: string, directoryUrl: string | null): T | null {
  if (!row || row.domain !== domain.toLowerCase()) return null;
  if (directoryUrl !== null && row.directoryUrl !== directoryUrl) return null;
  return row;
}
