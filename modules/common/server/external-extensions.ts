// Generic, host-agnostic bridge for runtime-discovered (e.g. sandboxed community)
// contributions into ANY host extension point. Host modules (ai, storage, auth…)
// stay free of marketplace/plugin_runtime imports and simply ask for the
// contributions to their point.
//
// Discovery is DYNAMIC, not boot-registered: sources are themselves declared as
// `external:contributions` extension contributions and pulled on demand through
// the generated extension registry (same lazy dynamic-import mechanism storage
// providers use). So discovery never depends on instrumentation having run, never
// goes stale across dev hot-reloads, and needs no server restart.

import Logger from '@kuraykaraaslan-labs/logger';
import { extensionRegistry } from './extension-registry';
import { contributionsFor, ext, tenantCtx } from './extensions/ext';
import { externalContributionsLoaders } from './generated/extensions/external.contributions';
import { commonProviderScopeLoaders } from './generated/extensions/common.provider_scope';
import { ROOT_TENANT_ID, isRootTenant } from './tenant-constants';
import { SETTING_LEVELS_BY_MODULE } from './setting-keys.catalog';

export interface ExternalContribution {
  /** Provider/contribution key (e.g. 'kimi'). */
  key: string;
  /** Static manifest metadata for the point (label, models, secrets, …). */
  metadata: Record<string, unknown>;
  /** Whether the contribution's required credentials are set for the tenant. */
  configured: boolean;
  /** Forward an operation into the contribution (e.g. a sandboxed provider op). */
  invoke: (op: string, input: unknown) => Promise<unknown>;
  /**
   * Identifies the code behind `invoke` (a sandboxed plugin's version id), so a
   * host can cache an op result per version and drop it when the plugin is
   * upgraded. Absent when the source has no notion of versions.
   */
  version?: string;
  /**
   * Phase 53.4: whose install serves it, the tenant's own (`own`) or the root tenant's at the module's setting level (`root`).
   * Set by the bridge; a host that caches a built provider keys it by this too, so a level change never reuses the other one.
   */
  from?: 'own' | 'root';
}

/**
 * A source resolves the external contributions for a given host point + tenant: the installs of `tenantId`. With
 * `servedTenantId` (phase 53.4) those are the root tenant's installs serving another tenant: each `invoke` must then run in
 * the served tenant's scope (its data, its usage) and read the plugin's secrets and config from `tenantId`'s.
 */
export type ExternalContributionSource = (
  tenantId: string,
  point: string,
  opts?: { servedTenantId?: string },
) => Promise<ExternalContribution[]>;

// ── Provider scope (docs/phases/53-setting-levels, 53.4) ───────────────────────────────────────────────────────────────
// At a module's `platform` setting level, the providers that serve a tenant are the root tenant's installs, with the root
// tenant's secrets and config; at `tenant` the tenant's own; at `tenant_first` the tenant's own if one is configured, else the
// root tenant's. `common` cannot read the level (tenant_setting imports `common`), so the answer is the
// `common:provider_scope` point. No answer, or a failing one, is `own`: today's behaviour, which never hands out ROOT's secrets.

export type ProviderScope = 'own' | 'root' | 'own_then_root';

/** Extension point id, declared in common/module.json `extensionPoints`. */
export const PROVIDER_SCOPE_POINT = 'common:provider_scope';

/** What a `common:provider_scope` contribution default-exports. */
export interface ProviderScopeSource {
  /** Whose installs serve `tenantId` at `point`; null when the point follows no setting level. */
  scope(tenantId: string, point: string): ProviderScope | null | Promise<ProviderScope | null>;
}

/** The points some module's setting level covers; only those ask the scope at all. */
const LEVEL_POINTS: ReadonlySet<string> = new Set(Object.values(SETTING_LEVELS_BY_MODULE).flatMap((l) => l.points));
const SCOPES: ReadonlySet<string> = new Set(['own', 'root', 'own_then_root']);

