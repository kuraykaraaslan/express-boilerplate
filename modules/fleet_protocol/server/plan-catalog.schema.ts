import { z } from 'zod';

/**
 * The plan catalogue's document shape and its pure rules (Decision 20, decision F25), split out of `plan-catalog.ts` so a browser can use them:
 * nothing here imports `node:crypto`, the canonical encoder or a key. `plan-catalog.ts` re-exports every name, so the signing, verifying and
 * hashing side reads exactly these schemas. The fleet console parses an operator's draft with them, composes it with the active documents the
 * way a node will receive it, and lists what a publish changes (`planCatalogChanges`, 02-fleet/16 1.1).
 *
 * The unit of every amount (02-fleet/16 1.3, decision (c)): **hundredths of the major unit, for every currency** (`PLAN_CATALOG_VERSION` 1).
 * 49.00 EUR is 4900, ¥5000 is 500000, 12.34 KWD is 1234; a node stores `minor / 100` in its decimal(12,2) catalogue columns. A third decimal
 * (1.234 KWD) cannot be expressed in this version. This is NOT the unit of the heartbeat `billing` block, whose `mrrMinor` uses the ISO 4217
 * exponent of its currency (`billing-money.ts`): 5000 JPY is 5000 there. An ISO-exponent catalogue unit is left to a catalogue version 2.
 */

/**
 * A product key: the same vocabulary `tenant_subscription` uses ('plan_pro', 'bundle_commerce'). Cannot hold a uuid: no '-', and no run of 16 or more hex
 * digits (a uuid or an id written without its dashes), so an identifier can never pass as a plan code.
 */
export const PLAN_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const HEX_RUN = /[0-9a-f]{16,}/;
export const isPlanCode = (s: string): boolean => PLAN_CODE_RE.test(s) && !HEX_RUN.test(s);
const planCode = z.string().refine(isPlanCode, 'not a plan code');
/** The billing bucket for every product the fleet did not publish: a local product's key never leaves the region. Reserved: no catalogue may use it. */
export const UNMANAGED_PLAN_CODE = 'unmanaged';
const productKey = planCode.refine((k) => k !== UNMANAGED_PLAN_CODE, `'${UNMANAGED_PLAN_CODE}' is reserved for the billing bucket of local products`);
const moduleId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
/** The pricing region of a row as `tenant_subscription` keys it: '*' (the base row) or a short upper-case code (TR, EU, US). */
const priceRegion = z.string().regex(/^(\*|[A-Z][A-Z0-9_]{0,15})$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
/** Hundredths up to what the catalogue's decimal(12,2) amount columns hold (9,999,999,999.99): a larger price could never be imported on a node. */
export const MAX_PLAN_CATALOG_AMOUNT_MINOR = 999_999_999_999;
const minor = z.number().int().nonnegative().max(MAX_PLAN_CATALOG_AMOUNT_MINOR);
const smallInt = z.number().int().nonnegative().max(1_000_000);

export const PLAN_CATALOG_PRODUCT_TYPES = ['plan', 'bundle', 'addon', 'metered'] as const;
export const PLAN_CATALOG_VISIBILITY = ['public', 'private', 'deprecated'] as const;
export const PLAN_CATALOG_INTERVALS = ['month', 'year', 'once'] as const;
export const PLAN_CATALOG_AUDIENCES = ['retail', 'wholesale'] as const;

export const PlanCatalogFeatureSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_:]{0,63}$/),
  type: z.enum(['BOOLEAN', 'LIMIT']),
  value: z.string().max(16),
  label: z.string().min(1).max(100).optional(),
}).strict().superRefine((f, ctx) => {
  if (f.type === 'BOOLEAN' && f.value !== 'true' && f.value !== 'false') ctx.addIssue({ code: 'custom', path: ['value'], message: "a BOOLEAN is 'true' or 'false'" });
  if (f.type === 'LIMIT' && !(/^-?\d{1,9}$/.test(f.value) && parseInt(f.value, 10) >= -1)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'a LIMIT is a whole number, -1 for unlimited' });
});

