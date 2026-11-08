/**
 * The tenant of an ingested record is the tenant of the verified key, nothing else. Any attribute a client sends that names a tenant
 * is REMOVED and the real tenant is written in its place (`nb.tenant_id`, plus `tenant.id` so a client that set it sees its value
 * overwritten, not merely dropped). Adapters strip these keys again on write; this is the first of the two layers.
 */
import { TENANT_ATTR, type Attributes, type LogRecord, type MetricPoint, type SpanRecord } from './telemetry.types';

/** `tenant.id`, `tenant_id`, `TenantId`, `nb-tenant-id`, `tenant` and every variant that differs only by case and `._-`. */
export function isTenantKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[._\-\s]/g, '');
  return k === 'tenantid' || k === 'tenant' || k === 'nbtenantid' || k === 'tenantuuid' || k === 'orgid' || k === 'scopeorgid' || k === 'xscopeorgid';
}

function clean(attrs: Attributes): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) if (!isTenantKey(k)) out[k] = v;
  return out;
}

export function stampResource(resource: Attributes, tenantId: string): Attributes {
  return { ...clean(resource), [TENANT_ATTR]: tenantId, 'tenant.id': tenantId };
}

export const stampSpan = (s: SpanRecord, tenantId: string): SpanRecord => ({
  ...s, attributes: clean(s.attributes), resource: stampResource(s.resource, tenantId),
  events: s.events.map((e) => ({ ...e, attributes: clean(e.attributes) })),
});
export const stampLog = (r: LogRecord, tenantId: string): LogRecord => ({ ...r, attributes: clean(r.attributes), resource: stampResource(r.resource, tenantId) });
export const stampMetric = (p: MetricPoint, tenantId: string): MetricPoint => ({ ...p, attributes: clean(p.attributes), resource: stampResource(p.resource, tenantId) });
