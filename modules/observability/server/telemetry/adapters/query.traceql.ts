/** Structured `TraceSearch` to TraceQL. Strings appear only as quoted literals; attribute keys are validated by the schema. */
import { FIELD_NAME, TENANT_ATTR, type TraceSearch } from '../telemetry.types';
import { quote } from './query.logql';

const fmtMs = (n: number): string => `${Number.isInteger(n) ? n : Number(n.toFixed(3))}ms`;

export function buildTraceQL(tenantId: string, q: TraceSearch): string {
  const conds = [`resource.${TENANT_ATTR} = ${quote(tenantId)}`];
  if (q.service) conds.push(`resource.service.name = ${quote(q.service)}`);
  if (q.name) conds.push(`name = ${quote(q.name)}`);
  if (q.status === 'error') conds.push('status = error');
  if (q.status === 'ok') conds.push('status != error');
  for (const a of q.attributes) {
    if (!FIELD_NAME.test(a.key)) throw new Error(`invalid attribute key: ${a.key}`);
    conds.push(`.${a.key} = ${quote(a.value)}`);
  }
  if (q.minDurationMs !== undefined) conds.push(`traceDuration >= ${fmtMs(q.minDurationMs)}`);
  if (q.maxDurationMs !== undefined) conds.push(`traceDuration <= ${fmtMs(q.maxDurationMs)}`);
  return `{ ${conds.join(' && ')} }`;
}
