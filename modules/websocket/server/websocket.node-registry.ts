import {
  NODE_HEARTBEAT_MS, NODE_TTL_SECONDS, announceNode, readNodes, readProcessNodes, withdrawNode,
  type NodeReadResult,
} from '@kuraykaraaslan-labs/process_host/server/process-registry';

/**
 * Realtime-gateway view of the sidecar process registry.
 *
 * The heartbeat machinery (ZSET index, TTL trimming, `v` guard) now lives in the
 * leaf module `process_host` (docs/phases/09-observability phase 5, OD-12), so every
 * sidecar can share it without importing a transport. This file keeps the names
 * `telephony` and the setup screens already import, as a thin re-export.
 *
 * Index keys: the gateway announces under `proc:nodes:ws` and, for one release,
 * still under the legacy `ws:nodes`. Readers prefer the new key.
 */
export { NODE_HEARTBEAT_MS, NODE_TTL_SECONDS, announceNode, readNodes, withdrawNode };
export type { NodeReadResult };

export const WS_NODE_INDEX = 'ws:nodes';
export const wsNodeKey = (nodeId: string): string => `ws:node:${nodeId}`;

/** What the realtime gateway says about itself. `v` guards a shape change. */
export interface WsNodeInfo {
  /** 1 = `namespaces` was a list of paths; 2 = the node also reports per-namespace socket counts. Readers accept both. */
  v: 1 | 2;
  nodeId: string;
  /**
   * The URL it believes browsers reach it on, or null when nobody told it.
   *
   * Announcing `null` while still announcing that the process is ALIVE is the
   * whole point: it separates "the gateway is down" from "the gateway is up and
   * no operator has said where it is". Those are different bugs with different
   * fixes, and from the app's side they are otherwise identical.
   */
  publicUrl: string | null;
  port: number;
  /**
   * The namespaces it actually loaded.
   *
   * A gateway booted against a stale registry snapshot comes up healthy with no
   * `/telephony` namespace, and the browser then gets a bare `connect_error`
   * with no cause anywhere. Announcing the list turns that into a named row.
   */
  namespaces: string[];
  /** Live sockets per namespace on this node (heartbeat v2; empty for a v1 node). */
  namespaceStats: WsNamespaceStat[];
  corsMode: 'allowlist' | 'permissive';
  startedAt: number;
  connections: number;
  at: number;
}

export interface WsNamespaceStat { path: string; sockets: number }

/** What a node writes into its heartbeat: v2 carries `{ path, sockets }` per namespace. */
export type WsNodeHeartbeat = Omit<WsNodeInfo, 'v' | 'nodeId' | 'startedAt' | 'at' | 'namespaces' | 'namespaceStats'> & {
  namespaces: Array<string | WsNamespaceStat>;
};

/** Accept a v1 (`string[]`) or v2 (`{path, sockets}[]`) `namespaces` field. */
export function normalizeWsNamespaces(raw: unknown): { namespaces: string[]; namespaceStats: WsNamespaceStat[]; v: 1 | 2 } {
  const list = Array.isArray(raw) ? raw : [];
  const stats: WsNamespaceStat[] = [];
  const paths: string[] = [];
  let v: 1 | 2 = 1;
  for (const entry of list) {
    if (typeof entry === 'string') {
      paths.push(entry);
    } else if (entry && typeof entry === 'object' && typeof (entry as WsNamespaceStat).path === 'string') {
      v = 2;
      paths.push((entry as WsNamespaceStat).path);
      stats.push({ path: (entry as WsNamespaceStat).path, sockets: Number((entry as WsNamespaceStat).sockets) || 0 });
    }
  }
  return { namespaces: paths, namespaceStats: stats, v };
}

/** Registry kind the realtime gateway announces as. */
export const WS_PROCESS_KIND = 'ws';

export async function readWsNodes(): Promise<NodeReadResult<WsNodeInfo>> {
  const fresh = await readProcessNodes(WS_PROCESS_KIND);
  if (fresh.redisError) return { nodes: [], redisError: fresh.redisError };
  if (fresh.nodes.length > 0) {
    // The gateway's `info()` carries the WsNodeInfo-specific fields.
    return {
      nodes: fresh.nodes.map((n) => {
        const info = n.info as unknown as WsNodeHeartbeat;
        return {
          ...info,
          ...normalizeWsNamespaces(info.namespaces),
          nodeId: n.nodeId,
          startedAt: n.startedAt,
          at: n.lastBeatAt,
        };
      }),
    };
  }
  // Legacy fallback for one release (a gateway older than process_host).
  const legacy = await readNodes<WsNodeInfo | (Omit<WsNodeInfo, 'namespaces'> & { namespaces: Array<string | WsNamespaceStat> })>(WS_NODE_INDEX, wsNodeKey);
  return {
    ...legacy,
    nodes: legacy.nodes.map((n) => ({ ...n, ...normalizeWsNamespaces(n.namespaces) }) as WsNodeInfo),
  };
}
