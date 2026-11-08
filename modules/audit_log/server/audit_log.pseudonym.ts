import { createHash, createHmac } from 'node:crypto';
import { env } from '@kuraykaraaslan-labs/env';

/**
 * The erasure pseudonym of an actor (audit_log.07, fixed 2026-10-20): a keyed HMAC, not a bare SHA-256 of the id, so whoever knows
 * or can enumerate user ids cannot recompute it and re-link the erased rows. Keyed by `AUDIT_LOG_PSEUDONYM_KEY` when set, else by a
 * key derived (with its own label) from the access-token secret; stable per deployment, so repeated erasures agree.
 */
export function erasurePseudonym(actorId: string): string {
  const configured = (env as Record<string, unknown>).AUDIT_LOG_PSEUDONYM_KEY;
  const key = typeof configured === 'string' && configured
    ? configured
    : createHash('sha256').update(`audit_log:erasure-pseudonym:${String((env as Record<string, unknown>).ACCESS_TOKEN_SECRET ?? '')}`).digest('hex');
  return `anon:${createHmac('sha256', key).update(actorId).digest('hex').slice(0, 32)}`;
}
