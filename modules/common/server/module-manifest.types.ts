// ============================================================================
// Module System Types
// ============================================================================

import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { ItemPlacement, ModulePlacement } from './module-placement';

// ============================================================================
// Scope Type
// ============================================================================

export type ModuleScope = 'system' | 'tenant' | 'both';

// ============================================================================
// Settings Tab
// ============================================================================

export interface SettingsTabJson {
  id: string;
  label: string;
  icon?: string;
  component: string;
  order?: number;
  scope?: ModuleScope;
  keys?: string | string[];
  permissions?: string[];
}

/**
 * Setting level (docs/phases/53-setting-levels): where a module's provider keys come from. 'platform' = the root tenant's only,
 * 'tenant' = the tenant's own only, 'tenant_first' = the tenant's whole group if it set any key of it, else the root tenant's.
 */
export type SettingLevel = 'platform' | 'tenant' | 'tenant_first';

/** The `level` entry of a module's settings block (module.schema.json describes each field). */
export interface SettingLevelJson {
  allowed: SettingLevel[];
  default: SettingLevel;
  keys?: string[];
  prefixes?: string[];
  caps?: string[];
  points?: string[];
}

// ============================================================================
// Menu Item
// ============================================================================

export interface MenuItemJson {
  id: string;
  label: string;
  href: string;
  icon?: string;
  order?: number;
  scope?: ModuleScope;
  /** Sidebar section label this item is grouped under (e.g. 'Content'). */
  group?: string;
  /**
   * Top-level admin workspace this item belongs to (e.g. 'commerce', 'finance').
   * Explicit value wins over the group→workspace fallback. See workspaces.config.ts
   * and phases/monetization/4.md.
   */
  workspace?: string;
  permissions?: string[];
  /** Where the item shows when it differs from its module's placement (docs/phases/46-module-placement D46-3); children inherit it. */
  placement?: ItemPlacement;
  children?: MenuItemJson[];
  badge?: {
    type: 'count' | 'dot' | 'text';
    source: string;
  };
}

export interface MenuItem {
  id: string;
  label: string;
  href: string;
  icon?: IconDefinition;
  order: number;
  scope: ModuleScope;
  permissions: string[];
  children?: MenuItem[];
  badge?: {
    type: 'count' | 'dot' | 'text';
    source: string;
  };
  moduleId: string;
}

// ============================================================================
// Route
// ============================================================================

export interface RouteJson {
  path: string;
  component: string;
  layout?: string;
  middleware?: string[];
  permissions?: string[];
  /** Where the page exists when it differs from its module's placement (docs/phases/46-module-placement D46-3). */
  placement?: ItemPlacement;
  /**
   * Admin pages only: the href of the menu item the page sits under when no item's href covers its path (a page kept
   * without its own item): the sidebar marks that item, the workspace follows it, the browser tab is named by it.
   */
  navHref?: string;
  /** Admin pages only: the browser-tab name of the page, over the menu item it sits under; `titleKey` translates it. */
  title?: string;
  titleKey?: string;
}

// ============================================================================
// API Endpoint
// ============================================================================

export interface ApiEndpointJson {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  handler: string;
  middleware?: string[];
  permissions?: string[];
  rateLimit?: {
    requests: number;
    window: string;
  };
}

// ============================================================================
// Permission
// ============================================================================

export interface Permission {
  id: string;
  name: string;
  description?: string;
  group?: string;
  moduleId: string;
}

// ============================================================================
// Widget
// ============================================================================

export interface WidgetJson {
  id: string;
  name?: string;
  component: string;
  scope?: ModuleScope;
  size?: 'small' | 'medium' | 'large' | 'full';
  /** Workspace dashboard this widget appears on (e.g. 'commerce', 'developer'). */
  workspace?: string;
  order?: number;
  permissions?: string[];
}

// ============================================================================
// Slot Contribution
// ============================================================================

/** A component a module contributes into a named slot exposed by another module. */
export interface SlotContributionJson {
  /** Target slot name, e.g. 'user.profile.tabs'. */
  slot: string;
  /** Contributed component id, e.g. 'payment/ui/BillingProfileTab'. */
  component: string;
  order?: number;
  scope?: ModuleScope;
  permissions?: string[];
  /** Static props merged into the rendered component. */
  props?: Record<string, unknown>;
}

// ============================================================================
// Module Hooks
// ============================================================================

export interface ModuleHooks {
  onInstall?: string;
  onUninstall?: string;
  onEnable?: string;
  onDisable?: string;
  onUpgrade?: string;
}

// ============================================================================
// Module Dependencies
// ============================================================================

export interface ModuleDependencies {
  requires?: string[];
  optional?: string[];
  conflicts?: string[];
}

// ============================================================================
// Extension Points & Contributions
// ============================================================================

