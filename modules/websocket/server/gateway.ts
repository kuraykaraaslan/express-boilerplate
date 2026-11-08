import { WS_CONTROL_CHANNEL, parseControlEvent, type WsControlEvent } from './websocket.control';
import { startControlStreamReader, type ControlStreamReader } from './websocket.control-stream';
import { createServer, type Server as HttpServer } from 'http';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRedisConnection } from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { websocketNamespaceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/websocket.namespace';
import { makeTicketAuthMiddleware } from './websocket.auth';
import { resolveWsPublicUrl } from './websocket.public-url';
import { createDeliverer, createLagGuard } from './websocket.delivery';
import { WsMetrics } from './websocket.metrics';
import {
  CONNECTION_REFRESH_MS, capRoomsPerSocket, createConnectionTracker, limitInboundEvents,
  type ConnectionTracker,
} from './websocket.limits';
import { startProcessHost, type DrainInfo } from '@kuraykaraaslan-labs/process_host/server/process-host';
import { drainUntil, type ChildContext } from '@kuraykaraaslan-labs/process_host/server/supervisor/child';
import { WS_RECONNECT_SPREAD_MS, WS_SIGNAL_REPORT_MS, createLoadSignal, socketGraceFor } from './websocket.scaling';
import {
  NODE_HEARTBEAT_MS, WS_NODE_INDEX, WS_PROCESS_KIND, announceNode, withdrawNode, wsNodeKey,
  type WsNodeHeartbeat,
} from './websocket.node-registry';
import { armSessionExpiry } from './websocket.session-expiry';
import { createHandshakeBudget, trustedProxies } from './websocket.handshake-budget';
import { createRevocationMemory, type RevocationMemory } from './websocket.revocation-memory';
import { isTenantFenced } from './websocket.tenant-fence';
import { installTicketReplace } from './websocket.ticket-replace';
import type { RealtimeNamespace } from './websocket.types';

/**
 * Standalone realtime WebSocket gateway.
 *
 * Runs as its own process (`npm run ws:start`) — Next.js App Router cannot host
 * a long-lived WebSocket server. It hosts one Socket.IO namespace per domain
 * (`/messaging`, later `/collab`, …). Domains never wire themselves in here;
 * each contributes a `RealtimeNamespace` descriptor into the `websocket:namespace`
 * extension point, and this gateway discovers them at boot via the extension
 * registry — so the gateway has ZERO compile-time coupling to any domain module.
 *
 * Two Redis mechanisms, different hops:
 *   • @socket.io/redis-adapter — socket↔socket fan-out *within* the WS cluster.
 *     The adapter is set once on the Server and applies to every namespace; its
 *     pub/sub channels are namespace-prefixed, so rooms are isolated per domain.
 *   • each descriptor's `channel` — how the Next HTTP process (no Socket.IO)
 *     hands persisted events to the gateway for room delivery.
 *
 * IMPORTANT: only pure-Node `@kuraykaraaslan-labs/*` code may be reached from here —
 * never anything pulling `next/server`. Descriptors are loaded lazily, so a
 * consumer's Node-pure realtime surface is all that is imported.
 *
 * `createGateway` holds the wiring and has no import-time side effects, so a
 * test can drive it in-process; `bootstrap` is the production composition.
 */

const NAMESPACE_POINT = 'websocket:namespace';

/**
 * Engine-level settings, explicit so a Socket.IO upgrade cannot change them silently
 * (docs/phases/13-websocket/02 §2.3). The values equal the library defaults today.
 *
 *  • `maxHttpBufferSize` — largest single inbound message (1 MB). A client frame above it
 *    closes the connection; namespaces that need bigger payloads must upload over HTTP.
 *  • `pingInterval` / `pingTimeout` — the server pings every 25 s and drops a client that does
 *    not answer within 20 s, so a dead peer is noticed in at most 45 s.
 *  • `connectTimeout` — an upgrade that never sends the namespace CONNECT is closed after 10 s,
 *    not Socket.IO's default 45 s, so thousands of half-open handshakes cannot hold file
 *    descriptors that long (risk register websocket.07). A real client sends CONNECT at once.
 */
export const GATEWAY_ENGINE_OPTIONS = {
  maxHttpBufferSize: 1_000_000,
  connectTimeout: 10_000,
  pingInterval: 25_000,
  pingTimeout: 20_000,
} as const;

/**
 * Resolve the CORS origin policy.
 *
 * A permissive default is right in development (any localhost port, any preview
 * host) and wrong in production: this gateway carries call control, not just
 * chat. So production REFUSES TO BOOT with an empty allowlist rather than
 * silently accepting every origin — an operator who forgot the variable finds
 * out at deploy time, not from an incident.
 */
export function resolveCorsOrigin(): string[] | boolean {
  const raw = env.WS_CORS_ORIGIN ?? env.MESSAGING_WS_CORS_ORIGIN;
  const allowlist = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowlist.length > 0) return allowlist;

  // Permissive only where it is meant to be: every other NODE_ENV the schema accepts (production, vercel, …) is a
  // deployment and must name its origins (risk register websocket.03: `vercel` used to fall through to permissive).
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error(
      `[websocket] WS_CORS_ORIGIN is required in production (NODE_ENV=${env.NODE_ENV}) — set a comma-separated origin allowlist`,
    );
  }
  return true;
}

