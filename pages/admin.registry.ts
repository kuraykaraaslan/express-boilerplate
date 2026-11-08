// What fills the admin shell's content area: the module route's component id -> a view and its locals.
// Generic pages are data-driven (settings pages: pages/settings.manifest.ts); a component with no Express page yet gets a placeholder
// that names it, so the menu never leads to a blank screen.
import type { RuntimePageRoute } from '@kuraykaraaslan-labs/common/server/module-registry';
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { settingsPages } from './settings.manifest';

export type AdminPageInput = { tenantId: string; adminPath: string; route?: RuntimePageRoute; params: Record<string, string> };
export type AdminPage = { view: string; title?: string; locals?: Record<string, unknown>; status?: number };

export async function renderAdminPage(input: AdminPageInput): Promise<AdminPage> {
  const { tenantId, route } = input;
  if (!route) {
    // /admin itself (the dashboard module owns it in NB): a landing with the menu until that page is ported.
    return { view: 'admin/home', title: 'Home' };
  }
  const settings = settingsPages[route.componentId];
  if (settings) {
    // Platform-wide fields (`rootOnly`) show on the root tenant only; elsewhere they are neither shown nor saved.
    const fields = settings.fields.filter((f) => !f.rootOnly || isRootTenant(tenantId));
    return {
      view: 'admin/module-settings',
      title: settings.title,
      locals: {
        settings: { ...settings, fields, crumbHref: tenantPath(tenantId, settings.crumb.href) },
        groups: groupFields(fields),
        extraScripts: '<script src="/js/kui-api.js"></script><script src="/js/auth-ui.js"></script><script src="/js/module-settings.js"></script>',
      },
    };
  }
  return { view: 'admin/not-ported', title: route.title ?? route.componentId, locals: { componentId: route.componentId, adminPath: input.adminPath } };
}

function groupFields<T extends { group: string }>(fields: T[]): { group: string; items: T[] }[] {
  const order: string[] = [];
  const by: Record<string, T[]> = {};
  for (const f of fields) {
    if (!by[f.group]) { by[f.group] = []; order.push(f.group); }
    by[f.group].push(f);
  }
  return order.map((g) => ({ group: g, items: by[g] }));
}
