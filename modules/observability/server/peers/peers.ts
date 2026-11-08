import { ext, systemCtx, tenantCtx, type ExtCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { observabilityAiPeerLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.ai-peer'
import { observabilitySearchPeerLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.search-peer'
import { observabilityOnCallPeerLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.on-call-peer'
import type { AiPeer, OnCallPeer, SearchPeer } from './peers.types'

/**
 * How observability reaches the modules it uses when they are installed: `ai`, `search` and `on_call`. Each is a `select` point declared in
 * observability/module.json, so a workspace without the module (or a Core fork, which does not carry it) answers `null` and the caller degrades
 * exactly as it did when the module was merely switched off. Nothing here imports those modules.
 *
 * `forTenant` asks as the tenant (only a module active for it answers); `forSystem` is for work that belongs to no tenant (the watchdog, the
 * one-time install of the GenAI wrapper) and says why it needs the contributor.
 */
export const AI_PEER_POINT = 'observability:ai-peer'
export const SEARCH_PEER_POINT = 'observability:search-peer'
export const ON_CALL_PEER_POINT = 'observability:on-call-peer'

const ctxOf = (tenantId: string | null, reason: string): ExtCtx => (tenantId === null ? systemCtx(reason) : tenantCtx(tenantId))

/** `ai`'s peer for the tenant (`null` tenant: the platform), or `null` when no active module provides one. */
export async function loadAiPeer(tenantId: string | null, reason = 'observability: ai peer'): Promise<AiPeer | null> {
  return (await ext.select<AiPeer>(AI_PEER_POINT, ctxOf(tenantId, reason), observabilityAiPeerLoaders))?.impl ?? null
}

export async function loadSearchPeer(tenantId: string): Promise<SearchPeer | null> {
  return (await ext.select<SearchPeer>(SEARCH_PEER_POINT, tenantCtx(tenantId), observabilitySearchPeerLoaders))?.impl ?? null
}

export async function loadOnCallPeer(tenantId: string | null, reason = 'observability: on_call peer'): Promise<OnCallPeer | null> {
  return (await ext.select<OnCallPeer>(ON_CALL_PEER_POINT, ctxOf(tenantId, reason), observabilityOnCallPeerLoaders))?.impl ?? null
}