/**
 * An Origin check against a fixed allowlist alone. NOT installed on the gateway: tenants are served on their own
 * subdomains and custom domains, which a static `WS_CORS_ORIGIN` list cannot name, so enforcing it on the upgrade would
 * refuse every tenant site (found and reverted 2026-10-19). The installed check is `originAllowed` in the handshake,
 * which also accepts the origin that minted the ticket (websocket.04). Kept for its tests and for an upgrade-level use.
 */
export function makeAllowRequest(policy: string[] | boolean) {
  return (req: { headers: Record<string, string | string[] | undefined> }, callback: (err: string | null | undefined, ok: boolean) => void): void => {
    const origin = req.headers.origin;
    if (policy === true || origin === undefined || origin === '') { callback(null, true); return; }
    const ok = Array.isArray(policy) && typeof origin === 'string' && policy.includes(origin);
    callback(ok ? null : 'origin not allowed', ok);
  };
}

/**
 * Discover every domain's realtime namespace descriptor via the extension registry.
 *
 * A process-wide catalog read at boot: the gateway serves every tenant, so every namespace in the build is mounted
 * (a system context); who may connect is each namespace's own ticket check, per connection. One descriptor that
 * fails to load is logged and left out; the others still mount.
 */
export async function loadNamespaces(): Promise<RealtimeNamespace[]> {
  const { loaded, failed } = await ext.loadAll<RealtimeNamespace>(
    NAMESPACE_POINT, systemCtx('websocket gateway boot: every realtime namespace in the build'), websocketNamespaceLoaders,
  );
  for (const f of failed) Logger.error(`[websocket] failed to load namespace '${f.contributionId}': ${f.message}`);
  for (const { contribution, impl } of loaded) {
    Logger.info(`[websocket] registered namespace '${impl.path}' from '${contribution.moduleId}'`);
  }
  return loaded.map((l) => l.impl);
}

export interface GatewayDeps {
  /** Listener the gateway starts and stops; `io` must be attached to it. */
  httpServer: HttpServer;
  io: Server;
  /** Creates one Redis connection (adapter pub/sub and the bridge subscriber). */
  redisFactory: () => Redis;
  descriptors: RealtimeNamespace[];
  port: number;
  /** Install `@socket.io/redis-adapter`. Default true; an in-process test turns it off. */
  useRedisAdapter?: boolean;
  /** Publish the node heartbeat. Default true. */
  announce?: boolean;
  /** Counters shared with the caller (the process-host `/metrics` hook). Default: a fresh set. */
  metrics?: WsMetrics;
  /** The origin policy for ticketed sockets (`originAllowed`, websocket.04). Default: none (`true`); `startWsNode` passes the CORS policy. */
  originPolicy?: string[] | boolean;
}

