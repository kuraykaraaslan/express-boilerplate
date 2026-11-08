import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * True when `authorization` is `Bearer <secret>`, compared in constant time (both sides hashed first, so neither the
 * content nor the length of the secret leaks through the comparison's timing). Pure Node: the credential-less local
 * supervisor loads it too.
 */
export function bearerMatches(authorization: string | undefined, secret: string): boolean {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b) && token.length > 0;
}
