import { createHash, timingSafeEqual } from 'node:crypto';
import redis from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import { FieldDecryptError, isEncryptedField, isForeignKeyEnvelope } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { userKeys } from '@kuraykaraaslan-labs/db/server/db.user-keys.service';
import { UserSecurity } from './user_security.types';

export const USER_SECURITY_CACHE_TTL = env.SESSION_CACHE_TTL ?? (60 * 5);

/** One-way hash for backup codes / device tokens — never store the raw value. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
}

/**
 * Decrypt the TOTP secret for return; the DB / cache only ever hold ciphertext. The secret is opened only under the row user's per-user data key
 * (decision F27, db.user-keys.service.ts; dual read of a node-key envelope or a legacy plaintext written before it): a secret under another user's
 * key or a destroyed key reads as null (counted), so the TOTP factor is unusable rather than checked against someone else's secret.
 */
export async function hydrate(userId: string, parsed: UserSecurity): Promise<UserSecurity> {
  if (parsed.otpSecret) parsed.otpSecret = (await userKeys.decryptOpt(userId, parsed.otpSecret)) ?? null;
  return parsed;
}

/**
 * Seal the TOTP secret under the user's per-user data key (F27) before it ever touches the DB. A value already under a data key is kept as it is
 * (only its owner's reader opens it); a node-key envelope (a caller that still sealed it the old way) is opened and sealed again under the user's key.
 */
export async function encryptWrite<T extends Partial<UserSecurity>>(userId: string, data: T): Promise<T> {
  const stored: unknown = data.otpSecret;
  if (typeof stored !== 'string' || !stored || isForeignKeyEnvelope(stored)) return data;
  let plaintext: string = stored;
  if (isEncryptedField(plaintext)) {
    try { plaintext = await userKeys.decrypt(userId, plaintext); } catch (e) {
      if (e instanceof FieldDecryptError) return data;   // an envelope this node cannot open is stored as it came (never encrypted as if it were the secret)
      throw e;
    }
  }
  return { ...data, otpSecret: await userKeys.encryptOpt(userId, plaintext) };
}

export async function clearCache(userId: string): Promise<void> {
  await Promise.all([
    redis.del(`user_security:user:${userId}`).catch(() => {}),
    redis.del(`user_security:safe:${userId}`).catch(() => {}),
  ]);
}