export interface Gateway {
  /** Per-namespace counters; `register` them on the process-host registry. */
  metrics: WsMetrics;
  /** Live sockets per namespace on this node (the heartbeat's `namespaces`). */
  namespaceStats(): Array<{ path: string; sockets: number }>;
  start(): Promise<void>;
  /**
   * Drain: `server:draining` to every client, close sockets, release Redis. Idempotent. `spreadMs` closes the sockets in
   * batches over that long after the notice (a scale-down), instead of all at once (a SIGTERM bounded by SHUTDOWN_GRACE_MS).
   */
  stop(opts?: { spreadMs?: number }): Promise<void>;
  /**
   * The long drain of a scale-down (07 task 7): stop accepting (the listener closes; under `cluster` the primary routes new
   * connections to the siblings), keep the existing sockets until they are all gone or `socketGraceMs` passed (or the drain
   * is escalated through `signal`), then `stop` with the reconnect hint. Sockets are never cut before the grace.
   */
  drain(opts: { socketGraceMs: number; spreadMs?: number; signal?: AbortSignal; pollMs?: number }): Promise<'idle' | 'timeout' | 'aborted'>;
}

/** Wire discovery → auth → connection → bridge → drain onto a prepared Server. */
export function createGateway(deps: GatewayDeps): Gateway {
  const { httpServer, io, descriptors, port } = deps;
  const connections: Redis[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let stopped: Promise<void> | null = null;
  const nodeId = randomBytes(4).toString('hex');
  const metrics = deps.metrics ?? new WsMetrics();
  const timers: Array<ReturnType<typeof setInterval>> = [];
  const closers: Array<() => void> = [];
  let tracker: ConnectionTracker | null = null;
  let controlReader: ControlStreamReader | null = null;
  let reticket: { stop(): void } | null = null;
  // One budget per node, shared by every namespace: refusals are what it counts, whichever namespace they hit.
  const handshakeBudget = createHandshakeBudget(env.WS_HANDSHAKE_REFUSALS_PER_MINUTE ?? 100, trustedProxies(env.WS_TRUSTED_PROXIES));
  // Fed by the control subscriber, asked by every namespace's handshake (websocket.17).
  const revocations = createRevocationMemory();

  const namespaceStats = () => descriptors.map((descriptor) => ({
    path: descriptor.path,
    sockets: io.of(descriptor.path).sockets.size,
  }));

  async function start(): Promise<void> {
    if (deps.useRedisAdapter !== false) {
      // Cross-instance broadcast — the adapter needs two dedicated connections.
      // Set once, before creating namespaces; it applies to all of them.
      const pubClient = deps.redisFactory();
      const subClient = deps.redisFactory();
      connections.push(pubClient, subClient);
      io.adapter(createAdapter(pubClient, subClient));
    }

    if (descriptors.length === 0) {
      Logger.warn('[websocket] no realtime namespaces registered — is the registry snapshot up to date?');
    }

    const needsCounter = descriptors.some((d) => d.limits?.maxConnectionsPerTenant != null || d.limits?.maxConnectionsPerUser != null);
    if (needsCounter) {
      const counterRedis = deps.redisFactory();
      connections.push(counterRedis);
      tracker = createConnectionTracker(counterRedis, nodeId);
      const refresh = setInterval(() => { void tracker?.refresh(); }, CONNECTION_REFRESH_MS);
      refresh.unref?.();
      timers.push(refresh);
    }

    // A suspended tenant's handshakes are refused, even with a ticket minted just before the suspension (websocket.tenant-fence).
    // Its own connection: the subscribers are in subscriber mode and cannot run GET.
    const fenceRedis = deps.redisFactory();
    connections.push(fenceRedis);
    const fenceCheck = async (identity: unknown): Promise<boolean> => {
      const tenantId = (identity as { tenantId?: unknown } | null)?.tenantId;
      return typeof tenantId === 'string' && tenantId.length > 0 ? isTenantFenced(tenantId, fenceRedis) : false;
    };

    for (const descriptor of descriptors) {
      const ns = io.of(descriptor.path);
      const stats = metrics.for(descriptor.path);
      const limits = descriptor.limits;
      const capped = limits?.maxConnectionsPerTenant != null || limits?.maxConnectionsPerUser != null;

      ns.use(makeTicketAuthMiddleware(descriptor, {
        budget: handshakeBudget,
        revocations,
        origins: deps.originPolicy ?? true,
        onRefused: (reason) => { stats.refused[reason as keyof typeof stats.refused]++; },
        fenced: (identity) => fenceCheck(identity),
        admit: capped
          ? (socket, identity) => (tracker ? tracker.acquire(descriptor.path, socket.id, identity, limits ?? {}) : Promise.resolve(null))
          : undefined,
      }));
      ns.on('connection', (socket) => {
        const identity = (socket.data as { identity: unknown }).identity;
        if (capped) {
          socket.on('disconnect', () => { void tracker?.release(socket.id); });
          // Closed between admission and `connection`: no `disconnect` will fire, and refresh would keep the slot alive forever.
          if (socket.disconnected) void tracker?.release(socket.id);
        }
        if (limits?.maxRoomsPerSocket != null) {
          capRoomsPerSocket(socket, limits.maxRoomsPerSocket, (n) => { stats.roomsRefused += n; });
        }
        if (limits?.inboundEventsPerMinute != null) {
          limitInboundEvents(socket, limits.inboundEventsPerMinute, () => { stats.inboundDropped++; });
        }
        // Kept on the socket so a namespace that re-authorises in place can re-arm it (`rearmSessionExpiry`).
        (socket.data as Record<string, unknown>).sessionExpiryDisarm = armSessionExpiry(socket, identity, Date.now, () => { stats.sessionExpired++; });
        // A namespace that declares `replace` takes a fresh ticket on this socket (D40-4), judged like this handshake's.
        if (descriptor.replace) {
          installTicketReplace(socket, descriptor, {
            budget: handshakeBudget,
            revocations,
            origins: deps.originPolicy ?? true,
            fenced: (next) => fenceCheck(next),
            onExpire: () => { stats.sessionExpired++; },
            onOutcome: (ack) => { if (ack.ok) stats.ticketReplaced++; else stats.ticketReplaceRefused++; },
          });
        }
        // The handshake read the fence before the socket joined `ns.sockets`; a suspension landing in between (fence set, then
        // `disconnect_tenant` handled here before this socket was listed) would miss it. Read again now that it is listed: either
        // the drop sees this socket, or the fence was already set and this drops it. A read that fails keeps the socket: the
        // handshake's own check passed, and an outage must not drop every live connection.
        void fenceCheck(identity).then((fenced) => { if (fenced) socket.disconnect(true); }, () => {});
        try {
          descriptor.onConnection(ns, socket, identity as never);
        } catch (err) {
          Logger.error(`[websocket] onConnection error on '${descriptor.path}': ${err}`);
          socket.disconnect(true);
        }
      });

      const maxBytes = descriptor.delivery?.maxBufferedBytes;
      if (maxBytes != null && maxBytes > 0) {
        const guard = createLagGuard(ns, maxBytes, () => { stats.laggingDisconnects++; });
        const sweep = setInterval(() => guard.sweep(), Math.max(descriptor.delivery?.coalesceMs ?? 1000, 250));
        sweep.unref?.();
        timers.push(sweep);
      }
    }

    const sub = startRealtimeSubscriber(io, descriptors, deps.redisFactory, { metrics, closers });
    if (sub) connections.push(sub);
    // Sockets are authenticated at the handshake only; this is what ends one whose owner has since lost the right: the control
    // stream (every order, from this node's last place, D247), and the legacy channel of the previous release.
    const controlRedis = deps.redisFactory();
    connections.push(controlRedis);
    // a read the dropped connection held must FAIL, not be resent after the reconnect: the failure is what makes the reader look for a gap
    if ((controlRedis as { options?: { autoResendUnfulfilledCommands?: boolean } }).options) controlRedis.options.autoResendUnfulfilledCommands = false;
    controlReader = await startControlStreamReader(controlRedis, (event) => { applyControlEvent(io, descriptors, event, revocations); }, {
      onGap: () => { reticket?.stop(); reticket = reticketAll(io, descriptors); },
    });
    connections.push(startControlSubscriber(io, descriptors, deps.redisFactory, revocations));

    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => {
        Logger.info(`[websocket] gateway listening on :${port} (${descriptors.length} namespace(s))`);
        resolve();
      });
    });

    if (deps.announce !== false) startHeartbeat();
  }

  // Announce ourselves, so a setup screen can tell three states apart that are
  // otherwise identical from the app's side: gateway DOWN, gateway UP but
  // nobody told it its public URL, and fine. The middle one is the operator's
  // actual bug and today it is indistinguishable from the first.
  //
  // `namespaces` is announced for the same reason: a gateway booted against a
  // stale registry snapshot comes up perfectly healthy with no `/telephony`,
  // and the browser then gets a bare `connect_error` with no cause anywhere.
  function startHeartbeat(): void {
    const startedAt = Date.now();
    heartbeat = setInterval(() => {
      void announceNode(WS_NODE_INDEX, wsNodeKey(nodeId), nodeId, {
        v: 2,
        nodeId,
        // Whatever an operator SET, never a guess about their topology — the one
        // exception is the development default, which reads back the port this
        // process is already listening on.
        publicUrl: resolveWsPublicUrl().url,
        port,
        namespaces: namespaceStats(),
        corsMode: Array.isArray(resolveCorsOrigin()) ? 'allowlist' : 'permissive',
        startedAt,
        connections: io.engine.clientsCount,
        at: Date.now(),
      });
    }, NODE_HEARTBEAT_MS);
    heartbeat.unref?.();
  }

  async function drain(opts: { socketGraceMs: number; spreadMs?: number; signal?: AbortSignal; pollMs?: number }): Promise<'idle' | 'timeout' | 'aborted'> {
    // stop accepting; the callback would wait for every open socket, so it is not awaited
    try { httpServer.close(); } catch { /* not listening */ }
    Logger.info(`[websocket] draining: no new connections, ${io.engine.clientsCount} socket(s) get up to ${Math.round(opts.socketGraceMs / 1000)} s`);
    const outcome = await drainUntil(() => io.engine.clientsCount === 0, { maxMs: opts.socketGraceMs, signal: opts.signal, pollMs: opts.pollMs });
    Logger.info(`[websocket] drain ${outcome}: sending the reconnect hint to ${io.engine.clientsCount} socket(s)`);
    await stop({ spreadMs: outcome === 'aborted' ? 0 : (opts.spreadMs ?? 0) });
    return outcome;
  }

  /** Closes the engine connections in ten batches over `spreadMs` (each client already has the notice). */
  async function closeSpread(spreadMs: number): Promise<void> {
    // engine.io keeps its connections in `clients` (protected in its typings)
    const clients = Object.values((io.engine as unknown as { clients: Record<string, { close(): void }> }).clients);
    if (clients.length === 0) return;
    const batches = Math.min(10, clients.length);
    const size = Math.ceil(clients.length / batches);
    for (let i = 0; i < clients.length; i += size) {
      if (i > 0) await new Promise((r) => setTimeout(r, spreadMs / batches));
      for (const c of clients.slice(i, i + size)) { try { c.close(); } catch { /* already gone */ } }
    }
  }

  function stop(opts: { spreadMs?: number } = {}): Promise<void> {
    stopped ??= (async () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
        // Withdrawn BEFORE the sockets close, so a status screen stops
        // advertising this node while it is still saying goodbye to its clients.
        await withdrawNode(WS_NODE_INDEX, wsNodeKey(nodeId), nodeId).catch(() => { /* the TTL expires it anyway */ });
      }
      for (const timer of timers.splice(0)) clearInterval(timer);
      for (const close of closers.splice(0)) close();
      controlReader?.stop();
      reticket?.stop();
      // `io.emit` reaches only the default namespace; every client here is on a
      // named one, so the notice has to go out per namespace. LOCAL only: through
      // the Redis adapter it would reach every other node's (or child's) sockets
      // too and send the whole cluster reconnecting because one node drains.
      io.local.emit('server:draining');
      for (const descriptor of descriptors) io.of(descriptor.path).local.emit('server:draining');
      if (opts.spreadMs && opts.spreadMs > 0) await closeSpread(opts.spreadMs);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.allSettled(connections.map((c) => c.quit()));
    })();
    return stopped;
  }

  return { start, stop, drain, metrics, namespaceStats };
}