/**
 * Fleet phase 6d.1 (F47, "format 3"): what a bundle or add-on grants, authored at the fleet so a package means the same in every region: the feature
 * keys it switches on (SCADA pieces among them, ADR-0015), the modules it needs installed, and whether it is sold once or recurring. Present = the
 * node imports exactly this; absent = the node keeps its own build's terms for the key (`nonPlanTerms`), as before format 3. Optional and never
 * defaulted, so a catalogue that does not use it signs to the same bytes and an older node still verifies it.
 */
export const PlanCatalogGrantsSchema = z.object({
  features: z.array(PlanCatalogFeatureSchema).max(100),
  requiresModules: z.array(moduleId).max(100),
  billing: z.enum(['recurring', 'once']),
}).strict().superRefine((g, ctx) => {
  if (new Set(g.features.map((f) => f.key)).size !== g.features.length) ctx.addIssue({ code: 'custom', path: ['features'], message: 'a feature is listed twice' });
  if (new Set(g.requiresModules).size !== g.requiresModules.length) ctx.addIssue({ code: 'custom', path: ['requiresModules'], message: 'a module is listed twice' });
});
export type PlanCatalogGrants = z.infer<typeof PlanCatalogGrantsSchema>;

export const PlanCatalogProductSchema = z.object({
  key: productKey,
  type: z.enum(PLAN_CATALOG_PRODUCT_TYPES),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  tier: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/).optional(),
  moduleIds: z.array(moduleId).max(300).default([]),
  includes: z.array(productKey).max(100).default([]),
  features: z.array(PlanCatalogFeatureSchema).max(100).default([]),
  visibility: z.enum(PLAN_CATALOG_VISIBILITY).default('public'),
  grants: PlanCatalogGrantsSchema.optional(),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.features.map((f) => f.key)).size !== p.features.length) ctx.addIssue({ code: 'custom', path: ['features'], message: 'a feature is listed twice' });
  if (p.features.length && p.type !== 'plan') ctx.addIssue({ code: 'custom', path: ['features'], message: 'only a plan carries features; a bundle or add-on grants them under grants' });
  if (p.grants && p.type !== 'bundle' && p.type !== 'addon') ctx.addIssue({ code: 'custom', path: ['grants'], message: 'only a bundle or an add-on carries grants' });
  if (p.includes.includes(p.key)) ctx.addIssue({ code: 'custom', path: ['includes'], message: 'a product cannot include itself' });
});
export type PlanCatalogProduct = z.infer<typeof PlanCatalogProductSchema>;

export const PlanCatalogPriceSchema = z.object({
  productKey,
  region: priceRegion.default('*'),
  currency,
  interval: z.enum(PLAN_CATALOG_INTERVALS).default('month'),
  audience: z.enum(PLAN_CATALOG_AUDIENCES).default('retail'),
  baseAmountMinor: minor,
  seatAmountMinor: minor.nullable().default(null),
  includedSeats: smallInt.nullable().default(null),
  trialDays: z.number().int().nonnegative().max(365).nullable().default(null),
}).strict();
export type PlanCatalogPrice = z.infer<typeof PlanCatalogPriceSchema>;

export const MAX_PLAN_CATALOG_PRODUCTS = 300;
export const MAX_PLAN_CATALOG_PRICES = 2000;

/** The identity of a price inside one document: (product, pricing region, interval, audience). */
export const planCatalogPriceKey = (p: Pick<PlanCatalogPrice, 'productKey' | 'region' | 'interval' | 'audience'>): string => `${p.productKey}|${p.region}|${p.interval}|${p.audience}`;

/**
 * One catalogue document as an operator saves it for a scope (GLOBAL or one REGION). Product keys and price tuples are unique; a price may name a product
 * of the other scope (a region pricing a global product), so references are checked only on the composed catalogue a node receives.
 */
