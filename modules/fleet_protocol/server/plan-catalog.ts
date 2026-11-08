import { createHash, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalize } from './canonical';
import { signDocument, verifyDocument } from './document';
import { importPublicKey } from './sign';
import { PlanCatalogDocumentSchema, isPlanCode, planCatalogProblems, type PlanCatalogDocument } from './plan-catalog.schema';

/**
 * The plan catalogue (Decision 20, decision F25): the control plane pushes the commercial catalogue DOWN to the nodes as a signed policy of its own kind,
 * `PLAN_CATALOG`, never as a merge axis of the policy document. Each node receives the GLOBAL catalogue overlaid with its region's (a region's product or
 * price replaces the global one with the same key), so a region only ever sees its own price lists. The node app imports the rows into ROOT's
 * `tenant_subscription` catalogue as `managedBy = 'fleet'` read-only rows; the region stays the system of record for subscriptions and invoices.
 *
 * Signed with a trust-bundle key under its own document domain (`fleet.plan-catalog`), so it can never be replayed as a policy bundle, a trust bundle or
 * an envelope. `version` is monotonic per node; the node refuses an older or equal one and a catalogue addressed to another node. Prices are integers in
 * hundredths of the major unit for EVERY currency (the scale the catalogue stores: 49.00 EUR is 4900, ¥5000 is 500000; plan-catalog.schema.ts), so
 * canonical JSON (integers only) can carry them. The heartbeat `billing` block below uses the ISO 4217 exponent instead (billing-money.ts).
 *
 * The reverse direction is the heartbeat `billing` block (`BillingAggregateSchema`): numbers per plan code and currency, no tenant ids.
 */
export const PLAN_CATALOG_DOMAIN = 'fleet.plan-catalog';
export const PLAN_CATALOG_VERSION = 1;

// The document shape and its pure rules live in plan-catalog.schema.ts (no node:crypto, so the console can use them); every name is re-exported here.
export * from './plan-catalog.schema';
const planCode = z.string().refine(isPlanCode, 'not a plan code');
const currency = z.string().regex(/^[A-Z]{3}$/);

export const planCatalogHash = (catalog: PlanCatalogDocument): string => createHash('sha256').update(canonicalize(catalog)).digest('hex');

/**
 * The largest composed catalogue a node is sent, measured as it travels: the signed `content` is the canonical JSON, and on the wire it is a JSON
 * string inside `{planCatalog:{content}}`, so every quote, backslash and control character in it is escaped once more. The bound is therefore taken on
 * `JSON.stringify` of the canonical catalogue, which is what the catalogue costs inside the response, never on the canonical bytes (a description full
 * of quotes doubles in size there). The signed document must fit the agent's response cap (`fleet_agent` mTLS, 256 KiB) and the app's loopback body cap
 * (256 KiB) with room for the envelope. The control plane refuses to publish a document that would exceed it for any node.
 */
export const MAX_PLAN_CATALOG_BYTES = 192 * 1024;
export const planCatalogBytes = (catalog: PlanCatalogDocument): number => Buffer.byteLength(JSON.stringify(canonicalize(catalog)), 'utf8');

