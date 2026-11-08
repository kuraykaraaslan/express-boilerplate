// Runtime extension registry. Reads the build-time `module-runtime.json`
// `extensions` surface and resolves a contribution id to its server-side
// implementation via the loader map of its point, which the CALLER imports from
// `generated/extensions/<point>.ts` and passes to load()/loadModule().
//
// Why the caller holds the map: this file is reached by ~90 modules, the proxy,
// instrumentation and every page graph. Referencing one map of all ~284
// implementations here made all of those graphs compile every implementation
// (Turbopack compiles lazy-import targets). A host that reads one point now
// pulls in only that point's implementations, and contribution metadata
// (getContributions) costs no code at all.
//
// This is the backend twin of `module-registry`'s slot mechanism: a host module
// declares named extension points (module.json `extensionPoints`) and satellite
// modules contribute into them (module.json `extensions`). The host discovers
// contributions here — gated by the caller's enabled-module set, exactly like
// the API dispatcher gates route handlers — and never imports a satellite
// directly. Server-only (dynamic-imports handler code); kept React-free.

import runtime from './generated/module-runtime.json';
import { matchesFilter, type RegistryFilter } from './module-registry';
import type { ModuleScope } from './module-manifest.types';

export interface RuntimeExtension {
  /** Stable contribution id `<moduleId>:<point>:<key|export>`. */
  id: string;
  /** Target extension point, e.g. `<hostModuleId>:<pointName>`. */
  point: string;
  /** Contributing (satellite) module id. */
  moduleId: string;
  /** Provider key (e.g. 'openai'); null for hook contributions. */
  key: string | null;
  /** Server export id, resolved to `@kuraykaraaslan-labs/<exportId>` in the generated map. */
  exportId: string;
  order: number;
  scope: ModuleScope;
  permissions: string[];
  /** Static, code-free metadata declared in the manifest (label, models, …). */
  metadata: Record<string, unknown>;
}

/** A declared point and its contract (module.json `extensionPoints`, defaults resolved by the snapshot). */
export interface RuntimeExtensionPoint {
  id: string;
  kind: 'provider' | 'hook' | 'component';
  moduleId: string;
  description: string;
  pattern: 'select' | 'first' | 'fanout' | 'aggregate' | 'guard' | 'pipeline' | 'catalog' | 'component';
  gate: 'behaviour' | 'data' | 'platform';
  onFailure: 'skip' | 'fail-closed' | 'fallback';
  failOpen?: { reason: string; when?: string };
  fallback?: 'none' | 'default' | 'any';
  timeoutMs?: number;
  persists: boolean;
  external: boolean;
  /** `false`: the host reads marketplace plugins only; the snapshot refuses in-tree contributions. Absent = in-tree read too. */
  inTree?: false;
  /** `true`: the host reads the contributions' static metadata only and never loads their code (no loader file, no cycle edge). */
  metadataOnly?: true;
  /** `true`: the host loads the contributions' code on first use, never at boot (a registry of kinds); the loader file exists, the cycle edge does not. */
  lazyContributors?: true;
  version: number;
  slot?: string;
  reserved?: { reason: string };
}

export type ExtensionModule = Record<string, unknown> & { default?: unknown };

/** One point's implementations, generated as `generated/extensions/<point>.ts`. */
export interface ExtensionPointLoaders {
  /** The extension point these loaders implement; load() refuses a contribution to another one. */
  point: string;
  /** Contribution id -> lazy import of its implementation module. */
  loaders: Record<string, () => Promise<ExtensionModule>>;
}

const EXTENSIONS = (runtime.extensions ?? []) as unknown as RuntimeExtension[];
const POINTS = new Map(((runtime.extensionPoints ?? []) as unknown as RuntimeExtensionPoint[]).map((p) => [p.id, p]));

/**
 * The loader for one contribution. A map for a different point is a wiring bug in
 * the caller (it imported the wrong generated file), named as such rather than
 * reported as a stale snapshot.
 */
function loaderFor(ext: RuntimeExtension, map: ExtensionPointLoaders): () => Promise<ExtensionModule> {
  if (map.point !== ext.point) {
    throw new Error(`extension '${ext.id}' contributes to '${ext.point}', but was loaded with the '${map.point}' loaders`);
  }
  const loader = map.loaders[ext.id];
  if (!loader) throw new Error(`extension implementation not found: '${ext.id}' (run \`npm run registry:snapshot\`)`);
  return loader;
}

export const extensionRegistry = {
  /**
   * Contributions to a point, filtered by enabled modules / scope / permissions
   * (pass `{ enabledIds: await getEnabledModuleIds(tenantId) }` for per-tenant
   * gating) and sorted by order then id. Pure data — no code is loaded here.
   */
  getContributions(point: string, filter: RegistryFilter = {}): RuntimeExtension[] {
    return EXTENSIONS
      .filter((e) => e.point === point && matchesFilter(e, filter))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  },

  /** A declared point's contract, or undefined for an unknown id. Pure data. */
  getPoint(point: string): RuntimeExtensionPoint | undefined {
    return POINTS.get(point);
  },

  /**
   * Lazy-load the implementation behind a contribution (its default export, or
   * the module namespace if there is no default). `loaders` is the generated map
   * of the contribution's point (`generated/extensions/<point>.ts`). Throws if the
   * contribution id is unknown to it (stale snapshot) or the map is for another point.
   */
  async load<T = unknown>(ext: RuntimeExtension, loaders: ExtensionPointLoaders): Promise<T> {
    const mod = await loaderFor(ext, loaders)();
    return (mod.default ?? mod) as T;
  },

  /**
   * The implementation module itself (its namespace, not its default export), for a contribution that names a function in a file that
   * also has a default export (a boot task names `scheduleXJob` of a job file). Same `loaders` and errors as `load`.
   */
  async loadModule(ext: RuntimeExtension, loaders: ExtensionPointLoaders): Promise<Record<string, unknown>> {
    return (await loaderFor(ext, loaders)()) as Record<string, unknown>;
  },
};

export type ExtensionRegistryRuntime = typeof extensionRegistry;
