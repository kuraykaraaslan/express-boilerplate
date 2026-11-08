import { z } from 'zod';
import {
  AbacOperatorEnum,
  PolicyEffectEnum,
  type DecisionReason,
  type PolicyEffect,
} from './auth_abac.enums';

// ── Attribute model ──────────────────────────────────────────────────────────

/** A flat, framework-agnostic bag of attributes for one namespace. */
export type AttributeBag = Record<string, unknown>;

/**
 * A single authorization request the PDP evaluates. The four ABAC namespaces:
 * who (`subject`), what they do (`action`), what to (`resource`, always carries
 * a `type`), and in what context (`environment`).
 */
export interface AuthzRequest {
  subject: AttributeBag;
  action: string;
  resource: { type: string } & AttributeBag;
  environment: AttributeBag;
}

/** The PDP's verdict. `policyId` is set when a specific policy decided. */
export interface Decision {
  effect: PolicyEffect;
  policyId?: string;
  reason: DecisionReason;
}

// ── Policy rule / target schemas (zod, jsonb-validated) ──────────────────────

/**
 * A single condition. `attribute` is a dotted path into the request
 * (`subject.role`, `resource.ownerId`, `environment.ip`, or bare `action`);
 * all rules on a policy are AND-ed. Shape follows auth_saml's
 * SamlRoleMappingRuleSchema + feature_flags TargetingRuleSchema.
 */
export const PolicyRuleSchema = z.object({
  attribute: z.string().min(1).max(128),
  operator: AbacOperatorEnum,
  // Single value (eq/neq/regex/gt/lt/dnEquals/contains) or list (in/nin). For
  // `exists` the value is ignored. Kept as string|string[] for jsonb stability.
  value: z.union([z.string().max(512), z.array(z.string().max(512)).max(100)]).default(''),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

/**
 * Which request-space a policy applies to. Empty arrays = matches everything of
 * that dimension (so `{}` targets all requests).
 */
export const PolicyTargetSchema = z.object({
  resourceTypes: z.array(z.string().max(128)).max(100).default([]),
  actions: z.array(z.string().max(128)).max(100).default([]),
});
export type PolicyTarget = z.infer<typeof PolicyTargetSchema>;

/** Runtime projection of an abac_policy row (zod-parsed on read). */
export const PolicySchema = z.object({
  policyId: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  effect: PolicyEffectEnum,
  priority: z.number().int(),
  isActive: z.boolean(),
  target: PolicyTargetSchema,
  rules: z.array(PolicyRuleSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Policy = z.infer<typeof PolicySchema>;

// ── Explain (simulator trace) ────────────────────────────────────────────────

export interface PolicyTrace {
  policyId: string;
  name: string;
  effect: PolicyEffect;
  matchedTarget: boolean;
  matchedRules: string[];
  contributed: boolean;
}

export interface Explanation {
  decision: Decision;
  trace: PolicyTrace[];
}
