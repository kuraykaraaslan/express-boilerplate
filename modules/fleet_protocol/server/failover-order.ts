import { createHash, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalBytes } from './canonical';
import { signDocument, verifyDocument } from './document';
import { IsoSecondsSchema } from './attest.schema';

/**
 * The regional-operator failover order (decision F1, the fallback path of O-17): when the control plane cannot be reached, the region's regional
 * operator signs an order with the regional operator key (the key every node of the region pinned at enrollment, held off-host; its fingerprint is
 * `fleet_nodes.operatorFingerprint`), and the paired `DR_STANDBY`'s agent executes it locally. The normal path is the class-3, co-signed
 * `node.failover` command from the control plane; this document exists only so tenant recovery never depends on the control plane.
 *
 * The order is a domain-separated DOCUMENT (`fleet.failover-order`, document.ts), never an envelope: a signature over it cannot be replayed as a policy
 * override or a command. It names the standby that takes over, the primary that failed and their region, and is valid for at most
 * `FAILOVER_ORDER_MAX_TTL_SECONDS`. The standby carries the order and its signature in every `DR_FAILOVER` receipt it writes, so the directory can
 * re-verify it against the regional key it holds, and accepts it only for a primary it has seen silent past the LOST threshold
 * (`fleet_directory.receipts.ts`). Class G only: ids, a code, timestamps.
 */
export const FAILOVER_ORDER_DOMAIN = 'fleet.failover-order';
export const FAILOVER_ORDER_VERSION = 1;
/** An order is meant for an incident that is happening now: one day at most between issue and expiry. */
export const FAILOVER_ORDER_MAX_TTL_SECONDS = 24 * 3600;
/** Tolerance for a verifier's clock running behind the operator's, on the issue side only: the agent, the helper, the app and the directory allow the same. */
export const FAILOVER_ORDER_SKEW_SECONDS = 300;

const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const regionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);

export const FailoverOrderSchema = z.object({
  v: z.literal(FAILOVER_ORDER_VERSION),
  kind: z.literal('node.failover'),
  orderId: z.uuid(),
  regionId,
  /** The DR_STANDBY that takes the tenants over (the node that executes the order). */
  standbyNodeId: nodeId,
  /** The primary that failed: the only node whose tenants the order covers. */
  failedNodeId: nodeId,
  issuedAt: IsoSecondsSchema,
  expiresAt: IsoSecondsSchema,
}).strict().superRefine((o, ctx) => {
  const ttl = (Date.parse(o.expiresAt) - Date.parse(o.issuedAt)) / 1000;
  if (!(ttl > 0 && ttl <= FAILOVER_ORDER_MAX_TTL_SECONDS)) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'an order is valid for at most one day after its issue' });
  if (o.standbyNodeId === o.failedNodeId) ctx.addIssue({ code: 'custom', path: ['failedNodeId'], message: 'a node cannot take over its own tenants' });
});
export type FailoverOrder = z.infer<typeof FailoverOrderSchema>;

/** The order and the regional operator's signature over it, as the standby stores and forwards it. */
export const SignedFailoverOrderSchema = z.object({ order: FailoverOrderSchema, signature }).strict();
export type SignedFailoverOrder = z.infer<typeof SignedFailoverOrderSchema>;

/** sha256 (hex) of the canonical order: its identity in logs and audit rows. */
export function failoverOrderHash(order: FailoverOrder): string {
  return createHash('sha256').update(canonicalBytes(order)).digest('hex');
}

/** Builds and signs an order with the regional operator key (an operator tool and tests; the key never lives on a node). Throws on an order the schema refuses. */
export function signFailoverOrder(input: Omit<FailoverOrder, 'v' | 'kind'>, regionalOperatorKey: KeyObject): SignedFailoverOrder {
  const order = FailoverOrderSchema.parse({ v: FAILOVER_ORDER_VERSION, kind: 'node.failover', ...input });
  return { order, signature: signDocument(FAILOVER_ORDER_DOMAIN, order, regionalOperatorKey) };
}

export type FailoverOrderCheck =
  | { ok: true; order: FailoverOrder }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'WRONG_STANDBY' | 'WRONG_PRIMARY' | 'WRONG_REGION' | 'NOT_YET_VALID' | 'EXPIRED' };

/**
 * Verifies a signed order for one standby (pure apart from the signature check). `expect` holds what the verifier knows on its own: the standby it is,
 * the primary it is paired with and the region, each compared exactly; `at` is the moment the order must be valid at (unix seconds), with
 * `skewSeconds` of tolerance on the issue side only.
 */
export function verifyFailoverOrder(
  signed: unknown, regionalOperatorKey: KeyObject,
  expect: { standbyNodeId: string; failedNodeId?: string; regionId?: string; at: number; skewSeconds?: number },
): FailoverOrderCheck {
  const p = SignedFailoverOrderSchema.safeParse(signed);
  if (!p.success) return { ok: false, reason: 'MALFORMED' };
  const { order, signature: sig } = p.data;
  if (!verifyDocument(FAILOVER_ORDER_DOMAIN, order, sig, regionalOperatorKey)) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (order.standbyNodeId !== expect.standbyNodeId) return { ok: false, reason: 'WRONG_STANDBY' };
  if (expect.failedNodeId !== undefined && order.failedNodeId !== expect.failedNodeId) return { ok: false, reason: 'WRONG_PRIMARY' };
  if (expect.regionId !== undefined && order.regionId !== expect.regionId) return { ok: false, reason: 'WRONG_REGION' };
  const issued = Date.parse(order.issuedAt) / 1000;
  const expires = Date.parse(order.expiresAt) / 1000;
  if (expect.at + (expect.skewSeconds ?? 0) < issued) return { ok: false, reason: 'NOT_YET_VALID' };
  if (expect.at >= expires) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, order };
}
