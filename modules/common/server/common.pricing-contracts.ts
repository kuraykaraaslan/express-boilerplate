import { z } from 'zod';

/**
 * The pricing hand-off contracts (commerce charter Ek B.1, plan 04 §6):
 * commerce PRODUCES a PricingContext, `coupon` — the ONE discount domain —
 * READS it and answers with AppliedDiscount[]. The types live in `common`
 * because either side owning them would force the other to import it
 * (`coupon → commerce_cart` is forbidden by charter §4/2).
 *
 * ALIGNMENT CONDITION (2026-08-16, binding): this file stays in `common` only
 * as long as it is pure types + zod value-objects — ZERO imports beyond zod,
 * ZERO runtime behaviour (the common.address.ts / PLAT-06 precedent). The
 * moment a line of evaluation, allocation, caching or ordering appears here,
 * the file moves to `coupon` and commerce imports downward. G-mutual scans
 * for exactly this.
 *
 * All monetary amounts are MINOR units as STRINGS (the bigint-as-string house
 * rule, W1) — these objects round-trip through jsonb and JSON has no bigint.
 */

const MINOR_STRING = /^-?\d+$/;

// ── Context ────────────────────────────────────────────────────────────────

export const PricingLineSchema = z.object({
  /** Caller-stable line reference (cart item id / order line id). */
  ref: z.string(),
  productId: z.string().nullish(),
  variantId: z.string().nullish(),
  categoryId: z.string().nullish(),
  sku: z.string().nullish(),
  /** Product tag slugs, resolved by the caller (coupon never asks the catalog). */
  tagSlugs: z.array(z.string()).default([]),
  quantity: z.number().int().positive(),
  unitPriceMinor: z.string().regex(MINOR_STRING),
  lineTotalMinor: z.string().regex(MINOR_STRING),
});
export type PricingLine = z.infer<typeof PricingLineSchema>;

export const PricingContextSchema = z.object({
  currency: z.string().min(3).max(3),
  subtotalMinor: z.string().regex(MINOR_STRING),
  shippingTotalMinor: z.string().regex(MINOR_STRING).default('0'),
  itemCount: z.number().int().nonnegative(),
  countryCode: z.string().length(2).optional(),
  /** Empty for guests — a rule that must exclude guests uses `requiresCustomer`. */
  customerTagSlugs: z.array(z.string()).default([]),
  userId: z.string().nullish(),
  customerId: z.string().nullish(),
  /** Codes the shopper typed; AUTOMATIC rules join them at evaluation. */
  couponCodes: z.array(z.string()).default([]),
  lines: z.array(PricingLineSchema).default([]),
  /**
   * The open half of the fact vocabulary (plan 04 §3 alignment): any consumer
   * — subscription renewal, marketplace commission — adds its facts here
   * without a breaking change on the `coupon` side. An evaluator that does
   * not recognise a fact treats the condition as NOT MATCHED, never throws.
   */
  facts: z.record(z.string(), z.unknown()).default({}),
});
export type PricingContext = z.infer<typeof PricingContextSchema>;

// ── Condition grammar (plan 04 §3) ─────────────────────────────────────────

/** Commerce's first fact set — an OPEN vocabulary owned by `coupon`, not a closed union. */
export type KnownFact =
  | 'subtotalMinor' | 'itemCount' | 'currency' | 'countryCode'
  | 'customerTagSlugs' | 'requiresCustomer'
  | 'line.productId' | 'line.variantId' | 'line.categoryId' | 'line.tagSlugs' | 'line.quantity';
export type Fact = KnownFact | (string & {});

export const ConditionOpEnum = z.enum([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'includesAny', 'includesAll',
]);
export type ConditionOp = z.infer<typeof ConditionOpEnum>;

export interface FactCondition {
  fact: Fact;
  op: ConditionOp;
  value: unknown;
  /** For `line.*` facts: "at least this many matching units" (BOGO's condition half). */
  minQuantity?: number;
}
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | FactCondition;

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ all: z.array(ConditionSchema) }),
  z.object({ any: z.array(ConditionSchema) }),
  z.object({ not: ConditionSchema }),
  z.object({
    fact: z.string(),
    op: ConditionOpEnum,
    value: z.unknown(),
    minQuantity: z.number().int().positive().optional(),
  }) as z.ZodType<FactCondition>,
]));

/** Deeper than 3 is a programming language, not a rule — and the UI cannot express it. */
export const MAX_CONDITION_DEPTH = 3;

// ── Action grammar (plan 04 §4) ────────────────────────────────────────────

export const DiscountTargetSchema = z.union([
  z.object({ scope: z.literal('SUBTOTAL') }),
  z.object({ scope: z.literal('CHEAPEST_MATCHING') }),
  z.object({ scope: z.literal('MATCHING_LINES'), limit: z.number().int().positive().optional() }),
]);
export type DiscountTarget = z.infer<typeof DiscountTargetSchema>;

export const DiscountActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PERCENT'),
    percent: z.number().positive().max(100),
    maxDiscountMinor: z.string().regex(MINOR_STRING).optional(),
    appliesTo: DiscountTargetSchema.default({ scope: 'SUBTOTAL' }),
  }),
  z.object({
    type: z.literal('FIXED'),
    amountMinor: z.string().regex(MINOR_STRING),
    appliesTo: DiscountTargetSchema.default({ scope: 'SUBTOTAL' }),
  }),
  z.object({
    type: z.literal('FIXED_PRICE'),
    unitPriceMinor: z.string().regex(MINOR_STRING),
    appliesTo: DiscountTargetSchema.default({ scope: 'MATCHING_LINES' }),
  }),
  z.object({
    type: z.literal('BUY_X_GET_Y'),
    buyQuantity: z.number().int().positive(),
    getQuantity: z.number().int().positive(),
    /** 100 = free. The reward is the CHEAPEST matching unit by default (deliberate). */
    discountPercent: z.number().positive().max(100).default(100),
    appliesTo: DiscountTargetSchema.default({ scope: 'CHEAPEST_MATCHING' }),
  }),
  z.object({
    type: z.literal('FREE_SHIPPING'),
    methodIds: z.array(z.string()).optional(),
  }),
]);
export type DiscountAction = z.infer<typeof DiscountActionSchema>;

// ── Result ─────────────────────────────────────────────────────────────────

export const AppliedDiscountSchema = z.object({
  /** 'COUPON' today; open for future rule sources. */
  sourceType: z.string(),
  sourceId: z.string(),
  /** Customer-visible code, when the source has one (AUTOMATIC rules do not show theirs). */
  code: z.string().nullish(),
  label: z.string(),
  amountMinor: z.string().regex(MINOR_STRING),
  appliesTo: z.enum(['SUBTOTAL', 'SHIPPING', 'LINE']),
  /** For LINE-scoped discounts: which line took it. */
  lineRef: z.string().nullish(),
});
export type AppliedDiscount = z.infer<typeof AppliedDiscountSchema>;