/**
 * Subscribe to every descriptor's Redis channel on a single dedicated connection
 * (a subscriber-mode connection cannot run normal commands) and fan each parsed
 * event into its namespace via the descriptor's own dispatch.
 */
export function startRealtimeSubscriber(
  io: Server,
  descriptors: RealtimeNamespace[],
  redisFactory: () => Redis,
  opts: { metrics?: WsMetrics; closers?: Array<() => void> } = {},
): Redis | null {
  const metrics = opts.metrics ?? new WsMetrics();
  const byChannel = new Map<string, { descriptor: RealtimeNamespace; deliver: (event: unknown) => void }>();
  for (const descriptor of descriptors) {
    if (byChannel.has(descriptor.channel)) {
      Logger.warn(`[websocket] channel '${descriptor.channel}' claimed by multiple namespaces — using last`);
    }
    // Per-namespace delivery path: local emit, plus the descriptor's opt-in coalescing / volatile mode.
    const deliverer = createDeliverer(descriptor, io.of(descriptor.path), metrics.for(descriptor.path));
    opts.closers?.push(() => deliverer.close());
    byChannel.set(descriptor.channel, { descriptor, deliver: (event) => deliverer.dispatch(event) });
  }
  const channels = [...byChannel.keys()];
  if (channels.length === 0) return null;

  const sub = redisFactory();
  sub.subscribe(...channels).catch((err) => Logger.error(`[websocket] subscribe failed: ${err}`));

  sub.on('message', (channel: string, raw: string) => {
    const entry = byChannel.get(channel);
    if (!entry) return;
    const event = entry.descriptor.parseEvent(raw);
    if (event == null) return; // ignore malformed / unknown payloads
    // Local-only delivery: every node gets this event from Redis, so the cluster
    // adapter would deliver it once per node (docs/phases/13-websocket/02 §2.1).
    entry.deliver(event);
  });

  return sub;
}

