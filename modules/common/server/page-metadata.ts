// React's `cache` is a server-side request-memoization API (not a component/hook),
// so it is a legitimate server-layer dependency here.
// eslint-disable-next-line no-restricted-imports
import { cache } from 'react';
import type { Metadata } from 'next';
import TenantBrandingService from '@kuraykaraaslan-labs/tenant_branding/server/tenant_branding.service';
import { safeAssetUrl } from '@kuraykaraaslan-labs/tenant_branding/server/tenant_branding.theme';
import { DEFAULT_APP_NAME, DEFAULT_FAVICON } from './app-name';

// Defined in a dependency-free leaf so the root layout can read them without this
// file's branding service graph; re-exported so existing imports keep working.
// Both are the installation's config/brand.ts values when it sets them.
export { DEFAULT_APP_NAME, DEFAULT_FAVICON };

/**
 * Per-request app identity of a tenant: the app name and favicon every page of it shows (browser tab, bookmarks).
 * The tenant's own white label wins; a tenant that set none gets the ROOT tenant's (tenant_setting reads inherit
 * branding keys from the root), and with neither, the platform's own name and favicon. Wrapped in React `cache()`
 * so the layout and page `generateMetadata` calls of one render share one lookup (Redis-cached in the service).
 */
export const tenantAppIdentity = cache(async (tenantId: string): Promise<{ name: string; favicon: string }> => {
  try {
    const branding = await TenantBrandingService.get(tenantId);
    return {
      name: branding.brandName?.trim().slice(0, 120) || DEFAULT_APP_NAME,
      favicon: safeAssetUrl(branding.brandFavicon) ?? DEFAULT_FAVICON,
    };
  } catch {
    return { name: DEFAULT_APP_NAME, favicon: DEFAULT_FAVICON };
  }
});

const brandName = async (tenantId: string): Promise<string> => (await tenantAppIdentity(tenantId)).name;

/** The tenant's favicon as Next metadata `icons` (tab icon, shortcut, Apple touch icon). */
export function faviconIcons(favicon: string): NonNullable<Metadata['icons']> {
  return { icon: favicon, shortcut: favicon, apple: favicon };
}

/** `"<title> | <app name>"` and the tenant's favicon, for one page of `tenantId`. */
export async function tenantPageMetadata(tenantId: string, title: string): Promise<Metadata> {
  const { name, favicon } = await tenantAppIdentity(tenantId);
  return { title: { absolute: `${title} | ${name}` }, icons: faviconIcons(favicon) };
}

/**
 * For a layout: its pages' titles become `"<page> | <app name>"` (`defaultTitle` when a page sets none), and the favicon.
 * `absolute`, not `default`: Next wraps a layout's `default` in the parent's template, so the root layout's
 * `"%s | <platform name>"` doubled the name ("Admin | Acme | Next Boilerplate").
 */
export async function tenantLayoutMetadata(tenantId: string, defaultTitle: string): Promise<Metadata> {
  const { name, favicon } = await tenantAppIdentity(tenantId);
  return { title: { template: `%s | ${name}`, absolute: `${defaultTitle} | ${name}` }, icons: faviconIcons(favicon) };
}

type TenantMetadataProps = { params: Promise<{ tenantId: string }> };

/**
 * Builds a `generateMetadata` function that sets an absolute browser-tab title
 * of `"<title> | <tenant brand name>"`, where the brand name comes from the
 * tenant's branding settings at request time.
 *
 * Uses `title.absolute` rather than a plain string so the result is correct
 * regardless of how many parent layouts sit between the route and the root —
 * an intermediate layout that sets its own string title would otherwise consume
 * the root `title.template` and stop it cascading to deeper routes.
 */
export function pageTitle(title: string) {
  return async ({ params }: TenantMetadataProps): Promise<Metadata> => {
    const { tenantId } = await params;
    return { title: { absolute: `${title} | ${await brandName(tenantId)}` }, icons: faviconIcons((await tenantAppIdentity(tenantId)).favicon) };
  };
}
