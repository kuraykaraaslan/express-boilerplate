import TenantService from '@kuraykaraaslan-labs/tenant/server/tenant.service';
import { installBrand } from '@kuraykaraaslan-labs/common/server/install-config/install-config.brand';
import TenantBrandingService, { sanitizeCss } from './tenant_branding.service';
import { brandThemeCss, cssUrl, normalizeHex, safeAssetUrl } from './tenant_branding.theme';
import { withInstallBrand } from './tenant_branding.install';
import type { TenantBranding as PublicBranding } from '../ui/use-tenant-branding.hook';

/**
 * A tenant's white label for its PUBLIC sign-in surface (the auth pages), read on the server so the page renders
 * branded from the first byte: no platform-blue flash, no second request.
 *
 *  - `branding`: the public fields, in the shape the client hook uses (use-tenant-branding.hook), with every asset URL
 *    vetted (absolute http(s) or root-relative) and every color a valid hex, or empty.
 *  - `css`: one stylesheet for a nonce'd <style>: theme variables from the brand colors, the wallpaper, then the
 *    tenant's custom CSS (sanitized again on read, and unable to close the <style> element).
 *  - `favicon`: the vetted favicon URL, or null.
 *
 * Fields neither the tenant nor the root set come from the installation's config/brand.ts (tenant_branding.install),
 * which also gives the sign-in heading and the line under it.
 *
 * Custom JavaScript is never part of it: these pages take passwords and one-time codes, and on the platform host they
 * also serve other tenants' sign-in, so a tenant's script there could read what a person types. (Decided on the owner's
 * delegation, 2026-10-19; the admin keeps its custom code.)
 */
export type AuthBranding = {
  branding: PublicBranding;
  css: string;
  favicon: string | null;
  hasWallpaper: boolean;
};

export const WALLPAPER_CLASS = 'nb-auth-wallpaper';

const empty = (): AuthBranding => ({
  branding: {
    name: '', tagline: '', logoLight: '', logoDark: '', iconLight: '', iconDark: '', favicon: '', primaryColor: '', secondaryColor: '',
    authWallpaper: '', customCss: '', customJs: '', privacyPolicyUrl: '', termsOfServiceUrl: '',
    signInTitle: '', signInSubtitle: '',
  },
  css: '',
  favicon: null,
  hasWallpaper: false,
});

const text = (v: string | undefined, max: number) => (v ?? '').trim().slice(0, max);

/** The auth pages' branding for `tenantId`. Never throws: a read that fails is the platform's own look. */
export async function getAuthBranding(tenantId: string): Promise<AuthBranding> {
  try {
    const [stored, tenant] = await Promise.all([
      TenantBrandingService.get(tenantId),
      // The tenant name is a fallback only: a failed lookup (even a synchronous throw) costs the name, not the branding.
      Promise.resolve().then(() => TenantService.getById(tenantId)).catch(() => null),
    ]);
    const raw = withInstallBrand(stored);
    const install = installBrand();
    const asset = (v: string | undefined) => safeAssetUrl(v) ?? '';
    const wallpaper = safeAssetUrl(raw.authWallpaper);
    const customCss = raw.customCss ? sanitizeCss(raw.customCss).replace(/<\/(style)/gi, '<\\/$1') : '';
    const css = [
      brandThemeCss({ primary: raw.brandPrimaryColor, secondary: raw.brandSecondaryColor }),
      wallpaper ? `.${WALLPAPER_CLASS}{background-image:${cssUrl(wallpaper)};background-size:cover;background-position:center}` : '',
      customCss,
    ].filter(Boolean).join('\n');
    const branding: PublicBranding = {
      name: text(raw.brandName, 120) || tenant?.name || '',
      tagline: text(raw.brandTagline, 200),
      logoLight: asset(raw.brandLogoLight),
      logoDark: asset(raw.brandLogoDark),
      iconLight: asset(raw.brandIconLight),
      iconDark: asset(raw.brandIconDark),
      favicon: asset(raw.brandFavicon),
      primaryColor: normalizeHex(raw.brandPrimaryColor) ?? '',
      secondaryColor: normalizeHex(raw.brandSecondaryColor) ?? '',
      authWallpaper: wallpaper ?? '',
      customCss: '',
      customJs: '',
      privacyPolicyUrl: asset(raw.privacyPolicyUrl),
      termsOfServiceUrl: asset(raw.termsOfServiceUrl),
      signInTitle: install.signInTitle ?? '',
      signInSubtitle: install.signInSubtitle ?? '',
    };
    return { branding, css, favicon: branding.favicon || null, hasWallpaper: !!wallpaper };
  } catch {
    return empty();
  }
}