/** A named extension point this module (the host) exposes for satellites. */
export interface ExtensionPointJson {
  /** Host-namespaced id, e.g. `<hostModuleId>:<pointName>`. */
  id: string;
  /**
   * provider = a keyed backend implementation (server, JSON ops);
   * hook = a fn invoked at the point;
   * component = a client React contribution (e.g. a page-builder block
   * Definition) resolved via the generated client component/block map, never the
   * server extension map.
   */
  kind: 'provider' | 'hook' | 'component';
  description?: string;
}

/** A contribution this module makes into another module's extension point. */
export interface ExtensionContributionJson {
  /** Target extension point id, e.g. `<hostModuleId>:<pointName>`. */
  point: string;
  /** Stable key for provider contributions (e.g. 'openai'); ignored for hooks. */
  key?: string;
  /** Server export id resolved to '@kuraykaraaslan-labs/<export>'; must be in package.json exports. */
  export: string;
  order?: number;
  scope?: ModuleScope;
  permissions?: string[];
  /** Static metadata merged into the runtime contribution record. */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Tenant API Route (catch-all dispatcher)
// ============================================================================

/** A tenant API endpoint owned by this module, served by the catch-all dispatcher. */
export interface ApiRouteJson {
  /** URL path, e.g. '/api/store/products/[productId]'. */
  path: string;
  /** Handler module id, e.g. 'store/server/store-products.route'. */
  handler: string;
  permissions?: string[];
  /** Where the route is served when it differs from its module's placement (docs/phases/46-module-placement D46-3). */
  placement?: ItemPlacement;
}

// ============================================================================
// Plugin Sandbox (untrusted community plugins)
// ============================================================================

/**
 * For untrusted community plugins: declares the isolated runtime and the
 * capabilities/limits it requests. First-party modules omit this (they run
 * trusted, in-process).
 */
export interface SandboxJson {
  /** 'isolated' = V8 isolate with brokered capabilities, no direct DB/fs/net. */
  runtime: 'isolated';
  capabilities: Array<'data' | 'http' | 'settings' | 'secrets' | 'storage' | 'events'>;
  /** Hostnames the plugin's http.fetch may reach (SSRF-guarded). Empty = none. */
  httpAllowlist?: string[];
  limits?: {
    memoryMb?: number;
    timeoutMs?: number;
    httpTimeoutMs?: number;
    httpMaxBytes?: number;
  };
}

// ============================================================================
// Module Configuration (JSON structure)
// ============================================================================

export interface ModuleJson {
  $schema?: string;
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  license?: string;
  icon?: string;
  tags?: string[];
  /**
   * Default admin workspace for this module's menu items (items may override per
   * item). Enables the "1 bundle = 1 workspace" model. See workspaces.config.ts.
   */
  workspace?: string;
  /** Commercial bundle this module belongs to (catalog Product key). */
  bundle?: string;
  enabled?: boolean;
  /**
   * Where the module runs (docs/phases/46-module-placement D46-1), required: 'core' (a platform service every place has),
   * 'root' (the installation's own console), 'fleet' (the federation identity) or 'tenant' (a customer's business module,
   * which ROOT may use too). A mixed module gives a page, menu item or API route its own `placement` (D46-3).
   */
  placement: ModulePlacement;
  /**
   * Product edition (docs/phases/35-editions-licensing): 'core' (Free), 'pro', 'enterprise', 'iot' (the IoT add-on package, ADR-0013:
   * no rank, may require core and iot modules only), or 'custom' for the operator's own modules. A module may only require modules of its own
   * edition or lower (scripts/registry/edition-guard.mjs).
   */
  edition?: 'core' | 'pro' | 'enterprise' | 'iot' | 'custom';
  priority?: number;
  /**
   * Module ids this module comes with: enabled for a tenant exactly when every one of them and every module it `requires` is (a companion
   * of its host, e.g. the Rules card of `automation`); the tenant's own `module.<id>.enabled` row is not consulted.
   */
  enabledWith?: string[];
  dependencies?: ModuleDependencies;
  settings?: {
    tabs?: SettingsTabJson[];
    keys?: string;
    level?: SettingLevelJson;
  };
  menu?: MenuItemJson[];
  routes?: RouteJson[];
  api?: {
    endpoints?: ApiEndpointJson[];
    middleware?: string[];
  };
  permissions?: Array<{
    id: string;
    name: string;
    description?: string;
    group?: string;
  }>;
  hooks?: ModuleHooks;
  widgets?: WidgetJson[];
  slots?: SlotContributionJson[];
  /** Named extension points this module (the host) exposes for satellites. */
  extensionPoints?: ExtensionPointJson[];
  /** Contributions this module makes into other modules' extension points. */
  extensions?: ExtensionContributionJson[];
  /** Tenant API endpoints owned by this module, served by the catch-all dispatcher. */
  apiRoutes?: ApiRouteJson[];
  /** Setting keys owned by this module. */
  settingKeys?: string[];
  /** Module/plugin website or documentation URL. */
  homepage?: string;
  /** Isolated-runtime declaration for untrusted community plugins. */
  sandbox?: SandboxJson;
  exports?: Record<string, string>;
}
