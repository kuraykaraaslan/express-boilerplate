import MailService from "./notification_mail.service";
import { buildTemplateVars, type MailTemplateVars } from "./notification_mail.brand";
import { resolveMailBrand } from "./notification_mail.brand.service";
import type { PlatformMailDefaults } from "./notification_mail.brand.types";

/** The platform's env-derived values — what every mail looked like before white-labelling. */
function platformDefaults(): PlatformMailDefaults {
  return {
    appName: MailService.APPLICATION_NAME,
    frontendUrl: MailService.FRONTEND_URL,
    loginPath: MailService.FRONTEND_LOGIN_PATH,
    resetPasswordPath: MailService.FRONTEND_RESET_PASSWORD_PATH,
    forgotPasswordPath: MailService.FRONTEND_FORGOT_PASSWORD_PATH,
    termsPath: MailService.FRONTEND_TERMS_PATH,
    privacyPath: MailService.FRONTEND_PRIVACY_PATH,
    supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
  };
}

/**
 * Base template variables shared by every email template: the tenant's brand
 * (name, logo, primary colour, own domain) over the platform's env-level values.
 *
 * Async because the brand is read through the `notification_mail:brand_source`
 * seam (cached per tenant, 5 minutes). A caller WITHOUT a tenant — root or
 * platform mail — gets exactly the platform values, as before. `appName` is kept
 * as an alias of `brandName` for one release.
 *
 * Every link is rebuilt on `baseUrl`; callers building their own link (verify
 * e-mail, reset, magic link) must start from `vars.baseUrl`, not from
 * `MailService.FRONTEND_URL`.
 */
export async function getBaseTemplateVars(tenantId?: string | null): Promise<MailTemplateVars> {
  return buildTemplateVars(platformDefaults(), await resolveMailBrand(tenantId));
}
