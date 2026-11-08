import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import Logger from '@kuraykaraaslan-labs/logger'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusSubscriberService from './status.subscriber.service'
import redis from '@kuraykaraaslan-labs/redis'
import { env } from '@kuraykaraaslan-labs/env'
import { createHash } from 'node:crypto'

/** observability.07: at most this many confirmation sends per address (or number, or endpoint) and tenant per day. */
const CONFIRMATIONS_PER_DAY = 3

/** Reserve one confirmation send for `target`; false when the daily allowance is spent or cannot be read (fail closed). */
async function reserveConfirmation(tenantId: string, target: string): Promise<boolean> {
  const key = `observability:subscribe:confirm:${tenantId}:${createHash('sha256').update(target.trim().toLowerCase()).digest('hex')}`
  try {
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, 24 * 60 * 60)
    return n <= CONFIRMATIONS_PER_DAY
  } catch {
    return false
  }
}

type Ctx = { params: Promise<{ tenantId: string }> }

const SubscribeDTO = z.object({
  /** EMAIL (the original, and the default), SMS, WEBHOOK, or a Slack / Teams channel (SLACK, TEAMS: `endpointUrl` is the incoming-webhook URL). */
  channel: z.enum(['EMAIL', 'SMS', 'WEBHOOK', 'SLACK', 'TEAMS']).default('EMAIL'),
  email: z.string().email().max(320).optional(),
  /** E.164, e.g. +4915112345678. */
  phone: z.string().max(32).optional(),
  /** https endpoint that receives signed events once it confirms; for SLACK and TEAMS the channel's incoming-webhook URL (the vendors' own hosts only). */
  endpointUrl: z.string().max(2048).optional(),
  componentIds: z.array(z.string().uuid()).max(50).optional(),
  /** The page the person subscribes on (public pages only) and the language they read. */
  pageSlug: z.string().max(64).optional(),
  locale: z.string().max(12).optional(),
  /** Honeypot — real users never see or fill it. observability.08: a filled one is accepted by the schema and answered
   *  with the same uniform 202 (a 400 would tell the bot it was caught), and nothing is sent. */
  website: z.string().max(2048).optional(),
}).superRefine((v, ctx) => {
  const need = v.channel === 'EMAIL' ? 'email' : v.channel === 'SMS' ? 'phone' : 'endpointUrl'
  if (!v[need]) ctx.addIssue({ code: 'custom', path: [need], message: `${need} is required for ${v.channel}` })
})

/**
 * Double-opt-in start for EMAIL, SMS, WEBHOOK, SLACK or TEAMS. Uniformly answers accepted: whether the
 * address was new, already subscribed, refused, or the page is disabled is not the internet's
 * business (an enumerable subscribe endpoint doubles as an email oracle).
 * Strictest rate bucket — every call may cost an outbound mail or text.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'auth')
    const dto = SubscribeDTO.parse(await request.json())
    const target = dto.channel === 'EMAIL' ? dto.email : dto.channel === 'SMS' ? dto.phone : dto.endpointUrl
    if (!dto.website && target && await reserveConfirmation(tenantId, `${dto.channel}:${target}`)) {
      // observability.01: the links in the mail are built on the configured application host, never on the Host /
      // X-Forwarded-Host the caller sent (a forged host would send the victim a genuine mail pointing elsewhere).
      const base = (env.APPLICATION_HOST || 'http://localhost:3000').replace(/\/+$/, '')
      const verifyBase = `${base}/tenant/${tenantId}`
      // Plain email without a page or language is the original call, unchanged; everything else goes through the channel-aware one.
      const started = dto.channel === 'EMAIL' && !dto.pageSlug && !dto.locale
        ? StatusSubscriberService.subscribe(tenantId, dto.email!, dto.componentIds ?? null, verifyBase)
        : StatusSubscriberService.subscribeChannel(tenantId, {
            channel: dto.channel, email: dto.email, phone: dto.phone, endpointUrl: dto.endpointUrl,
            componentIds: dto.componentIds ?? null, pageSlug: dto.pageSlug ?? null, locale: dto.locale ?? null,
          }, verifyBase)
      await started.catch((err) => Logger.warn(`[observability] subscribe rejected: ${err?.message ?? err}`))
    }
    return NextResponse.json({ accepted: true }, { status: 202 })
  } catch (e) {
    return normalizeError(e)
  }
}
