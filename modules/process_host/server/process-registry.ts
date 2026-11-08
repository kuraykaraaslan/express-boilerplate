import redis from '@kuraykaraaslan-labs/redis/server/redis.service';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * The sidecar process registry: a process saying "I am here", and anything
 * (the Next app, an operator screen) reading it back.
 *
 * Moved here from `websocket.node-registry.ts` (docs/phases/09-observability phase 5,
 * OD-12) with the ZSET index, TTL trimming and `v` guard unchanged.
 *
 * ## Why Redis and not an HTTP health check
 *
 * The app does not know the sidecars' hosts, they may sit on a private network,
 * and there may be several of each. Polling them over HTTP would mean service
 * discovery, timeouts and a retry policy — to learn a fact that already travels
 * over the Redis every process is connected to. A heartbeat also expires on its
 * own when a node dies, which no table of nodes would.
 *
 * ## A sorted-set index, not a key scan
 *
 * `KEYS`/`SCAN` over a pattern gets slower as the keyspace grows and is read on
 * a page an operator refreshes. The index is a ZSET scored by timestamp: expired
 * members are trimmed by score in one command, and the survivors are fetched by
 * id. The set of KINDS is a tiny plain set (`proc:kinds`) for the same reason.
 *
 * ## Why a leaf
 *
 * Every sidecar imports this. If it lived inside `observability`, the realtime
 * gateway would import `observability`, which already imports `websocket`.
 */

/** Long enough to survive one missed beat, short enough to notice a death. */
export const NODE_TTL_SECONDS = 15;
/** Half the TTL, so a single slow tick is not a node going dark. */
export const NODE_HEARTBEAT_MS = 5_000;

/** Index of every kind that has ever announced (never expires; tiny). */
export const PROCESS_KINDS_KEY = 'proc:kinds';
export const procNodeIndex = (kind: string): string => `proc:nodes:${kind}`;
export const procNodeKey = (kind: string, nodeId: string): string => `proc:node:${kind}:${nodeId}`;

export type ProcessHealthStatus = 'ok' | 'degraded' | 'fail';

/** What a process's `health()` callback returns. */
export interface HealthReport {
  status: ProcessHealthStatus;
  /** Free-form per-check detail, shown on the operator screen. */
  checks?: Record<string, { status: ProcessHealthStatus; detail?: string }>;
  detail?: string;
}

/** The heartbeat payload under `proc:node:<kind>:<id>`. `v` guards a shape change. */
export interface ProcessNodeInfo {
  v: 1;
  kind: string;
  nodeId: string;
  version: string;
  port: number;
  startedAt: number;
  lastBeatAt: number;
  health: HealthReport;
  info: Record<string, unknown>;
}

/** Publish one node's heartbeat and keep it in the index. Best-effort. */
export async function announceNode(
  index: string, key: string, nodeId: string, payload: object,
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(payload), 'EX', NODE_TTL_SECONDS);
    await redis.zadd(index, Date.now(), nodeId);
  } catch (error) {
    // A process that cannot announce still carries traffic. Failing here would
    // trade a working service for a status screen.
    Logger.warn(`[process_host] could not announce node ${nodeId}: ${error}`);
  }
}

export async function withdrawNode(index: string, key: string, nodeId: string): Promise<void> {
  try {
    await redis.del(key);
    await redis.zrem(index, nodeId);
  } catch {
    // The TTL removes it within one window regardless.
  }
}

export interface NodeReadResult<T> {
  nodes: T[];
  /**
   * Set when Redis itself could not be read.
   *
   * Distinct from an empty list on purpose. "No node has announced" means start
   * the process; "we could not ask" means something else entirely, and telling
   * an operator to restart a process that is already running is the fastest way
   * to make a status screen untrusted.
   */
  redisError?: string;
}

export async function readNodes<T>(
  index: string, keyFor: (id: string) => string,
): Promise<NodeReadResult<T>> {
  try {
    // Trimmed by score first, so a node that died is GONE rather than merely
    // filtered out on every subsequent read.
    await redis.zremrangebyscore(index, '-inf', Date.now() - NODE_TTL_SECONDS * 1000);
    const ids = await redis.zrange(index, 0, -1);
    if (ids.length === 0) return { nodes: [] };

    const raw = await redis.mget(...ids.map(keyFor));
    const nodes: T[] = [];
    for (const value of raw) {
      if (!value) continue;
      try { nodes.push(JSON.parse(value) as T); } catch { /* a torn write */ }
    }
    return { nodes };
  } catch (error) {
    return { nodes: [], redisError: error instanceof Error ? error.message : String(error) };
  }
}

/** Every process kind that has announced at least once. */
export async function listKinds(): Promise<{ kinds: string[]; redisError?: string }> {
  try {
    const kinds = await redis.smembers(PROCESS_KINDS_KEY);
    return { kinds: kinds.sort() };
  } catch (error) {
    return { kinds: [], redisError: error instanceof Error ? error.message : String(error) };
  }
}

/** Live nodes of one kind, read from the `proc:nodes:<kind>` index. */
export function readProcessNodes(kind: string): Promise<NodeReadResult<ProcessNodeInfo>> {
  return readNodes<ProcessNodeInfo>(procNodeIndex(kind), (id) => procNodeKey(kind, id));
}

/** Record that a kind exists. Best-effort, called on every beat (SADD is idempotent). */
export async function registerKind(kind: string): Promise<void> {
  try {
    await redis.sadd(PROCESS_KINDS_KEY, kind);
  } catch { /* next beat */ }
}
