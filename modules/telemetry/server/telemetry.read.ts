import { ensureTelemetryKindsLoaded, telemetryKindOf, type TelemetryEntityKind, type TelemetryReadContext } from './telemetry.kinds';

/**
 * The read gate every user-facing path applies (docs/phases/42-telemetry/00 §0.4): the kind must be registered and its `canRead`
 * must admit the entity. An unknown kind and a refused entity answer the same way (`null`), so a caller cannot tell "exists for
 * another tenant" from "does not exist".
 */
export async function readableKind(ctx: TelemetryReadContext, kind: string, entityId: string): Promise<TelemetryEntityKind | null> {
  let k = telemetryKindOf(kind);
  if (!k) {
    await ensureTelemetryKindsLoaded();
    k = telemetryKindOf(kind);
  }
  if (!k) return null;
  const ok = await k.canRead(ctx, [entityId]);
  return ok.has(entityId) ? k : null;
}

/** What a caller may see of a kind's declaration (the catalogue of `GET /api/telemetry/kinds` and the dashboard picker). */
export function describeKind(k: TelemetryEntityKind): {
  kind: string; label: string; lane: string; keys: 'declared' | 'open'; declaredKeys?: Array<{ key: string; type: string; unit?: string; label?: string }>;
  retention: { fixedClass: number } | { plan: true }; exposeToDashboards: boolean; acceptsExternalWrites: boolean;
} {
  return {
    kind: k.kind,
    label: k.label,
    lane: k.lane ?? 'default',
    keys: k.keys.mode,
    ...(k.keys.mode === 'declared' ? { declaredKeys: k.keys.keys.map((x) => ({ key: x.key, type: x.type, unit: x.unit, label: x.label })) } : {}),
    retention: 'fixedClass' in k.retention ? { fixedClass: k.retention.fixedClass } : { plan: true },
    exposeToDashboards: k.exposeToDashboards === true,
    acceptsExternalWrites: k.acceptsExternalWrites === true,
  };
}
