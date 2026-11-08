import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { TFunction } from '@kuraykaraaslan-labs/i18n/ui';
import {
  faNewspaper,
  faCartShopping,
  faUsers,
  faListCheck,
  faGear,
  faCode,
  faWarehouse,
  faUserTie,
  faEllipsis,
  faBook,
  faTicket,
  faPeopleGroup,
  faBullhorn,
  faBoxesStacked,
  faCoins,
  faDiagramProject,
  faCalendarCheck,
  faHandshake,
  faMicrochip,
  faHouse,
  faBolt,
  faBuilding,
  faServer,
  faHeartPulse,
} from '@fortawesome/free-solid-svg-icons';

// ── Workspace catalog ────────────────────────────────────────────────────────
// Top-level workspaces group the sidebar's many module `group`s into a handful
// of switchable sections, so installing 80+ modules no longer produces an
// unusable flat menu. Each menu item declares its `workspace` in module.json
// (manifest-driven); this catalog only holds display metadata (label/icon/order)
// per workspace id. To rename/reorder workspaces, edit THIS file only.

export type WorkspaceDef = {
  id: string;
  label: string;
  icon: IconDefinition;
  order: number;
  /** Set by a shell profile: `label` is already the display text, so it is not translated. */
  literalLabel?: boolean;
};

// Bundle-aligned: each app bundle can light up one workspace (Odoo app-launcher
// model). New entries beyond the original 8 stay empty until a bundle's modules
// declare that `workspace` — a workspace with no enabled menu items simply does
// not appear in the switcher. See phases/monetization/4.md.
//
// The default order (docs/phases/45-install-config D45-6): Home first (the
// dashboards and the viewer's own "My …" items), IoT right under it and
// Automation beside IoT, then the business workspaces, then the administration
// tail: Organisation (the tenant admin's own), Platform (the platform operator's:
// the system-scope items, sysadmin only, and the fleet, which the fleet tenant's
// holders of the fleet permissions see), Monitoring, and System for what is left.
export const WORKSPACES: WorkspaceDef[] = [
  { id: 'home',         label: 'Home',         icon: faHouse,          order: 1 },
  // the IoT add-on's own workspace (owner, 2026-10-24): devices, profiles, alarms, RPC, flows of the iot host, SCADA and 3D boards
  { id: 'iot',          label: 'IoT',          icon: faMicrochip,      order: 2 },
  // owner, 2026-10-26: Automation out of Developer into its own workspace, beside IoT
  { id: 'automation',   label: 'Automation',   icon: faBolt,           order: 3 },
  { id: 'content',      label: 'Content',      icon: faNewspaper,      order: 10 },
  { id: 'knowledge',    label: 'Knowledge',    icon: faBook,           order: 12 },
  { id: 'commerce',     label: 'Commerce',     icon: faCartShopping,   order: 20 },
  { id: 'events',       label: 'Events',       icon: faTicket,         order: 22 },
  { id: 'community',    label: 'Community',    icon: faPeopleGroup,    order: 23 },
  { id: 'crm',          label: 'CRM',          icon: faUsers,          order: 30 },
  { id: 'marketing',    label: 'Marketing',    icon: faBullhorn,       order: 31 },
  { id: 'inventory',    label: 'Inventory',    icon: faBoxesStacked,   order: 34 },
  { id: 'erp',          label: 'ERP',          icon: faWarehouse,      order: 35 },
  { id: 'finance',      label: 'Finance',      icon: faCoins,          order: 36 },
  { id: 'hr',           label: 'HR',           icon: faUserTie,        order: 37 },
  { id: 'operations',   label: 'Operations',   icon: faListCheck,      order: 40 },
  { id: 'projects',     label: 'Projects',     icon: faDiagramProject, order: 41 },
  { id: 'bookings',     label: 'Bookings',     icon: faCalendarCheck,  order: 42 },
  { id: 'developer',    label: 'Developer',    icon: faCode,           order: 45 },
  { id: 'partner',      label: 'Partner',      icon: faHandshake,      order: 48 },
  // members, invitations, domains, plan and billing, branding, settings, tags, agreements and consent, imports, documents
  { id: 'organisation', label: 'Organisation', icon: faBuilding,       order: 50 },
  // tenants, users, modules, translations, fleet, marketplace review, audit logs, health: system-scope items
  { id: 'platform',     label: 'Platform',     icon: faServer,         order: 51 },
  // observability and on-call
  { id: 'monitoring',   label: 'Monitoring',   icon: faHeartPulse,     order: 52 },
  // what is left: AI, insights, security, configuration
  { id: 'system',       label: 'System',       icon: faGear,           order: 53 },
];

