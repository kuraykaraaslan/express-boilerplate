/**
 * Tokens of the MCP authorization server (docs/phases/57-mcp-server D57-8): opaque, 256 bits from the CSPRNG, prefixed so the lane
 * classifier and a leak scanner recognise them, and stored only as SHA-256. PKCE is S256 only (OAuth 2.1), compared in constant time.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_TOKEN_PREFIX = 'mcp_at_';
export const REFRESH_TOKEN_PREFIX = 'mcp_rt_';
export const AUTH_CODE_PREFIX = 'mcp_ac_';

/** RFC 7636 §4.1: 43..128 characters of the unreserved set. */
export const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
/** base64url of a SHA-256, no padding. */
export const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export const newToken = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;

export const hashToken = (raw: string): string => createHash('sha256').update(raw, 'utf8').digest('hex');

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!CODE_VERIFIER_RE.test(verifier) || !CODE_CHALLENGE_RE.test(challenge)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier, 'ascii').digest('base64url'), 'utf8');
  const expected = Buffer.from(challenge, 'utf8');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
