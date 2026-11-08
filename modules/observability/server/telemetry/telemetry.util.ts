/** Small pure helpers shared by the adapters, the ingest path and the query service. No I/O. */
import { SEVERITIES, TENANT_ATTR, TENANT_LABEL, type Attributes, type AttrValue, type HistogramValue, type SeverityText } from './telemetry.types';

/** Epoch nanoseconds (decimal string) to epoch milliseconds. Fractional milliseconds are kept to 3 decimals. */
export function nsToMs(ns: string): number {
  if (!/^\d+$/.test(ns)) return 0;
  // Split to stay exact: epoch ns exceed 2^53.
  const whole = ns.length > 6 ? ns.slice(0, -6) : '0';
  const frac = ns.length > 6 ? ns.slice(-6) : ns.padStart(6, '0');
  return Number(whole) + Number(frac) / 1e6;
}

export function msToNs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0';
  let whole = Math.floor(ms);
  let frac = Math.round((ms - whole) * 1e6);
  if (frac >= 1e6) { whole += 1; frac = 0; }
  return `${whole}${String(frac).padStart(6, '0')}`.replace(/^0+(?=\d)/, '');
}

export function durationMs(startNs: string, endNs: string): number {
  return Math.max(0, nsToMs(endNs) - nsToMs(startNs));
}

export function severityRank(s: SeverityText): number {
  return SEVERITIES.indexOf(s);
}

/** OTLP severity number (1..24) to the six levels this port stores. */
export function severityFromNumber(n: number | undefined, text?: string): SeverityText {
  if (typeof text === 'string') {
    const t = text.toUpperCase();
    if (t.startsWith('WARN')) return 'WARN';
    if (t.startsWith('ERR')) return 'ERROR';
    if (t.startsWith('FATAL') || t.startsWith('CRIT')) return 'FATAL';
    if (t.startsWith('DEBUG')) return 'DEBUG';
    if (t.startsWith('TRACE')) return 'TRACE';
    if (t.startsWith('INFO')) return 'INFO';
  }
  if (!n || n < 1) return 'INFO';
  if (n <= 4) return 'TRACE';
  if (n <= 8) return 'DEBUG';
  if (n <= 12) return 'INFO';
  if (n <= 16) return 'WARN';
  if (n <= 20) return 'ERROR';
  return 'FATAL';
}

export function severityToNumber(s: SeverityText): number {
  return { TRACE: 1, DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 }[s];
}

/** An attribute of a record: the signal's own attributes win over the resource's. */
export function attrOf(attributes: Attributes, resource: Attributes, key: string): AttrValue | undefined {
  return key in attributes ? attributes[key] : resource[key];
}

export function serviceOf(resource: Attributes): string {
  const v = resource['service.name'];
  return typeof v === 'string' && v ? v : 'unknown_service';
}

/** The record's attributes without anything that names a tenant (the adapter stamps the real one). */
export function stripTenant(attrs: Attributes): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) if (k !== TENANT_ATTR && k !== TENANT_LABEL) out[k] = v;
  return out;
}

export function matchText(haystack: string, op: 'eq' | 'neq' | 'contains' | 'prefix', needle: string): boolean {
  switch (op) {
    case 'eq': return haystack === needle;
    case 'neq': return haystack !== needle;
    case 'contains': return haystack.includes(needle);
    case 'prefix': return haystack.startsWith(needle);
  }
}

/** Quantile `q` (0..1) of a merged explicit-bucket histogram, by linear interpolation inside the bucket. */
export function histogramQuantile(q: number, h: HistogramValue): number | null {
  const total = h.counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const rank = q * total;
  let cum = 0;
  for (let i = 0; i < h.counts.length; i++) {
    const c = h.counts[i]!;
    if (cum + c >= rank) {
      const lower = i === 0 ? 0 : h.bounds[i - 1]!;
      const upper = i < h.bounds.length ? h.bounds[i]! : (h.bounds[h.bounds.length - 1] ?? lower);
      if (c === 0) return lower;
      return lower + ((rank - cum) / c) * (upper - lower);
    }
    cum += c;
  }
  return h.bounds[h.bounds.length - 1] ?? null;
}

export function mergeHistograms(list: HistogramValue[]): HistogramValue | null {
  const first = list[0];
  if (!first) return null;
  const merged: HistogramValue = { count: 0, sum: 0, bounds: first.bounds, counts: new Array(first.counts.length).fill(0) };
  for (const h of list) {
    if (h.bounds.length !== first.bounds.length) continue;
    merged.count += h.count;
    merged.sum += h.sum;
    h.counts.forEach((c, i) => { merged.counts[i] = (merged.counts[i] ?? 0) + c; });
  }
  return merged;
}

export function stringifyAttrs(attrs: Attributes): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
}

/** Trace id / span id as 32 / 16 lowercase hex, or `undefined` when it is not (all-zero ids are invalid in OTel). */
export function normalizeId(id: unknown, hexLen: 16 | 32): string | undefined {
  if (typeof id !== 'string') return undefined;
  const low = id.toLowerCase();
  if (low.length !== hexLen || !/^[0-9a-f]+$/.test(low) || /^0+$/.test(low)) return undefined;
  return low;
}
