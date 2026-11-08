import { firewallSignalLabelKey, type PlantedHoneytoken } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import Logger from '@kuraykaraaslan-labs/logger';
import { firewallRegistry } from './registry/ai_firewall.registry';
import type { RegisteredHoneytoken, RegistryVerdict } from './registry/ai_firewall.registry.validate';
import type { HoneytokenCatalogue, HoneytokenCatalogueEntry, HoneytokenState } from './ai_firewall.catalogue.types';

/**
 * The canary list (docs/phases/55-ai-firewall/02 §2.5): the decoys installed modules registered in `ai_firewall:honeytoken`, with each
 * one's reference and bait for the URL tenant, so its administrator can place the bait where only an intruder would find it. This list is
 * the only place a decoy is ever shown: the owning modules keep them out of every list, count, export and listing a customer reads.
 *
 * The registry is process-wide (a system context); what is the tenant's is each decoy's value, which its module derives (`plant`, which
 * changes nothing for the derived decoys of 02.5). A module that cannot answer, or does not answer within `PLANT_TIMEOUT_MS`, is shown as
 * `failed` and never fails the list. Nothing here acts or writes.
 */

export const PLANT_TIMEOUT_MS = 2_000;

/** Lengths the list shows at most (a module's answer is data). */
const REF_MAX = 128;
const BAIT_MAX = 2_048;
const WHERE_MAX = 128;

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** The detector signal kinds of every registered decoy: a touch of one is a high-precision label (03 reads this set). */
export function honeytokenDetectorKinds(verdict: RegistryVerdict): Set<string> {
  return new Set([...verdict.catalog.honeytokens.values()].map((h) => h.detector.signalKind));
}

async function entryOf(h: RegisteredHoneytoken, tenantId: string, verdict: RegistryVerdict): Promise<HoneytokenCatalogueEntry> {
  let state: HoneytokenState = 'passive';
  let planted: PlantedHoneytoken | null = null;
  if (typeof h.plant === 'function') {
    try {
      planted = await within(Promise.resolve(h.plant(tenantId)), PLANT_TIMEOUT_MS);
      state = planted && typeof planted.ref === 'string' ? 'planted' : 'not_planted';
    } catch (error) {
      state = 'failed';
      Logger.warn(`[ai_firewall] decoy ${h.id} could not be planted for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const signal = verdict.catalog.signals.get(h.detector.signalKind);
  return {
    id: h.id,
    moduleId: h.moduleId,
    kind: h.kind,
    labelKey: h.labelKey,
    descriptionKey: h.descriptionKey ?? null,
    signalKind: h.detector.signalKind,
    signalLabelKey: signal ? firewallSignalLabelKey(signal.moduleId, signal.kind, signal.labelKey) : h.detector.signalKind,
    state,
    ref: state === 'planted' ? text(planted?.ref, REF_MAX) : null,
    bait: state === 'planted' ? text(planted?.bait, BAIT_MAX) : null,
    where: state === 'planted' ? text(planted?.where, WHERE_MAX) : null,
  };
}

export default class AiFirewallHoneytokenService {
  /** Every registered decoy with its state, reference and bait for the tenant, sorted by id. */
  static async decoys(tenantId: string): Promise<HoneytokenCatalogue> {
    const verdict = await firewallRegistry();
    const decoys = await Promise.all([...verdict.catalog.honeytokens.values()].map((h) => entryOf(h, tenantId, verdict)));
    return {
      registry: { ok: verdict.ok, problems: verdict.problems.length },
      decoys: decoys.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
  }
}