export const PlanCatalogDocumentSchema = z.object({
  products: z.array(PlanCatalogProductSchema).max(MAX_PLAN_CATALOG_PRODUCTS),
  prices: z.array(PlanCatalogPriceSchema).max(MAX_PLAN_CATALOG_PRICES),
  /**
   * Fleet phase 6d.1 (F47): the plan a new organization of the region starts on (ROOT's `defaultPlanId` on the node). A REGION document's replaces the
   * GLOBAL one's. Optional and never defaulted, like `grants`.
   */
  defaultPlan: productKey.optional(),
}).strict().superRefine((d, ctx) => {
  if (new Set(d.products.map((p) => p.key)).size !== d.products.length) ctx.addIssue({ code: 'custom', path: ['products'], message: 'a product key is listed twice' });
  if (new Set(d.prices.map(planCatalogPriceKey)).size !== d.prices.length) ctx.addIssue({ code: 'custom', path: ['prices'], message: 'a price (product, region, interval, audience) is listed twice' });
});
export type PlanCatalogDocument = z.infer<typeof PlanCatalogDocumentSchema>;

/** A reference a composed catalogue cannot resolve: a price for a product it does not carry, or a product including one it does not carry. */
export type PlanCatalogGap = { kind: 'price'; productKey: string } | { kind: 'include'; productKey: string; includes: string };

/** The unresolved references of a composed catalogue, structured (the console names them in the operator's language). Empty = complete. */
export function planCatalogGaps(doc: PlanCatalogDocument): PlanCatalogGap[] {
  const keys = new Set(doc.products.map((p) => p.key));
  const out: PlanCatalogGap[] = [];
  for (const p of doc.prices) if (!keys.has(p.productKey)) out.push({ kind: 'price', productKey: p.productKey });
  for (const p of doc.products) for (const i of p.includes) if (!keys.has(i)) out.push({ kind: 'include', productKey: p.key, includes: i });
  return out;
}

/** The problems of a composed catalogue: a price or an include naming a product it does not carry. Empty = complete. */
export function planCatalogProblems(doc: PlanCatalogDocument): string[] {
  const out = planCatalogGaps(doc).map((g) => (g.kind === 'price' ? `price for unknown product '${g.productKey}'` : `'${g.productKey}' includes unknown product '${g.includes}'`));
  if (doc.defaultPlan !== undefined) {
    const d = doc.products.find((p) => p.key === doc.defaultPlan);
    if (!d) out.push(`the default plan '${doc.defaultPlan}' is not in the catalogue`);
    else if (d.type !== 'plan') out.push(`the default plan '${doc.defaultPlan}' is not a plan`);
    else if (d.visibility === 'deprecated') out.push(`the default plan '${doc.defaultPlan}' is deprecated`);
  }
  return out;
}

/**
 * The plans of a document that grant nothing: neither a module nor an included product (02-fleet/16 N1). A node that already sells a product
 * under the same key hands it over to the catalogue, which replaces its modules and includes, so such a plan would strip every subscriber of
 * its bundle at their next entitlement read. The control plane refuses to save or publish one; it is not a protocol rule (a node still
 * verifies a catalogue signed before this check).
 */
export function planCatalogEmptyPlans(doc: Pick<PlanCatalogDocument, 'products'>): string[] {
  return doc.products.filter((p) => p.type === 'plan' && !(p.moduleIds ?? []).length && !(p.includes ?? []).length).map((p) => p.key);
}

/**
 * GLOBAL overlaid with the node's REGION document: a regional product replaces the global one with the same key, a regional price replaces the global
 * price with the same (product, region, interval, audience). Sorted, so the same inputs always give the same bytes (and the same hash).
 */
export function composePlanCatalog(global: PlanCatalogDocument | null, region: PlanCatalogDocument | null): PlanCatalogDocument {
  const products = new Map<string, PlanCatalogProduct>();
  const prices = new Map<string, PlanCatalogPrice>();
  for (const d of [global, region]) {
    if (!d) continue;
    for (const p of d.products) products.set(p.key, p);
    for (const p of d.prices) prices.set(planCatalogPriceKey(p), p);
  }
  const defaultPlan = region?.defaultPlan ?? global?.defaultPlan;
  return {
    products: [...products.values()].sort((a, b) => a.key.localeCompare(b.key)),
    prices: [...prices.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p),
    ...(defaultPlan !== undefined ? { defaultPlan } : {}),
  };
}

/** What a node stores of one price: its currency, amounts (hundredths), included seats and trial days. */
export interface PlanCatalogPriceTerms {
  currency: string; baseAmountMinor: number; seatAmountMinor: number | null; includedSeats: number | null; trialDays: number | null;
}

