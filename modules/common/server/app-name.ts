/**
 * The platform's fallback identity, with no dependencies beyond the installation's config/brand.ts.
 *
 * page-metadata re-exports it, but that file imports TenantBrandingService and
 * with it the DB, audit and extension graph. The root layout only needs the
 * strings, so it imports them from here and stays a small module graph.
 *
 * config/brand.ts (docs/phases/45-install-config D45-2) replaces the package
 * defaults below. It is read raw here, through the generated shim: the boot
 * (instrumentation.ts) and the build (`npm run config:check`) validate it, and
 * this leaf only trims what it shows, so an invalid value can never reach a page.
 */
import brandSource from './generated/install-config.brand';
import { brandAssetUrl } from './install-config/install-config.assets';

const raw = (brandSource ?? {}) as { name?: unknown; favicon?: unknown; defaultTheme?: unknown; primaryColor?: unknown; secondaryColor?: unknown };
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Fallback brand name when a tenant hasn't configured one (or lookup fails): config/brand.ts's name, else the package's. */
export const DEFAULT_APP_NAME = text(raw.name)?.slice(0, 120) ?? 'Next Boilerplate';

/** The favicon when no tenant and not the root set one: config/brand.ts's, else the package's (public/favicon.ico). */
export const DEFAULT_FAVICON = brandAssetUrl(text(raw.favicon)) ?? '/favicon.ico';

/** The theme a first visit gets: config/brand.ts's `defaultTheme`, else the viewer's system setting. */
export const DEFAULT_THEME: 'light' | 'dark' | 'system' =
  raw.defaultTheme === 'light' || raw.defaultTheme === 'dark' ? raw.defaultTheme : 'system';

/** config/brand.ts's colours, for the root layout's theme variables (brandThemeCss normalises them again). */
export const INSTALL_BRAND_COLORS = { primary: text(raw.primaryColor), secondary: text(raw.secondaryColor) };
