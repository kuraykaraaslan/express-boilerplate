import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalBytes } from './canonical';
import { IsoSecondsSchema } from './attest.schema';
import { isPlanCode } from './plan-catalog';

/**
 * The subscription echo (fleet phase 6d.2, docs/phases/02-fleet/15-fleet-commerce.md F48): what the control plane may know of ONE tenant's
 * subscription, carried by a `SUBSCRIPTION_CHANGED` lifecycle receipt and kept in the directory's `fleet_tenant_subscriptions`. Commercial status
 * only, class G: product keys from the fleet's own catalogue (a local key is reported as `unmanaged`, like the heartbeat's billing block), an enum
 * status and billing mode, a period end, a seat count, coupon codes, a currency. Never an amount per tenant, a payment or provider id, an invoice, a
 * usage figure, a name or an e-mail: Decision 20 keeps per-tenant money in the region.
 *
 * `seq` is the node's change counter for the tenant (1, 2, ...): the directory keeps the highest it saw, so a receipt delivered late never
 * overwrites a newer state. `stateHash` is the hash of the snapshot without `seq`; a fleet command carries the hash it was based on, and the node
 * refuses it when its subscription no longer hashes to it (F51, stage 6d.3).
 */
export const SUBSCRIPTION_ECHO_STATUSES = ['NONE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'COMP'] as const;
export type SubscriptionEchoStatus = (typeof SUBSCRIPTION_ECHO_STATUSES)[number];
/** PROVIDER: billed through the region's payment provider; MANUAL_INVOICE: invoiced by hand; COMP: free by an operator; NONE: nothing billed. */
export const SUBSCRIPTION_BILLING_MODES = ['PROVIDER', 'MANUAL_INVOICE', 'COMP', 'NONE'] as const;
export type SubscriptionBillingMode = (typeof SUBSCRIPTION_BILLING_MODES)[number];

/** A coupon code as the platform writes it: upper-case letters, digits, '-' and '_'. Never free text. */
export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
export const MAX_ECHO_ADDONS = 50;
export const MAX_ECHO_COUPONS = 10;

const productKey = z.string().refine(isPlanCode, 'not a product key');
const sorted = (a: readonly string[]) => a.every((v, i) => i === 0 || a[i - 1]! < v);

/** The snapshot a node reports; `seq` and `stateHash` are added by the reporter. */
export const SubscriptionSnapshotSchema = z.object({
  /** The plan's product key, `unmanaged` for a local product, null when the tenant holds no plan. */
  plan: productKey.nullable(),
  status: z.enum(SUBSCRIPTION_ECHO_STATUSES),
  periodEnd: IsoSecondsSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** Live bundles, add-ons and pieces by product key, sorted and unique (`unmanaged` once for any number of local ones). */
  addons: z.array(productKey).max(MAX_ECHO_ADDONS).refine(sorted, 'addons are sorted and unique'),
  /** Coupon codes applied to the subscription now, sorted and unique (stage 6d.4 fills it). */
  coupons: z.array(z.string().regex(COUPON_CODE_RE)).max(MAX_ECHO_COUPONS).refine(sorted, 'coupons are sorted and unique'),
  /** The plan price's currency, `XXX` when it has none. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  billingMode: z.enum(SUBSCRIPTION_BILLING_MODES),
  seats: z.number().int().min(0).max(1_000_000),
}).strict().superRefine((s, ctx) => {
  if (s.plan === null && s.status !== 'NONE') ctx.addIssue({ code: 'custom', path: ['status'], message: 'a tenant without a plan has status NONE' });
  if (s.plan !== null && s.status === 'NONE') ctx.addIssue({ code: 'custom', path: ['status'], message: 'a tenant with a plan has a status' });
});
export type SubscriptionSnapshot = z.infer<typeof SubscriptionSnapshotSchema>;

/** sha256 (hex) of the canonical snapshot: what a fleet command is based on. */
export function subscriptionStateHash(snapshot: SubscriptionSnapshot): string {
  return createHash('sha256').update(canonicalBytes(SubscriptionSnapshotSchema.parse(snapshot))).digest('hex');
}

/** The `subscription` field of a SUBSCRIPTION_CHANGED receipt: the snapshot with its sequence and hash, the hash bound to the snapshot. */
export const SubscriptionEchoSchema = z.object({
  seq: z.number().int().min(1).max(2 ** 31 - 1),
  stateHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot: SubscriptionSnapshotSchema,
}).strict().refine((e) => subscriptionStateHash(e.snapshot) === e.stateHash, 'stateHash does not match the snapshot');
export type SubscriptionEcho = z.infer<typeof SubscriptionEchoSchema>;

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/**
 * A tenant's billing reference (F57): a short customer number derived from its id, so the node (on invoices and its own pages) and the fleet (to
 * search the echo) compute the same one without either sending it. `B-` and 8 characters of an alphabet without 0/O and 1/I. Not a secret and not
 * personal data: it says nothing the tenant id does not.
 */
export function billingRefOf(tenantId: string): string {
  const h = createHash('sha256').update(`fleet.billing-ref\u0000${tenantId.toLowerCase()}`, 'utf8').digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += B32[h[i]! % 32];
  return `B-${out}`;
}
export const BILLING_REF_RE = /^B-[A-HJ-NP-Z2-9]{8}$/;
