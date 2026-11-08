# Tenant Branding Module

Per-tenant white-label branding: brand name, tagline, logos, favicon, colors, custom CSS/JS, and auth wallpaper. Values are stored as setting key-value pairs (via `setting`) and read by the proxy/shell to render per-tenant chrome. No global defaults — each tenant is fully isolated.

---

## Entities

This module has no entities of its own. All branding values are persisted as tenant-scoped setting key-value pairs through `SettingService` (`setting` module), which stores them in the **tenant DB**.

---

## Services / Responsibilities

| Service | Method | Responsibility |
|---|---|---|
| `TenantBrandingService` | `get(tenantId)` | Reads all branding keys for the tenant via `SettingService.getByKeys`, then validates/parses them with `TenantBrandingSchema`. Missing keys are returned as `undefined`. |
| `TenantBrandingService` | `update(tenantId, data)` | Writes only the provided keys via `SettingService.updateMany`; skips the write entirely when no recognized keys are present. Returns the freshly re-read branding. |
| `TenantBrandingService` | `reset(tenantId)` | Deletes every branding key for the tenant via `SettingService.delete`, ignoring per-key errors, reverting the tenant to platform defaults. |
| `tenant_branding.install` | `withInstallBrand`, `effectiveBranding(tenantId)` | The installation's `config/brand.ts` under the stored branding (docs/phases/45-install-config D45-2): package default < `config/brand.ts` < the root's branding (inherited) < the tenant's. Fills only what both left empty; the two logos stay a pair. Used by the sign-in pages, `/api/settings/public`, the mail brand source and the `/favicon.ico` redirect. The settings form keeps reading the stored rows. |
| `tenant_branding.install` | `shellThemeCss(tenantId)`, `installThemeCss()` | The theme variables the whole admin is drawn with (the admin layout's nonce'd `<style>`), and `config/brand.ts`'s alone for the root layout. |
| `tenant_branding.theme` | `brandThemeCss`, `brandPalette` | Two rules, `:root` (the colour, darker hover / active, a pale tint) and `:root.dark` (a lighter fill, lighter hover / active, a deep tint), each with a readable foreground. The primary colour sets `--primary*`; the secondary colour sets the accent, `--accent`, `--accent-hover`, `--accent-fg` (Button `accent`, the coloured alternative action), with the same readable-foreground rule (`lightFill`, `readableOn`), and the same three `--secondary` variables, the second palette colour of charts, the widget colour option "Secondary" and ButtonGroup. No Button reads `--secondary`, so Button `secondary` (Cancel, Back) stays neutral. |

---

## Branding Fields

`TenantBranding` (from `tenant_branding.types.ts`, all fields optional strings):

```typescript
type TenantBranding = {
  brandName?: string;          // display name shown in UI chrome, emails, docs
  brandTagline?: string;       // short descriptor displayed alongside logo
  brandLogoLight?: string;     // URL — logo for light theme
  brandLogoDark?: string;      // URL — logo for dark theme
  brandIconLight?: string;     // URL — square app icon for light theme (the admin header's 28 px slot, app tiles)
  brandIconDark?: string;      // URL — square app icon for dark theme
  brandFavicon?: string;       // URL — favicon asset
  brandPrimaryColor?: string;  // hex color — buttons, links, accents
  brandSecondaryColor?: string;// hex color — the accent: coloured alternative actions (Button `accent`)
  authWallpaper?: string;      // URL — background on login/signup pages
  customCss?: string;          // injected into <head>
  customJs?: string;           // injected before </body>
};
```

`tenant_branding.types.ts` also exports `TenantBrandingStateSchema` / `TenantBrandingState` (`{ tenantId, branding, isLoading, error }`) for client-side state.

---

## Usage

```typescript
import TenantBrandingService from '@/modules/tenant_branding/tenant_branding.service';

// Read branding
const branding = await TenantBrandingService.get(tenantId);

// Update branding (only the provided keys are written)
await TenantBrandingService.update(tenantId, {
  brandPrimaryColor: '#6366f1',
  brandLogoLight: 'https://cdn.example.com/logo-light.svg',
});

// Reset all branding back to platform defaults
await TenantBrandingService.reset(tenantId);
```

---

## API Routes