export const PlanCatalogBundleContentSchema = z.object({
  v: z.literal(PLAN_CATALOG_VERSION),
  kind: z.literal('PLAN_CATALOG'),
  version: z.number().int().positive().max(2 ** 31 - 1),
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** The fleet region whose document was overlaid; null for a node outside any region (GLOBAL only). */
  regionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(),
  issuedAt: z.string().datetime(),
  catalog: PlanCatalogDocumentSchema,
  catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((c, ctx) => {
  for (const message of planCatalogProblems(c.catalog)) ctx.addIssue({ code: 'custom', path: ['catalog'], message });
});
export type PlanCatalogBundleContent = z.infer<typeof PlanCatalogBundleContentSchema>;
export interface SignedPlanCatalog { version: number; content: string; sig: string; kid: string }
export const SignedPlanCatalogSchema = z.object({ version: z.number().int().positive(), content: z.string().max(MAX_PLAN_CATALOG_BYTES + 4096), sig: z.string().max(128), kid: z.string().max(64) }).strict();

export function signPlanCatalog(c: { version: number; nodeId: string; regionId: string | null; issuedAt: string; catalog: PlanCatalogDocument }, kid: string, privateKey: KeyObject): SignedPlanCatalog {
  const catalog = PlanCatalogDocumentSchema.parse(c.catalog);
  if (planCatalogBytes(catalog) > MAX_PLAN_CATALOG_BYTES) throw new RangeError(`plan catalogue exceeds ${MAX_PLAN_CATALOG_BYTES} bytes`);
  const content = PlanCatalogBundleContentSchema.parse({ ...c, catalog, v: PLAN_CATALOG_VERSION, kind: 'PLAN_CATALOG', catalogHash: planCatalogHash(catalog) });
  return { version: content.version, content: canonicalize(content), sig: signDocument(PLAN_CATALOG_DOMAIN, content, privateKey), kid };
}

export type PlanCatalogDecision = 'OK' | 'REJECTED_SCHEMA' | 'REJECTED_KID' | 'REJECTED_SIGNATURE' | 'REJECTED_NODE' | 'REJECTED_VERSION' | 'REJECTED_HASH';

/**
 * Verifies a signed catalogue for one node. `bundleKeys` come from the installed, verified trust bundle; `currentVersion` is the catalogue the verifier
 * already holds (0 = none). Used by the agent before it installs one and again by the node app before it imports one, each against its own trust bundle.
 */
export function verifyPlanCatalog(
  signed: unknown, ctx: { bundleKeys: readonly { kid: string; publicKey: string; revoked?: boolean }[]; nodeId: string; currentVersion: number },
): { decision: PlanCatalogDecision; content?: PlanCatalogBundleContent } {
  const s = SignedPlanCatalogSchema.safeParse(signed);
  if (!s.success) return { decision: 'REJECTED_SCHEMA' };
  let content: PlanCatalogBundleContent;
  try {
    const raw = JSON.parse(s.data.content) as unknown;
    content = PlanCatalogBundleContentSchema.parse(raw);
    // Canonical and default-free: the signed bytes must be exactly the parsed content, so no default can add what was not signed.
    if (canonicalize(content) !== s.data.content || canonicalize(raw) !== s.data.content || content.version !== s.data.version) return { decision: 'REJECTED_SCHEMA' };
  } catch { return { decision: 'REJECTED_SCHEMA' }; }
  const key = ctx.bundleKeys.find((k) => k.kid === s.data.kid);
  if (!key || key.revoked) return { decision: 'REJECTED_KID' };
  if (!verifyDocument(PLAN_CATALOG_DOMAIN, content, s.data.sig, importPublicKey(key.publicKey))) return { decision: 'REJECTED_SIGNATURE' };
  if (content.nodeId !== ctx.nodeId) return { decision: 'REJECTED_NODE' };
  if (content.version <= ctx.currentVersion) return { decision: 'REJECTED_VERSION' };
  if (planCatalogHash(content.catalog) !== content.catalogHash) return { decision: 'REJECTED_HASH' };
  return { decision: 'OK', content };
}

/**
 * The heartbeat `billing` block (class G, Decision 20): per plan code and currency, how many subscriptions are active, the monthly recurring revenue in
 * minor units of the row's currency with its ISO 4217 exponent (`mrrMinor`: 49.00 EUR is 4900, 5000 JPY is 5000, 1.234 KWD is 1234; see
 * billing-money.ts, which readers use to format it), and how many started and ended within the trailing `windowDays`. Integers, a plan code from the closed key vocabulary (which cannot hold a
 * uuid) and an ISO currency code: a tenant id, a name or an amount per tenant is not representable. Products the fleet did not publish are reported
 * under `UNMANAGED_PLAN_CODE`, so a local key never leaves the region either.
 */
export const MAX_BILLING_ROWS = 200;
export const BILLING_WINDOW_DAYS = 30;
export const BillingRowSchema = z.object({
  planCode,
  currency,
  active: z.number().int().nonnegative().max(1e9),
  mrrMinor: z.number().int().nonnegative().max(1e15),
  new: z.number().int().nonnegative().max(1e9),
  churned: z.number().int().nonnegative().max(1e9),
}).strict();
export type BillingRow = z.infer<typeof BillingRowSchema>;
export const BillingAggregateSchema = z.object({
  windowDays: z.number().int().min(1).max(366),
  plans: z.array(BillingRowSchema).max(MAX_BILLING_ROWS),
}).strict().refine((b) => new Set(b.plans.map((p) => `${p.planCode}|${p.currency}`)).size === b.plans.length, 'a (plan, currency) row is listed twice');
export type BillingAggregate = z.infer<typeof BillingAggregateSchema>;

/** What a source answered, cut to the schema: the block when it is valid as a whole, otherwise `undefined` (the heartbeat then says nothing). */
export function billingAggregateOf(input: unknown): BillingAggregate | undefined {
  const p = BillingAggregateSchema.safeParse(input);
  if (!p.success) return undefined;
  return { windowDays: p.data.windowDays, plans: [...p.data.plans].sort((a, b) => `${a.planCode}|${a.currency}`.localeCompare(`${b.planCode}|${b.currency}`)) };
}