async function providerScope(tenantId: string, point: string): Promise<ProviderScope> {
  if (isRootTenant(tenantId) || !LEVEL_POINTS.has(point)) return 'own';
  try {
    const hit = await ext.first<ProviderScopeSource, ProviderScope>(
      PROVIDER_SCOPE_POINT, tenantCtx(tenantId), commonProviderScopeLoaders,
      (source) => source.scope(tenantId, point),
      { validate: (value) => SCOPES.has(value) },
    );
    return hit?.value ?? 'own';
  } catch {
    return 'own';
  }
}

/** Extension point that source modules contribute into (default export = a source fn). */
const SOURCE_POINT = 'external:contributions';

const refusedPoints = new Set<string>();

/**
 * Contributions to a host extension point, gathered live from every registered
 * source. Empty when no source module is present. A broken source is skipped, never
 * fatal — first-party contributions must keep working. `opts.scope` names whose installs to list instead of asking the tenant's
 * setting level (phase 53.5): `own` or `root`.
 */
export async function listExternalContributions(
  tenantId: string,
  point: string,
  opts?: { scope?: 'own' | 'root' },
): Promise<ExternalContribution[]> {
  // EXT-8: community code reaches only the points that say it may (`external: true`). Enforced here too, not only at
  // publish time, so a listing published before the allowlist existed cannot reach a point by naming it.
  const def = extensionRegistry.getPoint?.(point);
  if (def && !def.external) {
    if (!refusedPoints.has(point)) {
      refusedPoints.add(point);
      Logger.warn(`[external-extensions] '${point}' does not accept community contributions (no \`external: true\`); none are served`);
    }
    return [];
  }
  // Phase 53.5: a caller that knows which side an earlier use was on (a stored file kept on the side it was written to) names it.
  const scope = opts?.scope && !isRootTenant(tenantId) ? opts.scope : await providerScope(tenantId, point);
  if (scope === 'root') return gather(ROOT_TENANT_ID, point, tenantId);
  const own = await gather(tenantId, point);
  if (scope === 'own_then_root' && !own.some((c) => c.configured)) return gather(ROOT_TENANT_ID, point, tenantId);
  return own;
}

/**
 * Phase 53.5: whether the platform pays for `tenantId`'s use of `point`, so the use counts against the plan's quota and is
 * billed. True for the root tenant itself (its providers are the platform's) and for a tenant its setting level serves with the
 * root tenant's installs; false while the tenant's own provider serves it. Answered from the scope (one settings read); only
 * `tenant_first` lists the tenant's providers, to see whether one of its own is configured.
 */
export async function isPlatformServed(tenantId: string, point: string): Promise<boolean> {
  if (isRootTenant(tenantId)) return true;
  const scope = await providerScope(tenantId, point);
  if (scope !== 'own_then_root') return scope === 'root';
  return !(await gather(tenantId, point)).some((c) => c.configured);
}

/**
 * The installs of `listTenantId` at `point`. The sources are gated like any contribution, for the tenant whose installs they
 * are: with the marketplace switched off for a tenant (or a source module blocked), none of its community contributions are
 * served. With `servedTenantId` they serve that tenant (see ExternalContributionSource).
 */
async function gather(listTenantId: string, point: string, servedTenantId?: string): Promise<ExternalContribution[]> {
  const sources = await contributionsFor(SOURCE_POINT, tenantCtx(listTenantId));
  if (!sources.length) return [];
  const from = servedTenantId ? 'root' : 'own';
  const out: ExternalContribution[] = [];
  for (const contribution of sources) {
    try {
      const source = await extensionRegistry.load<ExternalContributionSource>(contribution, externalContributionsLoaders);
      const list = servedTenantId ? await source(listTenantId, point, { servedTenantId }) : await source(listTenantId, point);
      out.push(...list.map((c) => ({ ...c, from } as ExternalContribution)));
    } catch (error) {
      // Skipped so first-party contributions keep working, but never silently: without this line a broken
      // marketplace source made every sandboxed provider look "not installed" with no trace.
      Logger.warn(`[external-extensions] source '${contribution.id}' failed for point '${point}' (tenant ${servedTenantId ?? listTenantId}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}
