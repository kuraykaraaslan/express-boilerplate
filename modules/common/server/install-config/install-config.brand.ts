import brandSource, { file as brandFile } from '../generated/install-config.brand';
import type { InstallBrand } from './install-config.define';
import { brandAssetUrl } from './install-config.assets';
import { parseInstallBrand } from './install-config.service';

// config/brand.ts at run time (D45-2): the installation's product identity, under the platform's and the tenant's own
// branding (tenant_branding applies the layering). Asset fields come back as the URLs a page loads.

/** The installation's brand with every asset resolved to a URL; every field absent without a config/brand.ts. */
export type ResolvedInstallBrand = {
  name?: string;
  shortName?: string;
  logoLight?: string;
  logoDark?: string;
  iconLight?: string;
  iconDark?: string;
  favicon?: string;
  primaryColor?: string;
  secondaryColor?: string;
  defaultTheme?: 'light' | 'dark' | 'system';
  mailSenderName?: string;
  signInTitle?: string;
  signInSubtitle?: string;
};

/** The flat, URL-resolved view of a parsed brand. Pure. */
export function resolveInstallBrand(brand: InstallBrand | undefined): ResolvedInstallBrand {
  if (!brand) return {};
  const out: ResolvedInstallBrand = {
    name: brand.name,
    shortName: brand.shortName,
    logoLight: brandAssetUrl(brand.logo?.light ?? brand.logo?.dark),
    logoDark: brandAssetUrl(brand.logo?.dark ?? brand.logo?.light),
    iconLight: brandAssetUrl(brand.icon?.light ?? brand.icon?.dark),
    iconDark: brandAssetUrl(brand.icon?.dark ?? brand.icon?.light),
    favicon: brandAssetUrl(brand.favicon),
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    defaultTheme: brand.defaultTheme,
    mailSenderName: brand.mail?.senderName ?? brand.name,
    signInTitle: brand.signIn?.title,
    signInSubtitle: brand.signIn?.subtitle,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as ResolvedInstallBrand;
}

let resolved: ResolvedInstallBrand | null = null;

/** The validated config/brand.ts, resolved. An invalid file throws InstallConfigError on every call. */
export function installBrand(): ResolvedInstallBrand {
  resolved ??= resolveInstallBrand(parseInstallBrand(brandSource, brandFile));
  return resolved;
}