`app/tenant/[tenantId]/api/settings/branding/route.ts`:

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/tenant/[tenantId]/api/settings/branding` | `tenant:admin` | Returns the tenant's branding |
| `PUT` | `/tenant/[tenantId]/api/settings/branding` | `tenant:admin` | Validates the body with `TenantBrandingSchema` and updates branding |
| `DELETE` | `/tenant/[tenantId]/api/settings/branding` | `tenant:owner` | Resets all branding to defaults |

All routes are rate-limited and authenticated via `TenantSessionNextService.authenticateTenantByRequest`.

---

## Settings

Branding values are themselves setting keys, enumerated by `TenantBrandingSettingKeySchema` in `tenant_branding.setting.keys.ts` (exposed as `TENANT_BRANDING_KEYS`):

`brandName`, `brandTagline`, `brandLogoLight`, `brandLogoDark`, `brandIconLight`, `brandIconDark`, `brandFavicon`, `brandPrimaryColor`, `brandSecondaryColor`, `authWallpaper`, `customCss`, `customJs`.

---

## Tenant Variability

> What varies per tenant in this module — and what could. Audited 2026-06-03.

White-label branding module that stores per-tenant logos, colors, favicon, custom CSS/JS, and auth wallpaper as setting key-value pairs, with full tenant isolation and no global defaults.

### Per-tenant settings

| Key | Type | Default | Scope | Controls | Read in |
|---|---|---|---|---|---|
| `brandName` | string | — | tenant | Tenant admin — display name shown in UI chrome, emails, docs | `tenant_branding.service.ts` |
| `brandTagline` | string | — | tenant | Tenant admin — short descriptor displayed alongside logo | `tenant_branding.service.ts` |
| `brandLogoLight` | string | — | tenant | Tenant admin — URL to logo asset for light theme | `tenant_branding.service.ts` |
| `brandLogoDark` | string | — | tenant | Tenant admin — URL to logo asset for dark theme | `tenant_branding.service.ts` |
| `brandIconLight` | string | — | tenant | Tenant admin — URL to the square app icon for light theme (the admin header's 28 px slot, app tiles; the favicon stands in without one, then the logo) | `tenant_branding.service.ts` |
| `brandIconDark` | string | — | tenant | Tenant admin — URL to the square app icon for dark theme (the light one stands in) | `tenant_branding.service.ts` |
| `brandFavicon` | string | — | tenant | Tenant admin — URL to favicon asset | `tenant_branding.service.ts` |
| `brandPrimaryColor` | string | — | tenant | Tenant admin — primary brand color (hex) applied to buttons, links, accents | `tenant_branding.service.ts` |
| `brandSecondaryColor` | string | — | tenant | Tenant admin — secondary brand color (hex): the accent, coloured alternative actions (Button `accent`, `--accent*`), and the second palette colour (`--secondary*`: charts, the widget "Secondary" colour); the neutral Button `secondary` does not take it | `tenant_branding.service.ts` |
| `authWallpaper` | string | — | tenant | Tenant admin — URL to background image displayed on login/signup pages | `tenant_branding.service.ts` |
| `customCss` | text | — | tenant | Tenant admin — custom CSS injected into <head> for white-label theming | `tenant_branding.service.ts` |
| `customJs` | text | — | tenant | Tenant admin — custom JavaScript injected before </body> | `tenant_branding.service.ts` |

*Scope: `tenant` = real tenants override · `root` = platform-only default (not per-tenant).*

### Per-tenant behavior

- `tenant_branding.service.ts:get` — Reads branding keys from SettingService for the request tenantId; each tenant has its own logo, colors, CSS/JS
- `tenant_branding.service.ts:update` — Updates branding keys for the request tenantId; changes only affect that tenant's chrome/UI rendering
- `tenant_branding.service.ts:reset` — Deletes all branding keys for the request tenantId, reverting that tenant to platform defaults
- `app/tenant/[tenantId]/api/settings/branding/route.ts:GET` — Returns branding for the tenant in the URL parameter; response is tenant-specific
- `app/tenant/[tenantId]/api/settings/branding/route.ts:PUT` — Updates branding for the tenant in the URL parameter; requires tenant:admin role
- `app/tenant/[tenantId]/api/settings/branding/route.ts:DELETE` — Resets branding for the tenant in the URL parameter; requires tenant:owner role

---

## Dependencies

Requires: `db`, `tenant_setting`, `storage`. Reads/writes branding values through `setting` (`SettingService`); API routes depend on `tenant_session` (auth) and `limiter` (rate limiting).

## Mail brand source

`server/tenant_branding.mail-brand.ts` contributes name, logo light/dark and primary colour to
`notification_mail:brand_source`. `TenantBrandingService` deletes the `notification_mail:brand:<tenantId>` cache key on
every write. No CSS/JS/favicon/wallpaper is ever exposed to mail.

## The 3D viewer's loading screen

kui-viewer shows a loading screen (logo, line, bar) while a model loads, with its own mark by default and a white label by option.
`ui/viewer-loading-brand.ts` maps the tenant's branding to it (the logo light/dark, else the name's initial, else no logo; the name; the
primary colour when it is a hex colour) and sets it as the page-wide defaults (`setLoadingScreenDefaults`) when the installed package has them;
`ui/use-viewer-loading-brand.hook.ts` does that from a component that already uses the viewer (`viewer.design` today), so every viewer on the
page is branded, the vendored widget-kit canvas included. This application never shows the viewer's own mark. A package without the loading
screen (before the release after 0.8.5) is left alone: nothing changes.

The logo addresses are vetted on the client (`safeLogoAddress`, the same rule as the server's `safeAssetUrl`) before they reach the viewer.
The defaults are set after the package has loaded; a viewer built earlier picks them up from its next load (kui-viewer keeps them on a shared
global, so the main entry and `/react` see the same ones). A board with only a `viewer.model` card and no `viewer.design` card has no component
that runs the hook, so it is not branded yet (open: a kit-runtime seam, or a `loadingScreen` pass-through in kui-react's `ViewerModelCanvas`).