// Synthetic catch-all for any group not claimed by a workspace above (e.g. a new
// plugin's group, or the runtime "Plugins" fallback). Ensures nothing is hidden
// before someone assigns it a workspace.
export const FALLBACK_WORKSPACE: WorkspaceDef = {
  id: 'more', label: 'More', icon: faEllipsis, order: 999,
};

// Keep the canonical sidebar section order regardless of manifest scan order. Shared by the sidebar and the menu
// editor (Platform → Menu), which shows groups in the order the sidebar draws them.
export const GROUP_ORDER = [
  'Overview',
  // Home: the dashboards, then the viewer's own work, then self-service HR.
  'Home', 'My work',
  'Content', 'Blog', 'Management', 'Commerce', 'Operations',
  // Work and contact history — `tasks` and `activity` share this group rather
  // than opening one each.
  'Activities',
  // HR suite, in the order an HR user works: self-service first, then the
  // people master file, then time, pay, talent and the compliance/insight tail.
  'My HR', 'My Team', 'People', 'Employees', 'Departments', 'Employee Records',
  'Time Off', 'Leave', 'Time & Attendance', 'Payroll', 'Expenses',
  'Talent', 'HR Insights', 'HR Compliance',
  // Company-wide reference data — lives in the erp workspace, not hr
  'Organisation', 'Payroll TR',
  'Insights', 'AI', 'Store', 'Security', 'Developer', 'Configuration', 'Account',
  // Organisation, then Platform (sysadmin) and Monitoring.
  'Members', 'Settings', 'Plan and billing', 'Agreements and documents',
  'Plugins', 'Platform', 'Marketplace', 'Fleet', 'Platform health',
  'Observability', 'On-call',
];

// Groups that appear in EVERY workspace (pinned above the workspace-scoped
// groups), never gated by the switcher.
export const ALWAYS_ON_GROUPS = ['Overview', 'Account'];

// Fallback map for items that predate the manifest `workspace` field, and to
// resolve a sidebar group's workspace from its label. Keep in sync with the
// `workspace` values seeded into module.json manifests.
export const GROUP_WORKSPACE: Record<string, string> = {
  // The viewer's own items: the dashboards, "My …" work and self-service HR.
  Home: 'home', 'My work': 'home', 'My HR': 'home',
  // the IoT add-on's group (owner, 2026-10-24: IoT is its own workspace)
  IoT: 'iot',
  Automation: 'automation',
  Content: 'content', Blog: 'content', Drive: 'content',
  Media: 'content', SEO: 'content', Forms: 'content',
  Navigation: 'content', Redirects: 'content', Search: 'content',
  Commerce: 'commerce', Store: 'commerce', Orders: 'commerce',
  Inventory: 'erp', Procurement: 'erp',
  Sales: 'erp', Catalog: 'erp',
  // The tenant's own shape (legal entities, sites, cost centers) and the country
  // statutory registry are company-wide reference data, not HR screens.
  Organisation: 'erp', 'Payroll TR': 'erp',
  // Finance-domain surfaces (accounting, invoice, tax, exchange rates, metering,
  // wallet) all live in the finance workspace now (MIS-03) — no longer split
  // across erp/commerce with a group literally named 'Finance' in each.
  Finance: 'finance',
  Employees: 'hr', Departments: 'hr', Leave: 'hr', Payroll: 'hr',
  // HR suite groups. `group` strings are identity keys (matched against
  // GROUP_ORDER / ALWAYS_ON_GROUPS / manifest `group`), so they are never
  // translated — only the workspace label is.
  People: 'hr', 'Time Off': 'hr', 'Time & Attendance': 'hr',
  Talent: 'hr', 'Employee Records': 'hr', Expenses: 'hr',
  'HR Insights': 'hr', 'HR Compliance': 'hr', 'My Team': 'hr',
  Operations: 'operations',
  // `tasks` + `activity`. Group strings are identity keys, never translated.
  Activities: 'operations',
  Developer: 'developer',
  // The tenant admin's own items (members, plan and billing, settings, records), out of System (phase 45 D45-6).
  Members: 'organisation', 'Plan and billing': 'organisation', Settings: 'organisation',
  'Agreements and documents': 'organisation',
  // System-scope items, for the platform's operator only, and the fleet.
  Platform: 'platform', Marketplace: 'platform', Fleet: 'platform', 'Platform health': 'platform',
  Observability: 'monitoring', 'On-call': 'monitoring',
  Security: 'system', AI: 'system', Configuration: 'system', Insights: 'system', Telemetry: 'system',
};

