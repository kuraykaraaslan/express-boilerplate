/**
 * Live tail of logs (phase 18.2), as a PORT operation: `TelemetryBackend.tailLogs(tenant, filter, cursor, opts)`. One poll step returns the
 * lines that arrived since the cursor; a caller (the websocket namespace) keeps calling it with the cursor it got back.
 *
 * Every adapter implements it with `pollLogTail` over its own `queryLogs`, so a tail behaves the same on the memory backend and on Loki:
 * same cursor, same de-duplication, same batch cap, same drop accounting. Loki also has a native `/loki/api/v1/tail`, but that is a
 * WebSocket the adapter would have to hold open per tenant; polling `query_range` is the same answer with no long-lived connection to a
 * backend whose server this repository has never run (see the README, "Live tail").
 *
 * Semantics (the tests pin each):
 *  - The first call (`cursor` null) starts at "now": it returns nothing and a cursor whose floor is now. The page already has the query
 *    result; a tail shows what happens after it. No backlog is replayed, and a line stamped before the start is never shown by the tail.
 *  - A poll reads the window `[max(watermark - overlap, floor), now]` and drops what the cursor says was delivered. The overlap tolerates a line
 *    whose own timestamp is a little older than the moment it reached the store (a client with a slow clock, a batching exporter).
 *    A line later than the overlap is not shown by the tail (it is by a search).
 *  - A batch never holds more than `maxBatch` lines. When more are new, the NEWEST are delivered and the rest are counted in `dropped`
 *    (a tail that falls behind should show the present, not a growing past). `dropped` is what the UI shows as "N lines skipped".
 *  - A read that hits its limit lost the older lines of the window; the cursor's `floorMs` makes sure the next poll never goes back for
 *    them (a tail replaying the past out of order is worse than one that skipped it, and `dropped` / `truncated` say it happened).
 *  - `seen` is bounded (`maxSeen`): the cursor cannot grow with the volume. Past the bound the oldest fingerprints are forgotten, which
 *    can at worst repeat a line, never lose one.
 */
import { isTenantKey } from './telemetry.tenant';
import type { LogQuery, LogQueryResult, LogRecord, LogTailBatch, LogTailCursor, LogTailQuery } from './telemetry.types';
import { LogQuerySchema, LogTailQuerySchema } from './telemetry.types';
import { nsToMs } from './telemetry.util';

export interface TailOptions {
  /** Most lines one poll hands back (default 100, hard ceiling 500). */
  maxBatch?: number;
  /** How far before the watermark a poll looks again (default 2 s). */
  overlapMs?: number;
  /** Fingerprints a cursor remembers (default 1500). */
  maxSeen?: number;
  now?: () => number;
}

export const TAIL_DEFAULTS = { maxBatch: 100, overlapMs: 2000, maxSeen: 1500 } as const;
export const TAIL_MAX_BATCH = 500;

/** A short stable fingerprint of one line: its exact timestamp plus a hash of everything that can tell two lines at one instant apart. */
export function lineFingerprint(r: LogRecord): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } h ^= 0xff; };
  feed(r.body);
  feed(r.severity);
  feed(r.traceId ?? '');
  feed(String(r.resource['service.name'] ?? ''));
  for (const k of Object.keys(r.attributes).sort()) { feed(k); feed(String(r.attributes[k])); }
  return `${r.timeNs}:${h.toString(36)}`;
}

type QueryLogs = (q: LogQuery) => Promise<LogQueryResult>;

export async function pollLogTail(queryLogs: QueryLogs, filter: LogTailQuery, cursor: LogTailCursor | null, opts: TailOptions = {}): Promise<LogTailBatch> {
  const now = (opts.now ?? Date.now)();
  const maxBatch = Math.min(Math.max(1, Math.floor(opts.maxBatch ?? TAIL_DEFAULTS.maxBatch)), TAIL_MAX_BATCH);
  const overlapMs = opts.overlapMs ?? TAIL_DEFAULTS.overlapMs;
  const maxSeen = opts.maxSeen ?? TAIL_DEFAULTS.maxSeen;

  if (!cursor) return { records: [], cursor: { watermarkMs: now, seen: [], floorMs: now }, dropped: 0, truncated: false };

  const fromMs = Math.max(0, cursor.watermarkMs - overlapMs, cursor.floorMs);
  const toMs = Math.max(fromMs + 1, now + 1);
  const seen = new Set(cursor.seen);
  // Newest first, so a backend that cannot return everything loses the oldest lines of the window, not the present.
  const limit = Math.min(1000, maxBatch + seen.size + 1);
  const q = LogQuerySchema.parse({ ...filter, range: { fromMs, toMs }, limit, direction: 'newest' });
  const res = await queryLogs(q);

  const fresh = res.records.filter((r) => !seen.has(lineFingerprint(r)));
  const kept = fresh.slice(0, maxBatch);
  const dropped = fresh.length - kept.length;
  const delivered = kept.slice().reverse(); // oldest first for display

  // The next poll starts at `now - overlap`: remember every line of this window that it will read again.
  const nextFrom = Math.max(0, now - overlapMs);
  const remember = [...cursor.seen, ...res.records.map(lineFingerprint)];
  const nextSeen = [...new Set(remember)].filter((fp) => nsToMs(fp.split(':')[0] ?? '0') >= nextFrom);
  // A read that hit its limit lost the older lines of the window for good: never go back for them (that would replay the past out of order).
  const oldestRead = res.records.reduce((m, r) => Math.min(m, nsToMs(r.timeNs)), Infinity);
  const floorMs = res.truncated && Number.isFinite(oldestRead) ? Math.max(cursor.floorMs, Math.floor(oldestRead)) : cursor.floorMs;
  return {
    records: delivered,
    cursor: { watermarkMs: now, seen: nextSeen.slice(-maxSeen), floorMs },
    dropped,
    truncated: res.truncated,
  };
}

export type TailFilterResult = { ok: true; filter: LogTailQuery } | { ok: false; message: string };

/**
 * The filter a client sends with `tail:start`: the REST log query's own schema minus its window, row count and order, strict (an unknown
 * key, `tenantId` included, is a refusal, never ignored), and with the REST API's rule that a filter may not aim at a tenant-like field.
 * The message names the first problem and never echoes the value.
 */
export function parseTailFilter(raw: unknown): TailFilterResult {
  const parsed = LogTailQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue ? `${issue.path.join('.') || 'filter'}: ${issue.message}` : 'invalid filter' };
  }
  if (parsed.data.filters.some((f) => isTenantKey(f.field))) return { ok: false, message: 'That field name is reserved' };
  return { ok: true, filter: parsed.data };
}
