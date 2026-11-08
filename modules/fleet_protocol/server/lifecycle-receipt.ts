import { createHash, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalBytes } from './canonical';
import { signDocument, verifyDocument } from './document';
import { IsoSecondsSchema } from './attest.schema';
import { SignedFailoverOrderSchema } from './failover-order';
import { BackupHorizonsSchema, horizonsFitPurge } from './backup-horizons';
import { SubscriptionEchoSchema } from './subscription-echo';

/**
 * Tenant lifecycle receipts (docs/phases/02-fleet/05 section 7, 03 sections 6 and 8.9): what a node signs when something happened to one of its tenants
 * (provisioned, suspended, resumed, exported, purged, ...) and sends to the control plane, at least once, deduplicated by `receiptHash`.
 *
 * The receipt is a domain-separated DOCUMENT (`fleet.lifecycle-receipt`, document.ts) signed with the node's signing key, carried as the body of an
 * `event` envelope (which the node signs too, for transport: audience, freshness, single use). Keeping the receipt a document of its own is what makes it
 * evidence: the control plane stores the receipt fields, the hash and the document signature, and anyone can re-verify that row later against the node's
 * key without the envelope it arrived in. Class G only: ids, an enum type, a timestamp, counts and hashes; never a name, slug, e-mail or free string.
 *
 * VERSIONING. `LIFECYCLE_RECEIPT_VERSION` is the receipt's `v`; a new type is an additive enum member (the control plane's CHECK lists the same set).
 */
export const LIFECYCLE_RECEIPT_DOMAIN = 'fleet.lifecycle-receipt';
export const LIFECYCLE_RECEIPT_VERSION = 1;

/** Every receipt type (the `ck_fleet_tenant_lifecycle_events_type` set of the control plane). */
export const LIFECYCLE_RECEIPT_TYPES = [
  'PROVISIONED', 'ACTIVATED', 'SUSPENDED', 'RESUMED', 'EXPORTED', 'MIGRATION_EXPORTED', 'MIGRATION_IMPORTED', 'CUTOVER', 'PURGED', 'RESTORED',
  'DR_FAILOVER', 'DR_FAILBACK', 'DELETION_REQUESTED', 'LEGAL_HOLD_SET', 'LEGAL_HOLD_CLEARED',
  // fleet phase 6d.2 (F48): the tenant's subscription changed on the node; carries `payload.subscription` (subscription-echo.ts). Control plane first.
  'SUBSCRIPTION_CHANGED',
] as const;
export type LifecycleReceiptType = (typeof LIFECYCLE_RECEIPT_TYPES)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const enumKey = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const MAX_ENTRIES = 32;

/** What a receipt may say beyond its type: the command that caused it (when one did), the assignment version it was written at, counts and hashes. */
export const LifecycleReceiptPayloadSchema = z.object({
  commandJti: z.uuid().optional(),
  assignmentVersion: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  counts: z.record(enumKey, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)).refine((r) => Object.keys(r).length <= MAX_ENTRIES, 'too many counts').optional(),
  hashes: z.record(enumKey, sha256).refine((r) => Object.keys(r).length <= MAX_ENTRIES, 'too many hashes').optional(),
  /**
   * A `DR_FAILOVER` taken on the regional fallback path only (decision F1): the regional operator's signed order the standby executed, carried so the
   * directory can verify it itself. Ids, a code, timestamps and a signature: class G. Additive (control plane first: its strict schema must know it).
   */
  failoverOrder: SignedFailoverOrderSchema.optional(),
  /**
   * A PURGED receipt only (the deletion purge and a migration's source purge, 08 section 4 item 3): the horizon of every backup tier of the node and
   * `backupHorizonAt`, the latest (`backup-horizons.ts`). Absent when the node cannot state its retention. Additive (control plane first).
   */
  backupHorizons: BackupHorizonsSchema.optional(),
  /** A SUBSCRIPTION_CHANGED receipt only, and always there (fleet phase 6d.2): the subscription echo, status facts only. Additive (control plane first). */
  subscription: SubscriptionEchoSchema.optional(),
}).strict();
export type LifecycleReceiptPayload = z.infer<typeof LifecycleReceiptPayloadSchema>;

/** The signed receipt document. */
export const LifecycleReceiptSchema = z.object({
  v: z.literal(LIFECYCLE_RECEIPT_VERSION),
  nodeId,
  tenantId: z.uuid(),
  type: z.enum(LIFECYCLE_RECEIPT_TYPES),
  occurredAt: IsoSecondsSchema,
  payload: LifecycleReceiptPayloadSchema,
}).strict().superRefine((r, ctx) => {
  if ((r.type === 'SUBSCRIPTION_CHANGED') !== (r.payload.subscription !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'a SUBSCRIPTION_CHANGED receipt, and only one, carries the subscription echo', path: ['payload', 'subscription'] });
  }
  const h = r.payload.backupHorizons;
  if (!h) return;
  if (r.type !== 'PURGED') ctx.addIssue({ code: 'custom', message: 'backup horizons belong to a PURGED receipt', path: ['payload', 'backupHorizons'] });
  else if (!horizonsFitPurge(h, r.occurredAt)) ctx.addIssue({ code: 'custom', message: 'a backup horizon before the purge or beyond the bound', path: ['payload', 'backupHorizons'] });
});
export type LifecycleReceipt = z.infer<typeof LifecycleReceiptSchema>;

/** sha256 (hex) of the canonical receipt: its identity, the dedup key of the control plane. */
export function lifecycleReceiptHash(receipt: LifecycleReceipt): string {
  return createHash('sha256').update(canonicalBytes(receipt)).digest('hex');
}

/** The body of the `event` envelope that carries one receipt; the hash is bound to the receipt by the schema. */
export const LifecycleEventBodySchema = z.object({
  receipt: LifecycleReceiptSchema,
  receiptHash: sha256,
  nodeSignature: signature,
}).strict().refine((b) => lifecycleReceiptHash(b.receipt) === b.receiptHash, 'receiptHash does not match the receipt');
export type LifecycleEventBody = z.infer<typeof LifecycleEventBodySchema>;

/** Builds and signs a receipt for a node (throws on anything the control plane would refuse, so a node never signs an unacceptable receipt). */
export function signLifecycleReceipt(input: Omit<LifecycleReceipt, 'v'>, privateKey: KeyObject): LifecycleEventBody {
  const receipt = LifecycleReceiptSchema.parse({ v: LIFECYCLE_RECEIPT_VERSION, ...input });
  return { receipt, receiptHash: lifecycleReceiptHash(receipt), nodeSignature: signDocument(LIFECYCLE_RECEIPT_DOMAIN, receipt, privateKey) };
}

/** True only for a receipt whose hash matches and whose document signature verifies with `publicKey` (the node's signing key). */
export function verifyLifecycleReceipt(body: { receipt: unknown; receiptHash: string; nodeSignature: string }, publicKey: KeyObject): boolean {
  const r = LifecycleReceiptSchema.safeParse(body.receipt);
  if (!r.success || lifecycleReceiptHash(r.data) !== body.receiptHash) return false;
  return verifyDocument(LIFECYCLE_RECEIPT_DOMAIN, r.data, body.nodeSignature, publicKey);
}
