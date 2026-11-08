import type { NextRequest } from 'next/server';
import Logger from '@kuraykaraaslan-labs/logger';
import { rolloutBucket } from '@kuraykaraaslan-labs/common/server/common.rollout';
import { READ_ONLY_SAFE_METHODS } from './maintenance.enums';
import type { ActiveWindow } from './maintenance.dto';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * Phase-2 gradual-scope checks, kept out of the gate so the hot file stays
 * about HTTP: the READ_ONLY method exemption and percentage (canary) bucketing.
 *
 * Bucketing REUSES the one rollout hash feature flags use (locked decision: do
 * not build a second percentage rollout). It lives in common, so a canary
 * window works whether or not feature_flags is installed.
 */

/** READ_ONLY windows let reads through; only writes see the 503. */
export function isReadExempt(method: string, window: Pick<ActiveWindow, 'mode'>): boolean {
  return window.mode === 'READ_ONLY'
    && (READ_ONLY_SAFE_METHODS as readonly string[]).includes(method.toUpperCase());
}

/**
 * Stable canary subject, best first: authenticated user, the `ab_vid` cookie
 * proxy.ts pins on every visitor, client IP. Prefixed so the three id spaces
 * can never collide into one bucket.
 */
export function resolveSubject(req: NextRequest, userId?: string | null): string | null {
  if (userId) return `u:${userId}`;
  const vid = req.cookies.get('ab_vid')?.value;
  if (vid) return `v:${vid}`;
  const ip = clientIpOf(req.headers);
  return ip ? `ip:${ip}` : null;
}

/**
 * Whether this subject is inside the window's canary share. `percentage` null
 * (or 100) = everyone. The windowId salts the hash, so two concurrent canary
 * windows sample different slices of the same population.
 */
export async function isInMaintenanceBucket(
  window: Pick<ActiveWindow, 'windowId' | 'percentage'>,
  subject: string | null,
): Promise<boolean> {
  const pct = window.percentage;
  if (pct == null || pct >= 100) return true;
  if (!subject) return false; // no stable identity → stay out of the canary (fail-open)
  try {
    return rolloutBucket(`maintenance:${window.windowId}`, subject) < pct;
  } catch (error) {
    Logger.warn(`[maintenance] canary bucketing unavailable (fail-open): ${error}`);
    return false;
  }
}
