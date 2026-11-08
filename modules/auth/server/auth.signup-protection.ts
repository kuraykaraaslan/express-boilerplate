import 'reflect-metadata';
import redis from '@kuraykaraaslan-labs/redis';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { withinRedisBound } from '@kuraykaraaslan-labs/limiter/server/limiter.redis-bound';
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error';
import {
  CLEAR_MARK_SCRIPT, SIGNUP_HARD_BLOCK_SETTING_KEY, SIGNUP_MARKS, SIGNUP_MARKS_INDEX_KEY, signupMarkKey, type SignupMark,
} from './auth.signup-protection.keys';

/**
 * Sign-up protection (docs/phases/55-ai-firewall/02 §2.6): what auth's sign-up actions (auth.firewall-actions.ts) leave behind and what the
 * register route reads. Soft by default; nothing here runs on its own in phase 02 (every action is observed on install, D55-4), the
 * responder of 05 runs the actions under the tenant's mode.
 *
 *  - **Address marks** (`auth.signup_captcha`, `auth.signup_block`): one Redis key per mark, scope and address bucket, holding the run's id,
 *    with the run's TTL. A tenant's run marks the address for that tenant's sign-up; a platform run (tenant null) for every tenant's. The
 *    register route reads all four marks in ONE bounded MGET, and only after the endpoint's own rate limit admitted the request; a Redis that
 *    does not answer reads as no mark (fail open, FWA-7: the IP limiter and the strike store are the other layers). It reads them only
 *    while a mark may exist anywhere (D55-73): every mark also enters an index (`auth:signup-marks`, scored by when it ends), whose last
 *    end this process reads at most every `SIGNUP_MARKS_PRESENCE_TTL_MS` in the background, so while no mark holds (all of phase 02, and
 *    most of the time after) a sign-up waits on no Redis call for them at all.
 *  - **The CAPTCHA mark** asks the register endpoint for a CAPTCHA from the first sign-up of the address, where 38 2.4 asks it from the
 *    fourth; only while a provider is installed and configured (38 A-5): without one nothing is asked and the action refuses to run.
 *  - **The block mark** refuses the address's sign-up (403 SIGNUP_BLOCKED), and only where the tenant opted in to a hard block
 *    (`aiFirewallSignupHardBlock`, the AI firewall's setting, read here by its key: auth imports nothing of ai_firewall, ADR-0008). A
 *    platform mark blocks only on the tenants that opted in; switching the opt-in off ends every block of the tenant at once.
 *  - **The hold** (`auth.signup_hold`) is user_security's security lock with the sign-up marker (user_security.lock.service.ts
 *    `signupHoldReason`): every sign-in method answers "verify your e-mail", and verifying the address lifts it (`liftSignupHold`). It
 *    rests on a live link (D55-68): the run sends a fresh verification mail first (`freshVerificationLinkMs`) and the hold ends when that
 *    link does, so a held person always holds the way out, and an expired link never leaves them locked out with no way to get another.
 *
 * Codes and run ids only: no e-mail address, no token. The address is the limiter's bucket (an IPv4 address, an IPv6 /64).
 */

export { SIGNUP_MARKS, SIGNUP_HARD_BLOCK_SETTING_KEY, SIGNUP_MARKS_INDEX_KEY, CLEAR_MARK_SCRIPT, signupMarkKey, type SignupMark };

/** The longest the register route waits for the marks; past it there are none (fail open). */
export const SIGNUP_MARK_READ_TIMEOUT_MS = 250;

/** How new an account must be for the sign-up actions (hold, review): older ones are no sign-up any more. */
export const SIGNUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How old this process's knowledge of the mark index may be before it reads it again (in the background). */
export const SIGNUP_MARKS_PRESENCE_TTL_MS = 5_000;

/** The shortest link a sign-up hold rests on: with less left, the run refuses rather than hold the account for minutes. */
export const SIGNUP_HOLD_MIN_LINK_MS = 15 * 60 * 1000;

/* ─────────── Whether a mark may exist (D55-73): the register route skips the read while none can ─────────── */

interface MarksPresence {
  /** When the last mark this process knows of ends (ms since the epoch); 0 = none. */
  until: number;
  /** When the index was last read; 0 = never. */
  checkedAt: number;
  refreshing: Promise<void> | null;
}

