/**
 * Structured `LogQuery` to LogQL. The ONLY place tenant-supplied strings meet LogQL syntax, and they meet it in exactly two
 * shapes: a double-quoted string literal (`quote`) and a regex literal (`regexLiteral`, RE2-escaped first, then quoted).
 * Field names are validated against `labelName` before use. The tenant matcher is built first and is never optional.
 */
import { TENANT_LABEL, SEVERITIES, type LogQuery } from '../telemetry.types';

/** A string literal in LogQL / PromQL (Go-style escapes): JSON escaping is a valid subset (`\"`, `\\`, `\n`, `\uXXXX`). */
export function quote(value: string): string {
  return JSON.stringify(value);
}

/** Escapes RE2 metacharacters so the value matches literally. */
export function regexEscape(value: string): string {
  return value.replace(/[\\.+*?()|[\]{}^$]/g, '\\$&');
}

export function regexLiteral(value: string, mode: 'contains' | 'prefix'): string {
  const body = regexEscape(value);
  return quote(mode === 'contains' ? `(?s).*${body}.*` : `(?s)${body}.*`);
}

/** `http.route` to `http_route`; anything that is still not a legal label name is refused. */
export function labelName(field: string): string {
  const name = field.replace(/\./g, '_');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`invalid label name: ${field}`);
  return name;
}

export function buildLogQL(tenantId: string, q: LogQuery): string {
  const matchers = [`${TENANT_LABEL}=${quote(tenantId)}`];
  if (q.service) matchers.push(`service_name=${quote(q.service)}`);
  if (q.severityMin) {
    const levels = SEVERITIES.slice(SEVERITIES.indexOf(q.severityMin));
    matchers.push(`severity=~${quote(levels.join('|'))}`);
  }
  const stages: string[] = [];
  for (const t of q.text) stages.push(`|= ${quote(t)}`);
  if (q.traceId) stages.push(`| trace_id=${quote(q.traceId)}`);
  for (const f of q.filters) {
    const l = labelName(f.field);
    if (f.op === 'eq') stages.push(`| ${l}=${quote(f.value)}`);
    else if (f.op === 'neq') stages.push(`| ${l}!=${quote(f.value)}`);
    else stages.push(`| ${l}=~${regexLiteral(f.value, f.op)}`);
  }
  return `{${matchers.join(', ')}}${stages.length ? ` ${stages.join(' ')}` : ''}`;
}
