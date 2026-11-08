/**
 * Gate-refusal wording. Kept here rather than imported from a subscription rail
 * so the message a user sees does not depend on which rail happens to be
 * installed — and so the gate has no reason to import one (DUP-01, step 5).
 *
 * Deliberately says "your current plan" without naming a product: the same
 * refusal is raised whether entitlements came from a subscription, an
 * admin-granted bundle, or a future licence key.
 */
export const FEATURE_GATE_MESSAGES = {
  FEATURE_ACCESS_DENIED: 'This feature is not available on your current plan',
  FEATURE_LIMIT_REACHED: 'You have reached the limit for this feature on your current plan',
  FEATURE_CHECK_FAILED: 'Failed to check feature access',
  // Operator log lines of the deployment ceiling (feature_gate.ceiling.ts); never shown to a tenant.
  CEILING_BASELINE_APPLIED: 'Entitlement ceiling provider did not answer; its baseline is applied',
  CEILING_LAST_GOOD_APPLIED: 'Entitlement ceiling could not answer; the last ceiling resolved in this process is applied',
  CEILING_ENTRY_IGNORED: 'Malformed entitlement ceiling entry ignored',
  // Deployment-wide limits (feature_gate.deployment-limit.ts, fleet 3b.11): the deployment's license, not a tenant plan.
  DEPLOYMENT_LIMIT_REACHED: "This deployment has reached the limit its license allows; what already exists keeps working",
  DEPLOYMENT_FEATURE_OFF: "This deployment's license does not allow this",
  // The piece check (feature_gate.piece-check.ts): a module's pieces could not be checked, so none is treated as open.
  PIECE_CHECK_FAILED: 'The pieces of this module could not be checked; try again',
} as const;
