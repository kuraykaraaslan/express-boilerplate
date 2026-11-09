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
  /** A view under views/admin/lists/ drawn after the list (the modals the page opens). */
  partial?: string;
  /** Extra scripts loaded before the page script. */
  scripts?: string[];
};

type Ctx = { tenantId: string; isRoot: boolean };
const gear = (href: string, label: string): ListAction => ({ label: `<i class="fa-solid fa-gear" aria-hidden="true"></i><span class="sr-only">${label}</span>`, href, variant: 'ghost' });

const btn = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm';
export const BTN = { primary: `${btn} bg-primary text-primary-fg hover:bg-primary-hover`, ghost: `${btn} bg-transparent text-text-primary hover:bg-surface-overlay` };

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
  'tenant_member/ui/members.page': ({ tenantId }) => ({
    title: 'Members',
    subtitle: 'People with access to this organization',
    actions: [
      { label: 'Report', href: tenantPath(tenantId, '/admin/members/report'), variant: 'outline' },
      gear(tenantPath(tenantId, '/admin/members/settings'), 'Member settings'),
    ],
    script: '/js/lists/members.js',
    scripts: ['/js/step-up.js'],
    partial: 'members',
  }),
  'api_key/ui/api-keys.page': ({ tenantId }) => ({
    title: 'API Keys',
    subtitle: 'Programmatic access tokens for your integrations',
    actions: [
      { label: '<i class="fa-solid fa-chart-line" aria-hidden="true"></i> Reports', href: tenantPath(tenantId, '/admin/api-keys/reports'), variant: 'outline' },
      gear(tenantPath(tenantId, '/admin/api-keys/settings'), 'API key settings'),
    ],
    script: '/js/lists/api-keys.js',
    scripts: ['/js/step-up.js', '/js/permission-picker.js'],
    partial: 'api-keys',
  }),
};

export function listSpecFor(componentId: string, ctx: Ctx): ListSpec | undefined {
  return lists[componentId]?.(ctx);
}