const PRESENCE_KEY = Symbol.for('kuraykaraaslan-labs.auth.signupMarksPresence');
const presenceHolder = globalThis as unknown as Record<symbol, MarksPresence | undefined>;
const presence = (): MarksPresence => (presenceHolder[PRESENCE_KEY] ??= { until: 0, checkedAt: 0, refreshing: null });

/** Reads the end of the last mark in the index (one bounded ZRANGE). A failed or slow read keeps what was known (fail open). */
function refreshPresence(p: MarksPresence): Promise<void> {
  p.refreshing ??= (async () => {
    try {
      const top = await withinRedisBound(redis.zrange(SIGNUP_MARKS_INDEX_KEY, -1, -1, 'WITHSCORES'), SIGNUP_MARK_READ_TIMEOUT_MS);
      const score = Array.isArray(top) && top.length >= 2 ? Number(top[1]) : 0;
      p.until = Number.isFinite(score) ? score : 0;
    } catch {
      // unread: what was known stands (none, the first time); the next sign-up after the TTL asks again
    } finally {
      p.checkedAt = Date.now();
      p.refreshing = null;
    }
  })();
  return p.refreshing;
}

/**
 * May a sign-up mark hold anywhere now? The first call of a process waits for one bounded read of the index; after that the answer is
 * this process's (never a wait), read again in the background once it is older than `SIGNUP_MARKS_PRESENCE_TTL_MS`. A mark set by
 * another process is seen within that TTL; one set by this process at once. Never throws.
 */
export async function signupMarksMayExist(now: number = Date.now()): Promise<boolean> {
  try {
    const p = presence();
    if (p.checkedAt === 0) await refreshPresence(p);
    else if (now - p.checkedAt >= SIGNUP_MARKS_PRESENCE_TTL_MS) void refreshPresence(p);
    return p.until > now;
  } catch {
    return false;
  }
}

/** Test seam: forget what this process knows of the index. */
export function resetSignupMarksPresence(): void {
  presenceHolder[PRESENCE_KEY] = undefined;
}


/**
 * Sets a mark for `ms` unless one holds already. Answers whether this run set it. Throws when Redis does not answer (the run failed).
 * The mark enters the index first, scored by when it ends (`GT`: a shorter run never shortens a longer mark's entry; the ended entries
 * are pruned here), so no reader can find a mark the index does not announce.
 */
export async function markSignupAddress(mark: SignupMark, tenantId: string | null, address: string, runId: string, ms: number): Promise<boolean> {
  const key = signupMarkKey(mark, tenantId, address);
  const px = Math.max(1_000, Math.floor(ms));
  const now = Date.now();
  await withinRedisBound(redis.zremrangebyscore(SIGNUP_MARKS_INDEX_KEY, '-inf', now));
  await withinRedisBound(redis.zadd(SIGNUP_MARKS_INDEX_KEY, 'GT', now + px, key));
  const reply = await withinRedisBound(redis.set(key, runId, 'PX', px, 'NX'));
  const p = presence();
  p.until = Math.max(p.until, now + px);
  return reply === 'OK';
}

/** Lifts a mark this run set (compare and delete). Answers whether one was lifted. */
export async function clearSignupAddressMark(mark: SignupMark, tenantId: string | null, address: string, runId: string): Promise<boolean> {
  if (!runId) return false;
  const reply = await withinRedisBound(redis.eval(CLEAR_MARK_SCRIPT, 1, signupMarkKey(mark, tenantId, address), runId));
  return Number(reply) === 1;
}

export interface SignupMarks {
  captcha: boolean;
  block: boolean;
}

const NO_MARKS: SignupMarks = { captcha: false, block: false };

/**
 * The marks on an address for a sign-up on `tenantId` (the tenant's own and the platform's), in one MGET within
 * `SIGNUP_MARK_READ_TIMEOUT_MS`, and only while a mark may exist at all (`signupMarksMayExist`: no Redis call otherwise). Never throws:
 * no address, Redis trouble or a slow answer read as no mark (FWA-7).
 */
export async function signupMarksOf(tenantId: string, address: string | null | undefined): Promise<SignupMarks> {
  if (!address) return NO_MARKS;
  if (!(await signupMarksMayExist())) return NO_MARKS;
  try {
    const keys = [
      signupMarkKey('captcha', tenantId, address), signupMarkKey('captcha', null, address),
      signupMarkKey('block', tenantId, address), signupMarkKey('block', null, address),
    ];
    const values = await withinRedisBound(redis.mget(...keys), SIGNUP_MARK_READ_TIMEOUT_MS);
    if (!Array.isArray(values)) return NO_MARKS;
    return { captcha: !!(values[0] || values[1]), block: !!(values[2] || values[3]) };
  } catch {
    return NO_MARKS;
  }
}

