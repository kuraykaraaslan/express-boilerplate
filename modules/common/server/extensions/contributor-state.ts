// Which contributing modules may run for a tenant, and why the others may not (docs/phases/37-extensions/02).
//
// `common` cannot ask the modules that know — tenant_setting (enabled), module_lifecycle (installed, banned),
// billing (entitled) — because they all import `common`. So the answer is itself an extension point:
// `common:contributor_state`. Each source lists the modules it has an objection to; a module no source lists
// is active. The resolver merges the lists by severity and hands every host the same verdict and reason.

import { extensionRegistry } from '../extension-registry';
import { commonContributorStateLoaders } from '../generated/extensions/common.contributor_state';

export const CONTRIBUTOR_STATE_POINT = 'common:contributor_state';

/** README §Model 1. Every state but `active` stops behaviour; only a purge (`missing`) ends the data gate. */
export type ContributorState =
  | 'active' | 'disabled' | 'uninstalled' | 'unentitled' | 'blocked' | 'retired' | 'banned' | 'quarantined' | 'missing';

/** Most severe first: when two sources disagree, the earlier state wins (README §Model 1). */
export const STATE_PRECEDENCE: readonly ContributorState[] = [
  'missing', 'banned', 'retired', 'blocked', 'unentitled', 'uninstalled', 'disabled', 'quarantined', 'active',
];

export interface StateVerdict {
  moduleId: string;
  state: Exclude<ContributorState, 'active'>;
  /** Shown to admins as is ("blocked by the platform operator: …"). */
  reason?: string;
  /** ISO time the state began, when the source knows it. */
  since?: string;
}

/** What a `common:contributor_state` contribution default-exports. */
export interface ContributorStateSource {
  /** The modules this source objects to for the tenant. Modules it does not list are not its concern. */
  states(tenantId: string): Promise<StateVerdict[]>;
}

const severity = (s: ContributorState) => STATE_PRECEDENCE.indexOf(s);

/** Merge the lists of several sources: per module, the most severe state wins. */
export function mergeVerdicts(lists: readonly StateVerdict[][]): Map<string, StateVerdict> {
  const out = new Map<string, StateVerdict>();
  for (const list of lists) {
    for (const v of list) {
      const prev = out.get(v.moduleId);
      if (!prev || severity(v.state) < severity(prev.state)) out.set(v.moduleId, v);
    }
  }
  return out;
}

// Per process: a 1 s memo collapses the bursts of one request (a page reads several points), and the last good
// answer per source survives a source that starts failing. Cross-process staleness is bounded by the memo plus
// each source's own cache (tenant_setting: Redis, deleted on write).
const MEMO_MS = 1000;
const memo = new Map<string, { at: number; value: Map<string, StateVerdict> }>();
const lastGood = new Map<string, StateVerdict[]>(); // `${tenantId}|${contributionId}` -> list

/** Drop the memo (tests, and writers in this process that just changed a state). */
export function invalidateContributorStates(tenantId?: string): void {
  if (tenantId) memo.delete(tenantId); else memo.clear();
}

/**
 * The non-active modules for a tenant. A source that fails falls back to its last good answer; with none, it is
 * skipped and logged. That degrades to "more contributors run", deliberately: an unreadable state is our failure,
 * and turning it into "nothing is installed" would silently stop every tenant's mail, hooks and providers while
 * every layer reported success (the reasoning mail_inbound already documented for its sinks).
 */
export async function resolveContributorStates(tenantId: string): Promise<Map<string, StateVerdict>> {
  const hit = memo.get(tenantId);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  const sources = extensionRegistry.getContributions(CONTRIBUTOR_STATE_POINT);
  const lists = await Promise.all(sources.map(async (ext) => {
    const key = `${tenantId}|${ext.id}`;
    try {
      const source = await extensionRegistry.load<ContributorStateSource>(ext, commonContributorStateLoaders);
      const list = await source.states(tenantId);
      lastGood.set(key, list);
      return list;
    } catch (error) {
      const fallback = lastGood.get(key);
      const { loadLogger } = await import('./ext');
      const Logger = await loadLogger();
      Logger.error(`[extensions] contributor state source '${ext.id}' failed for tenant ${tenantId}; ${fallback ? 'using its last good answer' : 'ignoring it'}: ${error instanceof Error ? error.message : String(error)}`);
      return fallback ?? [];
    }
  }));
  const value = mergeVerdicts(lists);
  memo.set(tenantId, { at: Date.now(), value });
  return value;
}

/** One module's verdict for a tenant (`active` when no source objects). */
export async function contributorState(tenantId: string, moduleId: string): Promise<StateVerdict | { moduleId: string; state: 'active' }> {
  return (await resolveContributorStates(tenantId)).get(moduleId) ?? { moduleId, state: 'active' };
}
