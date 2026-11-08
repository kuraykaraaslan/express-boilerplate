import { NextRequest, NextResponse } from 'next/server';
import Logger from '@kuraykaraaslan-labs/logger';
import UserSessionNextService from '@kuraykaraaslan-labs/user_session/server/user_session.service.next';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import MaintenanceService from './maintenance.service';
import { isReadExempt, resolveSubject, isInMaintenanceBucket } from './maintenance.targeting';
import type { ActiveWindow } from './maintenance.dto';

/**
 * The proxy-side maintenance gate (phase 1). Called AFTER tenant resolution
 * with the app-relative path, so windows can be per-tenant and per-route —
 * unlike the root-tenant `maintenanceMode` settings boolean (which stays: it
 * is the coarse platform kill-switch and runs earlier in the proxy).
 *
 * Contract (locked decisions):
 *  - 503 + `Retry-After`, never a 200 rewrite (a 200 gets real URLs deindexed).
 *  - `Cache-Control: no-store` — a CDN must not keep serving the notice.
 *  - `/api/*` gets JSON, everything else branded HTML.
 *  - Escape hatches, all of which must hold at once: the auth surface stays
 *    reachable (the way back in), `/status` + `/api/health` stay up (the
 *    outage page must be able to say "see status page"), and members whose
 *    role is in the window's `allowRoles` (plus platform ADMINs) pass.
 */

// Auth under every tenancy shape, the public status surface, health, and the cron endpoints.
//  - auth: anchored at the (optional) tenant prefix — the same pattern as the kill-switch's MAINTENANCE_EXEMPT_PATH in
//    proxy/maintenance.ts (E-12). The unanchored `(?:^|/)auth(?:/|$)` let every path holding an `auth` segment through
//    (`/admin/settings/auth`, `/admin/auth/settings`) (41-ui-fixes/09 B2.3). Kept as a twin literal: the module cannot
//    import the proxy, and the proxy's tests mock this file.
//  - cron: `/api/cron/*` (and `/api/api/cron/*`, the `/api/tenant/{id}/api/cron/…` spelling of the docs) authenticate
//    with CRON_SECRET themselves; a live window must not 503 the maintenance tick that would end it (41-ui-fixes/09 B2.2).
const EXEMPT_PATH = new RegExp([
  /^(?:\/(?:t|tenant)\/[^/]+|\/api\/tenant\/[^/]+)?(?:\/api)?\/auth(?:\/|$)/.source,
  /^\/status(?:\/|$)/.source,
  /^\/api\/public\/status(?:\/|$)/.source,
  /^\/api\/health(?:\/|$)/.source,
  /^(?:\/api)?\/api\/cron(?:\/|$)/.source,
].join('|'));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface BrandingLite { brandName?: string; brandLogoLight?: string; brandPrimaryColor?: string }

// The branded look comes from the tenant's SETTINGS rows (the same rows
// tenant_branding manages) read through tenant_setting — an edge `tenant`
// already carries — so the outage page gets the logo/colour WITHOUT a
// tenant->tenant_branding module edge. Fail-open: any error renders neutral.
export async function loadBranding(tenantId: string): Promise<BrandingLite> {
  try {
    return await SettingService.getByKeys(tenantId, ['brandName', 'brandLogoLight', 'brandPrimaryColor']);
  } catch {
    return {};
  }
}

const FALLBACK_MESSAGE = 'We are performing scheduled maintenance. Please check back shortly.';

