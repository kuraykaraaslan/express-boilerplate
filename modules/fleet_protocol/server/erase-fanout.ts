import { randomUUID } from 'node:crypto'
import { checkCommandBody } from './catalogue'

/**
 * The erasure fan-out's plan (12 section 6): an erasure request at the hub names a person, and the workspace list says which nodes hold a shadow of
 * them. One `user.erase` order goes to each NODE (not each workspace: a person has one shadow per node, and the node's account deletion covers all
 * of that node's workspaces), carrying the pairwise subject that node knows. Pure: no store, no clock, no signing. Who may start a fan-out, and the
 * class-3 approval it needs, belong to the caller; this only says what would be ordered.
 *
 * Refuses (`ok: false`) rather than guessing: a person with no link has nothing to fan out to (`NO_WORKSPACES`), and rows of one node that disagree on
 * the subject (`SUB_MISMATCH`, never produced by the migration guard) would erase the wrong shadow or none, so the plan is not made.
 */
/** The part of a workspace list row the plan reads (`WorkspaceLinkRow` of `auth_oidc_provider` satisfies it). */
export interface EraseLink { nodeId: string; workspaceTenantId: string; pairwiseSub: string }
export interface EraseOrder { nodeId: string; kind: 'user.erase'; payload: { sub: string; fanoutJti: string }; workspaces: number }
export type ErasePlan = { ok: true; fanoutJti: string; orders: EraseOrder[] } | { ok: false; reason: 'NO_WORKSPACES' | 'SUB_MISMATCH' | 'BAD_ORDER' }

/** `fanoutJti` ties every order of one request together (receipts are collected by it); a fresh uuid unless the caller supplies the request's own. */
export function planEraseFanout(links: readonly EraseLink[], fanoutJti: string = randomUUID()): ErasePlan {
  return planFanout('user.erase', links, fanoutJti) as ErasePlan;
}

export interface DossierOrder { nodeId: string; kind: 'user.dossier'; payload: { sub: string; fanoutJti: string }; workspaces: number }
export type DossierPlan = { ok: true; fanoutJti: string; orders: DossierOrder[] } | { ok: false; reason: 'NO_WORKSPACES' | 'SUB_MISMATCH' | 'BAD_ORDER' }

/**
 * The access request's plan (decision F37): the same per-node orders as the erasure's, `user.dossier {sub, fanoutJti}`, one per node holding a shadow.
 * `fanoutJti` is the request's own id (a person may ask again later, and each request has its own receipts).
 */
export function planDossierFanout(links: readonly EraseLink[], fanoutJti: string = randomUUID()): DossierPlan {
  return planFanout('user.dossier', links, fanoutJti) as DossierPlan;
}

function planFanout(kind: 'user.erase' | 'user.dossier', links: readonly EraseLink[], fanoutJti: string): ErasePlan | DossierPlan {
  const byNode = new Map<string, { sub: string; workspaces: Set<string> }>()
  for (const l of links) {
    const seen = byNode.get(l.nodeId)
    if (!seen) byNode.set(l.nodeId, { sub: l.pairwiseSub, workspaces: new Set([l.workspaceTenantId]) })
    else if (seen.sub !== l.pairwiseSub) return { ok: false, reason: 'SUB_MISMATCH' }
    else seen.workspaces.add(l.workspaceTenantId)
  }
  if (byNode.size === 0) return { ok: false, reason: 'NO_WORKSPACES' }
  const orders = [...byNode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([nodeId, v]) => ({ nodeId, kind, payload: { sub: v.sub, fanoutJti }, workspaces: v.workspaces.size }))
  // The catalogue is the authority on what a node accepts: an order it would refuse is never planned.
  if (!orders.every((o) => checkCommandBody({ kind: o.kind, ...o.payload }).ok)) return { ok: false, reason: 'BAD_ORDER' }
  return { ok: true, fanoutJti, orders } as ErasePlan | DossierPlan
}
