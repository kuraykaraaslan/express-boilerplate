import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The signature scheme for inbound provider webhooks (shared since 2026-09-25:
 * `mail_inbound` and `commerce_fulfillment`'s carrier webhook). Each consumer
 * names its own headers and settings; the scheme itself exists once.
 *
 * Pure — bytes and a secret in, a verdict out. No request object, no settings
 * store, no clock of its own. That is what makes every rule below testable, and
 * these are rules where "we believe it works" is not good enough: the signature
 * IS the authentication for these endpoints. There is no session behind them,
 * because the sender is a provider and not a person.
 *
 * ## What is signed, and why the timestamp is inside the MAC
 *
 *     hex( HMAC-SHA256( secret, `${timestamp}.${rawBody}` ) )
 *
 * The timestamp travels in its own header AND inside the signed string. Signing
 * the body alone would leave the timestamp editable by anyone in the middle,
 * which turns the replay window below into decoration: an attacker replays
 * yesterday's captured delivery with today's timestamp and the signature still
 * verifies. Binding the two together is the whole point.
 *
 * ## Why a replay window exists at all
 *
 * A verified request that can be replayed forever is a verified request an
 * attacker can hold and re-send. `mail_inbound` deduplicates by
 * `(providerKey, providerMessageRef)`, so a replay of the SAME message is
 * already harmless; the window is what stops a captured envelope from being
 * useful long after the fact if that dedup is ever bypassed — and it is cheap.
 *
 * ## Rotation is a first-class case
 *
 * `previousSecret` is honoured for the same reason `WEBHOOK_SECRET_PREVIOUS`
 * exists: without it a rotation is a hard cutover, every message in flight at
 * the moment of the change fails verification, and the provider retries them
 * against a secret it does not have yet. Mail that arrives during a rotation is
 * exactly the mail a tenant will notice missing.
 */

/** How far a delivery's timestamp may be from our clock. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

export type WebhookRefusal =
  | 'SECRET_MISSING'
  | 'SIGNATURE_MISSING'
  | 'TIMESTAMP_MISSING'
  | 'TIMESTAMP_MALFORMED'
  | 'TIMESTAMP_OUTSIDE_WINDOW'
  | 'SIGNATURE_INVALID'

export type WebhookVerdict =
  | { ok: true; usedPreviousSecret: boolean }
  | { ok: false; reason: WebhookRefusal }

export interface WebhookInput {
  rawBody: string
  signature: string | null | undefined
  timestamp: string | null | undefined
  secret: string | null | undefined
  previousSecret?: string | null
  /** Injected so the window is testable without waiting five minutes. */
  nowMs: number
}

/**
 * Produce the signature a provider must send.
 *
 * Exported because the tenant has to be able to configure the far side, and
 * because a verifier with no signer is a verifier tested only against itself —
 * the tests sign with this and verify with {@link verifyWebhook}, which is the
 * only way a scheme mismatch shows up before a provider hits it.
 */
export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export function verifyWebhook(input: WebhookInput): WebhookVerdict {
  const { rawBody, timestamp, nowMs } = input

  const secret = (input.secret ?? '').trim()
  const previousSecret = (input.previousSecret ?? '').trim()
  // No secret configured is NOT "no signature required". An endpoint that
  // accepts everything until somebody configures it is an endpoint that
  // accepts a stranger's data for as long as nobody notices.
  if (!secret && !previousSecret) return { ok: false, reason: 'SECRET_MISSING' }

  const provided = normalizeSignature(input.signature)
  if (!provided) return { ok: false, reason: 'SIGNATURE_MISSING' }
  if (!timestamp) return { ok: false, reason: 'TIMESTAMP_MISSING' }

  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'TIMESTAMP_MALFORMED' }

  // Absolute difference, so a provider whose clock runs FAST is refused too. A
  // one-sided check ("not older than five minutes") accepts a timestamp dated
  // next year, and a signature that stays valid for a year is not a window.
  const skewSeconds = Math.abs(nowMs / 1000 - seconds)
  if (skewSeconds > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'TIMESTAMP_OUTSIDE_WINDOW' }

  if (secret && constantTimeEquals(provided, signWebhook(secret, timestamp, rawBody))) {
    return { ok: true, usedPreviousSecret: false }
  }
  if (previousSecret && constantTimeEquals(provided, signWebhook(previousSecret, timestamp, rawBody))) {
    return { ok: true, usedPreviousSecret: true }
  }
  return { ok: false, reason: 'SIGNATURE_INVALID' }
}

/**
 * Accept `sha256=<hex>` as well as a bare hex digest.
 *
 * Providers differ and the prefix is framing, not identity. Lowercased because
 * hex case is not identity either, and a provider sending upper-case hex would
 * otherwise fail verification for a reason no operator could ever guess.
 */
function normalizeSignature(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim().replace(/^sha256=/i, '').trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(value) ? value : null
}

/**
 * `timingSafeEqual` THROWS when the two buffers differ in length, so the length
 * check has to come first — and it is safe to leak, because both sides are a
 * fixed-width sha256 digest and `normalizeSignature` already refused anything
 * that was not 64 hex characters.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}
