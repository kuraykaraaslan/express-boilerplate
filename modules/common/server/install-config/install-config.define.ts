import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

// ── Install config: the shapes an installation writes in config/ ─────────────
// docs/phases/45-install-config (D45-1..D45-5). One configuration per installation, in the application's own `config/`
// directory, that no package update touches: `config/brand.ts`, `config/menu.ts`, `config/access.ts` and `config/modules.ts`, each a default
// export of the matching define call below. The define calls only give the file its type; every value is validated at
// boot and in the build (install-config.service.ts, `npm run config:check`), and a bad file fails loudly with the file
// and the path of the error.
//
// No runtime imports on purpose: the config files import this module, and the root layout reads the brand through them.

/** The built-in roles a menu or access rule names. A custom group (tenant role) is named by its key under `customGroups`. */
export const INSTALL_ROLES = ['sysadmin', 'owner', 'admin', 'user'] as const;
export type InstallRole = (typeof INSTALL_ROLES)[number];

// ── config/brand.ts ──────────────────────────────────────────────────────────

/**
 * The product identity of the installation. Layering, lowest first: the package default < this file < the platform's
 * own branding (the root tenant, set by a sysadmin in the UI) < a tenant's branding. An asset is a file under `config/`
 * (copied to `/brand/install/<name>` by `npm run config:check`) or an http(s) / root-relative URL.
 */
export type InstallBrand = {
  /** The product name: browser tab, sidebar header, mail, sign-in. */
  name?: string;
  /** A short name where room is tight (at most 16 characters). */
  shortName?: string;
  logo?: { light?: string; dark?: string };
  /** The square app icon: the admin header's 28 px slot and app tiles. Without one the favicon stands in, then the logo. */
  icon?: { light?: string; dark?: string };
  favicon?: string;
  /** `#rrggbb`; the hover, active, subtle and dark-theme shades and a readable foreground are generated from it. */
  primaryColor?: string;
  secondaryColor?: string;
  /** The theme a first visit gets (the viewer's own choice wins afterwards). */
  defaultTheme?: 'light' | 'dark' | 'system';
  mail?: { senderName?: string };
  /** The sign-in page's heading and the line under it (literal text, not translated). */
  signIn?: { title?: string; subtitle?: string };
};

// ── config/menu.ts ───────────────────────────────────────────────────────────

/**
 * A menu label: one text for every language, or one per language code (`{ en: 'Flows', tr: 'Akışlar' }`). The viewer's
 * language is shown, else English, else the first one given. A single text is shown as written in every language.
 */
export type MenuLabel = string | Record<string, string>;

/** One menu item, keyed by its id (`'blog-posts'`) or its tenant-relative href (`'/admin/blog/posts'`); the id wins. */
export type MenuItemOverride = {
  /** Drop the item from the sidebar. Hiding is not access control: close the page in config/access.ts. */
  hidden?: boolean;
  /** The item's label (`MenuLabel`: one text, or one per language). */
  label?: MenuLabel;
  /** Move the item to another sidebar group (an identity key, e.g. 'Finance'). */
  group?: string;
  /** Move the item to another workspace id. */
  workspace?: string;
  order?: number;
};

export type MenuWorkspaceOverride = {
  /** Drop the workspace, and every item in it, from the switcher. */
  hidden?: boolean;
  /** The workspace's label (`MenuLabel`: one text, or one per language). */
  label?: MenuLabel;
  icon?: IconDefinition;
  order?: number;
};

export type MenuGroupOverride = {
  /** Display label only (`MenuLabel`: one text, or one per language). The group's identity key (the object key) is unchanged. */
  label?: MenuLabel;
  /** Move the whole group to another workspace id. */
  workspace?: string;
  /** The group's place among the groups of its workspace, lower first (Platform → Menu sets it; docs/phases/54-menu-editor). */
  order?: number;
};

/** One layer of sidebar changes: the shape of `app/shell.profile.ts`, which stays read as the all-roles layer. */
export type InstallMenuLayer = {
  /**
   * `'single'`: one flat sidebar, no switcher. An object: per workspace id, change a built-in workspace or add a new
   * one (a new id needs `label` and `icon`).
   */
  workspaces?: 'single' | Record<string, MenuWorkspaceOverride>;
  /** Keyed by the group's identity key (`'Finance'`, `'Developer'`, ...). */
  groups?: Record<string, MenuGroupOverride>;
  items?: Record<string, MenuItemOverride>;
};

/**
 * The installation's sidebar: an all-roles layer (the top-level fields) and, per role, what that role sees on top of
 * it. Layers apply in order: app/shell.profile.ts, this file's top level, the viewer's built-in role, then each custom
 * group the viewer holds in the order written here. A later layer wins field by field.
 */
export type InstallMenu = InstallMenuLayer & {
  roles?: Partial<Record<InstallRole, InstallMenuLayer>>;
  /** Keyed by a custom group's key (tenant role key). */
  customGroups?: Record<string, InstallMenuLayer>;
};

// ── config/access.ts ─────────────────────────────────────────────────────────

/** Permission ids (`blog.posts.read`), not URLs: one line closes a page and its API together. */
export type InstallAccessRule = {
  /** Never held by this role, whatever the UI (role matrix, policies, shadow mode) says. */
  remove?: string[];
  /**
   * Held by this role over the tenant's role matrix and over an ADMIN role floor. An explicit policy deny still
   * applies, an OWNER-floor permission cannot be granted below owner, and module activation, edition and licence
   * still bound it. Every grant is listed at boot and written to the audit log.
   */
  grant?: string[];
};

export type InstallAccess = {
  roles?: Partial<Record<InstallRole, InstallAccessRule>>;
  /** Keyed by a custom group's key (tenant role key). */
  customGroups?: Record<string, InstallAccessRule>;
};

// ── config/modules.ts ────────────────────────────────────────────────────────

/**
 * Which modules this installation gives every tenant and which the tenants never see in the marketplace, by module id
 * (`iot_automation`). The platform's runtime switches (a sysadmin's default list, availability and bans) still apply on
 * top; this file is the installation's floor that no setting changes.
 */
export type InstallModules = {
  /**
   * On in every tenant where the module is placed, whatever the tenant's own switch says, together with every module it
   * requires. No tenant can switch them off or remove them, and the marketplace does not list them: they are part of the
   * product, like the core modules. A platform ban still switches one off everywhere.
   */
  included?: string[];
  /**
   * Never listed in a tenant's marketplace: a tenant cannot see, install, switch or remove them there. They arrive with a
   * plan, the platform's default list, a module that requires them, or the operator (Platform -> Modules), and a copy a
   * tenant has keeps running.
   */
  hidden?: string[];
};

// ── define calls ─────────────────────────────────────────────────────────────

/** `export default defineBrand({ ... })` in config/brand.ts. */
export function defineBrand(brand: InstallBrand): InstallBrand {
  return brand;
}

/** `export default defineMenu({ ... })` in config/menu.ts. */
export function defineMenu(menu: InstallMenu): InstallMenu {
  return menu;
}

/** `export default defineAccess({ ... })` in config/access.ts. */
export function defineAccess(access: InstallAccess): InstallAccess {
  return access;
}

/** `export default defineModules({ ... })` in config/modules.ts. */
export function defineModules(modules: InstallModules): InstallModules {
  return modules;
}
