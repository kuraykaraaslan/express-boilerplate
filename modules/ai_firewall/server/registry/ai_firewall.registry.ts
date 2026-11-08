import type { ExtensionPointLoaders } from '@kuraykaraaslan-labs/common/server/extension-registry';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { aiFirewallActionLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/ai_firewall.action';
import { aiFirewallAnalystLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/ai_firewall.analyst';
import { aiFirewallHoneytokenLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/ai_firewall.honeytoken';
import { aiFirewallSignalLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/ai_firewall.signal';
import {
  ACTION_POINT,
  ANALYST_POINT,
  HONEYTOKEN_POINT,
  SIGNAL_POINT,
  describeRegistryProblems,
  validateFirewallRegistries,
  type FirewallPoint,
  type LoadedContribution,
  type RegistryInput,
  type RegistryVerdict,
} from './ai_firewall.registry.validate';

/**
 * The firewall's four registries, loaded once per process (docs/phases/55-ai-firewall/01 §1.5).
 *
 * The catalogs are process-wide, never a tenant's: they are read in a SYSTEM context, so a contributor switched off for a tenant still
 * has its kinds in the catalogue (whether its actions may run for that tenant is the responder's question, 05). The contributions are
 * loaded through the generated maps, by the boot guard (`assertFirewallRegistries`, the `common:boot_task` guard
 * `ai-firewall-registries`) and on first use after it; the catalog points are `lazyContributors`, never loaded while a module evaluates.
 *
 * The verdict is kept on `globalThis` (the instrumentation hook and the route bundles each load this file). A refused registry stops the
 * boot; outside a boot (a test, a script) `firewallRegistry()` still answers, with the problems and the catalogue of what passed.
 */

const CTX = systemCtx('ai_firewall registries: the process-wide signal, action, honeytoken and analyst catalogues');

const POINT_LOADERS: ReadonlyArray<readonly [FirewallPoint, ExtensionPointLoaders]> = [
  [SIGNAL_POINT, aiFirewallSignalLoaders],
  [ACTION_POINT, aiFirewallActionLoaders],
  [HONEYTOKEN_POINT, aiFirewallHoneytokenLoaders],
  [ANALYST_POINT, aiFirewallAnalystLoaders],
];

const STATE_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.registry');
const holder = globalThis as unknown as Record<symbol, Promise<RegistryVerdict> | undefined>;

const idsOf = (metadata: Record<string, unknown>): string[] | null =>
  Array.isArray(metadata.ids) && metadata.ids.every((v) => typeof v === 'string') ? (metadata.ids as string[]) : null;

/** Every installed contribution of one point, in registry order: loaded, or listed as failed. Never throws. */
async function loadPoint(point: FirewallPoint, loaders: ExtensionPointLoaders): Promise<Pick<RegistryInput, 'failed'> & { loaded: LoadedContribution[] }> {
  const failed: RegistryInput['failed'][number][] = [];
  const loadedOut: LoadedContribution[] = [];
  try {
    const order = (await ext.states(point, CTX)).map((s) => s.contribution);
    const { loaded, failed: notLoaded } = await ext.loadAll<unknown>(point, CTX, loaders);
    const implOf = new Map(loaded.map((l) => [l.contribution.id, l.impl]));
    const failureOf = new Map(notLoaded.map((f) => [f.contributionId, f.message]));
    for (const c of order) {
      if (implOf.has(c.id)) loadedOut.push({ contributionId: c.id, moduleId: c.moduleId, ids: idsOf(c.metadata ?? {}), impl: implOf.get(c.id) });
      else failed.push({ point, contributionId: c.id, message: failureOf.get(c.id) ?? 'not loaded by the host runtime (paused?)' });
    }
  } catch (error) {
    failed.push({ point, contributionId: `${point} (all)`, message: error instanceof Error ? error.message : String(error) });
  }
  return { loaded: loadedOut, failed };
}

/** Loads the four points and checks them (no cache). */
export async function loadFirewallRegistries(): Promise<RegistryVerdict> {
  const [signals, actions, honeytokens, analysts] = await Promise.all(POINT_LOADERS.map(([point, loaders]) => loadPoint(point, loaders)));
  return validateFirewallRegistries({
    signals: signals.loaded,
    actions: actions.loaded,
    honeytokens: honeytokens.loaded,
    analysts: analysts.loaded,
    failed: [...signals.failed, ...actions.failed, ...honeytokens.failed, ...analysts.failed],
  });
}

/** The process's verdict, loaded on first use and then kept. */
export function firewallRegistry(): Promise<RegistryVerdict> {
  holder[STATE_KEY] ??= loadFirewallRegistries().catch((error: unknown) => {
    holder[STATE_KEY] = undefined;
    throw error;
  });
  return holder[STATE_KEY]!;
}

/**
 * The boot guard (`common:boot_task`, phase `guard`): loads the registries afresh and refuses the boot on any problem, naming the
 * contribution, the identity and the rule. Resolves with a one-line count when every registry passed.
 */
export async function assertFirewallRegistries(): Promise<string> {
  const verdict = await loadFirewallRegistries();
  holder[STATE_KEY] = Promise.resolve(verdict);
  if (!verdict.ok) throw new Error(describeRegistryProblems(verdict.problems));
  const c = verdict.catalog;
  return `ai_firewall registries: ${c.signals.size} signal kinds, ${c.actions.size} actions, ${c.honeytokens.size} decoys, ${c.analyst ? 'one analyst' : 'no analyst'}`;
}

/** Test seam: forget the process's verdict. */
export function resetFirewallRegistry(): void {
  holder[STATE_KEY] = undefined;
}
