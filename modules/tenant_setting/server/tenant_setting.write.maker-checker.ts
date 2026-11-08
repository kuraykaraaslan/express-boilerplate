import { Setting } from './tenant_setting.types';

// ── Maker-checker: deferred setting writes, reviewed through tenant_setting:change_review (the approval queue) ─────

/** Approval-queue entityType that parked setting changes are submitted under (the approval module's reviewer uses it). */
export const SETTING_CHANGE_ENTITY_TYPE = 'tenant_setting_change';

/**
 * Per-tenant toggle: when its value is `'true'`, admin-initiated setting writes
 * are routed through the shared approval queue (maker-checker) instead of being
 * applied immediately. Default (unset / anything else) = off.
 */
export const MAKER_CHECKER_SETTING = 'tenantSettingMakerChecker';

/**
 * Every key is gated (tenant_setting.02). The toggle key and the approval subsystem's config (`approval*`) used to be
 * exempt, so the maker switched the gate off (`tenantSettingMakerChecker=false`) or stretched the approval SLAs with no
 * review. Gating them does not deadlock: the reviewer applies an approved change through the low-level write, and with no
 * reviewer at all the OWNER may still switch the gate off on its own (updateManyGated).
 *
 * The IP allow/deny lists are gated too (a second reviewer on the tenant's network
 * policy): the self-lockout guard runs once for the maker on submit and again
 * for the approver on approval (`assertSettingChangeApprovable`,
 * tenant_setting.change-decision.ts), so the list lands only if it keeps the
 * person who approved it.
 */
export function isMakerCheckerGateable(_key: string): boolean {
  return true;
}

export interface PendingSettingChange {
  key: string;
  /** The review item's id (the approval queue item that holds the change). */
  approvalItemId: string;
}

export interface GatedUpdateResult {
  /** Keys written immediately (gate off, or excluded bootstrap keys). */
  applied: Setting[];
  /** Keys parked in the approval queue awaiting a maker-checker decision. */
  pending: PendingSettingChange[];
}


/**
 * Settings that are PROJECTIONS of a ledger another module owns, and therefore must never be
 * written through the generic settings API:
 *  - `module.<id>.enabled` — the hot-path gate `getEnabledModuleIds` reads. Writing it directly
 *    skips the entitlement check, the install ledger and the install/enable hooks (and could
 *    switch a protected module off).
 *  - `platform.module_bans` (ROOT) — the operator's module kill switch; only module_lifecycle's ban service writes it.
 *  - `hr_payroll_tr.statutoryRulesReviewed` (ROOT) — the operator's record of the OD-33 legal review that lets the
 *    Turkish statutory payroll maths finalize payslips; only hr_payroll_tr's GLOBAL review route writes it.
 *  - `plugin.community.<listingId>.{version,active,channel,pinned,grant}` — what the plugin broker runs (and the version pin and the four-eyes install grant that sit beside it), and `plugin.archive.<listingId>` — the undo-uninstall record the daily sweep purges data by.
 *    Writing `channel=test` would put a workspace on the unreviewed test build without being a
 *    tester; `version`/`active` would run a plugin that was never installed or paid for.
 *  - `plugin.local.<pluginId>.*` (`version`, `active`) — the projection of an operator-installed local plugin (plugin_local,
 *    OD-139); a tenant writing it would run a sandboxed bundle the operator never installed for it. And the ROOT
 *    trust settings `pluginLocalTrustedKeys` / `pluginLocalRequireSigned` / `pluginLocalMaxLimits`, written only by
 *    plugin_local's ROOT route, which validates the keys and audits the change.
 * Their writers are `module_lifecycle`, the marketplace's install service and plugin_local's services, which call the
 * low-level `updateMany` directly and are unaffected by this guard.
 *
 * For the same reason they are never INHERITED from the root tenant (see the read service): they
 * record what THIS tenant installed, so the platform operator's own install is not every
 * tenant's default. Inheriting them used to switch a module ROOT enabled on for every tenant
 * without a row of its own — no entitlement check, no ledger row, no hooks.
 */
const LEDGER_PROJECTION_KEY = /^(module\.[^.]+\.enabled|platform\.module_bans|hr_payroll_tr\.statutoryRulesReviewed|plugin\.community\.[^.]+\.(version|active|channel|pinned|grant)|plugin\.archive\.[^.]+|plugin\.local\..+|pluginLocal(TrustedKeys|RequireSigned|MaxLimits))$/;

export function isLedgerProjectionKey(key: string): boolean {
  return LEDGER_PROJECTION_KEY.test(key);
}

/**
 * A sandboxed plugin's per-tenant config: `plugin:<pluginId>:<key>` (settings) and `plugin_secret:<pluginId>:<key>`
 * (encrypted secrets), for marketplace and operator-installed local plugins alike. Only the plugin config services
 * (`plugin_runtime/server/config/plugin-config.service`) write them, because those check an egress endpoint setting's
 * value and clear the plugin's secrets when the endpoint changes; the plugin itself writes its non-endpoint settings
 * through the broker. The generic settings API refuses them: writing an endpoint setting there would skip both checks
 * and send the plugin's secrets to any host.
 */
const PLUGIN_CONFIG_KEY = /^plugin(_secret)?:/;

export function isPluginConfigKey(key: string): boolean {
  return PLUGIN_CONFIG_KEY.test(key);
}