/**
 * Drop this node's sockets that belong to `target.userId` (and `target.tenantId` when given), in
 * every namespace. Only LOCAL sockets: every node receives the control event itself, so each
 * acts on its own.
 */
export function disconnectUserSockets(
  io: Server,
  descriptors: RealtimeNamespace[],
  target: { userId: string; tenantId?: string; userSessionId?: string },
): number {
  let dropped = 0;
  for (const descriptor of descriptors) {
    for (const socket of io.of(descriptor.path).sockets.values()) {
      const identity = (socket.data as { identity?: { userId?: string; tenantId?: string; userSessionId?: string } }).identity;
      if (identity?.userId !== target.userId) continue;
      // An identity with no tenant (a namespace that does not scope by one) is matched on the user alone.
      if (target.tenantId && identity.tenantId && identity.tenantId !== target.tenantId) continue;
      // A session-scoped drop spares sockets known to belong to another session; one with no session id is dropped (fail closed).
      if (target.userSessionId && identity.userSessionId && identity.userSessionId !== target.userSessionId) continue;
      socket.disconnect(true);
      dropped += 1;
    }
  }
  return dropped;
}

/**
 * Drop every socket of `tenantId` on this node, in every namespace, whoever opened it (suspension, deletion: websocket.09;
 * docs/phases/02-fleet/05 section 7 stage 7). A socket whose identity names no tenant is spared: nothing ties it to this one.
 */
