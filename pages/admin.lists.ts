// The list pages: component id -> what the generic list view (views/admin/data-list.ejs) draws around the list, and the script that
// mounts it (public/js/lists/*.js on public/js/data-list.js). The page script reads the tenant and root flag from #dl-page.
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';

export type ListAction = { label: string; href: string; variant?: 'primary' | 'outline' | 'ghost' };
export type ListSpec = {
  title: string; subtitle?: string; actions?: ListAction[]; script: string;
  /** Title of the detail drawer (`#dl-drawer-body`); none = no drawer. */
  drawer?: string;
  /** Static HTML above and below the list (banners, stat cards the script fills). */
  above?: string; below?: string;
};

type Ctx = { tenantId: string; isRoot: boolean };
const gear = (href: string, label: string): ListAction => ({ label: `<i class="fa-solid fa-gear" aria-hidden="true"></i><span class="sr-only">${label}</span>`, href, variant: 'ghost' });

const lists: Record<string, (c: Ctx) => ListSpec> = {
  'audit_log/ui/audit-logs.page': ({ tenantId, isRoot }) => ({
    title: 'Audit Logs',
    subtitle: isRoot ? 'Tamper-evident record of actions across all tenants' : 'Tamper-evident record of actions taken in this organization',
    actions: [
      { label: '<i class="fa-solid fa-download mr-2" aria-hidden="true"></i>Export CSV', href: tenantPath(tenantId, '/api/audit-logs/export?format=csv'), variant: 'ghost' },
      gear(tenantPath(tenantId, '/admin/audit-logs/settings'), 'Audit log settings'),
    ],
    script: '/js/lists/audit-logs.js',
    drawer: 'Audit Log Detail',
  }),
};

export function listSpecFor(componentId: string, ctx: Ctx): ListSpec | undefined {
  return lists[componentId]?.(ctx);
}
