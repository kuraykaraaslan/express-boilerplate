import 'reflect-metadata'
import crypto from 'node:crypto'
import { In, IsNull } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { encryptFieldOpt, decryptFieldOpt, encryptField, decryptField } from '@kuraykaraaslan-labs/common/server/field-encryption'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { StatusSubscriber } from './entities/status_subscriber.entity'
import type { Incident } from './entities/incident.entity'
import StatusPublicService from './status.public.service'
import { limitOf } from './observability.limits'
import { OBSERVABILITY_LIMIT_KEYS } from './observability.limit-keys'
import { refusalForLimit } from './observability.refusals'
import {
  allowConfirmation, assertWebhookEndpoint, E164, isChatChannel, newSigningSecret, postSignedWebhook, sendSms,
} from './status.subscriber.channels'
import { checkChatUrl, chatUrlFingerprint, redactSecrets } from './chat.destination'
import { formatFor, type ChatMessageModel } from './chat.format'
import { postChat, type ChatSendOutcome } from './chat.sender'

/**
 * Status page subscriptions (phase 3, extended in phase 15.5): email, SMS and signed webhook, double opt-in on every channel, per-
 * component filtering, per-page and per-language preference, one-click tokened unsubscribe.
 *
 * Email and SMS leave through the notification dispatcher (the address gate, including hard bounces and complaints, applies there).
 * The webhook channel posts directly, signed with the webhook module's scheme, to an endpoint that was confirmed first.
 * (Audit alignment: these are anonymous EXTERNAL recipients, outside notification's user-preference model.)
 */

const token = () => crypto.randomBytes(24).toString('base64url')

/**
 * Incident titles/messages and maintenance texts are operator-written and go
 * to PUBLIC subscribers' inboxes: escaped, so markup in a title renders as
 * text instead of injecting links or hiding content in the mail.
 */
const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const PG_UNIQUE_VIOLATION = '23505'

const MAX_SUBSCRIBERS_NOTIFIED = 500
/** Slack and Teams deliveries in flight at once during one fan-out. */
const CHAT_CONCURRENCY = 10

export type IncidentMailKind = 'opened' | 'updated' | 'resolved'

export type SubscriberChannel = 'EMAIL' | 'SMS' | 'WEBHOOK' | 'SLACK' | 'TEAMS'

/** After this many deliveries in a row that fail, a webhook subscriber is switched off (it must subscribe again) instead of being hammered. */
export const WEBHOOK_MAX_FAILURES = 10

export interface ChannelSubscribeInput {
  channel: SubscriberChannel
  email?: string
  phone?: string
  /** The webhook endpoint (WEBHOOK) or the Slack / Teams incoming-webhook URL (SLACK, TEAMS). */
  endpointUrl?: string
  componentIds?: string[] | null
  /** The page the person subscribes on; honoured only for a PUBLIC page. */
  pageSlug?: string | null
  /** The language the person reads; honoured only for a language the page offers. */
  locale?: string | null
}

/** What every channel is handed for one event: the words, the machine-readable twin and the way out. */
interface OutboundMessage {
  subject: string
  /** Body paragraphs as HTML (already escaped), without the unsubscribe footer. */
  html: string
  event: string
  data: () => Promise<Record<string, unknown>>
  /** What a SLACK or TEAMS subscriber is sent (the same words, structured; the unsubscribe link is added per subscriber). */
  chat?: ChatMessageModel
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

export default class StatusSubscriberService {
  /**
   * Start (or restart) a subscription. Existing unverified rows get a fresh
   * verification mail; existing verified rows are a silent no-op — the
   * response never reveals whether an address was already subscribed.
   */
  static async subscribe(
    tenantId: string,
    email: string,
    componentIds?: string[] | null,
    verifyUrlBase?: string,
  ): Promise<void> {
    await StatusPublicService.assertEnabled(tenantId)
    const normalized = email.trim().toLowerCase()
    const full = await StatusSubscriberService.atCap(tenantId)

    let row: StatusSubscriber | null
    try {
      row = await withTenantRepositoryFor(tenantId, StatusSubscriber, async (repo) => {
        const found = await repo.findOne({ where: { tenantId, email: normalized } })
        if (found?.verifiedAt) return null
        if (!found) {
          if (full) return null
          return repo.save(repo.create({
            tenantId,
            email: normalized,
            channel: 'EMAIL',
            componentIds: componentIds ?? null,
            verifyToken: token(),
            unsubscribeToken: token(),
          }))
        }
        const patch = { verifyToken: token(), componentIds: componentIds ?? found.componentIds ?? null }
        await repo.update({ tenantId, subscriberId: found.subscriberId }, patch)
        return Object.assign(found, patch)
      })
    } catch (error) {
      // A concurrent subscribe of the same address won the unique index; its
      // confirmation mail is already on the way — not a 500.
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) return
      throw error
    }
    if (!row) return