export function disconnectTenantSockets(io: Server, descriptors: RealtimeNamespace[], tenantId: string): number {
  let dropped = 0;
  for (const descriptor of descriptors) {
    for (const socket of io.of(descriptor.path).sockets.values()) {
      const identity = (socket.data as { identity?: { tenantId?: string } }).identity;
      if (identity?.tenantId !== tenantId) continue;
      socket.disconnect(true);
      dropped += 1;
    }
  }
  return dropped;
}

/** Acts on one control order on this node: remember it first (websocket.17), then drop the matching local sockets. */
export function applyControlEvent(io: Server, descriptors: RealtimeNamespace[], event: WsControlEvent, revocations?: RevocationMemory): number {
  // Remember it first, so a handshake racing this event cannot slip in between (websocket.17).
  if (event.kind === 'disconnect_tenant') revocations?.tenant(event.tenantId);
  else if (event.userSessionId) revocations?.session(event.userSessionId);
  else revocations?.user(event.userId, event.tenantId);
  if (event.kind === 'disconnect_tenant') {
    const dropped = disconnectTenantSockets(io, descriptors, event.tenantId);
    if (dropped > 0) Logger.info(`[websocket] control: dropped ${dropped} socket(s) of tenant ${event.tenantId}`);
    return dropped;
  }
  const dropped = disconnectUserSockets(io, descriptors, event);
  if (dropped > 0) Logger.info(`[websocket] control: dropped ${dropped} socket(s) of user ${event.userId}`);
  return dropped;
}

