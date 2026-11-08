import { z } from 'zod';

// ── The stored menu (docs/phases/54-menu-editor, 01) ─────────────────────────
// The installation's sidebar as the sysadmin sets it in Platform → Menu: the layers of config/menu.ts (D45-3: all roles,
// then the viewer's built-in role, then each custom group they hold), with three differences. A label is the ENGLISH
// source of the entry's own translation key (shell_menu.keys.ts); the other languages live in `translations`. An icon is
// a Font Awesome name (`fas fa-industry`). Role and custom-group layers carry no label (D54-5). Pure: the editor page
// imports the types and the schema too.

export const MENU_ROLES = ['sysadmin', 'owner', 'admin', 'user'] as const;
export type MenuRole = (typeof MENU_ROLES)[number];

export const LABEL_MAX = 60;
export const MAX_WORKSPACES = 64;
export const MAX_GROUPS = 256;
export const MAX_ITEMS = 4000;
export const MAX_LINKS = 200;
export const MAX_CUSTOM_GROUP_LAYERS = 100;
export const URL_MAX = 2048;
/** The whole spec as JSON. */
export const SPEC_MAX_BYTES = 256 * 1024;

/** A workspace id, a link id: what a key segment and a URL can carry. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A menu item id or a `link:<id>` reference (manifest ids are lowercase with dashes, a few with underscores). */
const ITEM_KEY_RE = /^(link:)?[a-z0-9][a-z0-9_-]{0,79}$/;
/** A group's identity key: the English name a manifest declares (`Platform System`). */
const GROUP_KEY_RE = /^[\p{L}\p{N}][\p{L}\p{N} &'()/.,-]{0,47}$/u;
const ICON_RE = /^(fa[a-z]?\s+)?(fa-)?[a-z0-9-]{1,48}$/;
/** A custom group: a tenant role key. */
const CUSTOM_GROUP_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PERMISSION_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$/;

const Label = z.string().trim().min(1).max(LABEL_MAX);
const Order = z.number().int().min(-10000).max(10000);
const Icon = z.string().trim().regex(ICON_RE);

const ItemOverride = z.object({
  hidden: z.boolean().optional(),
  label: Label.optional(),
  group: z.string().regex(GROUP_KEY_RE).optional(),
  workspace: z.string().regex(SLUG_RE).optional(),
  order: Order.optional(),
}).strict();

const WorkspaceOverride = z.object({
  hidden: z.boolean().optional(),
  label: Label.optional(),
  icon: Icon.optional(),
  order: Order.optional(),
}).strict();

const GroupOverride = z.object({
  label: Label.optional(),
  workspace: z.string().regex(SLUG_RE).optional(),
  /** The group's place among the groups of its workspace (lower first); without it the shell's default order. */
  order: Order.optional(),
}).strict();

function boundedRecord<T extends z.ZodTypeAny>(key: z.ZodString, value: T, max: number) {
  return z.record(key, value).refine((r) => Object.keys(r).length <= max, { message: `at most ${max} entries` });
}

const layerShape = {
  workspaces: z.union([z.literal('single'), boundedRecord(z.string().regex(SLUG_RE), WorkspaceOverride, MAX_WORKSPACES)]).optional(),
  groups: boundedRecord(z.string().regex(GROUP_KEY_RE), GroupOverride, MAX_GROUPS).optional(),
  items: boundedRecord(z.string().regex(ITEM_KEY_RE), ItemOverride, MAX_ITEMS).optional(),
};

/** A role or custom-group layer: no label anywhere in it (D54-5: a rename applies to every role). */
const RoleLayerSchema = z.object({
  workspaces: z.union([z.literal('single'), boundedRecord(z.string().regex(SLUG_RE), WorkspaceOverride.omit({ label: true, icon: true }), MAX_WORKSPACES)]).optional(),
  groups: boundedRecord(z.string().regex(GROUP_KEY_RE), GroupOverride.omit({ label: true }), MAX_GROUPS).optional(),
  items: boundedRecord(z.string().regex(ITEM_KEY_RE), ItemOverride.omit({ label: true }), MAX_ITEMS).optional(),
}).strict();

export const LINK_KINDS_BUILTIN = ['page', 'url'] as const;

const LinkSchema = z.object({
  /** `page`, `url`, or a kind a module contributes (`board`). */
  kind: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  /** `page`: a tenant-relative `/admin/…` path; `url`: an https address; a contributed kind: its own value. */
  target: z.string().trim().min(1).max(URL_MAX),
  label: Label,
  icon: Icon.optional(),
  workspace: z.string().regex(SLUG_RE).optional(),
  group: z.string().regex(GROUP_KEY_RE).optional(),
  order: Order.optional(),
  /** Who sees it: required for `url` (nothing else guards it); narrows a `page` or contributed link. */
  audience: z.object({
    minRole: z.enum(MENU_ROLES).optional(),
    permission: z.string().regex(PERMISSION_RE).max(160).optional(),
  }).strict().optional(),
}).strict();

export const MenuSpecSchema = z.object({
  ...layerShape,
  roles: z.object(Object.fromEntries(MENU_ROLES.map((r) => [r, RoleLayerSchema.optional()])) as Record<MenuRole, z.ZodOptional<typeof RoleLayerSchema>>).strict().optional(),
  customGroups: boundedRecord(z.string().regex(CUSTOM_GROUP_RE), RoleLayerSchema, MAX_CUSTOM_GROUP_LAYERS).optional(),
  links: boundedRecord(z.string().regex(SLUG_RE), LinkSchema, MAX_LINKS).optional(),
}).strict().superRefine((spec, ctx) => {
  if (JSON.stringify(spec).length > SPEC_MAX_BYTES) ctx.addIssue({ code: 'custom', message: `the menu is larger than ${SPEC_MAX_BYTES / 1024} KB` });
  for (const [id, link] of Object.entries(spec.links ?? {})) {
    const at = ['links', id];
    if (link.kind === 'url') {
      const problem = urlTargetProblem(link.target);
      if (problem) ctx.addIssue({ code: 'custom', path: [...at, 'target'], message: problem });
      if (!link.audience?.minRole && !link.audience?.permission) ctx.addIssue({ code: 'custom', path: [...at, 'audience'], message: 'an outside link needs an audience (a lowest role or a permission)' });
    } else if (link.kind === 'page') {
      const problem = pageTargetProblem(link.target);
      if (problem) ctx.addIssue({ code: 'custom', path: [...at, 'target'], message: problem });
    }
  }
});

export type MenuItemOverride = z.infer<typeof ItemOverride>;
export type MenuWorkspaceOverride = z.infer<typeof WorkspaceOverride>;
export type MenuGroupOverride = z.infer<typeof GroupOverride>;
export type MenuLayer = {
  workspaces?: 'single' | Record<string, MenuWorkspaceOverride>;
  groups?: Record<string, MenuGroupOverride>;
  items?: Record<string, MenuItemOverride>;
};
export type MenuLink = z.infer<typeof LinkSchema>;
export type MenuSpec = MenuLayer & {
  roles?: Partial<Record<MenuRole, MenuLayer>>;
  customGroups?: Record<string, MenuLayer>;
  links?: Record<string, MenuLink>;
};

export const EMPTY_SPEC: MenuSpec = {};

/** Why an outside link's address is refused, or null. https only; `{tenantId}` and `{locale}` are the only placeholders. */
export function urlTargetProblem(target: string): string | null {
  if (target.length > URL_MAX) return 'the address is too long';
  const probe = target.replaceAll('{tenantId}', 'tenant').replaceAll('{locale}', 'en');
  if (/[{}]/.test(probe)) return 'only {tenantId} and {locale} may be used as placeholders';
  let url: URL;
  try { url = new URL(probe); } catch { return 'not a valid address'; }
  if (url.protocol !== 'https:') return 'only https addresses are allowed';
  if (url.username || url.password) return 'an address may not carry a user name or password';
  return null;
}

/** Why a page link's path is refused, or null: a tenant-relative admin path, no host, no protocol, no `..`. */
export function pageTargetProblem(target: string): string | null {
  if (!target.startsWith('/admin')) return 'a page link starts with /admin';
  if (target !== '/admin' && !target.startsWith('/admin/') && !target.startsWith('/admin?')) return 'a page link starts with /admin';
  if (/\.\.|\\|\/\/|[\s<>"'`]/.test(target)) return 'the path has characters a page path may not have';
  return null;
}

/** The path of a page link without its query (`/admin/devices?status=x` → `/admin/devices`). */
export function pagePath(target: string): string {
  const q = target.indexOf('?');
  return q === -1 ? target : target.slice(0, q);
}

/** Parse a spec; throws a ZodError naming the path of each problem. */
export function parseMenuSpec(input: unknown): MenuSpec {
  return MenuSpecSchema.parse(input) as MenuSpec;
}
