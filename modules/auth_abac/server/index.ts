export { default as AbacPolicyService } from './auth_abac.policy.service';
export { default as AbacPdpService } from './auth_abac.pdp.service';
export {
  evaluatePolicies,
  explain,
  ruleMatches,
  resolveAttribute,
  policyMatchesTarget,
} from './auth_abac.eval';
export {
  authorize,
  can,
  authorizeRequest,
  type AuthorizeArgs,
  type AuthorizationScope,
  type AuthorizeTenantArgs,
  type AuthorizeGuestArgs,
  type AuthorizeRootArgs,
  type AuthorizeGlobalArgs,
  type AuthorizeAccountArgs,
  type PublicAuthResult,
  type AccountAuthResult,
} from './auth_abac.guard.next';
export {
  evaluatePermissionFromRequest,
  environmentFromRequest,
  type AuthorizePermissionArgs,
} from './auth_abac.pdp.service.next';
export { default as AbacSettingsService, type AbacRuntimeSettings } from './auth_abac.settings.service';
export {
  resolveSubjectAttributes,
  resolveEnvironmentAttributes,
  buildResource,
} from './auth_abac.attributes';
export {
  CreatePolicyDTO,
  UpdatePolicyDTO,
  ListPoliciesQuery,
  SimulateDTO,
  type CreatePolicyInput,
  type UpdatePolicyInput,
  type ListPoliciesQueryInput,
  type SimulateInput,
} from './auth_abac.dto';
export * from './auth_abac.types';
export * from './auth_abac.enums';
export { AUTH_ABAC_MESSAGES } from './auth_abac.messages';
