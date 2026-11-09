// What fills the admin shell's content area: the module route's component id -> a view and its locals.
// Generic pages are data-driven (settings pages: pages/settings.manifest.ts); a component with no Express page yet gets a placeholder
// that names it, so the menu never leads to a blank screen.
import type { RuntimePageRoute } from '@kuraykaraaslan-labs/common/server/module-registry';
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { resolveTenantLanguages } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.languages';
import { LANGUAGE_OPTIONS, narrowLanguages } from '@kuraykaraaslan-labs/localization/server/languages';
import { TIMEZONE_OPTIONS } from '@kuraykaraaslan-labs/localization/server/timezones';
import { DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS, FIRST_DAY_OPTIONS } from '@kuraykaraaslan-labs/localization/server/datetime';
import { settingsPages } from './settings.manifest';
import { listSpecFor } from './admin.lists';

export type AdminPageInput = { tenantId: string; adminPath: string; route?: RuntimePageRoute; params: Record<string, string> };
export type AdminPage = { view: string; title?: string; locals?: Record<string, unknown>; status?: number };

export async function renderAdminPage(input: AdminPageInput): Promise<AdminPage> {
  const { tenantId, route } = input;
  if (!route) {
    // /admin itself (the dashboard module owns it in NB): a landing with the menu until that page is ported.
    return { view: 'admin/home', title: 'Home' };
  }
  if (route.componentId === 'account/ui/me.page') {
    // Only the tenant's enabled languages are offered: the server clamps the application locale to that set.
    const { enabledLanguages } = await resolveTenantLanguages(tenantId);
    const languageOptions = narrowLanguages(LANGUAGE_OPTIONS.map((o) => o.value), enabledLanguages)
      .map((code) => LANGUAGE_OPTIONS.find((o) => o.value === code))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .map((o) => ({ value: o.value, label: o.label }));
    return {
      view: 'admin/account-me',
      title: 'My Profile',
      locals: {
        languageOptions,
        timezoneOptions: TIMEZONE_OPTIONS,
        dateFormatOptions: DATE_FORMAT_OPTIONS,
        timeFormatOptions: TIME_FORMAT_OPTIONS,
        firstDayOptions: FIRST_DAY_OPTIONS,
        extraScripts: '<script src="/js/kui-api.js"></script><script src="/js/auth-ui.js"></script><script src="/js/account-me.js"></script>',
      },
    };
  }
  const list = listSpecFor(route.componentId, { tenantId, isRoot: isRootTenant(tenantId) });
  if (list) {
    return {
      view: 'admin/data-list',
      title: list.title,
      locals: {
        spec: list, isRoot: isRootTenant(tenantId),
        extraScripts: `<script src="/js/kui-api.js"></script><script src="/js/data-list.js"></script><script src="${list.script}"></script>`,
      },
    };
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