// Exported for the phase-3 admin preview route — the preview IS this renderer,
// so what the operator approves is byte-for-byte what a user would see.
export function maintenanceHtml(window: ActiveWindow, branding: BrandingLite): string {
  const message = window.message?.trim() || FALLBACK_MESSAGE;
  const accent = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(branding.brandPrimaryColor?.trim() ?? '')
    ? branding.brandPrimaryColor!.trim()
    : '#2563eb';
  const logo = branding.brandLogoLight?.trim()
    ? `<img src="${escapeHtml(branding.brandLogoLight.trim())}" alt="${escapeHtml(branding.brandName?.trim() || 'Logo')}" style="max-height:48px;max-width:220px;margin-bottom:24px">`
    : '';
  const until = window.scheduledEnd
    ? `<p class="until">Expected back by <time datetime="${new Date(window.scheduledEnd).toISOString()}">${new Date(window.scheduledEnd).toUTCString()}</time></p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(window.title || 'Maintenance')}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #fafafa; color: #18181b; padding: 24px; }
  main { max-width: 34rem; text-align: center; }
  .bar { width: 56px; height: 4px; border-radius: 2px; background: ${accent}; margin: 0 auto 20px; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0 0 .5rem; opacity: .75; }
  .until { font-size: .9rem; }
  a { color: ${accent}; }
  @media (prefers-color-scheme: dark) { body { background: #09090b; color: #fafafa; } }
</style>
</head>
<body><main>
${logo}
<div class="bar"></div>
<h1>${escapeHtml(window.title || 'Under maintenance')}</h1>
<p>${escapeHtml(message)}</p>
${until}
<p><a href="/status">Status page</a></p>
</main></body>
</html>`;
}

// Resolve the caller's platform role + tenant member role. Only runs when a
// window is ACTIVE, so its cost never touches the normal hot path.
async function resolveActor(req: NextRequest, tenantId: string): Promise<{ userId?: string; userRole?: string; memberRole?: string | null }> {
  try {
    const auth = await UserSessionNextService.authenticateUserByRequest({
      request: req, requiredUserRole: 'USER', otpVerifyBypass: true,
    });
    if (!auth?.user) return {};
    let memberRole: string | null = null;
    try {
      const { getByTenantAndUser } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service');
      const member = await getByTenantAndUser({ tenantMemberId: null, tenantId, userId: auth.user.userId });
      memberRole = member?.memberRole ?? null;
    } catch { /* no membership / module error → role stays null */ }
    return { userId: auth.user.userId, userRole: auth.user.userRole, memberRole };
  } catch {
    return {}; // unauthenticated
  }
}

/**
 * Returns the 503 response when `tenantId`+`appPath` is under an active window
 * the caller may not bypass; null lets the request continue. Fail-open end to
 * end — an infra error never takes the platform down.
 */
export async function gateMaintenance(req: NextRequest, tenantId: string, appPath: string): Promise<NextResponse | null> {
  if (EXEMPT_PATH.test(appPath)) return null;

  const window = await MaintenanceService.resolveMaintenance(tenantId, appPath);
  if (!window) return null;

  // READ_ONLY (phase 2): reads pass, writes 503 — checked before the actor so
  // the common case (a GET under a read-only window) costs nothing extra.
  if (isReadExempt(req.method, window)) return null;

  const actor = await resolveActor(req, tenantId);
  if (MaintenanceService.isAllowed(actor, window)) return null;

  // Canary maintenance (phase 2): only the window's percentage share of
  // subjects sees the 503; everyone else proceeds. Deterministic per subject.
  if (!(await isInMaintenanceBucket(window, resolveSubject(req, actor.userId)))) return null;

  const retryAfter = String(MaintenanceService.retryAfterSeconds(window));
  Logger.info(`[maintenance] window ${window.windowId} → 503 (tenant=${tenantId} path=${appPath})`);

  if (appPath.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'MAINTENANCE', message: window.message?.trim() || FALLBACK_MESSAGE, retryAfter: Number(retryAfter) },
      { status: 503, headers: { 'Retry-After': retryAfter, 'Cache-Control': 'no-store' } },
    );
  }

  const branding = await loadBranding(tenantId);
  return new NextResponse(maintenanceHtml(window, branding), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': retryAfter,
      'Cache-Control': 'no-store',
    },
  });
}
