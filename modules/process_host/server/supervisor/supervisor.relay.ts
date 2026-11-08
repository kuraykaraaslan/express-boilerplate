import { randomBytes } from 'node:crypto';
import Logger from '@kuraykaraaslan-labs/logger';
import redis from '@kuraykaraaslan-labs/redis/server/redis.service';
import { announceNode, procNodeIndex, procNodeKey, registerKind, type HealthReport, type ProcessNodeInfo } from '../process-registry';
import {
  redisSupervisorPublisher, supEventsKey, supSignalKey, type SupervisorPublisher, type SupervisorRedis,
} from './supervisor.publisher';
import type { SignalSample, SupervisorEvent, SupervisorStateV1 } from './supervisor.types';

/**
 * The relay that puts the credential-less **local** supervisors (the script host, the plugin host: no Redis on purpose) into
 * the Scaling view (07 task 7 open point, closed here). A process that holds Redis polls a local supervisor's
 * `GET /supervisor` (`{ state, events, signal, health, port, version }`, see `supervisor.local.ts`) every 5 s and writes
 * what the Redis-backed supervisor would have written itself:
 *
 * - `proc:sup:<kind>:<nodeId>` (the state, TTL 15 s) and a `proc:nodes:<kind>` heartbeat with the supervisor's own `nodeId`
 *   and `info.role = 'supervisor'` (`info.relayedBy`), so the observability reader finds it from the registry as usual;
 * - the decisions and the signal samples that are not in `proc:sup:events:*` / `proc:sup:signal:*` yet (newer than the
 *   list's head), oldest first, so the lists read exactly as if the supervisor had pushed them.
 *
 * The keys are the supervisor's (its `nodeId` is in the JSON), so two relays reaching the same supervisor write the same
 * keys; a short `SET NX` per tick (`proc:sup:relay:<kind>:<nodeId>`) lets one of them push the list items, so none is
 * pushed twice. A supervisor that does not answer (supervision off, the container down) is skipped: its state key and
 * registry row expire within 15 s, so the view never shows a group that is not running.
 *
 * Wired in the worker (`scripts/worker.ts`, `runProcessKind({ perNode })`: the supervisor, or the single process; never a
 * child): it relays the script host it already announces (`AUTOMATION_SCRIPT_HOST_URL`, supervisor on
 * `AUTOMATION_SCRIPT_HOST_SUPERVISOR_PORT`, 4015) and the plugin host of its node (`PLUGIN_HOST_URL`, `PLUGIN_HOST_SUPERVISOR_PORT`,
 * 4501).
 *
 * The relay crosses into credential-less containers that run untrusted code, so it hands them nothing and believes
 * little: no bearer unless the target has its own (`RelayTarget.secret`, never the worker's `METRICS_SECRET`), a body
 * capped at `RELAY_MAX_BODY_BYTES`, and a `nodeId` that must look like one (`NODE_ID_RE`) before it names a Redis key.
 */

export const RELAY_INTERVAL_MS = 5_000;
export const RELAY_TIMEOUT_MS = 1_500;
/** The largest `/supervisor` answer read (an hour of signal samples and decisions is well under 100 KB). */
export const RELAY_MAX_BODY_BYTES = 512 * 1024;
/** A supervisor's node id: `randomBytes(4).toString('hex')` (supervisor.local.ts). Anything else is not relayed. */
export const NODE_ID_RE = /^[0-9a-f]{8}$/;
export const supRelayLockKey = (kind: string, nodeId: string): string => `proc:sup:relay:${kind}:${nodeId}`;

/** What a local supervisor's `GET /supervisor` answers. */
export interface LocalSupervisorSnapshot {
  state: SupervisorStateV1 | null;
  /** Newest first. */
  events: SupervisorEvent[];
  /** Newest first. */
  signal: SignalSample[];
  health?: HealthReport;
  port?: number;
  version?: string;
}

export interface RelayTarget {
  /** The supervised kind (`script-host`, `plugin-host`). */
  kind: string;
  /** The supervisor's base URL (`http://plugin-host:4501`). */
  url: string;
  /**
   * A bearer for this target's `/supervisor` only: the token that local supervisor was given (`PROC_SUPERVISOR_TOKEN`).
   * None by default: the local hosts run without one, and the worker's own `METRICS_SECRET` must never reach them.
   */
  secret?: string;
}

export interface RelayRedis extends SupervisorRedis {
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
}

export interface SupervisorRelayOptions {
  targets: RelayTarget[];
  intervalMs?: number;
  /** Who relays, shown as `info.relayedBy` (default `worker`). */
  relayedBy?: string;
  // seams (tests)
  fetchImpl?: typeof fetch;
  client?: RelayRedis;
  publisher?: SupervisorPublisher;
  announce?: (kind: string, node: ProcessNodeInfo) => Promise<void>;
  now?: () => number;
}

/**
 * The supervisor URL of a kind whose service URL a process already holds: the same host, the supervisor's port
 * (`portOverride`, else `defaultPort`). Null without a service URL.
 */