    const verifyUrl = `${verifyUrlBase ?? ''}/api/public/status/verify?token=${row.verifyToken}`
    await StatusSubscriberService.sendMail(
      tenantId, normalized,
      'Confirm your status page subscription',
      `<p>Click to confirm you want status updates:</p>`
      + `<p><a href="${verifyUrl}">Confirm subscription</a></p>`
      + `<p>If you did not request this, ignore this email.</p>`,
    )
  }

  /**
   * Start a subscription on any channel, with a page and a language. Same contract as `subscribe`: an address that is already
   * confirmed, a refused number or endpoint and a disabled page all end in silence, never in a different answer.
   */
  static async subscribeChannel(tenantId: string, input: ChannelSubscribeInput, verifyUrlBase?: string): Promise<void> {
    await StatusPublicService.assertEnabled(tenantId)
    const { pageId, locale } = await StatusSubscriberService.resolvePreferences(tenantId, input)

    if (input.channel === 'EMAIL') {
      if (!input.email) return
      const normalized = input.email.trim().toLowerCase()
      const row = await StatusSubscriberService.upsertPending(tenantId, { email: normalized }, {
        channel: 'EMAIL', email: normalized, componentIds: input.componentIds ?? null, pageId, locale,
      })
      if (!row) return
      await StatusSubscriberService.sendMail(
        tenantId, normalized,
        'Confirm your status page subscription',
        `<p>Click to confirm you want status updates:</p>`
        + `<p><a href="${verifyUrlBase ?? ''}/api/public/status/verify?token=${row.verifyToken}">Confirm subscription</a></p>`
        + `<p>If you did not request this, ignore this email.</p>`,
      )
      return
    }

    if (input.channel === 'SMS') {
      const phone = (input.phone ?? '').replace(/[\s()-]/g, '')
      if (!E164.test(phone)) return
      if (!(await allowConfirmation('sms', tenantId, phone))) return
      const row = await StatusSubscriberService.upsertPending(tenantId, { phone }, {
        channel: 'SMS', phone, componentIds: input.componentIds ?? null, pageId, locale,
      })
      if (!row) return
      await sendSms(tenantId, phone, `Confirm status alerts: ${verifyUrlBase ?? ''}/api/public/status/verify?token=${row.verifyToken}`)
      return
    }

    if (isChatChannel(input.channel)) {
      await StatusSubscriberService.subscribeChat(tenantId, input.channel, input.endpointUrl, { componentIds: input.componentIds ?? null, pageId, locale }, verifyUrlBase)
      return
    }

    // WEBHOOK
    if (!input.endpointUrl) return
    let url: string
    try { url = await assertWebhookEndpoint(tenantId, input.endpointUrl) } catch (err) {
      Logger.debug?.(`[observability] status webhook endpoint refused: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (!(await allowConfirmation('webhook', tenantId, url))) return
    const secret = newSigningSecret()
    const row = await StatusSubscriberService.upsertPending(tenantId, { endpointUrl: url }, {
      channel: 'WEBHOOK', endpointUrl: url, componentIds: input.componentIds ?? null, pageId, locale, signingSecret: encryptFieldOpt(secret),
    })
    if (!row) return
    // The confirmation goes to the endpoint, carrying the signing key: only whoever controls the endpoint ever sees it, and nothing
    // else is sent until that same party opens the confirmation link.
    await postSignedWebhook(tenantId, url, null, {
      event: 'status.subscription.confirm',
      data: {
        verifyUrl: `${verifyUrlBase ?? ''}/api/public/status/verify?token=${row.verifyToken}`,
        unsubscribeUrl: `${verifyUrlBase ?? ''}/api/public/status/unsubscribe?token=${row.unsubscribeToken}`,
        signingSecret: decryptFieldOpt(row.signingSecret) ?? secret,
        note: 'Confirm to receive status events. Deliveries are signed with signingSecret (X-Webhook-Signature-V2 over "<timestamp>.<body>").',
      },
    })
  }

  /**
   * Start a SLACK or TEAMS subscription (phase 15.5). The destination is an incoming-webhook URL, which is the credential for the channel:
   * it must be on the vendor's own host (never a private address, a lookalike, an IP literal or a URL with userinfo; `chat.destination.ts`),
   * is stored encrypted only, and receives nothing but a confirmation message until somebody who can READ that channel opens the link in it.
   * Every refusal ends in silence, exactly like the other channels, so the form is not a way to learn which hosts are reachable. Without the
   * platform encryption key nothing is stored (the plaintext fallback of `encryptFieldOpt` is not acceptable for a credential).
   */
  private static async subscribeChat(
    tenantId: string, kind: 'SLACK' | 'TEAMS', rawUrl: string | undefined,
    prefs: { componentIds: string[] | null; pageId: string | null; locale: string | null }, verifyUrlBase?: string,
  ): Promise<void> {
    if (!rawUrl) return
    const check = checkChatUrl(kind, rawUrl)
    if (!check.ok) {
      Logger.debug?.(`[observability] status ${kind} destination refused: ${check.reason}`)
      return
    }
    let cipher: string
    try { cipher = encryptField(check.url) } catch {
      Logger.warn('[observability] status chat subscription ignored: the platform encryption key is not configured')
      return
    }
    if (!(await allowConfirmation('chat', tenantId, check.url))) return
    const fingerprint = chatUrlFingerprint(tenantId, check.url)
    const row = await StatusSubscriberService.upsertPending(tenantId, { chatUrlFingerprint: fingerprint }, {
      channel: kind, chatUrlCipher: cipher, chatUrlHost: check.host, chatUrlFingerprint: fingerprint,
      componentIds: prefs.componentIds, pageId: prefs.pageId, locale: prefs.locale,
    })
    if (!row) return
    const base = verifyUrlBase ?? ''
    // The confirmation goes INTO the channel: only whoever can read it can open the link. Nothing else is posted until then.
    const outcome = await postChat(kind, check.url, formatFor(kind, {
      kind: 'status.confirm', headline: 'Confirm status updates', title: 'Someone asked to post status page updates to this channel',
      status: 'UNCONFIRMED',
      body: 'Incident and maintenance updates will be posted here once the subscription is confirmed. If you did not ask for this, ignore this message: nothing is posted until it is confirmed, and the request lapses.',
      linkUrl: `${base}/api/public/status/verify?token=${row.verifyToken}`, linkLabel: 'Confirm subscription',
      footerUrl: `${base}/api/public/status/unsubscribe?token=${row.unsubscribeToken}`, footerUrlLabel: 'Cancel',
    }))
    // A destination that cannot be written to is not kept as a pending row: nothing could ever confirm it.
    if (outcome.status === 'failed') {
      await withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) => repo.delete({ tenantId, subscriberId: row.subscriberId, verifiedAt: IsNull() }))
        .catch(() => undefined)
    }
  }

  /**
   * Which page and language a subscription may carry. A page is only remembered for a PUBLIC page; a language only when it is the
   * primary language or one the page offers. Anything else is dropped without a word: the preferences are conveniences, not a place
   * to learn what exists.
   */
  private static async resolvePreferences(tenantId: string, input: ChannelSubscribeInput): Promise<{ pageId: string | null; locale: string | null }> {
    const rules = await import('./status.page.rules')
    let pageId: string | null = null
    let offered: string[] = []
    if (input.pageSlug && rules.isValidSlug(input.pageSlug)) {
      try {
        const { default: StatusPageService } = await import('./status.page.service')
        const page = await StatusPageService.resolve(tenantId, input.pageSlug)
        if (page && page.enabled && page.audience === 'PUBLIC') { pageId = page.pageId; offered = page.languages }
      } catch { /* a preference that cannot be checked is not stored */ }
    }
    let locale: string | null = null
    if (input.locale && rules.isLocaleCode(input.locale)) {
      try {
        const want = rules.normalizeLocale(input.locale)
        const { resolveTenantLanguages } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages')
        const { defaultLanguage } = await resolveTenantLanguages(tenantId)
        const primary = rules.normalizeLocale(defaultLanguage)
        const allowed = new Set([primary, ...offered.map(rules.normalizeLocale)])
        if (allowed.has(want) && want !== primary) locale = want
      } catch { /* same */ }
    }
    return { pageId, locale }
  }

  /**
   * Has the tenant reached the plan's subscriber cap (phase 16)? A new row is then NOT created, and the caller answers exactly as it always does
   * (a public subscribe never discloses anything: not that an address exists, and not that a plan limit was hit). The refusal is logged with its
   * stable code so the operator view and an alert rule can see it; an unverified or verified row that already exists is unaffected.
   * No cap declared, or a gate that cannot answer, is "not full".
   */
  private static async atCap(tenantId: string): Promise<boolean> {
    try {
      const max = await limitOf(tenantId, OBSERVABILITY_LIMIT_KEYS.SUBSCRIBERS)
      if (!Number.isFinite(max)) return false
      const current = await withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) => repo.count({ where: { tenantId } }))
      if (current < max) return false
      Logger.warn(`[observability] ${refusalForLimit(OBSERVABILITY_LIMIT_KEYS.SUBSCRIBERS).code} tenant=${tenantId} limit=${max} current=${current}: a new subscriber was not stored`)
      return true
    } catch { return false }
  }

  /** Create the row, or re-arm an unverified one with a fresh token; a verified one is left alone (returns null). */
  private static async upsertPending(
    tenantId: string,
    key: { email: string } | { phone: string } | { endpointUrl: string } | { chatUrlFingerprint: string },
    fields: Partial<StatusSubscriber>,
  ): Promise<StatusSubscriber | null> {
    const full = await StatusSubscriberService.atCap(tenantId)
    try {
      return await withTenantRepositoryFor(tenantId, StatusSubscriber, async (repo) => {
        const found = await repo.findOne({ where: { tenantId, ...key } })
        if (found?.verifiedAt) return null
        if (!found) {
          if (full) return null
          return repo.save(repo.create({ tenantId, ...fields, verifyToken: token(), unsubscribeToken: token() }))
        }
        const patch: Partial<StatusSubscriber> = {
          verifyToken: token(),
          componentIds: fields.componentIds ?? found.componentIds ?? null,
          pageId: fields.pageId ?? found.pageId ?? null,
          locale: fields.locale ?? found.locale ?? null,
          ...(fields.signingSecret ? { signingSecret: fields.signingSecret } : {}),
        }
        await repo.update({ tenantId, subscriberId: found.subscriberId }, patch)
        return Object.assign(found, patch)
      })
    } catch (error) {
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) return null
      throw error
    }
  }

  /** Confirm a subscription from the emailed link. */
  static async verify(tenantId: string, verifyToken: string): Promise<boolean> {
    // Conditional, single statement: the token is consumed exactly once.
    const res = await withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) =>
      repo.update({ tenantId, verifyToken }, { verifiedAt: new Date(), verifyToken: null }))
    return (res.affected ?? 0) > 0
  }

  /**
   * Does this verify or unsubscribe token belong to a Slack or Teams subscriber? Their links sit in a channel that bots read: a link preview
   * would "click" a GET for a human, so for these rows the GET only shows a button and the POST acts (see the two routes).
   */
  static async isChatToken(tenantId: string, which: 'verify' | 'unsubscribe', token: string): Promise<boolean> {
    if (!token || token.length > 64) return false
    const row = await withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) => repo.findOne({
      where: which === 'verify' ? { tenantId, verifyToken: token } : { tenantId, unsubscribeToken: token },
    }))
    return Boolean(row && isChatChannel(row.channel))
  }

  /** One-click unsubscribe — token is the whole credential, no login. */
  static async unsubscribe(tenantId: string, unsubscribeToken: string): Promise<boolean> {
    const result = await withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) => repo.delete({ tenantId, unsubscribeToken }))
    return (result.affected ?? 0) > 0
  }

  static async list(tenantId: string): Promise<StatusSubscriber[]> {
    return withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) => repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 1000,
    }))
  }

  /** An operator removes a subscriber. */
  static async remove(tenantId: string, subscriberId: string): Promise<void> {
    const r = await withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) => repo.delete({ tenantId, subscriberId }))
    if (!r.affected) throw new AppError('Subscriber not found', 404, ErrorCode.NOT_FOUND)
  }

  /**
   * Which of `emails` this tenant's status page mails at a maintenance window's start and end (its verified EMAIL
   * subscribers, while the page is enabled), lower case. An announcement's maintenance notice leaves them out of its own
   * mail so a person gets one (docs/phases/47-announcements B).
   */
  static async mailedAddresses(tenantId: string, emails: string[]): Promise<string[]> {
    if (emails.length === 0 || !(await StatusPublicService.isEnabled(tenantId))) return []
    const wanted = new Set(emails.map((e) => e.toLowerCase()))
    const rows = await StatusSubscriberService.verifiedRows(tenantId)
    return rows
      .filter((r) => (r.channel ?? 'EMAIL') === 'EMAIL' && r.email && wanted.has(r.email.toLowerCase()))
      .map((r) => r.email!.toLowerCase())
  }

  // ── fan-out ────────────────────────────────────────────────────────────────

  private static async verifiedRows(tenantId: string): Promise<StatusSubscriber[]> {
    return withTenantRepositoryFor(tenantId, StatusSubscriber, (repo) => repo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.verifiedAt IS NOT NULL')
      .take(MAX_SUBSCRIBERS_NOTIFIED)
      .getMany())
  }

  /** Drop the subscribers whose page has none of the affected components. A page that cannot be read does not drop anybody. */
  private static async filterByPage(tenantId: string, rows: StatusSubscriber[], affected: string[]): Promise<StatusSubscriber[]> {
    const pageIds = [...new Set(rows.map((r) => r.pageId).filter((p): p is string => Boolean(p)))]
    if (pageIds.length === 0 || affected.length === 0) return rows
    try {
      const [{ StatusPage }, { StatusComponent }, rules] = await Promise.all([
        import('./entities/status_page.entity'), import('./entities/status_component.entity'), import('./status.page.rules'),
      ])
      const pages = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.find({ where: { tenantId, pageId: In(pageIds) } }))
      const comps = await withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.find({ where: { tenantId } }))
      const ok = new Map<string, boolean>()
      for (const p of pages) {
        const ids = new Set(rules.visibleComponents(comps, { audience: p.audience as 'PUBLIC', componentIds: p.componentIds ?? null }).map((c) => c.componentId))
        ok.set(p.pageId, affected.some((id) => ids.has(id)))
      }
      return rows.filter((r) => !r.pageId || ok.get(r.pageId) !== false)
    } catch {
      return rows
    }
  }

  /** The incident's words in each subscriber language that has a translation; the primary language otherwise. */
  private static async translations(tenantId: string, incident: Incident, rows: StatusSubscriber[]) {
    const locales = [...new Set(rows.map((r) => r.locale).filter((l): l is string => Boolean(l)))]
    const byLocale = new Map<string, { title: string; message: string | null }>()
    if (locales.length === 0) return byLocale
    try {
      const { StatusTranslation } = await import('./entities/status_translation.entity')
      const found = await withTenantRepositoryFor(tenantId, StatusTranslation, (repo) => repo.find({
        where: { tenantId, entityType: 'incident', entityId: incident.incidentId, locale: In(locales) },
      }))
      for (const t of found) byLocale.set(t.locale, { title: t.name || incident.title, message: t.body || incident.publicMessage || null })
    } catch { /* untranslated is still delivered */ }
    return byLocale
  }

  /** One subscriber who cannot be reached must never stop the others: every delivery is its own failure domain. */
  private static async deliver(tenantId: string, s: StatusSubscriber, msg: OutboundMessage, publicUrlBase?: string): Promise<void> {
    try {
      await StatusSubscriberService.deliverOne(tenantId, s, msg, publicUrlBase)
    } catch (err) {
      Logger.warn(`[observability] status delivery to a ${s.channel ?? 'EMAIL'} subscriber failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`)
    }
  }

  private static async deliverOne(tenantId: string, s: StatusSubscriber, msg: OutboundMessage, publicUrlBase?: string): Promise<void> {
    const unsubscribeUrl = `${publicUrlBase ?? ''}/api/public/status/unsubscribe?token=${s.unsubscribeToken}`
    const channel = s.channel ?? 'EMAIL'
    if (channel === 'SMS') {
      if (s.phone) await sendSms(tenantId, s.phone, `${clip(msg.subject, 120)}\nStop: ${unsubscribeUrl}`)
      return
    }
    if (channel === 'WEBHOOK') {
      if (!s.endpointUrl) return
      const secret = decryptFieldOpt(s.signingSecret) ?? null
      const data = { ...(await msg.data()), unsubscribeUrl }
      let ok = await postSignedWebhook(tenantId, s.endpointUrl, secret, { event: msg.event, data })
      if (!ok) ok = await postSignedWebhook(tenantId, s.endpointUrl, secret, { event: msg.event, data })
      await StatusSubscriberService.recordWebhookResult(tenantId, s, ok)
      return
    }
    if (isChatChannel(channel)) {
      if (!s.chatUrlCipher || !msg.chat) return
      let url: string
      try { url = decryptField(s.chatUrlCipher) } catch { return }
      // The unsubscribe link rides in every post, as in every mail.
      const outcome = await postChat(channel, url, formatFor(channel, { ...msg.chat, footerUrl: unsubscribeUrl, footerUrlLabel: 'Unsubscribe' }))
      await StatusSubscriberService.recordChatResult(tenantId, s, outcome)
      return
    }
    if (!s.email) return
    await StatusSubscriberService.sendMail(
      tenantId, s.email, msg.subject,
      msg.html + `<p style="font-size:12px;color:#888"><a href="${unsubscribeUrl}">Unsubscribe</a></p>`,
    )
  }

  /** A chat outcome: the same streak as a webhook, and a destination the vendor says is gone (revoked, deleted) is switched off at once. */
  private static async recordChatResult(tenantId: string, s: StatusSubscriber, outcome: ChatSendOutcome): Promise<void> {
    await StatusSubscriberService.recordWebhookResult(tenantId, s, outcome.status === 'sent', outcome.status === 'failed' && outcome.gone === true)
  }

  /** A success clears the streak; the tenth failure in a row switches the endpoint off until it subscribes again. */
  private static async recordWebhookResult(tenantId: string, s: StatusSubscriber, ok: boolean, gone = false): Promise<void> {
    try {
      await withTenantRepositoryFor(tenantId, StatusSubscriber, async (repo) => {
        if (ok) {
          if ((s.consecutiveFailures ?? 0) > 0) await repo.update({ tenantId, subscriberId: s.subscriberId }, { consecutiveFailures: 0 })
          return
        }
        const failures = (s.consecutiveFailures ?? 0) + 1
        await repo.update({ tenantId, subscriberId: s.subscriberId }, gone || failures >= WEBHOOK_MAX_FAILURES
          ? { consecutiveFailures: failures, verifiedAt: null, verifyToken: null }
          : { consecutiveFailures: failures })
      })
    } catch (err) {
      Logger.warn(`[observability] status webhook bookkeeping failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Deliver one message to each row. Email, SMS and webhook rows go one after another as before; Slack and Teams rows run alongside, a few at a
   * time, so a destination that hangs (a timeout and its retries take seconds) never delays the other channels, and a rejected delivery
   * (`deliver` already contains its own failure) never stops another.
   */
  private static async fanOut(tenantId: string, rows: StatusSubscriber[], build: (s: StatusSubscriber) => OutboundMessage, publicUrlBase?: string): Promise<void> {
    const chat = rows.filter((r) => isChatChannel(r.channel))
    const rest = rows.filter((r) => !isChatChannel(r.channel))
    const chatRun = (async () => {
      const queue = [...chat]
      await Promise.allSettled(Array.from({ length: Math.min(CHAT_CONCURRENCY, queue.length) }, async () => {
        for (let s = queue.shift(); s; s = queue.shift()) await StatusSubscriberService.deliver(tenantId, s, build(s), publicUrlBase)
      }))
    })()
    for (const s of rest) await StatusSubscriberService.deliver(tenantId, s, build(s), publicUrlBase)
    await chatRun
  }

  /** Names of the PUBLIC components an incident touches, for a chat post. A lookup that fails costs the names, not the post. */
  private static async publicComponentNames(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    try {
      const { StatusComponent } = await import('./entities/status_component.entity')
      const comps = await withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.find({ where: { tenantId } }))
      return comps.filter((c) => c.isPublic && ids.includes(c.componentId)).map((c) => c.name)
    } catch { return [] }
  }

  /**
   * The absolute base of the public links in a message (`<base>/api/public/status/unsubscribe?token=`). The incident paths never pass one, so the
   * links used to be RELATIVE (`/api/public/status/...`), which no mail client or chat can open and which a chat renderer drops altogether. The
   * default is the tenant's own absolute origin, in the same `/tenant/<id>` form the confirmation links already use.
   */
  private static async linkBase(tenantId: string, given?: string): Promise<string> {
    if (given) return given
    try {
      const { absoluteTenantUrl } = await import('@kuraykaraaslan-labs/common/server/tenant-url')
      return await absoluteTenantUrl(tenantId, '')
    } catch { return '' }
  }

  private static async statusLink(tenantId: string): Promise<string | null> {
    try {
      const { absoluteTenantUrl } = await import('@kuraykaraaslan-labs/common/server/tenant-url')
      return await absoluteTenantUrl(tenantId, '/status')
    } catch { return null }
  }

  /**
   * Notify every verified subscriber about a PUBLIC incident event.
   * Fire-and-forget from the incident path; only public incidents on an
   * enabled status page ever notify.
   */
  static async notifyIncident(
    tenantId: string,
    incident: Incident,
    kind: IncidentMailKind,
    publicUrlBase?: string,
  ): Promise<void> {
    try {
      if (!incident.isPublic) return
      if (!(await StatusPublicService.isEnabled(tenantId))) return
      const rows = await StatusSubscriberService.verifiedRows(tenantId)

      const affected = incident.affectedComponentIds ?? []
      const byComponent = rows.filter((s) =>
        !s.componentIds || s.componentIds.length === 0 || affected.length === 0
        || s.componentIds.some((id) => affected.includes(id)))
      const relevant = await StatusSubscriberService.filterByPage(tenantId, byComponent, affected)
      const translated = await StatusSubscriberService.translations(tenantId, incident, relevant)

      const subjectByKind: Record<IncidentMailKind, (title: string) => string> = {
        opened: (t) => `[Status] Incident: ${t}`,
        updated: (t) => `[Status] Update: ${t}`,
        resolved: (t) => `[Status] Resolved: ${t}`,
      }
      let projected: Promise<Record<string, unknown>> | null = null
      const incidentData = () => (projected ??= StatusSubscriberService.incidentWebhookData(tenantId, incident))

      const linkBase = await StatusSubscriberService.linkBase(tenantId, publicUrlBase)
      const wantsChat = relevant.some((r) => isChatChannel(r.channel))
      const components = wantsChat ? await StatusSubscriberService.publicComponentNames(tenantId, affected) : []
      const statusUrl = wantsChat ? await StatusSubscriberService.statusLink(tenantId) : null
      const chatHeadline: Record<IncidentMailKind, string> = { opened: 'Incident opened', updated: 'Incident update', resolved: 'Incident resolved' }
      await StatusSubscriberService.fanOut(tenantId, relevant, (s) => {
        const tr = s.locale ? translated.get(s.locale) : undefined
        const title = tr?.title ?? incident.title
        const message = tr ? tr.message : (incident.publicMessage ?? null)
        return {
          subject: subjectByKind[kind](title),
          html: `<p><strong>${esc(title)}</strong> (${esc(incident.severity)})</p>` + (message ? `<p>${esc(message)}</p>` : ''),
          event: `status.incident.${kind}`,
          data: incidentData,
          chat: {
            kind: kind === 'opened' ? 'incident.created' : kind === 'resolved' ? 'incident.resolved' : 'incident.updated',
            headline: chatHeadline[kind], title,
            severity: (incident.severity === 'MINOR' || incident.severity === 'MAJOR' || incident.severity === 'CRITICAL') ? incident.severity : null,
            status: kind === 'resolved' ? 'RESOLVED' : 'OPEN', components, body: message, linkUrl: statusUrl, linkLabel: 'View status page',
          },
        }
      }, linkBase)
    } catch (err) {
      Logger.warn(`[observability] subscriber notification failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** The webhook body of an incident: the page's own projection of it (never the row), with its public updates. */
  private static async incidentWebhookData(tenantId: string, incident: Incident): Promise<Record<string, unknown>> {
    const { projectIncident } = await import('./status.public.service')
    const { IncidentUpdate } = await import('./entities/incident_update.entity')
    const updates = await withTenantRepositoryFor(tenantId, IncidentUpdate, (repo) => repo.find({
      where: { tenantId, incidentId: incident.incidentId }, order: { createdAt: 'ASC' },
    }))
    return { incident: projectIncident(incident, updates) }
  }

  /**
   * Notify every verified subscriber that maintenance has started / ended
   * (tenant phase-3 bridge). The window itself lives in `tenant` — this only
   * reads the fields the operator already wrote for the public 503 page, and
   * windows have no component mapping, so every subscriber is relevant.
   */
  static async notifyMaintenance(
    tenantId: string,
    window: { windowId: string; title: string; message?: string | null; scheduledEnd?: Date | string | null },
    kind: 'started' | 'ended',
    publicUrlBase?: string,
  ): Promise<void> {
    try {
      if (!(await StatusPublicService.isEnabled(tenantId))) return
      const rows = await StatusSubscriberService.verifiedRows(tenantId)

      const subject = kind === 'started'
        ? `[Status] Maintenance in progress: ${window.title}`
        : `[Status] Maintenance completed: ${window.title}`
      const until = kind === 'started' && window.scheduledEnd
        ? `<p>Expected back by ${new Date(window.scheduledEnd).toUTCString()}.</p>`
        : ''
      const linkBase = await StatusSubscriberService.linkBase(tenantId, publicUrlBase)
      const statusUrl = rows.some((r) => isChatChannel(r.channel)) ? await StatusSubscriberService.statusLink(tenantId) : null
      await StatusSubscriberService.fanOut(tenantId, rows, () => ({
        subject,
        html: `<p><strong>${esc(window.title)}</strong></p>` + (window.message ? `<p>${esc(window.message)}</p>` : '') + until,
        event: `status.maintenance.${kind}`,
        data: async () => ({
          maintenance: {
            windowId: window.windowId, title: window.title, message: window.message ?? null,
            scheduledEnd: window.scheduledEnd ? new Date(window.scheduledEnd).toISOString() : null,
          },
        }),
        chat: {
          kind: 'status.maintenance', headline: kind === 'started' ? 'Maintenance in progress' : 'Maintenance completed', title: window.title,
          status: kind === 'started' ? 'MAINTENANCE' : 'COMPLETED', body: window.message ?? null, linkUrl: statusUrl, linkLabel: 'View status page',
        },
      }), linkBase)
    } catch (err) {
      Logger.warn(`[observability] maintenance subscriber notification failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Every status mail leaves through the dispatcher (PLAT-01), never the mail queue.
   *
   * Until now this module reached past `notification` straight into
   * `notification_mail`, which is the shape that made the account settings
   * page's "Email notifications" toggle gate nothing for two dozen modules.
   *
   * The recipient here is ADDRESS-ONLY — a status subscriber is somebody who
   * typed an email into a public page and confirmed it; they have no account
   * and usually no relationship with the tenant beyond caring whether the
   * service is up. `NotificationRecipient.userId` became optional for exactly
   * this (commerce plan 09 §3.4's request), so the dispatcher can address them
   * at all.
   *
   * `event` is stable and namespaced so a channel or a ledger can tell status
   * mail apart from everything else the tenant sends.
   *
   * **The suppression gate is the dispatcher's, not ours.** `notification.policy` asks every `notification:suppression` contributor
   * about the address before any channel runs (`contact` contributes its list of unsubscribes, hard bounces and complaints), so a
   * suppressed address gets no status mail without `observability` knowing `contact` exists. This call is TRANSACTIONAL by
   * derivation (NORMAL urgency, no marketing category): a marketing unsubscribe does not stop an outage notice, a hard bounce or a
   * complaint does. The call shape below is pinned by a test, because changing it (CRITICAL, a marketing category) would change what
   * the gate decides.
   */
  private static async sendMail(tenantId: string, to: string, subject: string, html: string): Promise<void> {
    try {
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service')
      await NotificationService.notify(
        tenantId,
        { email: to },
        { event: 'observability.status', title: subject, body: subject, data: { html } },
        // NORMAL, not CRITICAL: an outage notice is important, but CRITICAL
        // bypasses every recipient-controlled gate and is for account-control
        // messages (OTP, password reset). Borrowing it would make status mail
        // unmutable.
        { urgency: 'NORMAL', channels: ['mail'] },
      )
    } catch (err) {
      Logger.warn(`[observability] status mail not sent: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