/**
 * Has the tenant opted in to a hard block of sign-ups (null = the platform: the ROOT tenant's own setting)? Off unless set to `true`;
 * a read that fails answers false (a hard block never holds on a policy nobody can read).
 */
export async function signupHardBlockAllowed(tenantId: string | null): Promise<boolean> {
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    const value = await SettingService.getValue(tenantId ?? ROOT_TENANT_ID, SIGNUP_HARD_BLOCK_SETTING_KEY);
    return String(value ?? '').trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Is a sign-up from this address on `tenantId` hard-blocked now? Only with a block mark AND the tenant's opt-in (read only when a mark
 * holds, which is rare). Never throws.
 */
export async function signupBlocked(tenantId: string, marks: SignupMarks): Promise<boolean> {
  if (!marks.block) return false;
  return signupHardBlockAllowed(tenantId);
}

/** Is an account created at `createdAt` still a sign-up (younger than SIGNUP_WINDOW_MS)? An unknown date is not. Pure. */
export function isNewAccount(createdAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const at = new Date(createdAt).getTime();
  return Number.isFinite(at) && now - at <= SIGNUP_WINDOW_MS && at <= now + 60_000;
}

/**
 * What the sign-up actions need of an account, read from the database (never the user cache: a verification writes the row without
 * dropping the cached copy, and a hold laid on a verified account could never be lifted by verifying). null when there is no such account.
 */
export async function accountForSignupAction(userId: string): Promise<{ verified: boolean; createdAt: Date | null; email: string | null } | null> {
  const ds = await getDataSource();
  const row = await ds.getRepository(UserEntity).findOne({ select: { userId: true, email: true, emailVerifiedAt: true, createdAt: true }, where: { userId } });
  if (!row) return null;
  return { verified: !!row.emailVerifiedAt, createdAt: row.createdAt ? new Date(row.createdAt) : null, email: typeof row.email === 'string' && row.email ? row.email : null };
}

/**
 * The link a sign-up hold rests on (D55-68): sends the account a FRESH verification mail (a new link, the tenant's verification TTL, through
 * the tenant's branding; the platform's for null) and answers how long that link stays valid, in ms. A mail sent in the verification's
 * own rate window (429: the register mail of a minute ago, or another resend) is the link the hold rests on, as it stands. 0 when no link
 * can be counted on: no address, the mail failed to render or send, or nothing is stored. The verify page works without a session
 * (token + e-mail + password), so with this link the person lifts the hold alone. Never throws.
 */
export async function freshVerificationLinkMs(userId: string, email: string | null, tenantId: string | null): Promise<number> {
  if (!email) return 0;
  try {
    const { default: Verification } = await import('./auth.verification.service');
    try {
      await Verification.sendEmailVerification({ userId, email, tenantId: tenantId ?? undefined });
    } catch (err) {
      if (!(err instanceof AppError && err.statusCode === 429)) {
        Logger.warn(`[auth] no verification mail for the sign-up hold of ${userId}: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
      }
    }
    return await Verification.verificationLinkRemainingMs(userId);
  } catch {
    return 0;
  }
}

/**
 * After an address was verified: lifts the account's sign-up hold, if one holds (only the firewall's hold: an administrator's lock, or the
 * firewall's other locks, stay). Best effort: the verification stands whatever happens here; a hold that could not be lifted runs out with
 * its TTL. No mail (the person has just verified).
 */
export async function liftSignupHold(userId: string): Promise<boolean> {
  try {
    const { getSecurityLock, isSignupHold, unlockAccount } = await import('@kuraykaraaslan-labs/user_security/server/user_security.lock.service');
    const lock = await getSecurityLock(userId);
    if (!isSignupHold(lock)) return false;
    await unlockAccount(userId, { actorId: null, source: 'firewall', reason: 'signup_hold: e-mail verified', notify: false });
    return true;
  } catch (err) {
    Logger.warn(`[auth] the sign-up hold of ${userId} was not lifted after its e-mail was verified: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
