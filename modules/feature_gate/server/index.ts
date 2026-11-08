export {
  default as FeatureGateService,
  checkFeatureAccess,
  assertFeatureAccess,
  invalidateFeatureCache,
  FEATURE_GATE_SOURCE_POINT,
} from './feature_gate.service';
export {
  resolveLimit,
  checkLimit,
  assertHeadroom,
  headroomSnapshot,
  type GateErrorPolicy,
  type ResolveLimitOptions,
  type AssertHeadroomOptions,
  type HeadroomResult,
  type LimitCheck,
} from './feature_gate.headroom';
export {
  assertPeriodQuota,
  checkPeriodQuota,
  type PeriodQuotaOptions,
  type PeriodQuotaStatus,
} from './feature_gate.period-quota';
export {
  LIMIT_BLOCKED_ACTION,
  capAsLimit,
  evaluateDeploymentLimit,
  deploymentCap,
  deploymentCaps,
  deploymentCapsReport,
  FEATURE_GATE_USAGE_POINT,
  checkDeploymentLimit,
  recordLimitBlocked,
  deploymentLimitError,
  assertDeploymentLimit,
  type DeploymentLimitCheck,
  type LimitBlockedContext,
} from './feature_gate.deployment-limit';
export { FEATURE_KEYS, moduleFeatureKey, bundleFeatureKey, type FeatureKey } from './feature_gate.keys';
export { FEATURE_GATE_MESSAGES } from './feature_gate.messages';
export * from './feature_gate.types';
