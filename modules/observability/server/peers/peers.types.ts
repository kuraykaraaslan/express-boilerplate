import type { EntityTarget, ObjectLiteral } from 'typeorm'

/**
 * The shapes of the modules observability (Core) uses when they are there but never imports: `ai`, `search` and `on_call`.
 * Each is a point declared in observability/module.json (`observability:ai-peer`, `observability:search-peer`,
 * `observability:on-call-peer`) that the module contributes to, so observability keeps no edge onto a module of a higher edition and a
 * Core fork builds without them. The contributing modules type their export against these (`satisfies AiPeer`), so a change on either side
 * is a compile error there, not a runtime surprise here.
 */

// ── ai ─────────────────────────────────────────────────────────────────────────────────────────────────

export type AiCallOperation = 'chat' | 'stream' | 'embed'

export interface AiCallMeta {
  tenantId: string
  operation: AiCallOperation
  provider: string
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
}

/** What a provider call answers, reduced to what tracing reads; a chat or an embedding response both fit. */
export interface AiCallResult {
  model?: string
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export type AiCallWrapper = (meta: AiCallMeta, run: () => Promise<AiCallResult>) => Promise<AiCallResult>

export interface AiPeer {
  canComplete(tenantId: string): Promise<boolean>
  chat(tenantId: string, o: { messages: Array<{ role: 'user'; content: string }>; systemPrompt: string; maxTokens: number; temperature: number; provider: string; model?: string }):
    Promise<{ content: string; model: string; provider: string; usage?: { promptTokens: number; completionTokens: number } }>
  embed(tenantId: string, o: { input: string; provider?: string; model?: string }): Promise<{ embeddings: number[][]; model: string; provider: string }>
  /** The price table of `ai`: undefined for a model it has no price for. */
  calcCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined
  /** The class of `ai`'s own usage log, for a tenant-scoped repository. */
  usageLogEntity: EntityTarget<ObjectLiteral>
  /** Install (or, with null, remove) the one wrapper around every provider call (`ai.hooks`). */
  setCallWrapper(wrapper: AiCallWrapper | null): void
}

// ── search ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SearchPeerHit {
  entityId: string
  title: string
  rank: number
  metadata?: Record<string, unknown> | null
}

export interface SearchPeer {
  /** The document is `search`'s own `IndexDocInput`; observability builds it and does not name the type. */
  index(tenantId: string, input: unknown): Promise<void>
  remove(tenantId: string, entityType: string, entityId: string): Promise<void>
  search(tenantId: string, query: string, opts?: { entityType?: string; limit?: number; offset?: number }): Promise<{ hits: SearchPeerHit[] }>
}

// ── on_call ────────────────────────────────────────────────────────────────────────────────────────────

export interface OnCallPageInput {
  policyId?: string
  title: string
  body: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  source: string
  sourceRef: string
  dedupKey: string
  metadata?: unknown
}

export interface OnCallScheduleEntry {
  schedule: { scheduleId: string; name: string; isActive: boolean }
  onCall: { userId?: string | null; source?: string | null; shiftEnd?: Date | string | null }
}

export interface OnCallPeer {
  page(tenantId: string, input: OnCallPageInput): Promise<unknown>
  resolveByDedupKey(tenantId: string, dedupKey: string): Promise<unknown>
  listSchedules(tenantId: string): Promise<OnCallScheduleEntry[]>
  /** Tenants whose paging self-test has gone silent (none when every one ran lately). */
  silentSelfTests(): Promise<string[]>
}