/**
 * The LEGACY control channel (pub/sub, best-effort): still read for one release, because an HTTP process of the previous release
 * publishes there; this build writes the control stream (`startControlStreamReader`). A drop is idempotent, so an order heard on both
 * only drops what the first left.
 */
export function startControlSubscriber(
  io: Server,
  descriptors: RealtimeNamespace[],
  redisFactory: () => Redis,
  revocations?: RevocationMemory,
): Redis {
  const sub = redisFactory();
  sub.subscribe(WS_CONTROL_CHANNEL).catch((err) => Logger.error(`[websocket] control subscribe failed: ${err}`));
  sub.on('message', (channel: string, raw: string) => {
    if (channel !== WS_CONTROL_CHANNEL) return;
    const event = parseControlEvent(raw);
    if (!event) return;
    applyControlEvent(io, descriptors, event, revocations);
  });
  return sub;
}

/** Sockets re-ticketed per second after a gap in the control stream (D248). */
export const RETICKET_PER_SECOND = 200;

/**
 * Layer 2 for websockets (docs/audits/2026-11-03-redis-outage.md, D248): the control stream no longer runs through this node's place
 * (Redis lost its data, or it was trimmed past it), so an order may be gone. The gateway reads no database (least privilege: tickets
 * are checked by the HTTP side), so every local socket is sent `server:reauth` and closed, tenant by tenant, at most
 * `RETICKET_PER_SECOND` per second: the client mints a new ticket, which the HTTP side refuses for a revoked session, a removed member
 * or a suspended tenant (the database decides), and grants otherwise. A reconnect after which the stream still runs through the node's
 * place lost nothing (the orders written meanwhile are read in order) and re-tickets nothing.
 */
export function reticketAll(io: Server, descriptors: RealtimeNamespace[], perSecond = RETICKET_PER_SECOND): { stop(): void; total: number } {
  const sockets = descriptors.flatMap((d) => [...io.of(d.path).sockets.values()]);
  const tenantOf = (s: (typeof sockets)[number]) => String((s.data as { identity?: { tenantId?: string } }).identity?.tenantId ?? '');
  sockets.sort((a, b) => tenantOf(a).localeCompare(tenantOf(b)));
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const step = (): void => {
    timer = null;
    for (const end = Math.min(sockets.length, i + Math.max(1, perSecond)); i < end; i += 1) {
      const s = sockets[i];
      if (s.disconnected) continue;
      s.emit('server:reauth');
      s.disconnect(true);
    }
    if (i < sockets.length) {
      timer = setTimeout(step, 1_000);
      timer.unref?.();
    } else if (sockets.length > 0) {
      Logger.info(`[websocket] re-ticketed ${sockets.length} socket(s) after a gap in the control stream`);
    }
  };
  if (sockets.length > 0) Logger.warn(`[websocket] gap in the control stream: ${sockets.length} socket(s) re-ticketed (${perSecond}/s)`);
  step();
  return { stop: () => { if (timer) clearTimeout(timer); timer = null; }, total: sockets.length };
}

/**
 * Production composition: real HTTP server, Socket.IO, Redis and registry discovery.
 *
 * The process starts through `process_host` (the sidecar contract): it serves
 * `/healthz` and `/metrics` on this same server, heartbeats into
 * `proc:nodes:ws` (dual-writing the legacy `ws:nodes` for one release) and owns
 * SIGTERM/SIGINT with the `SHUTDOWN_GRACE_MS` ceiling. The gateway's own
 * heartbeat is therefore off (`announce: false`).
 *
 * `ctx` is set in a supervised child (`websocket.process.ts`, PROC_WS_ENABLED=true): the child then shares `WS_PORT` with
 * its siblings through `cluster`, reports its load ratio to the supervisor, and drains slowly on a scale-down.
 */
export async function bootstrap(ctx?: ChildContext): Promise<void> {
  const port = env.WS_PORT ?? env.MESSAGING_WS_PORT;
  const descriptors = await loadNamespaces();
  await startWsNode({ port, descriptors, redisFactory: createRedisConnection, ctx });
}

