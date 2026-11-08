import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { encryptField, decryptField } from '@kuraykaraaslan-labs/common/server/field-encryption'
import { ChatDestination } from './entities/chat_destination.entity'
import { StatusComponent } from './entities/status_component.entity'
import { checkChatUrl, chatUrlFingerprint, maskChatUrl, redactSecrets, type ChatKind } from './chat.destination'
import { formatFor, PUBLIC_CHAT_EVENTS, type ChatEvent, type ChatMessageModel } from './chat.format'
import { projectIncidentMessage, toChatEvent, wantsEvent, type ChatAudience, type ComponentFact, type IncidentFacts, type WebhookIncidentEvent } from './chat.projection'
import { postChat, isChatCode, type ChatSendOutcome } from './chat.sender'
import { auditChat } from './chat.audit'
import type { CreateChatDestinationInput, UpdateChatDestinationInput } from './chat.dto'

/**
 * Slack and Microsoft Teams posts for incidents (observability phase 14.7): the per-tenant list of destinations, and the fan-out of the
 * incident lifecycle to them.
 *
 * The invariants, each pinned by a test:
 *  - the webhook URL is write-only: encrypted at rest, never in a view, a log line, an audit row or an error;
 *  - a destination flagged PUBLIC never receives a private incident, a workflow step or an internal field (`chat.projection.ts`);
 *  - one dead destination never delays or blocks another, and never the incident itself (the caller fires and forgets);
 *  - a destination that fails ten times in a row, or answers "gone", is switched off instead of hammered;
 *  - every query is inside the caller's tenant.
 */

export const CHAT_MAX_FAILURES = 10
const TEST_COOLDOWN_SECONDS = 10
const MAX_DESTINATIONS = 20

/** What an operator sees of a destination. An exact key list, pinned by a test: no URL, no ciphertext, no fingerprint. */
export function chatDestinationView(d: Pick<ChatDestination, 'destinationId' | 'kind' | 'label' | 'urlHost' | 'audience' | 'events' | 'severities' | 'enabled' | 'consecutiveFailures' | 'lastStatus' | 'lastSentAt' | 'disabledAt' | 'createdAt'>) {
  return {
    destinationId: d.destinationId, kind: d.kind, label: d.label, host: d.urlHost, maskedUrl: maskChatUrl(d.urlHost),
    audience: d.audience, events: d.events ?? null, severities: d.severities ?? null, enabled: d.enabled,
    consecutiveFailures: d.consecutiveFailures, lastStatus: d.lastStatus ?? null, lastSentAt: d.lastSentAt ?? null,
    disabledAt: d.disabledAt ?? null, createdAt: d.createdAt,
  }
}
export type ChatDestinationView = ReturnType<typeof chatDestinationView>

const PG_UNIQUE_VIOLATION = '23505'

/** The checked URL as ciphertext, or a clear refusal. Refuses (never falls back to plaintext) when the platform key is not configured. */
function sealUrl(kind: ChatKind, tenantId: string, raw: string): { cipher: string; host: string; fingerprint: string } {
  const check = checkChatUrl(kind, raw)
  if (!check.ok) {
    throw new AppError(
      check.reason === 'host_not_allowed' || check.reason === 'path_not_allowed'
        ? `That is not a ${kind === 'SLACK' ? 'Slack incoming webhook' : 'Microsoft Teams webhook'} URL`
        : 'The URL is not acceptable for a chat webhook',
      422, ErrorCode.VALIDATION_ERROR,
    )
  }
  let cipher: string
  try { cipher = encryptField(check.url) } catch {
    throw new AppError('Chat destinations need the platform encryption key to be configured', 409, ErrorCode.CONFLICT)
  }
  return { cipher, host: check.host, fingerprint: chatUrlFingerprint(tenantId, check.url) }
}

function unseal(row: Pick<ChatDestination, 'urlCipher'>): string | null {
  try { return decryptField(row.urlCipher) } catch { return null }
}

export interface IncidentChatArgs {
  tenantId: string
  /** The webhook module's incident event; mapped to the chat vocabulary here. */
  event: WebhookIncidentEvent
  change?: string | null
  incident: IncidentFacts
  /** The words of the public progress update, when the event is one. */
  updateMessage?: string | null
  /** The incident was private a moment ago and has just been published. */
  becamePublic?: boolean
}

