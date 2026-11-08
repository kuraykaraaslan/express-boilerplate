import { effectiveBranding } from './tenant_branding.install';

/**
 * `notification_mail:brand_source` contribution — the tenant's brand for mail.
 *
 * The SAME four-field allowlist as `observability/status.branding.ts`
 * (name, logo light/dark, primary colour). `customCss`, `customJs`, favicon,
 * wallpaper and the legal-page URLs are deliberately absent: tenant-authored
 * markup or script has no place in a mail that may carry a reset link.
 *
 * Logos are the public URLs `uploadBrandingAsset` stores (the branding images
 * are served anonymously — the login page needs them without a session), so no
 * signed storage link is needed here. `notification_mail` re-validates every
 * value (HTTPS-only logo, hex colour, escaped name); this file only selects.
 *
 * The contract is structural on purpose: importing the host's types would make
 * `tenant_branding` depend on `notification_mail`.
 */
const source = {
  async load(tenantId: string) {
    // What the tenant's pages show: its own, else the root's, else the installation's config/brand.ts.
    const b = await effectiveBranding(tenantId);
    return {
      name: b.brandName || null,
      logoLight: b.brandLogoLight || null,
      logoDark: b.brandLogoDark || null,
      primaryColor: b.brandPrimaryColor || null,
    };
  },
};

export default source;
