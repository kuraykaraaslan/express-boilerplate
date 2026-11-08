import type { NextRequest } from 'next/server'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { check } from '@kuraykaraaslan-labs/limiter/server/limiter.service'
import { DISPLAY_LINK_RATE_PER_MINUTE, hashDisplayToken, limiterKey, tokenFromRequest } from './display-token'
import MSG from './dashboard.messages'

/**
 * The token of a display request, after its per-link rate limit: 404 without a token header (`X-Display-Token`, or the
 * earlier `Authorization: Display`) or with a token in its query string, 429 over `DISPLAY_LINK_RATE_PER_MINUTE`. Runs BEFORE any database read, keyed by a prefix of the token's hash (never the token
 * itself), and fails closed when Redis cannot count: a screen retries, a token holder does not get a free run.
 */
export async function displayToken(request: NextRequest, tenantId: string): Promise<string> {
  const raw = tokenFromRequest(request)
  if (!raw) throw new AppError(MSG.DISPLAY_LINK_INVALID, 404, ErrorCode.NOT_FOUND)
  const r = await check(limiterKey(hashDisplayToken(raw)), 'api', { limit: DISPLAY_LINK_RATE_PER_MINUTE, failMode: 'closed', tenantId })
  if (!r.success) {
    throw new AppError(MSG.DISPLAY_RATE_LIMITED, 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
      retryable: true,
      headers: { 'X-RateLimit-Limit': String(r.limit), 'X-RateLimit-Remaining': '0', 'Retry-After': String(Math.max(1, r.retryAfter)) },
    })
  }
  return raw
}
