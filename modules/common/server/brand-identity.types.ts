/**
 * The tenant brand ALLOWLIST shared by every surface that shows a tenant's brand
 * to somebody outside the app: the public status page and white-label mail.
 *
 * Four fields and the omissions are the design — no HTML, CSS, script, footer or
 * sender name. A tenant string is rendered as escaped text or as a validated
 * URL/colour, never as markup. A field is added when a consumer exists, not in
 * advance. `null` means "use the platform default".
 *
 * One allowlist type, not two (docs/phases/30-notification/02): `observability`'s
 * `StatusBranding` and `notification_mail`'s `MailBrandPatch` both derive from it.
 */
export interface BrandIdentity {
  name: string | null;
  logoLight: string | null;
  logoDark: string | null;
  primaryColor: string | null;
}
