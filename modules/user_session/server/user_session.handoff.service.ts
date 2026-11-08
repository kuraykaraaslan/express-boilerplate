import crypto from 'crypto';
import { z } from 'zod';
import redis from '@kuraykaraaslan-labs/redis';

/**
 * Cross-host session handoff (domain tenancy). Session cookies are host-only, so a tenant switch that ends on the
 * picked tenant's OWN host (acme.example.com, picked on app.example.com) cannot set the new session's cookie from the
 * host the picker is on. Instead the switch mints a one-time code here and sends the browser to the target host, whose
 * handoff route redeems it and only then creates the session, from that request.
 *
 * The code carries no credential: an identity (user, target tenant), the fingerprint of the browser that asked for it
 * and where to land. It is 32 random bytes, single-use (GETDEL, no GET/DEL race), short-lived, and bound to that
 * fingerprint, so a code that leaks (a log line, a shoulder) is useless from another device, a second time, or after
 * a minute. Only its SHA-256 is a Redis key (as with magic-link tokens), so reading Redis yields no code. The
 * redeeming route re-checks membership and tenant status before it creates anything.
 */
export const HANDOFF_TTL_SECONDS = 60;
const KEY_PREFIX = 'session:handoff:';
/** 32 random bytes in base64url are 43 characters; anything else cannot be a code and never costs a Redis lookup. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const PayloadSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  fingerprint: z.string().min(1).max(256),
  /** A tenant-relative path to land on (validated by the redeeming route). */
  next: z.string().max(512),
  /**
   * What the session on the target host inherits from the session that asked for the handoff (as the exchange does on the same host): the
   * derived Fleet ID marker (FID-07, user_session.fleet-id.ts), so the target session keeps the `sid` and never outlives the original login,
   * and the source's `amr` (FID-08), so a switch is not a new login.
   */
  fleetId: z.object({
    sid: z.string().max(128).nullable(),
    maxHours: z.number().int().min(1).max(24 * 30),
    notAfter: z.string().datetime(),
  }).optional(),
  amr: z.array(z.string().max(64)).max(8).optional(),
});
export type SessionHandoff = z.infer<typeof PayloadSchema>;

const keyOf = (code: string) => `${KEY_PREFIX}${crypto.createHash('sha256').update(code).digest('hex')}`;

/** Store a handoff and return its code. */
export async function mintSessionHandoff(payload: SessionHandoff): Promise<string> {
  const data = PayloadSchema.parse(payload);
  const code = crypto.randomBytes(32).toString('base64url');
  await redis.set(keyOf(code), JSON.stringify(data), 'EX', HANDOFF_TTL_SECONDS, 'NX');
  return code;
}

/**
 * Redeem a code once: the handoff, or null when the string cannot be a code, it is unknown, expired or already used,
 * or the stored value is not a handoff. Never throws.
 */
export async function consumeSessionHandoff(code: unknown): Promise<SessionHandoff | null> {
  if (typeof code !== 'string' || !CODE_SHAPE.test(code)) return null;
  let raw: string | null;
  try {
    raw = await redis.getdel(keyOf(code));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = PayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