export function supervisorTarget(kind: string, serviceUrl: string | undefined, defaultPort: number, portOverride?: string, secret?: string): RelayTarget | null {
  if (!serviceUrl) return null;
  try {
    const u = new URL(serviceUrl);
    const port = Number(portOverride);
    u.port = String(Number.isInteger(port) && port > 0 ? port : defaultPort);
    u.pathname = '';
    u.search = '';
    return { kind, url: u.toString().replace(/\/$/, ''), ...(secret && { secret }) };
  } catch {
    return null;
  }
}

const tsOf = (raw: string | undefined): number | null => {
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { ts?: unknown }).ts;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
};

/** The items of `newestFirst` that are not in the Redis list yet (whose head is `head`), oldest first. */
export function itemsToPush<T extends { ts: number }>(newestFirst: readonly T[], head: string | undefined): T[] {
  if (head !== undefined) {
    const at = newestFirst.findIndex((x) => JSON.stringify(x) === head);
    if (at >= 0) return newestFirst.slice(0, at).reverse();
  }
  const headTs = tsOf(head);
  return newestFirst.filter((x) => headTs === null || x.ts > headTs).reverse();
}

/** Reads a response body as JSON, refusing one larger than `maxBytes` (declared or actual). */
export async function readCappedJson(res: Response, maxBytes = RELAY_MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`body of ${declared} bytes is over ${maxBytes}`);
  if (!res.body) return JSON.parse(await res.text());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`body over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export interface Relay {
  /** One poll of every target; resolves to the number of supervisors relayed. */
  tick(): Promise<number>;
  /** Polls every `intervalMs` from now on. */
  start(): void;
  stop(): void;
}

export function createSupervisorRelay(o: SupervisorRelayOptions): Relay {
  const client = o.client ?? (redis as unknown as RelayRedis);
  const publisher = o.publisher ?? redisSupervisorPublisher(client);
  const fetchImpl = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const intervalMs = o.intervalMs ?? RELAY_INTERVAL_MS;
  const me = randomBytes(4).toString('hex');
  const announce = o.announce ?? (async (kind: string, node: ProcessNodeInfo) => {
    await registerKind(kind);
    await announceNode(procNodeIndex(kind), procNodeKey(kind, node.nodeId), node.nodeId, node);
  });
  const warned = new Set<string>();

  const relayOne = async (t: RelayTarget): Promise<boolean> => {
    let snap: LocalSupervisorSnapshot;
    try {
      const res = await fetchImpl(`${t.url}/supervisor`, {
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        ...(t.secret && { headers: { authorization: `Bearer ${t.secret}` } }),
      });
      if (!res.ok) return false;
      snap = (await readCappedJson(res)) as LocalSupervisorSnapshot;
    } catch {
      return false;
    }
    if (!snap || typeof snap !== 'object') return false;
    const state = snap.state;
    // the node id names Redis keys: only the shape a supervisor generates
    if (!state || state.v !== 1 || state.kind !== t.kind || typeof state.nodeId !== 'string' || !NODE_ID_RE.test(state.nodeId)) return false;
    try {
      await publisher.state(state);
      await announce(t.kind, {
        v: 1, kind: t.kind, nodeId: state.nodeId, version: snap.version ?? '', port: snap.port ?? Number(new URL(t.url).port),
        startedAt: state.startedAt, lastBeatAt: now(), health: snap.health ?? { status: 'ok' },
        info: { role: 'supervisor', children: state.children.length, max: state.budget.max, status: state.status, relayedBy: o.relayedBy ?? 'worker', url: t.url },
      });
      // one relay per tick pushes the list items (two relays of one supervisor would otherwise push them twice)
      const won = await client.set(supRelayLockKey(t.kind, state.nodeId), me, 'PX', Math.max(1_000, intervalMs - 500), 'NX');
      if (won === 'OK') {
        const [eventsHead] = await client.lrange(supEventsKey(t.kind, state.nodeId), 0, 0);
        for (const e of itemsToPush(snap.events ?? [], eventsHead)) await publisher.event(t.kind, state.nodeId, e);
        const [signalHead] = await client.lrange(supSignalKey(t.kind, state.nodeId), 0, 0);
        for (const s of itemsToPush(snap.signal ?? [], signalHead)) await publisher.signal?.(t.kind, state.nodeId, s);
      }
      warned.delete(t.url);
      return true;
    } catch (error) {
      if (!warned.has(t.url)) {
        warned.add(t.url);
        Logger.warn(`[process_host] ${t.kind} supervisor at ${t.url} not relayed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  const tick = async (): Promise<number> => {
    if (busy) return 0;
    busy = true;
    try {
      const done = await Promise.all(o.targets.map(relayOne));
      return done.filter(Boolean).length;
    } finally {
      busy = false;
    }
  };
  return {
    tick,
    start: () => {
      if (timer) return;
      timer = setInterval(() => { void tick(); }, intervalMs);
      timer.unref?.();
    },
    stop: () => { if (timer) clearInterval(timer); timer = null; },
  };
}

/** Relays now and then every `intervalMs`; the returned function stops it. No targets: nothing runs. */
export function startSupervisorRelay(o: SupervisorRelayOptions): () => void {
  if (o.targets.length === 0) return () => undefined;
  const relay = createSupervisorRelay(o);
  void relay.tick();
  relay.start();
  Logger.info(`[process_host] relaying the local supervisors ${o.targets.map((t) => `${t.kind} (${t.url})`).join(', ')} into the Scaling view`);
  return relay.stop;
}
