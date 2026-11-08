import {
  FIREWALL_ACTION_TTL_CAP_MS,
  FIREWALL_RUNGS,
  firewallActionLabelKeys,
  firewallSignalLabelKey,
  type FirewallMode,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';
import { firewallRegistry } from './registry/ai_firewall.registry';
import type { RegisteredAction, RegistryVerdict } from './registry/ai_firewall.registry.validate';
import { aiFirewallModeKey } from './ai_firewall.setting.keys';
import { effectiveActionMode, getFirewallActionPolicy, sanitizeActionMode, type FirewallActionPolicy } from './ai_firewall.settings-policy';
import type { ActionModeUpdateInput } from './ai_firewall.catalogue.dto';
import type {
  ActionCatalogue,
  ActionCatalogueEntry,
  ActionModeChange,
  ModeEditable,
  RegistryStateView,
  SignalCatalogue,
  SignalCatalogueEntry,
} from './ai_firewall.catalogue.types';

/**
 * The catalogue pages' reads and the one write (docs/phases/55-ai-firewall/01 §1.8).
 *
 * The catalogues are the registries the process loaded (`firewallRegistry()`, process-wide, a system context): the same for every
 * tenant, so a contributor switched off for a tenant still shows its kinds (whether its actions may run there is the responder's
 * question, 05). What is the tenant's is its policy: the kill switches, the default mode and its own mode per action
 * (`aiFirewallMode:<actionId>`, ai_firewall.settings-policy.ts). The write is the only way to set a mode (the generic settings API refuses
 * the family: tenant_setting.key-policy.ts ROUTE_ONLY_SETTING_PREFIXES), so every mode in the store names a registered action, fits
 * where the action can run, and an Auto was confirmed.
 *
 * Placement (phase 46): ai_firewall is a core module, so the page and its routes serve every tenant at TENANT scope. A customer tenant
 * chooses the modes of the actions that run inside it; the root tenant chooses the platform's (a run with `tenantId` null reads ROOT's
 * settings), holds the platform's kill switch (Settings -> AI firewall, root only) and sees the platform's caps.
 */

export const AUDIT_ACTION_MODE_CHANGED = 'ai_firewall.action_mode_changed';

async function settingService() {
  return (await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')).default;
}

async function auditService() {
  return (await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')).default;
}

const registryState = (verdict: RegistryVerdict): RegistryStateView => ({ ok: verdict.ok, problems: verdict.problems.length });

const RUNG_ORDER = new Map<string, number>(FIREWALL_RUNGS.map((r, i) => [r, i]));

/** Whether a tenant may choose the action's mode: a platform action is ROOT's, a tenant action is never the platform's. */
export function modeEditable(scope: RegisteredAction['scope'], platform: boolean): ModeEditable {
  if (scope === 'platform' && !platform) return 'platform_only';
  if (scope === 'tenant' && platform) return 'tenant_only';
  return 'yes';
}

export function signalEntries(verdict: RegistryVerdict): SignalCatalogueEntry[] {
  const out: SignalCatalogueEntry[] = [];
  for (const s of verdict.catalog.signals.values()) {
    const attrs = Object.entries(s.attrs).map(([name, a]) => ({ name, type: a.type, pd: a.pd })).sort((a, b) => (a.name < b.name ? -1 : 1));
    out.push({
      kind: s.kind,
      moduleId: s.moduleId,
      labelKey: firewallSignalLabelKey(s.moduleId, s.kind, s.labelKey),
      lanes: [...s.lanes],
      actorKinds: [...s.actorKinds],
      outcomes: s.outcomes ? [...s.outcomes] : null,
      severity: s.severity,
      defaultWeight: s.defaultWeight,
      attrs,
      personalData: attrs.some((a) => a.pd !== 'none'),
    });
  }
  return out.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

export function actionEntries(verdict: RegistryVerdict, policy: FirewallActionPolicy, platform: boolean): ActionCatalogueEntry[] {
  const out: ActionCatalogueEntry[] = [];
  for (const a of verdict.catalog.actions.values()) {
    const editable = modeEditable(a.scope, platform);
    const keys = firewallActionLabelKeys(a.moduleId, a.id);
    out.push({
      id: a.id,
      moduleId: a.moduleId,
      labelKey: keys.label,
      descriptionKey: keys.description,
      rung: a.rung,
      rungOrder: RUNG_ORDER.get(a.rung) ?? FIREWALL_RUNGS.length,
      lanes: [...a.lanes],
      actorKinds: [...a.actorKinds],
      ttl: { defaultMs: a.ttl.defaultMs, maxMs: a.ttl.maxMs },
      minimumMode: a.minimumMode,
      hourlyBudget: a.hourlyBudget,
      evidence: { boundToActor: a.evidence.boundToActor, minSignals: a.evidence.minSignals, kinds: a.evidence.kinds?.length ? [...a.evidence.kinds] : null },
      reversible: a.reversible !== false,
      scope: a.scope ?? null,
      chosen: editable === 'yes' ? policy.modes[a.id] ?? null : null,
      effective: editable === 'yes' ? effectiveActionMode(policy, a) : null,
      editable,
    });
  }
  return out.sort((a, b) => a.rungOrder - b.rungOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const refuse = (status: number, code: ErrorCode, reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new AppError(message, status, code, { details: { reason, ...extra } });

export default class AiFirewallCatalogueService {
  /** The signal kinds every module registered, with their attributes' personal-data classes. Never a tenant's data. */
  static async signals(): Promise<SignalCatalogue> {
    const verdict = await firewallRegistry();
    return { registry: registryState(verdict), signals: signalEntries(verdict) };
  }

  /** The registered actions with the URL tenant's mode for each (one policy read: the platform switch from ROOT, the rest the tenant's). */
  static async actions(tenantId: string): Promise<ActionCatalogue> {
    const verdict = await firewallRegistry();
    const platform = isRootTenant(tenantId);
    const policy = await getFirewallActionPolicy(tenantId, [...verdict.catalog.actions.keys()]);
    return {
      registry: registryState(verdict),
      policy: { killed: policy.killed, defaultMode: policy.defaultMode },
      platform,
      ttlCapMs: FIREWALL_ACTION_TTL_CAP_MS,
      actions: actionEntries(verdict, policy, platform),
    };
  }

  /**
   * Sets (or, with `mode: null`, clears) the tenant's mode for one registered action. Refused: an id nobody registered (404); an action
   * the tenant cannot choose (409: a platform action outside the root tenant, a tenant action on it); Auto for an action whose run cannot
   * be undone (409, `reversible: false`, FWA-4, D55-9) or whose `minimumMode` is Suggest (409: it would still ask a person every time, and the page must not pretend otherwise); Auto without
   * `confirmAuto` (400). Writing what is stored already changes nothing and audits nothing. The setting write records its own history and
   * `setting.*` audit row; this one adds `ai_firewall.action_mode_changed` with the old and new mode (high severity for a switch to Auto),
   * best-effort after the write.
   */
  static async setMode(tenantId: string, input: ActionModeUpdateInput, actorId: string | null): Promise<ActionModeChange> {
    const verdict = await firewallRegistry();
    const action = verdict.catalog.actions.get(input.actionId);
    if (!action) throw refuse(404, ErrorCode.NOT_FOUND, 'AI_FIREWALL_UNKNOWN_ACTION', 'No such firewall action is registered.');
    const editable = modeEditable(action.scope, isRootTenant(tenantId));
    if (editable === 'platform_only') {
      throw refuse(409, ErrorCode.CONFLICT, 'AI_FIREWALL_PLATFORM_ACTION', 'This action runs only for the whole platform; its mode is set on the root tenant.');
    }
    if (editable === 'tenant_only') {
      throw refuse(409, ErrorCode.CONFLICT, 'AI_FIREWALL_TENANT_ACTION', 'This action runs only inside a workspace; the platform has no mode for it.');
    }
    const mode: FirewallMode | null = input.mode;
    // FWA-4, D55-9: a run nobody can undo is never automatic (boot refuses such an action unless it is Suggest-only; this holds anyway).
    if (mode === 'auto' && action.reversible === false) {
      throw refuse(409, ErrorCode.CONFLICT, 'AI_FIREWALL_AUTO_IRREVERSIBLE', 'What this action does cannot be undone, so a person approves every run; it cannot be switched to Auto.');
    }
    if (mode === 'auto' && action.minimumMode === 'suggest') {
      throw refuse(409, ErrorCode.CONFLICT, 'AI_FIREWALL_AUTO_NOT_ALLOWED', 'A person approves every run of this action; it cannot be switched to Auto.');
    }
    if (mode === 'auto' && input.confirmAuto !== true) {
      throw refuse(400, ErrorCode.VALIDATION_ERROR, 'AI_FIREWALL_AUTO_NOT_CONFIRMED', 'Confirm the switch to Auto.');
    }

    const key = aiFirewallModeKey(action.id);
    const svc = await settingService();
    const stored = ((await svc.getByKeys(tenantId, [key])) ?? {}) as Record<string, string | null>;
    const previous = sanitizeActionMode(stored[key]);
    let changed = false;
    if (previous !== mode || (mode === null && stored[key] != null)) {
      const options = actorId ? { actorId } : undefined;
      if (mode === null) await svc.delete(tenantId, key, options);
      else await svc.updateMany(tenantId, { [key]: mode }, options);
      changed = true;
      await auditModeChange(tenantId, actorId, action.id, previous, mode);
    }

    const policy = await getFirewallActionPolicy(tenantId, [action.id]);
    return { actionId: action.id, chosen: policy.killed === 'unreadable' ? mode : policy.modes[action.id] ?? null, effective: effectiveActionMode(policy, action), changed };
  }
}

async function auditModeChange(tenantId: string, actorId: string | null, actionId: string, from: FirewallMode | null, to: FirewallMode | null): Promise<void> {
  try {
    await (await auditService()).log({
      tenantId,
      actorId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      action: AUDIT_ACTION_MODE_CHANGED,
      severity: to === 'auto' ? 'high' : 'medium',
      resourceType: 'ai_firewall_action',
      resourceId: actionId,
      metadata: { actionId, from: from ?? 'default', to: to ?? 'default' },
    } as never);
  } catch (error) {
    // The mode is written; a lost audit row is logged, never a failed request (the setting's own history and audit row still hold).
    Logger.warn(`[ai_firewall] mode change audit failed tenant=${tenantId} action=${actionId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
