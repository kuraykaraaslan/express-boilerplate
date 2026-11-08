import 'reflect-metadata'
import { createHash, randomBytes } from 'node:crypto'
import type { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import redis from '@kuraykaraaslan-labs/redis'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import StatusPageService, { type StatusPageSpec } from './status.page.service'
import StatusPublicService from './status.public.service'
import { ipAllowed } from './status.page.rules'
import {
  ACCESS_TTL_SECONDS, accessCookieName, deriveAccessKey, signAccessToken, verifyAccessToken,
} from './status.access'

/**
 * Who may see a status page (observability phase 15.3).
 *
 * One rule governs every outcome: **anything not allowed is indistinguishable from a page that does not exist.** A refused visitor,
 * an unknown slug, a disabled page and a disabled tenant all get the same 404 body, so a prober cannot learn that a private page
 * exists, which audience it has, or that a password is set. Refusal is also the answer when the check itself fails: a gate that
 * errors closes the page, it never opens it.
 *
 * PUBLIC: nobody is asked. PASSWORD: a signed cookie earned through {@link unlock}. AUTHENTICATED: a signed-in member of THIS tenant,
 * decided by the platform guard (`auth_abac`), never by a cookie of ours. IP: the caller's address is on the page's list.
 */

/** Wrong-password budget per client address and page, and per page for everybody together (a spread-out guess). */
export const UNLOCK_WINDOW_SECONDS = 15 * 60
export const UNLOCK_MAX_PER_CLIENT = 8
export const UNLOCK_MAX_PER_PAGE = 120

/** A real hash of a random value that matches nothing: comparing against it makes an unknown page cost what a known one costs. */
let dummyHash: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), 10)
  return dummyHash
}

const notFound = () => StatusPageService.notFound()
const tag = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 16)

function accessKey(): Buffer {
  return deriveAccessKey(env.ACCESS_TOKEN_SECRET)
}

export interface UnlockGrant {
  cookieName: string
  token: string
  maxAgeSeconds: number
}

export default class StatusAudienceService {
  /**
   * Throw the common 404 unless this request may see the page. PUBLIC pages pass without any read; the others read only what they
   * need and never reveal which check failed.
   */
  static async assertAllowed(request: NextRequest, tenantId: string, page: StatusPageSpec): Promise<void> {
    try {
      if (!page.enabled) throw notFound()
      switch (page.audience) {
        case 'PUBLIC':
          return
        case 'PASSWORD': {
          if (!page.pageId || !page.passwordHash) throw notFound()
          const token = request.cookies.get(accessCookieName(page.pageId))?.value
          if (verifyAccessToken({ key: accessKey(), pageId: page.pageId, passwordHash: page.passwordHash, token, nowMs: Date.now() })) return
          throw notFound()
        }
        case 'AUTHENTICATED': {
          if (await StatusAudienceService.isTenantMember(request, tenantId)) return
          throw notFound()
        }
        case 'IP': {
          if (ipAllowed(Limiter.getIpFromRequest(request), page.ipAllowlist)) return
          throw notFound()
        }
        default:
          throw notFound()
      }
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) throw err
      Logger.warn(`[observability] status audience check failed closed: ${err instanceof Error ? err.message : String(err)}`)
      throw notFound()
    }
  }

  /** Whether the caller is a signed-in member of this tenant. The guard decides; an anonymous caller is simply "not a member". */
  static async isTenantMember(request: NextRequest, tenantId: string): Promise<boolean> {
    try {
      const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.view', scope: 'GUEST' })
      return Boolean(auth.user && auth.tenantMember)
    } catch {
      return false
    }
  }

  /**
   * Spend one attempt; refuse (429) when a budget is gone. The counters are keyed by a hash of the slug, not by whether the page
   * exists, so a nonexistent page runs out of attempts exactly like a real one. If the counter cannot be read the attempt is
   * refused: unlimited guessing is worse than a brief lockout.
   */
  private static async spendAttempt(request: NextRequest, tenantId: string, slug: string): Promise<{ clientKey: string }> {
    const ip = Limiter.getIpFromRequest(request)
    const clientKey = `status:unlock:c:${tenantId}:${tag(slug)}:${tag(ip)}`
    const pageKey = `status:unlock:p:${tenantId}:${tag(slug)}`
    try {
      const [client, page] = await Promise.all([bump(clientKey), bump(pageKey)])
      if (client > UNLOCK_MAX_PER_CLIENT || page > UNLOCK_MAX_PER_PAGE) {
        throw new AppError('Too many attempts. Please try again later.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
          retryable: true, headers: { 'Retry-After': String(UNLOCK_WINDOW_SECONDS) },
        })
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      Logger.warn(`[observability] status unlock counter unavailable (refusing): ${err instanceof Error ? err.message : String(err)}`)
      throw new AppError('Too many attempts. Please try again later.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { retryable: true })
    }
    return { clientKey }
  }

  /**
   * Check a password and, when it is right, issue the access token. A wrong password, a page that has no password, a page that does
   * not exist and a disabled tenant all answer the same 404, and all of them pay for one bcrypt comparison.
   */
  static async unlock(request: NextRequest, tenantId: string, slug: string, password: string): Promise<UnlockGrant> {
    const { clientKey } = await StatusAudienceService.spendAttempt(request, tenantId, slug)
    let page: StatusPageSpec | null = null
    try { page = await StatusPageService.resolve(tenantId, slug) } catch { page = null }
    const tenantOn = await StatusPublicService.isEnabled(tenantId)
    const eligible = Boolean(tenantOn && page && page.enabled && page.audience === 'PASSWORD' && page.pageId && page.passwordHash)
    const hash = eligible ? page!.passwordHash! : await getDummyHash()
    const ok = await bcrypt.compare(password, hash).catch(() => false)
    if (!eligible || !ok || !page) throw notFound()
    await redis.del(clientKey).catch(() => undefined)
    const { token } = signAccessToken({ key: accessKey(), pageId: page.pageId!, passwordHash: page.passwordHash!, nowMs: Date.now() })
    return { cookieName: accessCookieName(page.pageId!), token, maxAgeSeconds: ACCESS_TTL_SECONDS }
  }
}

async function bump(key: string): Promise<number> {
  const n = await redis.incr(key)
  if (n === 1) await redis.expire(key, UNLOCK_WINDOW_SECONDS)
  return n
}
