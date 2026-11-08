import { ext, tenantCtx, type ContributionFailure } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { resolveContributorStates } from '@kuraykaraaslan-labs/common/server/extensions/contributor-state';
import { moduleLifecycleReferenceHolderLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/module_lifecycle.reference_holder';
import type { HeldReferences, ReferenceHolder } from '@kuraykaraaslan-labs/common/server/extensions/reference-holder.contract';

/**
 * References other modules hold to a module's contributions (docs/phases/37-extensions/06): an automation flow that
 * uses its node, a board that shows its widget, a page that renders its block, a setting that names its provider.
 * Hosts that store such keys (`persists: true` points) contribute a ReferenceHolder; module_lifecycle asks them for
 * the impact preview before a deactivation or uninstall (EXT-6: warn, never block), for the orphan report, and to
 * sweep the references when the module's data is finally purged (never earlier: re-enabling must restore them).
 */
export const REFERENCE_HOLDER_POINT = 'module_lifecycle:reference_holder';

export type { HeldReferences, ReferenceHolder };

export interface ReferenceImpact {
  moduleId: string;
  total: number;
  holders: Array<HeldReferences & { holder: string }>;
  /** Holders that could not answer; the preview says so instead of claiming nothing is affected. */
  unverifiable: Array<{ holder: string; reason: string }>;
}

const describeFailures = (failed: ContributionFailure[]) => failed.map((f) => ({ holder: f.moduleId, reason: f.reason }));

/** Every holder's references to `moduleId` in the tenant (data gate: holders run whatever their own state). */
export async function referencesTo(tenantId: string, moduleId: string): Promise<ReferenceImpact> {
  const { results, failed } = await ext.aggregate<ReferenceHolder, HeldReferences>(
    REFERENCE_HOLDER_POINT, tenantCtx(tenantId), moduleLifecycleReferenceHolderLoaders,
    (holder) => holder.listReferences(tenantId, moduleId),
    { validate: (v) => !!v && typeof v.count === 'number' && typeof v.label === 'string' },
  );
  const holders = results
    .filter((r) => r.value.count > 0)
    .map((r) => ({ holder: r.contribution.moduleId, ...r.value }));
  return { moduleId, total: holders.reduce((n, h) => n + h.count, 0), holders, unverifiable: describeFailures(failed) };
}

/** Sweep every holder's references to `moduleId` (purge step 1, docs/phases/37-extensions/08). */
export async function sweepReferencesTo(tenantId: string, moduleId: string): Promise<{ removed: number; failed: Array<{ holder: string; reason: string }> }> {
  let removed = 0;
  const { failed } = await ext.fanOut<ReferenceHolder>(
    REFERENCE_HOLDER_POINT, tenantCtx(tenantId), moduleLifecycleReferenceHolderLoaders,
    async (holder) => { removed += (await holder.sweep(tenantId, moduleId)).removed; },
    { sequential: true },
  );
  return { removed, failed: describeFailures(failed) };
}

/**
 * The orphan report: references in this tenant to modules that are not active (disabled, uninstalled, not in the
 * plan, blocked, banned). Same data as the impact preview, per module, for an admin page.
 */
export async function orphanReport(tenantId: string): Promise<Array<ReferenceImpact & { state: string; reason?: string }>> {
  const states = await resolveContributorStates(tenantId);
  const out: Array<ReferenceImpact & { state: string; reason?: string }> = [];
  for (const [moduleId, verdict] of states) {
    const impact = await referencesTo(tenantId, moduleId);
    if (impact.total > 0 || impact.unverifiable.length) out.push({ ...impact, state: verdict.state, ...(verdict.reason ? { reason: verdict.reason } : {}) });
  }
  return out.sort((a, b) => b.total - a.total);
}
