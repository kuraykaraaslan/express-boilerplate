import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'

// Heavy collaborators (redis, the optional-module gate, the SSRF-pinned fetch) are loaded when a channel is actually used, so a deployment
// that only ever sends email never pays for them and the module stays cheap to import.
const optional = async <T>(tenantId: string, moduleId: string, load: () => Promise<T>): Promise<T | null> => {
  const { ifActive } = await import('@kuraykaraaslan-labs/common/server/extensions/optional-module')
  return ifActive(tenantId, moduleId, load)
}

/**
 * The SMS and webhook channels of status subscriptions (observability phase 15.5): the checks that keep an anonymous form from being a
 * spam relay, and the two ways a message leaves.
 *
 * Both channels are reachable by anybody on the internet, and both cost something or hit somebody else's server. So each is held to
 * the same shape as the email subscription: a message is sent to an address only after its owner confirmed it, the first message is
 * only the confirmation, and the number of confirmation messages is capped per number and per tenant per day. A webhook endpoint
 * is judged by the webhook module's own address guard (never an internal address) and every delivery is signed with a key that the
 * endpoint received in its confirmation message, so the key reaches whoever controls the endpoint and nobody else.
 */

export const E164 = /^\+[1-9]\d{6,14}$/
export const SMS_COOLDOWN_SECONDS = 120
export const SMS_VERIFY_DAILY_CAP = 200
export const WEBHOOK_VERIFY_DAILY_CAP = 200
/** Slack and Teams confirmation posts per tenant per day: every one is a message into somebody else's channel. */
export const CHAT_VERIFY_DAILY_CAP = 100
const WEBHOOK_TIMEOUT_MS = 5000
const MAX_URL = 500

const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 20)

/** Spend one confirmation message of a kind for a target. false = refused (cooldown, daily cap, or the counter is unreadable: refuse). */
export async function allowConfirmation(kind: 'sms' | 'webhook' | 'chat', tenantId: string, target: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10)
  const cap = kind === 'sms' ? SMS_VERIFY_DAILY_CAP : kind === 'chat' ? CHAT_VERIFY_DAILY_CAP : WEBHOOK_VERIFY_DAILY_CAP
  try {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis')
    const first = await redis.set(`status:confirm:${kind}:cool:${tenantId}:${sha(target)}`, '1', 'EX', SMS_COOLDOWN_SECONDS, 'NX')
    if (first !== 'OK') return false
    const dayKey = `status:confirm:${kind}:day:${tenantId}:${day}`
    const n = await redis.incr(dayKey)
    if (n === 1) await redis.expire(dayKey, 26 * 3600)
    return n <= cap
  } catch (err) {
    Logger.warn(`[observability] status ${kind} confirmation counter unavailable (refusing): ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** An https URL that the webhook module's address guard accepts, or an error. Resolved again (pinned) at every delivery. */
export async function assertWebhookEndpoint(tenantId: string, raw: string): Promise<string> {
  if (raw.length > MAX_URL) throw new AppError('Endpoint URL is too long', 422, ErrorCode.VALIDATION_ERROR)
  let url: URL
  try { url = new URL(raw) } catch { throw new AppError('Not a valid URL', 422, ErrorCode.VALIDATION_ERROR) }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new AppError('A webhook endpoint must be a plain https URL', 422, ErrorCode.VALIDATION_ERROR)
  }
  const guard = await optional(tenantId, 'webhook', () => import('@kuraykaraaslan-labs/webhook/server/webhook.ssrf'))
  if (!guard) throw new AppError('Webhook subscriptions need the webhook module', 409, ErrorCode.FEATURE_NOT_AVAILABLE)
  try {
    await guard.assertSafeWebhookUrl(url.toString())
  } catch {
    throw new AppError('That address cannot be used as a webhook endpoint', 422, ErrorCode.VALIDATION_ERROR)
  }
  return url.toString()
}

/** Send one short text through the dispatcher's SMS channel. The address gate and the tenant's channel switch apply as for any send. */
export async function sendSms(tenantId: string, to: string, text: string): Promise<void> {
  try {
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service')
    await NotificationService.notify(
      tenantId, { phone: to },
      { event: 'observability.status', title: text, body: text },
      { urgency: 'NORMAL', channels: ['sms'] },
    )
  } catch (err) {
    Logger.warn(`[observability] status sms not sent: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface WebhookEnvelope {
  event: string
  data: Record<string, unknown>
}

/**
 * One signed POST. The body is `{ event, createdAt, data }`; the signature headers are the webhook module's own v2 scheme
 * (`sha256=` + HMAC over `${timestamp}.${body}`), so a receiver already verifying that platform's webhooks verifies these the same
 * way. No redirect is followed. Returns whether the endpoint answered 2xx; never throws.
 */
export async function postSignedWebhook(tenantId: string, url: string, secret: string | null, envelope: WebhookEnvelope): Promise<boolean> {
  try {
    const crypto = await optional(tenantId, 'webhook', () => import('@kuraykaraaslan-labs/webhook/server/webhook.crypto'))
    const guard = await optional(tenantId, 'webhook', () => import('@kuraykaraaslan-labs/webhook/server/webhook.ssrf'))
    if (!crypto || !guard) return false
    await guard.assertSafeWebhookUrl(url)
    const body = JSON.stringify({ event: envelope.event, createdAt: new Date().toISOString(), data: envelope.data })
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': envelope.event,
      'X-Webhook-Delivery': randomUUID(),
      'X-Webhook-Timestamp': timestamp,
      'User-Agent': 'NextBoilerplate-StatusPage/1.0',
    }
    if (secret) {
      headers['X-Webhook-Signature'] = crypto.signPayload(secret, body)
      headers['X-Webhook-Signature-V2'] = crypto.signPayload(secret, `${timestamp}.${body}`)
    }
    const { safeFetch } = await import('@kuraykaraaslan-labs/common/server/safe-fetch')
    const res = await safeFetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) })
    return res.status >= 200 && res.status < 300
  } catch (err) {
    Logger.debug?.(`[observability] status webhook delivery failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** The key a webhook subscriber signs with: 256 random bits, hex like the webhook module's own. */
export function newSigningSecret(): string {
  return randomBytes(32).toString('hex')
}

/** Slack and Teams subscriber destinations (phase 15.5): see `chat.destination.ts` for what a URL must be. */
export const CHAT_CHANNELS = ['SLACK', 'TEAMS'] as const
export type ChatChannel = typeof CHAT_CHANNELS[number]
export const isChatChannel = (c: string | null | undefined): c is ChatChannel => c === 'SLACK' || c === 'TEAMS'