export interface WsNodeOptions {
  /** The process kind it announces (default `ws`; tests use their own). */
  kind?: string;
  port: number;
  descriptors: RealtimeNamespace[];
  redisFactory: () => Redis;
  /** Set in a supervised child: report the load ratio, drain slowly on a scale-down. */
  ctx?: ChildContext;
  /** Dual-write the legacy `ws:nodes` heartbeat (default true). */
  legacy?: boolean;
}

export interface WsNode {
  gateway: Gateway;
  io: Server;
  httpServer: HttpServer;
}

/**
 * One gateway node: the HTTP server, Socket.IO (websocket-only), the gateway over `descriptors`, and `startProcessHost`.
 * `bootstrap` runs it with the registry's descriptors; a test runs the same composition with its own.
 *
 * Supervised (`ctx.isChild`), the drain depends on why it happens: a supervisor scale-down keeps the sockets up to the
 * kind's grace (`gateway.drain`, reconnect hint at the end), anything else (SIGTERM, a group shutdown, a lost supervisor,
 * an escalation) drains as before (`gateway.stop`, bounded by SHUTDOWN_GRACE_MS).
 */
export async function startWsNode(opts: WsNodeOptions): Promise<WsNode> {
  const { port, descriptors } = opts;
  const kind = opts.kind ?? WS_PROCESS_KIND;
  // Fallback for paths nobody else claims; `/healthz` and `/metrics` belong to
  // `process_host`, which answers them asynchronously.
  const httpServer = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/healthz' || path === '/metrics') return;
    res.writeHead(404);
    res.end();
  });

  const corsOrigin = resolveCorsOrigin();
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    // WebSocket-only avoids needing sticky sessions for the polling upgrade: under a supervisor the
    // children share the port through `cluster` round-robin, and a polling client's next request
    // would land on another child (07 task 7; every client in the repo connects websocket-only).
    transports: ['websocket'],
    ...GATEWAY_ENGINE_OPTIONS,
  });

  const metrics = new WsMetrics();
  const gateway = createGateway({
    httpServer,
    io,
    redisFactory: opts.redisFactory,
    descriptors,
    port,
    announce: false,
    metrics,
    originPolicy: corsOrigin,
  });
  await gateway.start();

  // What a setup screen reads: `publicUrl` is whatever an operator SET (null
  // separates "up but nobody told it" from "down"); `namespaces` turns a stale
  // registry snapshot into a named row instead of a bare `connect_error`.
  const wsInfo = (): WsNodeHeartbeat => ({
    publicUrl: resolveWsPublicUrl().url,
    port,
    namespaces: gateway.namespaceStats(),
    corsMode: Array.isArray(corsOrigin) ? 'allowlist' : 'permissive',
    connections: io.engine.clientsCount,
  });

  const supervised = opts.ctx?.isChild === true;
  const load = supervised ? createLoadSignal(() => io.engine.clientsCount) : null;
  if (load) opts.ctx!.reportSignalEvery(WS_SIGNAL_REPORT_MS, () => load.sample());

  await startProcessHost({
    kind,
    port,
    server: httpServer,
    listen: false,
    health: async () => descriptors.length === 0
      ? { status: 'degraded', detail: 'no realtime namespaces registered' }
      : { status: 'ok' },
    info: load ? () => ({ ...wsInfo(), load: load.last() }) : wsInfo,
    ...(opts.legacy !== false && {
      legacy: {
        index: WS_NODE_INDEX,
        key: wsNodeKey,
        // The legacy index stays on the v1 shape (`namespaces: string[]`) for older readers.
        payload: (node) => ({
          v: 1, nodeId: node.nodeId, startedAt: node.startedAt, at: node.lastBeatAt,
          ...wsInfo(), namespaces: descriptors.map((descriptor) => descriptor.path),
        }),
      },
    }),
    metrics: (registry, prom) => gateway.metrics.register(registry, prom, (path) => io.of(path).sockets.size),
    onDrain: async (info?: DrainInfo) => {
      try {
        if (info?.reason === 'scale-down') {
          await gateway.drain({ socketGraceMs: socketGraceFor(info.graceMs), spreadMs: WS_RECONNECT_SPREAD_MS, signal: info.signal });
        } else {
          await gateway.stop();
        }
      } finally {
        load?.stop();
      }
    },
  });
  return { gateway, io, httpServer };
}
