'use client';
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import api from '@kuraykaraaslan-labs/common/server/axios';
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';

// Public branding for a tenant, resolved from `/api/settings/public`. Every
// field defaults to '' so consumers can treat empty as "not configured" — and
// must NEVER fall back to the raw tenantId (UUID), which is not user-facing.
export type TenantBranding = {
  // Display name: explicit brand name wins, else the tenant's own name.
  name: string;
  tagline: string;
  logoLight: string;
  logoDark: string;
  /** The square app icon (the admin header's 28 px slot, app tiles); the favicon stands in without one, then the logo. */
  iconLight: string;
  iconDark: string;
  favicon: string;
  primaryColor: string;
  secondaryColor: string;
  authWallpaper: string;
  customCss: string;
  customJs: string;
  privacyPolicyUrl: string;
  termsOfServiceUrl: string;
  /** The sign-in page's heading and the line under it, from the installation's config/brand.ts (literal, not translated). */
  signInTitle: string;
  signInSubtitle: string;
};

export const EMPTY_TENANT_BRANDING: TenantBranding = {
  name: '', tagline: '', logoLight: '', logoDark: '', iconLight: '', iconDark: '', favicon: '',
  primaryColor: '', secondaryColor: '', authWallpaper: '',
  customCss: '', customJs: '', privacyPolicyUrl: '', termsOfServiceUrl: '',
  signInTitle: '', signInSubtitle: '',
};

// Branding the server already read for a tenant (the auth shell, tenant_branding.auth): pages under it use it
// directly, branded on the first render and without a second request.
const ServerBrandingContext = createContext<{ tenantId: string; branding: TenantBranding } | null>(null);

export function TenantBrandingProvider({ tenantId, branding, children }: { tenantId: string; branding: TenantBranding; children: ReactNode }) {
  return createElement(ServerBrandingContext.Provider, { value: { tenantId, branding } }, children);
}

// Fetches the tenant's full public branding (name, logos, colors, wallpaper,
// legal links). Returns EMPTY_TENANT_BRANDING until loaded / on failure; under a
// TenantBrandingProvider for the same tenant, its branding at once and no fetch.
export function useTenantBranding(tenantId: string): TenantBranding {
  const provided = useContext(ServerBrandingContext);
  const fromServer = provided && provided.tenantId === tenantId ? provided.branding : null;
  // Keyed by tenant: after a switch to another tenant, the previous one's branding is never shown while it loads.
  const [state, setState] = useState<{ tenantId: string; branding: TenantBranding }>({ tenantId, branding: fromServer ?? EMPTY_TENANT_BRANDING });
  const setBranding = (b: TenantBranding) => setState({ tenantId, branding: b });

  useEffect(() => {
    if (fromServer) return;
    api.get(tenantPath(tenantId, '/api/settings/public'))
      .then((res) => {
        const s = res.data?.settings ?? {};
        setBranding({
          name: s.brandName || res.data?.tenant?.name || '',
          tagline: s.brandTagline || '',
          logoLight: s.brandLogoLight || '',
          logoDark: s.brandLogoDark || '',
          iconLight: s.brandIconLight || '',
          iconDark: s.brandIconDark || '',
          favicon: s.brandFavicon || '',
          primaryColor: s.brandPrimaryColor || '',
          secondaryColor: s.brandSecondaryColor || '',
          authWallpaper: s.authWallpaper || '',
          customCss: s.customCss || '',
          customJs: s.customJs || '',
          privacyPolicyUrl: s.privacyPolicyUrl || '',
          termsOfServiceUrl: s.termsOfServiceUrl || '',
          signInTitle: s.signInTitle || '',
          signInSubtitle: s.signInSubtitle || '',
        });
      })
      .catch(() => setBranding(EMPTY_TENANT_BRANDING));
  }, [tenantId, fromServer]);

  return fromServer ?? (state.tenantId === tenantId ? state.branding : EMPTY_TENANT_BRANDING);
}
