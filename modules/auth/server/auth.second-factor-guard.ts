/**
 * Phase 55 00.5 (P-5): wrong second-factor codes are no longer invisible. Every code a person types after the first factor (an e-mail or
 * SMS one-time code, an authenticator-app code, a recovery code) that does not verify:
 *
 *  1. counts where it can only hurt the one who typed it. Two scopes (`secondFactorScopeOf`):
 *     - ACCOUNT (the `sign_in` flow, the step after the password, and a caller that names no flow): a PER-USER counter shared by every
 *       method: `SECOND_FACTOR_MAX_FAILURES` (10) wrong codes within `SECOND_FACTOR_WINDOW_SECONDS` (15 min) block the account's sign-in
 *       codes for `SECOND_FACTOR_BLOCK_BASE_SECONDS` (15 min), doubled for each repeat block within `SECOND_FACTOR_OFFENSE_MEMORY_SECONDS`
 *       (24 h), capped at `SECOND_FACTOR_BLOCK_MAX_SECONDS` (24 h): 15 min, 30 min, 1 h, 2 h, 4 h, 8 h, 16 h, 24 h. Why per user: the
 *       e-mail / SMS attempt budget is per session (`otp:attempts:<session>`) and a new sign-in mints a new session, so before this a
 *       person's password was enough to guess codes without bound. Only someone holding the password reaches this step, so only a
 *       password holder can feed this block (FWA-5).
 *     - SESSION (every other flow: step-up, TOTP disable, e-mail / SMS enable and disable, e-signature binding, impersonation step-up,
 *       legal hold, `other`): these are typed inside a signed-in session, which a stolen cookie is enough for. They count on THAT
 *       session only (`SECOND_FACTOR_SESSION_MAX_FAILURES`, 5, within the same window), never on the account: at the threshold the
 *       session is ended (and its in-session codes refused for `SECOND_FACTOR_SESSION_BLOCK_SECONDS` in case the end did not land), so
 *       a cookie thief loses the session instead of locking the owner out of sign-in. The account block does not refuse in-session
 *       codes either: a password holder guessing at sign-in cannot take the owner's live sessions' step-ups with it. An in-session flow
 *       whose caller cannot name the session counts on nothing (it is still struck and audited; TOTP's own per-user lock still bounds it).
 *     While blocked a code is refused (429 `SECOND_FACTOR_BLOCKED`, `Retry-After`) before it is looked at, so a blocked attempt neither
 *     verifies nor counts. A verified code clears its own scope's counter (not the offense memory). TOTP's own counter (5 / 15 min,
 *     `TOTP_LOCKED`) stays and is the tighter one for authenticator codes alone; the session threshold equals it, so one stolen session
 *     cannot push it past its limit before the session ends.
 *     This is the guessing-lock style of the password lock (`user_security.login.service.ts`), kept apart from it: it blocks codes only,
 *     never a sign-in method, and never the security lock of 0.1.
 *  2. is one strike for the request's address in the cross-account strike store (`IpStrikeService.recordStrike`), but only when the
 *     request's lane takes part in IP bans (38 L-4: `human-web`, `human-native`, `public-anon`); a machine or device lane never strikes an
 *     address. Callers without a request (an impersonation step-up, a legal hold order) count per user only.
 *  3. is audited as `auth.second_factor_failed`, aggregated: ONE row per (tenant, user, minute) carrying the count and the count per
 *     method, written when the minute is over, so a burst of guesses is one row a minute, never a row per guess. The block itself writes
 *     `auth.second_factor_blocked` (high) at once.
 *
 * Note for the merge with feat/fw-00-edge (00.3): that lane adds a shared refusal aggregator (`common/server/refusal-sink.ts` +
 * `audit_log.refusals.ts`) with a leader sweep for orphaned buckets. The aggregation here is a local equivalent (the counting process's
 * timer only; a bucket whose process stops before its minute ends is lost, the counter and the block are not); once both are on main it
 * can report through `reportRefusal` instead.
 *
 * Everything here is best-effort except the block check: recording a failure never throws into the refusal it follows, while
 * `assertSecondFactorOpen` fails closed (503) when Redis cannot answer, like every code check that reads Redis.
 */
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { outsideProbeRun } from '@kuraykaraaslan-labs/common/server/common.firewall-probe-run';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import AuthMessages from './auth.messages';