// Resolve a menu item's workspace id: explicit manifest value wins, else derive
// from its group, else the synthetic catch-all. Own keys only: a group named
// 'constructor' or 'toString' must not pick up an Object.prototype member.
export function resolveWorkspaceId(item: { workspace?: string; group?: string }): string {
  return (
    item.workspace ??
    (item.group && Object.hasOwn(GROUP_WORKSPACE, item.group) ? GROUP_WORKSPACE[item.group] : undefined) ??
    FALLBACK_WORKSPACE.id
  );
}

export function workspaceById(id: string): WorkspaceDef {
  return WORKSPACES.find((w) => w.id === id) ?? FALLBACK_WORKSPACE;
}

// `label` above is the English source AND the value the extractor picks up via
// the t() calls below. This catalog stays a plain module (no 'use client', no
// hook), so translation happens at render: pass the caller's `t` in.
export function workspaceLabel(w: WorkspaceDef, t: TFunction): string {
  if (w.literalLabel) return w.label;
  return t(`app_shell.workspace.${w.id}`, w.label);
}

/**
 * A sidebar group's key segment: `Platform System` → `platform-system`. Kept in step with
 * `groupSlug` in scripts/i18n/extract.mjs, which writes `app_shell.group.<slug>` for every
 * manifest menu `group` (a test compares the two).
 */
export function groupSlug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The display name of a sidebar group. The English `group` string stays the identity
 * (GROUP_ORDER, GROUP_WORKSPACE, ALWAYS_ON_GROUPS and the manifests compare it), so only
 * the text shown goes through `t`.
 */
export function groupLabel(group: string, t: TFunction): string {
  const slug = groupSlug(group);
  return slug ? t(`app_shell.group.${slug}`, group) : group;
}

// Extractor anchor — `scripts/i18n/extract.mjs` scans for literal t('key','default')
// pairs, so the dynamic keys above are invisible to it. Keeping the literal list
// here is what puts these labels in en.json; it is never called at runtime.
// Keep in sync with WORKSPACES + FALLBACK_WORKSPACE. (The manifest groups are added
// by the extractor from every module.json; only the groups no manifest names are here.)
/* istanbul ignore next */
function _i18nAnchor(t: TFunction) {
  return [
    t('app_shell.workspace.home', 'Home'),
    t('app_shell.workspace.iot', 'IoT'),
    t('app_shell.workspace.automation', 'Automation'),
    t('app_shell.workspace.content', 'Content'),
    t('app_shell.workspace.knowledge', 'Knowledge'),
    t('app_shell.workspace.commerce', 'Commerce'),
    t('app_shell.workspace.events', 'Events'),
    t('app_shell.workspace.community', 'Community'),
    t('app_shell.workspace.crm', 'CRM'),
    t('app_shell.workspace.marketing', 'Marketing'),
    t('app_shell.workspace.inventory', 'Inventory'),
    t('app_shell.workspace.erp', 'ERP'),
    t('app_shell.workspace.finance', 'Finance'),
    t('app_shell.workspace.hr', 'HR'),
    t('app_shell.workspace.operations', 'Operations'),
    t('app_shell.workspace.projects', 'Projects'),
    t('app_shell.workspace.bookings', 'Bookings'),
    t('app_shell.workspace.developer', 'Developer'),
    t('app_shell.workspace.partner', 'Partner'),
    t('app_shell.workspace.organisation', 'Organisation'),
    t('app_shell.workspace.platform', 'Platform'),
    t('app_shell.workspace.monitoring', 'Monitoring'),
    t('app_shell.workspace.system', 'System'),
    t('app_shell.workspace.more', 'More'),
    // the shell's own groups (admin-shell.nav.helpers) and the launcher's bucket for items without one
    t('app_shell.group.overview', 'Overview'),
    t('app_shell.group.account', 'Account'),
    t('app_shell.group.other', 'Other'),
    // a group name an installation's config/menu.ts commonly gives (the IoT menu's 'Management' shown as 'Devices')
    t('app_shell.group.devices', 'Devices'),
  ];
}
void _i18nAnchor;
