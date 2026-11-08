import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import { AppError, ErrorCode } from './app-error';

/**
 * Shared authentication for Vercel-Cron HTTP endpoints (`/api/cron/*` and the
 * per-module `cron-*.route.ts` twins). Every cron route hand-rolled the same
 * `header !== \`Bearer ${secret}\`` check — a plain `!==` on a secret is a timing
 * side channel, and fifteen copies is fifteen chances to get it subtly wrong.
 *
 * Throws AppError:
 *   - 503 when CRON_SECRET is not configured (fail closed, never run open).
 *   - 401 when the bearer token is missing or does not match (constant-time).
 *
 * Callers already sit inside a `try { … } catch (e) { return normalizeError(e) }`,
 * so a throw becomes the correct JSON response with no extra branching.
 */
/** Constant-time string equality (both sides secret-length). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function assertCronAuth(request: NextRequest): void {
  const secret = env.CRON_SECRET;
  if (!secret) {
    throw new AppError('CRON_SECRET is not configured', 503, ErrorCode.FEATURE_NOT_AVAILABLE);
  }
  const provided = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError('Unauthorized', 401, ErrorCode.UNAUTHORIZED);
  }
}
