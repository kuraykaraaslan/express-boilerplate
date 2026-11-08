import { z } from 'zod';

// Operators a policy rule may use to test a resolved attribute against its
// configured value(s). Union of the feature_flags set (eq/neq/in/nin/contains)
// + auth_saml enterprise matchers (regex/dnEquals) + numeric comparisons.
export const ABAC_OPERATORS = [
  'eq',
  'neq',
  'in',
  'nin',
  'contains',
  'regex',
  'dnEquals',
  'exists',
  'gt',
  'lt',
] as const;
export const AbacOperatorEnum = z.enum(ABAC_OPERATORS);
export type AbacOperator = z.infer<typeof AbacOperatorEnum>;

// A policy either grants or denies. `deny` always wins (deny-overrides).
export const POLICY_EFFECTS = ['permit', 'deny'] as const;
export const PolicyEffectEnum = z.enum(POLICY_EFFECTS);
export type PolicyEffect = z.infer<typeof PolicyEffectEnum>;

// Why the PDP returned its decision — surfaced for the simulator/audit trail.
export const DECISION_REASONS = [
  'explicit_deny', // a matched deny policy short-circuited
  'policy_permit', // a matched permit policy granted
  'rbac_fallback', // no policy applied → RBAC matrix/threshold decided
  'default_deny', // fail-closed: nothing applied and no fallback grant
  'not_applicable', // no policy targeted this request (fallback signal)
  'install_config', // the installation's config/access.ts removed or granted it (docs/phases/45-install-config D45-4)
] as const;
export const DecisionReasonEnum = z.enum(DECISION_REASONS);
export type DecisionReason = z.infer<typeof DecisionReasonEnum>;

// Top-level attribute namespaces a rule's dotted path may address. Guards the
// path resolver against arbitrary object traversal / prototype pollution.
export const ATTRIBUTE_ROOTS = ['subject', 'resource', 'environment', 'action'] as const;
export type AttributeRoot = (typeof ATTRIBUTE_ROOTS)[number];