/** Wrong codes within the window that block the account's second-factor checks. */
export const SECOND_FACTOR_MAX_FAILURES = 10;
/** The window the wrong codes are counted in, seconds (from the first wrong code). */
export const SECOND_FACTOR_WINDOW_SECONDS = 15 * 60;
/** First block, seconds; every repeat block within the offense memory doubles it. */
export const SECOND_FACTOR_BLOCK_BASE_SECONDS = 15 * 60;
/** Longest block, seconds. */
export const SECOND_FACTOR_BLOCK_MAX_SECONDS = 24 * 60 * 60;
/** How long a block is remembered for the doubling, seconds. */
export const SECOND_FACTOR_OFFENSE_MEMORY_SECONDS = 24 * 60 * 60;
/** Wrong in-session codes within the window that end the session they were typed in. */
export const SECOND_FACTOR_SESSION_MAX_FAILURES = 5;
/** How long an ended session's in-session codes stay refused, seconds (the session row is gone; this covers an end that did not land). */
export const SECOND_FACTOR_SESSION_BLOCK_SECONDS = 24 * 60 * 60;
/** Every Redis call here is bounded: a slow Redis must not hold a sign-in answer. */
export const SECOND_FACTOR_REDIS_TIMEOUT_MS = 500;

/** Audit aggregation: the minute a row covers, the grace after it before the row is written, and the bucket's TTL. */
export const SECOND_FACTOR_AUDIT_WINDOW_MS = 60_000;
export const SECOND_FACTOR_AUDIT_GRACE_MS = 5_000;
export const SECOND_FACTOR_AUDIT_BUCKET_TTL_SECONDS = 300;

export type SecondFactorKind = 'email_otp' | 'sms_otp' | 'totp' | 'recovery_code';

/** Where the code was typed (audit metadata only; the counter is shared by all of them). */
export type SecondFactorFlow =
  | 'sign_in'
  | 'otp_enable'
  | 'otp_disable'
  | 'step_up'
  | 'totp_disable'
  | 'e_signature'
  | 'impersonation_step_up'
  | 'legal_hold'
  | 'other';

/** What a caller knows about the attempt. Everything is optional: without it the failure still counts per user and is audited. */
export interface SecondFactorAttempt {
  /** The client address, read through the trusted hops (`clientIpOf`); null or absent when unknown. */
  ipAddress?: string | null;
  /** True only when the request's lane takes part in IP bans (`LANE_POLICY[lane].banParticipation === true`, 38 L-4). */
  humanLane?: boolean;
  /** The tenant the attempt was made in; the audit rows go to it (null = the platform / ROOT tenant). */
  tenantId?: string | null;
  flow?: SecondFactorFlow;
  /** The session the code was typed in. An in-session flow (every flow but `sign_in`) counts on it; without it, on nothing. */
  userSessionId?: string | null;
}

export type SecondFactorBlock = { userId: string; offense: number; blockedAt: number; until: number; userSessionId?: string };

/** Where a failure counts and which block refuses the attempt (see the header). Pure. */
export type SecondFactorScope = 'account' | 'session' | 'none';
export function secondFactorScopeOf(attempt: SecondFactorAttempt | undefined): SecondFactorScope {
  const flow = attempt?.flow;
  if (flow === undefined || flow === 'sign_in') return 'account';
  return typeof attempt?.userSessionId === 'string' && attempt.userSessionId ? 'session' : 'none';
}

