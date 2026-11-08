import redis from '@kuraykaraaslan-labs/redis';
import type { ChallengeStore } from './tenant_domain.acme.client';

/** HTTP-01 key authorisations live in Redis for the length of one order and nowhere else (phase 51). */
const PREFIX = 'tenant_domain:acme:challenge:';
export const CHALLENGE_TTL_SECONDS = 600;

/** ACME tokens are base64url (RFC 8555 §8.3); anything else is never looked up, so a path cannot address another key. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const isChallengeToken = (token: string): boolean => TOKEN_RE.test(token);

export const redisChallengeStore: ChallengeStore = {
  async put(token, keyAuthorization) {
    if (!isChallengeToken(token)) throw new Error('acme: refusing a malformed challenge token');
    await redis.set(PREFIX + token, keyAuthorization, 'EX', CHALLENGE_TTL_SECONDS);
  },
  async del(token) {
    if (isChallengeToken(token)) await redis.del(PREFIX + token);
  },
};

/** The key authorisation for `token`, or null. */
export async function readChallenge(token: string): Promise<string | null> {
  if (!isChallengeToken(token)) return null;
  return redis.get(PREFIX + token);
}
