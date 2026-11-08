import { installBrand } from '@kuraykaraaslan-labs/common/server/install-config/install-config.brand';
import TenantBrandingService from './tenant_branding.service';
import { brandThemeCss } from './tenant_branding.theme';
import type { TenantBranding } from './tenant_branding.types';

// ── The installation's brand under the stored branding ───────────────────────
// docs/phases/45-install-config D45-2. Layering, lowest first: the package default < config/brand.ts < the root
// tenant's branding (what a sysadmin sets in the UI, which tenants inherit through tenant_setting) < a tenant's own.
// TenantBrandingService.get already returns the tenant's value over the root's; this fills what both left empty from
// config/brand.ts. The settings form keeps reading the stored rows (TenantBrandingService.get), so nothing a tenant did
// not set is ever written back as its own.

const filled = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * `branding` with every field it leaves empty taken from config/brand.ts. The two logos are one choice: a stored logo
 * (light or dark) keeps the stored pair, so a tenant's light logo never sits beside the installation's dark one. The two
 * app icons are a pair the same way.
 */
export function withInstallBrand(branding: TenantBranding): TenantBranding {
  const install = installBrand();
  const storedLogo = filled(branding.brandLogoLight) || filled(branding.brandLogoDark);
  const storedIcon = filled(branding.brandIconLight) || filled(branding.brandIconDark);
  const pick = (own: string | undefined, fallback: string | undefined) => (filled(own) ? own : fallback);
  return {
    ...branding,
    brandName: pick(branding.brandName, install.name),
    brandLogoLight: storedLogo ? branding.brandLogoLight : install.logoLight,
    brandLogoDark: storedLogo ? branding.brandLogoDark : install.logoDark,
    brandIconLight: storedIcon ? branding.brandIconLight : install.iconLight,
    brandIconDark: storedIcon ? branding.brandIconDark : install.iconDark,
    brandFavicon: pick(branding.brandFavicon, install.favicon),
    brandPrimaryColor: pick(branding.brandPrimaryColor, install.primaryColor),
    brandSecondaryColor: pick(branding.brandSecondaryColor, install.secondaryColor),
  };
}

/** The branding a tenant's pages show: its own, else the root's, else config/brand.ts. */
export async function effectiveBranding(tenantId: string): Promise<TenantBranding> {
  return withInstallBrand(await TenantBrandingService.get(tenantId));
}

/** The theme variables of config/brand.ts's colours alone (the root layout, outside any tenant). Empty without them. */
export function installThemeCss(): string {
  const install = installBrand();
  return brandThemeCss({ primary: install.primaryColor, secondary: install.secondaryColor });
}

/**
 * The theme variables the admin app of `tenantId` is drawn with (the brand colours over the platform palette, light
 * and dark). A failed branding read falls back to config/brand.ts's colours, never to an error page.
 */
export async function shellThemeCss(tenantId: string): Promise<string> {
  let branding: TenantBranding;
  try {
    branding = await effectiveBranding(tenantId);
  } catch {
    return installThemeCss();
  }
  return brandThemeCss({ primary: branding.brandPrimaryColor, secondary: branding.brandSecondaryColor });
}
