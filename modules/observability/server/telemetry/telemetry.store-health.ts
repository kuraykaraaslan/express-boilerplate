import Logger from '@kuraykaraaslan-labs/logger';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { AlertSignal } from '../alert.ingest.parsers';
import { RUNBOOKS } from '../observability.runbooks';
import { CompositeBackend } from './adapters/composite.adapter';
import { getTelemetryBackend } from './telemetry.config';
import type { Signal } from './telemetry.types';

/**
 * The platform watches the telemetry store it offers (ADR-0009, phase 17.6): once a minute, on the ROOT tenant's alert pass, each configured store is asked
 * whether it is ready (the adapters' own `health()`: Loki and Tempo `/ready`, Prometheus `/-/ready`). A store that does not answer opens an alert with the
 * `telemetry-store-full` runbook; the recovery resolves it. Complements the `observability:probe-target` monitors of `telemetry.probe-targets.ts`, which can
 * only reach stores with a public name: this check runs inside the platform's network, so it covers the private stores of the default compose profile.
 *
 * Not configured (`TELEMETRY_BACKEND` not `reference`) means nothing is checked and nothing fires. A check that cannot run (an error other than the store
 * saying it is not ready) is not an outage: state is `unknown`, never `down` (the standing rule for Redis or backend loss).
 */
const TITLE: Record<Signal, string> = { logs: 'Loki (logs)', traces: 'Tempo (traces)', metrics: 'Prometheus (metrics)' };
/** The store's name by the adapter that serves the signal; the reference set's names when the adapter is not known. */
const titleOf = (signal: Signal, id?: string): string => (id === 'telemetry' ? 'the Core telemetry store (metrics)' : TITLE[signal]);

export function storeAlertSignal(signal: Signal, status: 'FIRING' | 'RESOLVED', detail?: string, id?: string): AlertSignal {
  const title = `Telemetry store ${titleOf(signal, id)} is not ready`;
  return {
    source: 'process', sourceRef: `telemetry-store-${signal}`, status, severity: 'MAJOR', title,
    fingerprint: `telemetry-store:${signal}`,
    labels: { alertname: 'TelemetryStoreDown', signal, entity: `telemetry:${signal}` },
    annotations: { summary: title, ...(detail ? { reason: detail.slice(0, 300) } : {}), runbook: RUNBOOKS.telemetryStore },
  };
}

export interface StoreHealthDeps {
  read(): Promise<Partial<Record<Signal, { ok: boolean; detail?: string; id?: string }>>>;
  ingest(signal: AlertSignal): Promise<unknown>;
}

const firing = new Set<Signal>();
export function resetStoreHealthState(): void { firing.clear(); }

export async function evaluateStores(deps: StoreHealthDeps): Promise<{ checked: Signal[]; firing: Signal[] }> {
  const health = await deps.read();
  const checked = Object.keys(health) as Signal[];
  for (const signal of checked) {
    const h = health[signal]!;
    if (!h.ok) { firing.add(signal); await deps.ingest(storeAlertSignal(signal, 'FIRING', h.detail, h.id)); }
    else if (firing.delete(signal)) await deps.ingest(storeAlertSignal(signal, 'RESOLVED', undefined, h.id));
  }
  return { checked, firing: [...firing] };
}

/** The minutely pass: ROOT only, best-effort. */
export async function evaluateStoresNow(tenantId: string): Promise<void> {
  if (tenantId !== ROOT_TENANT_ID) return;
  const backend = getTelemetryBackend();
  if (!(backend instanceof CompositeBackend)) return; // off, memory (dev) or a single adapter: nothing to watch
  const { default: AlertService } = await import('../alert.service');
  try {
    await evaluateStores({ read: () => backend.healthBySignal(), ingest: (s) => AlertService.ingest(ROOT_TENANT_ID, s) });
  } catch (err) {
    Logger.warn(`[telemetry.store-health] check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
