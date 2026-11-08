import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AuthPolicyService from './auth.policy.service';

/**
 * Self-service sign-up: who may create an account where, and how many organizations a person may open themselves.
 *
 *  - A tenant's own sign-up is open only when that tenant switched it on (`allowSelfRegistration = 'true'`, off unless
 *    set) AND its access policy allows registration (`allowRegistration`; the platform's value wins, so the platform
 *    can close sign-up everywhere). The register route, the login page's "Sign up" link (GET /api/auth/registration) and
 *    the onboarding all read this one answer.
 *  - On the root tenant this is the PLATFORM sign-up: the account is created alone (no root membership, no tenant), and
 *    the onboarding (/auth/onboarding) lets the person open their own organization.
 *  - `selfServiceTenantLimit` (root setting, default 3, 0 = nobody) caps the organizations a person may open through
 *    the onboarding, counted as tenants they OWN; the platform admin's tenant creation is not counted or capped.
 */
export const ALLOW_SELF_REGISTRATION_KEY = 'allowSelfRegistration';
export const SELF_SERVICE_TENANT_LIMIT_KEY = 'selfServiceTenantLimit';
export const DEFAULT_SELF_SERVICE_TENANT_LIMIT = 3;
const MAX_SELF_SERVICE_TENANT_LIMIT = 100;

/** Is self-registration open on `tenantId`? Fails closed: a settings or policy read that throws answers false. */
export async function registrationOpen(tenantId: string): Promise<boolean> {
  try {
    const settings = await SettingService.getByKeys(tenantId, [ALLOW_SELF_REGISTRATION_KEY]);
    if (settings[ALLOW_SELF_REGISTRATION_KEY] !== 'true') return false;
    const policy = await AuthPolicyService.getAccessPolicy(tenantId);
    return policy.allowRegistration === true;
  } catch {
    return false;
  }
}

/** How many organizations one person may open through the onboarding (root setting). A malformed value is the default. */
export async function selfServiceTenantLimit(): Promise<number> {
  try {
    const raw = (await SettingService.getByKeys(ROOT_TENANT_ID, [SELF_SERVICE_TENANT_LIMIT_KEY]))[SELF_SERVICE_TENANT_LIMIT_KEY];
    if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_SELF_SERVICE_TENANT_LIMIT;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_SELF_SERVICE_TENANT_LIMIT) : DEFAULT_SELF_SERVICE_TENANT_LIMIT;
  } catch {
    return DEFAULT_SELF_SERVICE_TENANT_LIMIT;
  }
}
