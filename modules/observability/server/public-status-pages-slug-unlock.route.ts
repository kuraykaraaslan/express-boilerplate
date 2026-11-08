import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { isValidSlug } from './status.page.rules'
import { notFound, unlockPage, type PageCtx } from './status.public.route-kit'

const UnlockDTO = z.object({ password: z.string().min(1).max(128) })

/**
 * Exchange a page password for an access cookie. Strictest rate bucket, plus a per-client and a per-page attempt budget. A wrong
 * password, a page without a password, an unknown page and a disabled tenant all answer the same 404 and each costs one bcrypt
 * comparison: the endpoint cannot be used to find out which pages exist or which are protected.
 */
export async function POST(request: NextRequest, { params }: PageCtx) {
  try {
    const { tenantId, slug } = await params
    await Limiter.checkRateLimit(request, 'auth')
    if (!isValidSlug(slug)) throw notFound()
    const dto = UnlockDTO.parse(await request.json())
    const grant = await unlockPage(request, tenantId, slug, dto.password)
    const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
    res.cookies.set(grant.cookieName, grant.token, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: grant.maxAgeSeconds,
    })
    return res
  } catch (e) {
    return normalizeError(e)
  }
}
