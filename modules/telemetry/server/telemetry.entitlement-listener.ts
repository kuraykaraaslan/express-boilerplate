import type { EntitlementChangeListener } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.entitlement-changed';
import type { SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { ClassBindingResolver } from './telemetry.class-binding';
import { classOfKind, ensureTelemetryKindsLoaded, registeredTelemetryKinds, type TelemetryEntityKind } from './telemetry.kinds';

/**
 * `feature_gate:entitlement_changed` contribution (docs/phases/42-telemetry/02 §2.8): a tenant's plan just changed, so every kind
 * whose class follows the plan (`resolveClass`) is asked again; a class that differs from the tenant's current binding closes
 * that binding and opens the next (reads cover both, by validity). A kind with a fixed class is never touched. Idempotent; the
 * nightly reconcile of the plan-driven kinds stays the safety net for a missed announcement.
 */
export interface ClassSwitchDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  classes?: ClassBindingResolver;
  kinds?: () => TelemetryEntityKind[];
}

export async function reconcileClassBindings(d: ClassSwitchDeps, tenantId: string): Promise<Array<{ kind: string; from: number | null; to: number }>> {
  const resolver = d.classes ?? new ClassBindingResolver();
  const switched: Array<{ kind: string; from: number | null; to: number }> = [];
  for (const k of (d.kinds ?? registeredTelemetryKinds)()) {
    if ('fixedClass' in k.retention) continue;
    const want = await classOfKind(k, tenantId);
    const r = await d.inTenant(tenantId, (db) => resolver.switchTo(db, tenantId, k.kind, want));
    if (r.changed) switched.push({ kind: k.kind, from: r.from, to: want });
  }
  return switched;
}

const listener: EntitlementChangeListener = {
  async entitlementChanged(tenantId) {
    await ensureTelemetryKindsLoaded();
    const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db/server/db.context');
    await reconcileClassBindings({ inTenant: (t, fn) => withTenantTransactionFor(t, (qr) => fn(qr)) }, tenantId);
  },
};

export default listener;
