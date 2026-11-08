// The admin shell on Express: the port of NB's app/tenant/[tenantId]/admin/(shell)/layout.tsx and its catch-all page.
// One route serves every admin page: the session gate, the enabled modules, the viewer's menu and the page guard are decided here;
// the page itself comes from the module's route (module.json `routes`) and is drawn by `pages/admin.registry.ts`.
import { Router, type Request, type Response } from 'express';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { placeOfTenant } from '@kuraykaraaslan-labs/common/server/module-placement';
import { isRootTenant, ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { switchTenantPath, tenancyMode, tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { platformHost } from '@kuraykaraaslan-labs/common/server/tenant-url';
import { authenticateTenantPage, tenantPageMembership } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.guard.next';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { getById as getTenantById } from '@kuraykaraaslan-labs/tenant/server/tenant.read.service';
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { permissionsExemptFromGroupLift } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.group-floor.next';
import { runWithTenant } from '@kuraykaraaslan-labs/db/server/db.context';
import Logger from '@kuraykaraaslan-labs/logger';
import { requestContext } from '../shims/next/request-context';
import { toNextRequest } from '../router/dispatch';
import { adminPageAccess, adminViewer } from './admin.viewer';
import { renderAdminPage } from './admin.registry';

const router = Router();
const prefix = process.env.TENANT_PATH_PREFIX || 't';

// `/admin/...` in domain tenancy; `/tenant/{id}/admin/...` and `/{prefix}/{id}/admin/...` name the tenant explicitly.
const paths = ['/admin{/*rest}', '/tenant/:tenantId/admin{/*rest}', `/${prefix}/:tenantId/admin{/*rest}`];

type NavItem = { id: string; label: string; href: string; icon?: string; children?: NavItem[] };

/** The registry's icon name as the sidebar draws it (a Font Awesome solid icon). */
function iconHtml(icon?: string): string {
  const name = (icon ?? '').replace(/^fa-(solid\s+)?/, '').replace(/[^a-z0-9-]/gi, '');
  return `<i class="fa-solid fa-${name || 'circle'}" aria-hidden="true"></i>`;
}

function toNav(items: ReturnType<typeof moduleRegistry.getMenuItems>, tenantId: string): { groups: { label?: string; items: NavItem[] }[]; all: NavItem[] } {
  const map = (it: (typeof items)[number]): NavItem => ({
    id: it.id, label: it.label, href: tenantPath(tenantId, it.href), icon: iconHtml(it.icon),
    children: it.children?.length ? it.children.map(map) : undefined,
  });
  const byGroup = new Map<string, NavItem[]>();
  for (const it of items) {
    const g = it.group ?? '';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(map(it));
  }
  const groups = [...byGroup.entries()].map(([label, list]) => ({ label: label || undefined, items: list }));
  return { groups, all: groups.flatMap((g) => g.items) };
}

async function handle(req: Request, res: Response): Promise<void> {
  const tenantId: string | undefined = res.locals.tenantId;
  if (!tenantId) { res.status(404).render('404', { layout: 'layouts/blank' }); return; }
  const rest = (req.params as { rest?: string[] }).rest ?? [];
  const adminPath = '/admin' + (rest.length ? '/' + rest.join('/') : '');
  const request = toNextRequest(req);

  await requestContext.run(request, () => runWithTenant(tenantId, async () => {
    // The gate: signed in, and somebody this tenant's admin is for (an account-only session of the central login, or a
    // session minted for another tenant, goes to the picker).
    const auth = await authenticateTenantPage();
    if (!auth.ok) {
      res.redirect(`${tenantPath(tenantId, '/auth/login')}?redirect=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    if ((await tenantPageMembership(tenantId)) === 'outsider') {
      res.redirect(
        isRootTenant(tenantId) ? tenantPath(tenantId, '/auth/select-tenant')
          : tenancyMode() === 'path' ? switchTenantPath(ROOT_TENANT_ID, '/auth/select-tenant')
            : `${platformHost()}/auth/select-tenant`,
      );
      return;
    }

    const enabled = await getEnabledModuleIds(tenantId);
    const viewer = await adminViewer(tenantId);

    // The page: a route of an enabled module, placed for this tenant; a page outside its placement is no match.
    const found = moduleRegistry.findPageRoute(adminPath, { tenantId });
    const match = found && enabled.has(found.route.moduleId) ? found : undefined;
    // /admin is the dashboard module's page; when that module is off the shell still opens on a plain home.
    if (!match && adminPath !== '/admin') {
      res.status(404).render('404', { layout: 'layouts/blank' });
      return;
    }
    if (match) {
      const access = await adminPageAccess(tenantId, match.route.guard ?? [], viewer);
      if (access === 'denied') { res.status(404).render('404', { layout: 'layouts/blank' }); return; }
      if (access === 'unresolved') {
        res.status(503).render('admin/unresolved', { layout: 'layouts/blank', title: 'Session check', retryHref: req.originalUrl });
        return;
      }
    }

    // The viewer's menu: the enabled modules' items, kept when every permission they ask for is granted. A failure to work the
    // granted set out fails closed (only gated items disappear).
    const isRoot = isRootTenant(tenantId);
    let items = moduleRegistry.getMenuItems({ scope: isRoot ? undefined : 'tenant', enabledIds: enabled, place: placeOfTenant(tenantId) });
    try {
      if (!viewer.ok) throw new Error(viewer.reason);
      const permissionIds = [...new Set(items.flatMap((i) => i.permissions))];
      const granted = await grantedPermissions({
        request: viewer.request, tenantId, session: viewer.session, permissionIds, noGroupLift: permissionsExemptFromGroupLift(items),
      });
      items = items.filter((i) => i.permissions.every((p) => granted.has(p)));
    } catch (e) {
      Logger.warn(`[admin-shell] permission set unresolved for tenant ${tenantId}, failing closed: ${e instanceof Error ? e.message : String(e)}`);
      items = items.filter((i) => i.permissions.length === 0);
    }
    const nav = toNav(items, tenantId);
    const navHref = moduleRegistry.navPath(adminPath);
    const active = nav.all.concat(nav.all.flatMap((n) => n.children ?? []))
      .filter((n) => { const h = n.href; const p = tenantPath(tenantId, navHref); return p === h || p.startsWith(h + '/'); })
      .sort((a, b) => b.href.length - a.href.length)[0];
    const tenantName = await getTenantById(tenantId).then((t) => t.name).catch(() => undefined);

    const page = await renderAdminPage({ tenantId, adminPath, route: match?.route, params: match?.params ?? {} });
    res.status(page.status ?? 200).render(page.view, {
      layout: 'layouts/admin',
      title: page.title ?? 'Admin',
      tenantName: tenantName ?? 'Admin',
      navGroups: nav.groups,
      activeId: active?.id ?? '',
      homeHref: tenantPath(tenantId, '/admin'),
      logoutHref: tenantPath(tenantId, '/auth/logout'),
      tenantId,
      ...page.locals,
    });
  }));
}

router.get(paths, (req, res, next) => { handle(req, res).catch(next); });

export default router;
