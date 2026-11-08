/**
 * Service map and per-service RED figures derived from spans (phase 18.3). Pure: spans in, graph out.
 *
 * An edge A -> B exists when a span of service B has a parent span of service A in the same trace. A client or producer span
 * that names a peer (`peer.service`, `db.system`, `messaging.system`, `server.address`) and has no child in another service becomes
 * an edge to that external node. Both figures are computed from whatever spans were loaded: a SAMPLE of recent traces, not the
 * population. Exact request rates come from metrics.
 */
import type { SpanRecord } from './telemetry.types';
import { durationMs, serviceOf } from './telemetry.util';

export interface ServiceNode {
  service: string;
  kind: 'service' | 'external';
  spans: number;
  errors: number;
}

export interface ServiceEdge {
  from: string;
  to: string;
  calls: number;
  errors: number;
  p95Ms: number;
}

export interface ServiceMap {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
}

export interface ServiceRed {
  service: string;
  requests: number;
  errors: number;
  errorRate: number;
  ratePerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return Math.round(sorted[i]! * 1000) / 1000;
}

function externalName(s: SpanRecord): string | null {
  const a = (k: string) => (typeof s.attributes[k] === 'string' ? (s.attributes[k] as string) : null);
  const peer = a('peer.service');
  if (peer) return peer;
  const db = a('db.system') ?? a('db.system.name');
  if (db) return `db:${db}`;
  const mq = a('messaging.system');
  if (mq) return `mq:${mq}`;
  const host = a('server.address') ?? a('net.peer.name') ?? a('http.host');
  return host;
}

const isErr = (s: SpanRecord) => s.status === 'ERROR';

export function deriveServiceMap(spans: SpanRecord[]): ServiceMap {
  const byKey = new Map<string, SpanRecord>();
  for (const s of spans) byKey.set(`${s.traceId}/${s.spanId}`, s);
  const hasForeignChild = new Set<string>();
  const nodes = new Map<string, ServiceNode>();
  const edges = new Map<string, { from: string; to: string; calls: number; errors: number; durs: number[] }>();

  const node = (service: string, kind: ServiceNode['kind']) => {
    let n = nodes.get(service);
    if (!n) { n = { service, kind, spans: 0, errors: 0 }; nodes.set(service, n); }
    return n;
  };
  const edge = (from: string, to: string, err: boolean, dur: number) => {
    const k = `${from}\u0000${to}`;
    let e = edges.get(k);
    if (!e) { e = { from, to, calls: 0, errors: 0, durs: [] }; edges.set(k, e); }
    e.calls++; if (err) e.errors++; e.durs.push(dur);
  };

  for (const s of spans) {
    const svc = serviceOf(s.resource);
    const n = node(svc, 'service');
    n.spans++; if (isErr(s)) n.errors++;
    const parent = s.parentSpanId ? byKey.get(`${s.traceId}/${s.parentSpanId}`) : undefined;
    if (parent) {
      const from = serviceOf(parent.resource);
      if (from !== svc) { edge(from, svc, isErr(s), durationMs(s.startNs, s.endNs)); hasForeignChild.add(`${parent.traceId}/${parent.spanId}`); }
    }
  }
  for (const s of spans) {
    if ((s.kind !== 'CLIENT' && s.kind !== 'PRODUCER') || hasForeignChild.has(`${s.traceId}/${s.spanId}`)) continue;
    const ext = externalName(s);
    if (!ext || ext === serviceOf(s.resource)) continue;
    node(ext, 'external').spans++;
    if (isErr(s)) node(ext, 'external').errors++;
    edge(serviceOf(s.resource), ext, isErr(s), durationMs(s.startNs, s.endNs));
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.service.localeCompare(b.service)),
    edges: [...edges.values()].map((e) => ({ from: e.from, to: e.to, calls: e.calls, errors: e.errors, p95Ms: percentile([...e.durs].sort((a, b) => a - b), 0.95) }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}

/** Rate, errors and duration per service from its entry spans (SERVER and CONSUMER kinds). */
export function deriveRed(spans: SpanRecord[], rangeMs: number): ServiceRed[] {
  const by = new Map<string, { durs: number[]; errors: number }>();
  for (const s of spans) {
    if (s.kind !== 'SERVER' && s.kind !== 'CONSUMER') continue;
    const svc = serviceOf(s.resource);
    let r = by.get(svc);
    if (!r) { r = { durs: [], errors: 0 }; by.set(svc, r); }
    r.durs.push(durationMs(s.startNs, s.endNs));
    if (isErr(s)) r.errors++;
  }
  const seconds = Math.max(1, rangeMs / 1000);
  return [...by.entries()].map(([service, r]) => {
    const sorted = [...r.durs].sort((a, b) => a - b);
    return {
      service, requests: sorted.length, errors: r.errors, errorRate: sorted.length ? Math.round((r.errors / sorted.length) * 10_000) / 10_000 : 0,
      ratePerSecond: Math.round((sorted.length / seconds) * 10_000) / 10_000, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), p99Ms: percentile(sorted, 0.99),
    };
  }).sort((a, b) => a.service.localeCompare(b.service));
}

export interface SpanTreeNode {
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  kind: string;
  status: string;
  statusMessage?: string;
  startMs: number;
  durationMs: number;
  /** Offset from the trace start, for indenting and bars. */
  offsetMs: number;
  attributes: Record<string, string | number | boolean>;
  children: SpanTreeNode[];
}

/** Spans as a nested tree. Orphans (a parent that was not stored or was sampled out) become roots; a cycle in bad data cannot loop. */
export function buildSpanTree(spans: SpanRecord[], maxDepth = 64): SpanTreeNode[] {
  if (!spans.length) return [];
  const start = Math.min(...spans.map((s) => Number(BigInt(s.startNs) / BigInt(1000)) / 1000));
  const make = (s: SpanRecord): SpanTreeNode => {
    const startMs = Number(BigInt(s.startNs) / BigInt(1000)) / 1000;
    return {
      spanId: s.spanId, ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, service: serviceOf(s.resource), kind: s.kind, status: s.status,
      ...(s.statusMessage ? { statusMessage: s.statusMessage } : {}), startMs, durationMs: durationMs(s.startNs, s.endNs), offsetMs: Math.max(0, Math.round((startMs - start) * 1000) / 1000),
      attributes: s.attributes, children: [],
    };
  };
  const nodes = new Map(spans.map((s) => [s.spanId, make(s)]));
  const roots: SpanTreeNode[] = [];
  const depthOf = (n: SpanTreeNode): number => {
    let d = 0; let cur: SpanTreeNode | undefined = n; const seen = new Set<string>();
    while (cur?.parentSpanId && nodes.has(cur.parentSpanId) && !seen.has(cur.spanId)) { seen.add(cur.spanId); cur = nodes.get(cur.parentSpanId); d++; }
    return d;
  };
  for (const n of nodes.values()) {
    const parent = n.parentSpanId ? nodes.get(n.parentSpanId) : undefined;
    if (parent && parent !== n && depthOf(n) <= maxDepth && depthOf(parent) < depthOf(n)) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (list: SpanTreeNode[]) => { list.sort((a, b) => a.startMs - b.startMs); list.forEach((c) => sort(c.children)); };
  sort(roots);
  return roots;
}