/** One price that a publish adds, removes or changes (amounts in the catalogue's hundredths; null = not listed on that side). */
export interface PlanCatalogPriceChange {
  productKey: string; region: string; interval: string; audience: string;
  before: PlanCatalogPriceTerms | null;
  after: PlanCatalogPriceTerms | null;
}

/** What replacing one composed catalogue with another changes on a node (02-fleet/16 1.1, decision (a)). */
export interface PlanCatalogChanges {
  /** Products the node did not receive before: a key matching a product the node sells itself takes that product over. */
  added: string[];
  /** Products the node no longer receives: retired on the node (deprecated, no longer sold), subscribers keep their entitlements. */
  removed: string[];
  /** Products whose definition changed (name, type, modules, includes, features, visibility, tier, description, grants). */
  changed: string[];
  /** Prices added, removed or with another amount, currency, seat amount, included seats or trial days. */
  prices: PlanCatalogPriceChange[];
}

const productShape = (p: PlanCatalogProduct): string => JSON.stringify([
  p.type, p.name, p.description ?? null, p.tier ?? null, [...p.moduleIds].sort(), [...p.includes].sort(),
  [...p.features].sort((a, b) => a.key.localeCompare(b.key)).map((f) => [f.key, f.type, f.value, f.label ?? null]), p.visibility, p.grants ?? null,
]);
/** Every field of a price a node writes (02-fleet/16 C1): a change of included seats or trial days is a change too. */
const priceShape = (p: PlanCatalogPrice | undefined): PlanCatalogPriceTerms | null => (p ? {
  currency: p.currency, baseAmountMinor: p.baseAmountMinor, seatAmountMinor: p.seatAmountMinor ?? null, includedSeats: p.includedSeats ?? null, trialDays: p.trialDays ?? null,
} : null);

/** The difference between the catalogue a node holds (`before`, null = none) and the one it would receive (`after`). Pure, sorted. */
export function planCatalogChanges(before: PlanCatalogDocument | null, after: PlanCatalogDocument | null): PlanCatalogChanges {
  const b = new Map((before?.products ?? []).map((p) => [p.key, p]));
  const a = new Map((after?.products ?? []).map((p) => [p.key, p]));
  const added = [...a.keys()].filter((k) => !b.has(k)).sort();
  const removed = [...b.keys()].filter((k) => !a.has(k)).sort();
  const changed = [...a.keys()].filter((k) => b.has(k) && productShape(a.get(k)!) !== productShape(b.get(k)!)).sort();
  const bp = new Map((before?.prices ?? []).map((p) => [planCatalogPriceKey(p), p]));
  const ap = new Map((after?.prices ?? []).map((p) => [planCatalogPriceKey(p), p]));
  const prices: PlanCatalogPriceChange[] = [];
  for (const key of [...new Set([...bp.keys(), ...ap.keys()])].sort()) {
    const x = priceShape(bp.get(key));
    const y = priceShape(ap.get(key));
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const p = (ap.get(key) ?? bp.get(key))!;
    prices.push({ productKey: p.productKey, region: p.region, interval: p.interval, audience: p.audience, before: x, after: y });
  }
  return { added, removed, changed, prices };
}

/** Whether a change list is empty: the publish changes nothing a node receives. */
export const noPlanCatalogChanges = (c: PlanCatalogChanges): boolean => !c.added.length && !c.removed.length && !c.changed.length && !c.prices.length;

/**
 * A catalogue amount as a node stores it (decision (c)): hundredths divided by 100 into the decimal(12,2) column, with the currency code.
 * 4900 EUR -> "49.00 EUR", 500000 JPY -> "5000.00 JPY". Exact (string arithmetic), whatever the currency's own exponent.
 */
export function planCatalogStoredAmount(minorUnits: number, currencyCode: string): string {
  const n = Number.isSafeInteger(minorUnits) && minorUnits >= 0 ? minorUnits : 0;
  const raw = String(n).padStart(3, '0');
  return `${raw.slice(0, -2)}.${raw.slice(-2)} ${currencyCode}`;
}