export default class ChatService {
  static async list(tenantId: string): Promise<ChatDestinationView[]> {
    const rows = await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'ASC' }, take: MAX_DESTINATIONS + 1 }))
    return rows.map(chatDestinationView)
  }

  static async create(tenantId: string, input: CreateChatDestinationInput, actorId: string | null): Promise<ChatDestinationView> {
    const sealed = sealUrl(input.kind, tenantId, input.url)
    try {
      const saved = await withTenantRepositoryFor(tenantId, ChatDestination, async (repo) => {
        if ((await repo.count({ where: { tenantId } })) >= MAX_DESTINATIONS) throw new AppError(`At most ${MAX_DESTINATIONS} chat destinations`, 409, ErrorCode.CONFLICT)
        return repo.save(repo.create({
          tenantId, kind: input.kind, label: input.label, urlCipher: sealed.cipher, urlHost: sealed.host, urlFingerprint: sealed.fingerprint,
          audience: input.audience, events: input.events ?? null, severities: input.severities ?? null, enabled: input.enabled,
          consecutiveFailures: 0, createdBy: actorId,
        }))
      })
      await auditChat(tenantId, actorId, 'observability.chat.destination_created', saved.destinationId, {
        kind: saved.kind, label: saved.label, host: saved.urlHost, audience: saved.audience, events: saved.events ?? null, severities: saved.severities ?? null, enabled: saved.enabled,
      })
      return chatDestinationView(saved)
    } catch (error) {
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) throw new AppError('That channel is already connected', 409, ErrorCode.CONFLICT)
      throw error
    }
  }

  static async update(tenantId: string, destinationId: string, patch: UpdateChatDestinationInput, actorId: string | null): Promise<ChatDestinationView> {
    const found = await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.findOne({ where: { tenantId, destinationId } }))
    if (!found) throw new AppError('Chat destination not found', 404, ErrorCode.NOT_FOUND)
    const next: Partial<ChatDestination> = {}
    const changed: string[] = []
    if (patch.label !== undefined) { next.label = patch.label; changed.push('label') }
    if (patch.url !== undefined) {
      const sealed = sealUrl(found.kind as ChatKind, tenantId, patch.url)
      Object.assign(next, { urlCipher: sealed.cipher, urlHost: sealed.host, urlFingerprint: sealed.fingerprint, consecutiveFailures: 0, lastStatus: null })
      changed.push('url')
    }
    if (patch.audience !== undefined) { next.audience = patch.audience; changed.push('audience') }
    if (patch.events !== undefined) { next.events = patch.events ?? null; changed.push('events') }
    if (patch.severities !== undefined) { next.severities = patch.severities ?? null; changed.push('severities') }
    if (patch.enabled !== undefined) {
      next.enabled = patch.enabled; changed.push('enabled')
      if (patch.enabled) { next.consecutiveFailures = 0; next.disabledAt = null } else next.disabledAt = new Date()
    }
    // Narrowing to PUBLIC must not leave an event list that the public audience could never receive.
    const audience = next.audience ?? found.audience
    if (audience === 'PUBLIC') {
      const events = next.events !== undefined ? next.events : found.events
      if (events && events.some((e) => !(PUBLIC_CHAT_EVENTS as readonly string[]).includes(e))) {
        throw new AppError('A public destination can only receive: ' + PUBLIC_CHAT_EVENTS.join(', '), 422, ErrorCode.VALIDATION_ERROR)
      }
    }
    try {
      await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.update({ tenantId, destinationId }, next))
    } catch (error) {
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) throw new AppError('That channel is already connected', 409, ErrorCode.CONFLICT)
      throw error
    }
    const after = { ...found, ...next } as ChatDestination
    await auditChat(tenantId, actorId, 'observability.chat.destination_updated', destinationId, {
      kind: after.kind, label: after.label, host: after.urlHost, changed, ...(changed.includes('audience') ? { audience: after.audience } : {}),
    })
    return chatDestinationView(after)
  }

  static async remove(tenantId: string, destinationId: string, actorId: string | null): Promise<void> {
    const found = await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.findOne({ where: { tenantId, destinationId } }))
    if (!found) throw new AppError('Chat destination not found', 404, ErrorCode.NOT_FOUND)
    await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.delete({ tenantId, destinationId }))
    await auditChat(tenantId, actorId, 'observability.chat.destination_deleted', destinationId, { kind: found.kind, label: found.label, host: found.urlHost })
  }

  /** A fixed, harmless message. Cooldown per destination; Redis down = refuse (an unlimited tester is a message cannon). */
  static async sendTest(tenantId: string, destinationId: string, actorId: string | null): Promise<{ delivered: boolean; code: string }> {
    const found = await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.findOne({ where: { tenantId, destinationId } }))
    if (!found) throw new AppError('Chat destination not found', 404, ErrorCode.NOT_FOUND)
    let first: string | null = null
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis')
      first = await redis.set(`obs:chat:test:${tenantId}:${destinationId}`, '1', 'EX', TEST_COOLDOWN_SECONDS, 'NX')
    } catch { first = null }
    if (first !== 'OK') throw new AppError('Wait a few seconds before sending another test', 429, ErrorCode.RATE_LIMIT_EXCEEDED)
    const url = unseal(found)
    const outcome: ChatSendOutcome = url
      ? await postChat(found.kind as ChatKind, url, formatFor(found.kind as ChatKind, TEST_MESSAGE))
      : { status: 'failed', code: 'undecryptable' }
    const code = outcome.status === 'sent' ? 'sent' : outcome.code
    await ChatService.record(tenantId, found, outcome, { countFailure: false })
    await auditChat(tenantId, actorId, 'observability.chat.destination_tested', destinationId, { kind: found.kind, host: found.urlHost, result: code })
    return { delivered: outcome.status === 'sent', code }
  }

  /** The outcome of a post: the streak, the last code, and the switch-off. Best-effort bookkeeping; never throws. */
  private static async record(tenantId: string, d: ChatDestination, outcome: ChatSendOutcome, opts: { countFailure?: boolean } = {}): Promise<void> {
    try {
      const code = outcome.status === 'sent' ? 'sent' : outcome.code
      const patch: Partial<ChatDestination> = { lastStatus: isChatCode(code) ? code : 'error' }
      if (outcome.status === 'sent') {
        patch.lastSentAt = new Date()
        if (d.consecutiveFailures > 0) patch.consecutiveFailures = 0
      } else if (opts.countFailure !== false) {
        const failures = (d.consecutiveFailures ?? 0) + 1
        patch.consecutiveFailures = failures
        const gone = outcome.status === 'failed' && outcome.gone === true
        if (d.enabled && (gone || failures >= CHAT_MAX_FAILURES)) {
          patch.enabled = false; patch.disabledAt = new Date()
          await auditChat(tenantId, null, 'observability.chat.destination_suspended', d.destinationId, { kind: d.kind, host: d.urlHost, reason: gone ? 'gone' : 'consecutive_failures', code })
        }
      }
      await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.update({ tenantId, destinationId: d.destinationId }, patch))
    } catch (err) {
      Logger.warn(`[observability.chat] bookkeeping failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`)
    }
  }

  private static async componentFacts(tenantId: string, ids: string[]): Promise<Map<string, ComponentFact>> {
    const out = new Map<string, ComponentFact>()
    if (ids.length === 0) return out
    try {
      const rows = await withTenantRepositoryFor(tenantId, StatusComponent, (repo) => repo.find({ where: { tenantId } }))
      for (const c of rows) if (ids.includes(c.componentId)) out.set(c.componentId, { name: c.name, isPublic: c.isPublic })
    } catch { /* a post without component names is still a post */ }
    return out
  }

  private static async links(tenantId: string): Promise<{ consoleUrl: string | null; statusUrl: string | null }> {
    try {
      const { absoluteTenantUrl } = await import('@kuraykaraaslan-labs/common/server/tenant-url')
      return { consoleUrl: await absoluteTenantUrl(tenantId, '/admin/incidents'), statusUrl: await absoluteTenantUrl(tenantId, '/status') }
    } catch { return { consoleUrl: null, statusUrl: null } }
  }

  /**
   * Post one incident lifecycle event to every destination that wants it. Each destination is its own failure domain. Never throws.
   * `facts.isPublic` is the incident's state AFTER the change.
   */
  static async dispatchIncident(args: IncidentChatArgs): Promise<{ attempted: number; sent: number }> {
    const { tenantId, incident } = args
    try {
      const baseEvent = toChatEvent(args.event, args.change)
      const destinations = await withTenantRepositoryFor(tenantId, ChatDestination, (repo) => repo.find({ where: { tenantId, enabled: true }, take: MAX_DESTINATIONS }))
      if (destinations.length === 0) return { attempted: 0, sent: 0 }
      const components = await ChatService.componentFacts(tenantId, incident.affectedComponentIds ?? [])
      const { consoleUrl, statusUrl } = await ChatService.links(tenantId)
      const results = await Promise.allSettled(destinations.map(async (d) => {
        const audience = d.audience as ChatAudience
        const event: ChatEvent = audience === 'PUBLIC' && args.becamePublic && baseEvent === 'incident.updated' ? 'incident.created' : baseEvent
        if (!wantsEvent(d, event, incident.severity)) return null
        const model = projectIncidentMessage({
          event: baseEvent, audience, incident, components, consoleUrl, statusUrl, updateMessage: args.updateMessage ?? null, becamePublic: args.becamePublic ?? false,
        })
        return model ? ChatService.post(tenantId, d, model) : null
      }))
      const sent = results.filter((r) => r.status === 'fulfilled' && r.value === true).length
      return { attempted: results.filter((r) => !(r.status === 'fulfilled' && r.value === null)).length, sent }
    } catch (err) {
      Logger.warn(`[observability.chat] dispatch failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`)
      return { attempted: 0, sent: 0 }
    }
  }

  /** The post-mortem of an incident was published: internal destinations only, and public ones only when the incident itself is public. */
  static async dispatchPostmortemPublished(tenantId: string, incident: IncidentFacts): Promise<void> {
    await ChatService.dispatchIncident({ tenantId, event: 'incident.updated', change: 'postmortem_published', incident, becamePublic: false })
  }

  private static async post(tenantId: string, d: ChatDestination, model: ChatMessageModel): Promise<boolean> {
    const url = unseal(d)
    const outcome: ChatSendOutcome = url ? await postChat(d.kind as ChatKind, url, formatFor(d.kind as ChatKind, model)) : { status: 'failed', code: 'undecryptable' }
    await ChatService.record(tenantId, d, outcome)
    return outcome.status === 'sent'
  }
}

const TEST_MESSAGE: ChatMessageModel = {
  kind: 'test', headline: 'Test message', title: 'Incident posts will arrive in this channel',
  severity: null, status: 'TEST', components: [],
  body: 'This is a harmless test message sent by the observability module. Nothing needs to be done.',
}
