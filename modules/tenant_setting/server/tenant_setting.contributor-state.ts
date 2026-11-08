import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import type { ContributorStateSource } from '@kuraykaraaslan-labs/common/server/extensions/contributor-state';
import { getEnabledModuleIds, getModuleBans } from './module-activation.service.next';

/**
 * Tiers whose modules are platform domains other modules build on (AGENTS.md §10.0): notification channels, audit,
 * storage, branding, contacts, tasks … They are rarely switched on by name; they run because something active needs
 * them. Feature tiers (commerce, billing, erp, content, ai) are products a tenant opts into.
 */
export const PLATFORM_TIERS = new Set(['infrastructure', 'notifications', 'identity', 'tenancy', 'platform']);

/**
 * The modules that are effectively running for a tenant, for extension gating (docs/phases/37-extensions/02): the
 * enabled ones, plus every platform-tier module an enabled module requires, directly or not. Without the second
 * part, mail, SMS, push and in-app delivery, email branding and the other platform domains would count as "off" for
 * every tenant that never switched them on by name — while the modules that need them call into them all the same.
 */
export function effectivelyActive(enabled: ReadonlySet<string>): Set<string> {
  const out = new Set(enabled);
  for (const id of enabled) {
    for (const dep of moduleRegistry.getRequiresClosure(id)) {
      if (PLATFORM_TIERS.has(moduleRegistry.getModule(dep)?.tier ?? '')) out.add(dep);
    }
  }
  return out;
}

/**
 * `common:contributor_state` from the activation flags: a module that is not effectively active for the tenant is
 * `disabled`, or `banned` with the operator's reason when the platform ban list (module_lifecycle) is why it is off.
 * Finer reasons (uninstalled, not in the plan, blocked) come from the sources that know them; the resolver keeps the
 * most severe.
 */
const moduleActivationState: ContributorStateSource = {
  async states(tenantId) {
    const [enabled, bans] = await Promise.all([getEnabledModuleIds(tenantId), getModuleBans()]);
    const active = effectivelyActive(enabled);
    return moduleRegistry.getModules()
      .filter((m) => !active.has(m.id) || bans[m.id])
      .map((m) => (bans[m.id]
        ? { moduleId: m.id, state: 'banned' as const, reason: `disabled by the platform: ${bans[m.id]!.reason}`, since: bans[m.id]!.at }
        : { moduleId: m.id, state: 'disabled' as const, reason: 'turned off in this workspace' }));
  },
};

export default moduleActivationState;
