/**
 * Attribute comparison for one workspace (phase 18.6): the flag, the bounded sample of spans, and the call into the pure scorer.
 *
 * It is OFF by default and per workspace (`observabilityTelemetryAttributeComparison`), because it reads many spans for one answer and its
 * suggestions are only as good as the sample: a person turns it on on purpose. Everything it reads goes through the same port, the same caps
 * and the same tenant argument as the explorer; the attribute bags it builds never carry a tenant-like key.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { CompareInputSchema, CompareSettingsInputSchema } from './telemetry.dto';
import { compareAttributes, COMPARE_LIMITS, type AttributeBag, type ComparisonResult } from './telemetry.compare';
import { assertRange, sampleSpans, type QueryDeps } from './telemetry.query.service';
import { TELEMETRY_SETTING_KEYS } from './telemetry.setting.keys';
import { isTenantKey } from './telemetry.tenant';
import type { SpanRecord } from './telemetry.types';
import { durationMs, serviceOf } from './telemetry.util';

export async function isCompareEnabled(tenantId: string): Promise<boolean> {
  try { return (await SettingService.getValue(tenantId, TELEMETRY_SETTING_KEYS.ATTRIBUTE_COMPARISON)) === 'true'; } catch { return false; }
}

export async function setCompareEnabled(tenantId: string, actorId: string | undefined, input: unknown): Promise<{ enabled: boolean }> {
  const { enabled } = CompareSettingsInputSchema.parse(input);
  await SettingService.create(tenantId, TELEMETRY_SETTING_KEYS.ATTRIBUTE_COMPARISON, enabled ? 'true' : 'false', 'observability', 'boolean', actorId ? { actorId } : undefined);
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
  await AuditLogService.log({ tenantId, ...(actorId ? { actorId } : {}), actorType: 'USER', action: 'observability.telemetry.compare_set', resourceType: 'telemetry', resourceId: tenantId, metadata: { enabled } }).catch(() => {});
  return { enabled };
}

/** A span's attributes as one flat bag: its own, its resource's, and its name; tenant-like keys never enter. */
export function spanBag(s: SpanRecord): AttributeBag {
  const bag: AttributeBag = {};
  for (const [k, v] of Object.entries({ ...s.resource, ...s.attributes })) if (!isTenantKey(k)) bag[k] = v;
  bag['span.name'] = s.name;
  return bag;
}

export interface CompareDeps extends QueryDeps {
  enabled: (tenantId: string) => Promise<boolean>;
}

export interface CompareAnswer extends ComparisonResult {
  mode: { failing: 'error' | 'slow'; slowerThanMs?: number };
  sample: { traces: number; spans: number; requestSpans: number; truncated: boolean };
}

export async function compare(deps: CompareDeps, tenantId: string, input: unknown): Promise<CompareAnswer> {
  const q = CompareInputSchema.parse(input);
  if (!(await deps.enabled(tenantId))) throw new AppError('Attribute comparison is off for this workspace', 409, ErrorCode.FEATURE_NOT_AVAILABLE, { details: { reason: 'attribute_comparison_off' } });
  const caps = await deps.limits().queryCaps(tenantId);
  assertRange(q.range, caps);
  await deps.limits().admitQuery(tenantId);
  const sampleCaps = { ...caps, maxSpans: Math.min(caps.maxSpans, COMPARE_LIMITS.maxItemsPerGroup * 2) };
  const { spans, traces, truncated } = await sampleSpans(deps, tenantId, q.range, q.traceLimit, sampleCaps);
  // Requests: the spans a service answers (SERVER) or consumes. Client and internal spans are one request seen from inside, not another request.
  const requests = spans.filter((s) => (s.kind === 'SERVER' || s.kind === 'CONSUMER')
    && (!q.service || serviceOf(s.resource) === q.service) && (!q.name || s.name === q.name));
  const isFailing = (s: SpanRecord) => (q.failing === 'slow' ? durationMs(s.startNs, s.endNs) >= q.slowerThanMs! : s.status === 'ERROR');
  const answer = compareAttributes(requests.filter(isFailing).map(spanBag), requests.filter((s) => !isFailing(s)).map(spanBag));
  return { ...answer, mode: { failing: q.failing, ...(q.slowerThanMs !== undefined ? { slowerThanMs: q.slowerThanMs } : {}) }, sample: { traces, spans: spans.length, requestSpans: requests.length, truncated } };
}