export const secondFactorFailKey = (userId: string) => `auth:2fa:fail:${userId}`;
export const secondFactorBlockKey = (userId: string) => `auth:2fa:block:${userId}`;
export const secondFactorOffenseKey = (userId: string) => `auth:2fa:offense:${userId}`;
export const secondFactorSessionFailKey = (userSessionId: string) => `auth:2fa:sfail:${userSessionId}`;
export const secondFactorSessionBlockKey = (userSessionId: string) => `auth:2fa:sblock:${userSessionId}`;
export const secondFactorAuditBucketKey = (tenantId: string | null, userId: string, minute: number) =>
  `auth:2fa:audit:${tenantId ?? 'root'}:${userId}:${minute}`;

function bounded<T>(work: Promise<T> | T, ms = SECOND_FACTOR_REDIS_TIMEOUT_MS): Promise<T> {
  const pending = Promise.resolve(work);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`redis did not answer within ${ms} ms`)), ms);
  });
  pending.catch(() => {}); // a late rejection after the bound must not surface as unhandled
  return Promise.race([pending, bound]).finally(() => clearTimeout(timer));
}

/** Block length for the nth block (1-based): the base doubled per repeat, capped. Pure. */
export function secondFactorBlockSecondsFor(offense: number): number {
  const n = Math.max(1, Math.floor(Number.isFinite(offense) ? offense : 1));
  return Math.min(SECOND_FACTOR_BLOCK_MAX_SECONDS, SECOND_FACTOR_BLOCK_BASE_SECONDS * 2 ** Math.min(n - 1, 30));
}

/** A stored block, or null when the value is not one (a hand-written key, an older shape). */
function parseBlock(raw: unknown): SecondFactorBlock | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SecondFactorBlock> | null;
    if (!v || typeof v !== 'object' || typeof v.userId !== 'string') return null;
    if (![v.offense, v.blockedAt, v.until].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const block: SecondFactorBlock = { userId: v.userId, offense: v.offense!, blockedAt: v.blockedAt!, until: v.until! };
    if (typeof v.userSessionId === 'string') block.userSessionId = v.userSessionId;
    return block;
  } catch {
    return null;
  }
}

/** Audit writes in flight (fire-and-forget for the caller; `flushSecondFactorAuditsNow` waits for them). */
const pendingWrites = new Set<Promise<void>>();

