import Logger from '@kuraykaraaslan-labs/logger';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { featureGateEntitlementChangedLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/feature_gate.entitlement_changed';

/**
 * "This tenant's entitlements just changed."
 *
 * The gate already had the moment: every write that changes what a tenant is entitled to drops the tenant's feature
 * cache after it commits, because a cached answer would otherwise outlive the change. Announcing it from that same
 * call gives a module that keeps state DERIVED from an entitlement a way to react without importing the rail that
 * changed it. The first listener is tenant_domain: a plan that stops including custom domains suspends them, and a plan
 * that includes them again brings them back (its 6-hourly reconcile stays as the safety net).
 *
 * Detached on purpose. The announcing write has committed; making it wait for listeners would put their latency (and
 * their failures) on a billing call that already succeeded. A failing listener is logged and counted by the runtime.
 */

/** Extension point id, declared in feature_gate/module.json `extensionPoints`. */
export const FEATURE_GATE_CHANGED_POINT = 'feature_gate:entitlement_changed';

/** What a `feature_gate:entitlement_changed` contribution default-exports. Must be idempotent. */
export interface EntitlementChangeListener {
  entitlementChanged(tenantId: string): Promise<void> | void;
}

/** Tell every listener; never throws, never waits for them. */
export async function announceEntitlementChange(tenantId: string): Promise<void> {
  try {
    await ext.fanOut<EntitlementChangeListener>(
      FEATURE_GATE_CHANGED_POINT, tenantCtx(tenantId), featureGateEntitlementChangedLoaders,
      (listener) => listener.entitlementChanged(tenantId),
      { detached: true },
    );
  } catch (err) {
    Logger.warn(`[feature_gate] could not announce an entitlement change for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
