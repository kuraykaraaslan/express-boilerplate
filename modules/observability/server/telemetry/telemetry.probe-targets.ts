import { isIP } from 'node:net';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { isAddressAllowed } from '@kuraykaraaslan-labs/common/server/ip-guard';
import type { ProbeTargetProvider, ProbeTargetSpec } from '../uptime.probe-target.types';
import { telemetryEnv } from './telemetry.env';

/**
 * `observability:probe-target`: the platform monitors the telemetry store it offers (ADR-0009, phase 17.6). The three stores' readiness endpoints become
 * managed HTTP monitors of the ROOT tenant, owned by this provider (`sourceKey` `observability:telemetry-store-<signal>`); their alerts carry the
 * `telemetry-store-full` runbook (`alert.monitor-source.ts`). ROOT only: the stores hold every tenant's telemetry and are platform infrastructure.
 *
 * What a probe may reach is the control plane's strict rule: public addresses only (`uptime.probe.net.ts`). A store on the Compose network
 * (`http://telemetry-loki:3100`) is private by design and is NOT turned into a monitor here, because the probe would refuse it every minute and
 * the "outage" would be the guard. Those stores are watched from inside by `telemetry.store-health.ts` (the same runbook, the same alert pipeline),
 * which asks the adapters themselves; a store reachable on a public name (a managed Loki, a Grafana Cloud endpoint) gets a monitor as well, so it
 * is seen from outside the platform too. To probe a private store from its own network, run a private probe runner there (phase 10) and
 * assign the location to the monitors this provider creates.
 */
const READY_PATH = { logs: '/ready', traces: '/ready', metrics: '/-/ready' } as const;
const LABEL = { logs: 'Loki (logs)', traces: 'Tempo (traces)', metrics: 'Prometheus (metrics)' } as const;

/** True when a monitor's probe may connect to this URL: an https or http URL whose host is a public IP literal or a dotted public-looking name. */
export function probeReachable(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) return isAddressAllowed(host, null, 'only');
  if (!host.includes('.')) return false; // a bare name is a Compose or cluster name
  return !/\.(internal|local|localhost|lan|home|corp|intranet|svc|cluster\.local)$/.test(host);
}

export function targetsFromEnv(e: Record<string, string | undefined>): ProbeTargetSpec[] {
  if ((e.TELEMETRY_BACKEND ?? 'off') !== 'reference') return [];
  const urls: Array<['logs' | 'traces' | 'metrics', string | undefined]> = [['logs', e.TELEMETRY_LOKI_URL], ['traces', e.TELEMETRY_TEMPO_URL], ['metrics', e.TELEMETRY_PROMETHEUS_URL]];
  const out: ProbeTargetSpec[] = [];
  for (const [signal, base] of urls) {
    if (!base || !probeReachable(base)) continue;
    out.push({
      key: `telemetry-store-${signal}`, name: `Telemetry store: ${LABEL[signal]}`, type: 'HTTP',
      target: `${base.replace(/\/+$/, '')}${READY_PATH[signal]}`, intervalSeconds: 60, timeoutMs: 8000, expectedStatus: 200,
    });
  }
  return out;
}

const provider: ProbeTargetProvider = {
  async listTargets(tenantId) {
    if (tenantId !== ROOT_TENANT_ID) return [];
    return targetsFromEnv(telemetryEnv());
  },
};

export default provider;