function writeAudit(row: Record<string, unknown>): void {
  const p = (async () => {
    try {
      const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
      await AuditLogService.log(row as never);
    } catch (err) {
      Logger.warn(`[auth.second-factor] audit row not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
  pendingWrites.add(p);
  void p.finally(() => pendingWrites.delete(p));
}

/**
 * Refuses (429 `SECOND_FACTOR_BLOCKED`, `Retry-After`) while the attempt's scope is blocked: the account's block for a sign-in code
 * (or an attempt that names no flow), the session's block for an in-session code; nothing for an in-session code without a session.
 * 503 when Redis cannot answer (the code checks after it read Redis too, so failing closed here costs nothing a working check would not).
 */
export async function assertSecondFactorOpen(userId: string, attempt?: SecondFactorAttempt): Promise<void> {
  const scope = secondFactorScopeOf(attempt);
  if (scope === 'none') return;
  const key = scope === 'session' ? secondFactorSessionBlockKey(attempt!.userSessionId!) : secondFactorBlockKey(userId);
  let block: SecondFactorBlock | null;
  try {
    block = parseBlock(await bounded(redis.get(key)));
  } catch {
    throw new AppError(AuthMessages.SECOND_FACTOR_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
  }
  const now = Date.now();
  if (!block || block.until <= now) return;
  const wait = Math.max(1, Math.ceil((block.until - now) / 1000));
  throw new AppError(AuthMessages.SECOND_FACTOR_BLOCKED, 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
    retryable: true,
    headers: { 'Retry-After': String(wait) },
  });
}

/** The active block of an account's second-factor checks, or null. Throws when Redis cannot answer (an admin screen says "unavailable"). */
export async function getSecondFactorBlock(userId: string): Promise<SecondFactorBlock | null> {
  const block = parseBlock(await bounded(redis.get(secondFactorBlockKey(userId))));
  return block && block.until > Date.now() ? block : null;
}

/**
 * One wrong second-factor code of this account. Counts it in its scope (per user for a sign-in code, per session for an in-session one)
 * and starts that scope's block at the threshold, strikes the address when the lane is a human one, and adds it to the minute's audit
 * row. Never throws. Answers the block this failure started, or null.
 */
export async function recordSecondFactorFailure(
  userId: string,
  kind: SecondFactorKind,
  attempt: SecondFactorAttempt = {},
): Promise<SecondFactorBlock | null> {
  if (!userId) return null;
  const ipAddress = attempt.ipAddress && attempt.ipAddress !== 'unknown' ? attempt.ipAddress : null;

  // 38 L-4: only a human lane's address is struck; the strike store bounds its own Redis calls and never throws.
  if (attempt.humanLane === true && ipAddress) {
    try {
      const { default: IpStrikeService } = await import('@kuraykaraaslan-labs/limiter/server/limiter.ip-strikes');
      await IpStrikeService.recordStrike(ipAddress, 'second_factor_failed');
    } catch (err) {
      Logger.warn(`[auth.second-factor] strike not recorded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await countForAudit(userId, kind, attempt, ipAddress);

  const scope = secondFactorScopeOf(attempt);
  if (scope === 'none') return null;
  if (scope === 'session') return recordSessionFailure(userId, attempt.userSessionId!, kind, attempt, ipAddress);

  try {
    const failKey = secondFactorFailKey(userId);
    // SET NX EX first so the counter always carries the window's TTL (INCR keeps it), as TOTPService.checkCode does.
    await bounded(redis.set(failKey, '0', 'EX', SECOND_FACTOR_WINDOW_SECONDS, 'NX'));
    const failures = Number(await bounded(redis.incr(failKey)));
    if (failures === 1) await bounded(redis.expire(failKey, SECOND_FACTOR_WINDOW_SECONDS));
    if (!(failures >= SECOND_FACTOR_MAX_FAILURES)) return null;
    return await startBlock(userId, failures, kind, attempt, ipAddress);
  } catch (err) {
    Logger.warn(`[auth.second-factor] failure not counted: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function startBlock(
  userId: string,
  failures: number,
  kind: SecondFactorKind,
  attempt: SecondFactorAttempt,
  ipAddress: string | null,
): Promise<SecondFactorBlock | null> {
  const blockKey = secondFactorBlockKey(userId);
  // A failure counted while a block already holds (a concurrent guess that passed the check before the block landed) extends nothing.
  if (parseBlock(await bounded(redis.get(blockKey)))) return null;
  const offenseKey = secondFactorOffenseKey(userId);
  const offense = Number(await bounded(redis.incr(offenseKey))) || 1;
  await bounded(redis.expire(offenseKey, SECOND_FACTOR_OFFENSE_MEMORY_SECONDS));
  const seconds = secondFactorBlockSecondsFor(offense);
  const now = Date.now();
  const block: SecondFactorBlock = { userId, offense, blockedAt: now, until: now + seconds * 1000 };
  const set = await bounded(redis.set(blockKey, JSON.stringify(block), 'EX', seconds, 'NX'));
  if (set !== 'OK') return null; // another process started it
  await bounded(redis.del(secondFactorFailKey(userId))).catch(() => 0);
  writeAudit({
    tenantId: attempt.tenantId ?? null,
    actorId: userId,
    actorType: 'USER',
    action: AuditActions.AUTH_SECOND_FACTOR_BLOCKED,
    resourceType: 'user_security',
    resourceId: userId,
    ipAddress,
    metadata: {
      scope: 'account',
      failures,
      offense,
      seconds,
      until: new Date(block.until).toISOString(),
      lastKind: kind,
      flow: attempt.flow ?? 'other',
    },
  });
  return block;
}

/**
 * An in-session wrong code: counts on the session; at `SECOND_FACTOR_SESSION_MAX_FAILURES` the session's in-session codes are refused and
 * the session is ended. The account's counter, block and offense memory are not touched. Never throws.
 */
async function recordSessionFailure(
  userId: string,
  userSessionId: string,
  kind: SecondFactorKind,
  attempt: SecondFactorAttempt,
  ipAddress: string | null,
): Promise<SecondFactorBlock | null> {
  try {
    const failKey = secondFactorSessionFailKey(userSessionId);
    await bounded(redis.set(failKey, '0', 'EX', SECOND_FACTOR_WINDOW_SECONDS, 'NX'));
    const failures = Number(await bounded(redis.incr(failKey)));
    if (failures === 1) await bounded(redis.expire(failKey, SECOND_FACTOR_WINDOW_SECONDS));
    if (!(failures >= SECOND_FACTOR_SESSION_MAX_FAILURES)) return null;
    const now = Date.now();
    const seconds = SECOND_FACTOR_SESSION_BLOCK_SECONDS;
    const block: SecondFactorBlock = { userId, offense: 1, blockedAt: now, until: now + seconds * 1000, userSessionId };
    const set = await bounded(redis.set(secondFactorSessionBlockKey(userSessionId), JSON.stringify(block), 'EX', seconds, 'NX'));
    if (set !== 'OK') return null; // already ended by a concurrent failure
    await bounded(redis.del(failKey)).catch(() => 0);
    let sessionEnded = false;
    try {
      const { default: UserSessionService } = await import('@kuraykaraaslan-labs/user_session/server/user_session.service');
      await UserSessionService.deleteSession(userSessionId);
      sessionEnded = true;
    } catch (err) {
      // The block above still refuses this session's in-session codes; the session's other requests are the firewall's to end.
      Logger.warn(`[auth.second-factor] session not ended: ${err instanceof Error ? err.message : String(err)}`);
    }
    writeAudit({
      tenantId: attempt.tenantId ?? null,
      actorId: userId,
      actorType: 'USER',
      action: AuditActions.AUTH_SECOND_FACTOR_BLOCKED,
      resourceType: 'user_session',
      resourceId: userSessionId,
      ipAddress,
      metadata: {
        scope: 'session',
        userId,
        failures,
        seconds,
        until: new Date(block.until).toISOString(),
        sessionEnded,
        lastKind: kind,
        flow: attempt.flow ?? 'other',
      },
    });
    return block;
  } catch (err) {
    Logger.warn(`[auth.second-factor] session failure not counted: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** A verified code: the wrong-code count of its scope starts again (the offense memory stays). Best-effort. */
export async function clearSecondFactorFailures(userId: string, attempt?: SecondFactorAttempt): Promise<void> {
  const scope = secondFactorScopeOf(attempt);
  if (scope === 'none') return;
  try {
    await bounded(redis.del(scope === 'session' ? secondFactorSessionFailKey(attempt!.userSessionId!) : secondFactorFailKey(userId)));
  } catch {
    /* the counter expires on its own */
  }
}

/**
 * Lifts a block before it ends and forgets the count and the offense memory (an administrator, or the firewall's undo). Audited
 * `auth.second_factor_unblocked` only when a block was lifted. Throws when Redis cannot answer.
 */
export async function liftSecondFactorBlock(
  userId: string,
  input: { actorId?: string | null; source?: 'admin' | 'firewall'; tenantId?: string | null } = {},
): Promise<boolean> {
  const removed = Number(await bounded(redis.del(secondFactorBlockKey(userId)))) > 0;
  await bounded(redis.del(secondFactorFailKey(userId), secondFactorOffenseKey(userId))).catch(() => 0);
  if (removed) {
    writeAudit({
      tenantId: input.tenantId ?? null,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action: AuditActions.AUTH_SECOND_FACTOR_UNBLOCKED,
      resourceType: 'user_security',
      resourceId: userId,
      metadata: { source: input.source ?? (input.actorId ? 'admin' : 'firewall') },
    });
  }
  return removed;
}

// ── The minute's audit row ──────────────────────────────────────────────────────────────────────────────────────────────

type BucketFirst = { userId: string; tenantId: string | null; ipAddress: string | null; flow: SecondFactorFlow; at: number };

/** Buckets this process counted the first failure of, with the timer that writes their row. */
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();

async function countForAudit(userId: string, kind: SecondFactorKind, attempt: SecondFactorAttempt, ipAddress: string | null): Promise<void> {
  const now = Date.now();
  const tenantId = attempt.tenantId ?? null;
  const minute = Math.floor(now / SECOND_FACTOR_AUDIT_WINDOW_MS);
  const bucket = secondFactorAuditBucketKey(tenantId, userId, minute);
  const first: BucketFirst = { userId, tenantId, ipAddress, flow: attempt.flow ?? 'other', at: now };
  try {
    const count = Number(await bounded(redis.hincrby(bucket, 'count', 1)));
    await bounded(redis.hincrby(bucket, `k:${kind}`, 1));
    if (count === 1) {
      await bounded(redis.hset(bucket, 'first', JSON.stringify(first)));
      await bounded(redis.expire(bucket, SECOND_FACTOR_AUDIT_BUCKET_TTL_SECONDS));
      const delay = Math.max(0, (minute + 1) * SECOND_FACTOR_AUDIT_WINDOW_MS + SECOND_FACTOR_AUDIT_GRACE_MS - now);
      // the minute's row counts every request of the bucket: armed and written outside any probe-run stamp (phase 55 03 §3.3, D55-93)
      const timer = outsideProbeRun(() => setTimeout(() => {
        scheduled.delete(bucket);
        void outsideProbeRun(() => flushBucket(bucket));
      }, delay));
      (timer as { unref?: () => void }).unref?.();
      scheduled.set(bucket, timer);
    }
  } catch {
    // Redis cannot count: this failure is its own row now (a duplicate beats a silent guess).
    writeAudit(rowFor(first, 1, { [kind]: 1 }, minute));
  }
}

function rowFor(first: BucketFirst, count: number, byKind: Record<string, number>, minute: number): Record<string, unknown> {
  return {
    tenantId: first.tenantId,
    actorId: first.userId,
    actorType: 'USER',
    action: AuditActions.AUTH_SECOND_FACTOR_FAILED,
    resourceType: 'user_security',
    resourceId: first.userId,
    ipAddress: first.ipAddress,
    metadata: {
      count,
      byKind,
      flow: first.flow,
      windowStart: new Date(minute * SECOND_FACTOR_AUDIT_WINDOW_MS).toISOString(),
      windowEnd: new Date((minute + 1) * SECOND_FACTOR_AUDIT_WINDOW_MS).toISOString(),
    },
  };
}

async function flushBucket(bucket: string): Promise<void> {
  try {
    const fields = (await bounded(redis.hgetall(bucket))) as Record<string, string> | null;
    await bounded(redis.del(bucket)).catch(() => 0);
    const count = Number(fields?.count) || 0;
    if (!fields || count < 1) return;
    let first: BucketFirst | null = null;
    try { first = JSON.parse(fields.first ?? '') as BucketFirst; } catch { first = null; }
    if (!first || typeof first.userId !== 'string') return;
    const byKind: Record<string, number> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (field.startsWith('k:')) byKind[field.slice(2)] = Number(value) || 0;
    }
    const minute = Number(bucket.slice(bucket.lastIndexOf(':') + 1));
    writeAudit(rowFor(first, count, byKind, Number.isFinite(minute) ? minute : Math.floor(first.at / SECOND_FACTOR_AUDIT_WINDOW_MS)));
  } catch (err) {
    Logger.warn(`[auth.second-factor] audit bucket not flushed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Writes every minute row this process is holding now, and waits for the writes (tests, and a process that is shutting down). */
export async function flushSecondFactorAuditsNow(): Promise<void> {
  const buckets = [...scheduled.entries()];
  scheduled.clear();
  for (const [bucket, timer] of buckets) {
    clearTimeout(timer);
    await flushBucket(bucket);
  }
  await Promise.all([...pendingWrites]);
}
