# WebSocket Gateway Module

Shared realtime transport for the whole platform. A single standalone Socket.IO
process (`npm run ws:start`) hosts **one namespace per domain** — `/messaging`
today, `/collab` (dynamic_page) and others later. Next.js App Router cannot host
a long-lived WebSocket server, so this runs as its own process and receives
persisted events from the Next HTTP process over Redis pub/sub.

Domains never edit the gateway. Each domain contributes a `RealtimeNamespace`
descriptor into the **`websocket:namespace`** extension point; the gateway
discovers them at boot via the extension registry and has zero compile-time
coupling to any domain module.

---

## Architecture

```
Next HTTP process                 Redis                  WS gateway process
──────────────────         ─────────────────        ────────────────────────
publishToChannel(ch) ─────► pub/sub channel  ─────►  subscriber → descriptor.dispatch
(socket.io-FREE)                                     io.of('/messaging') ┐
                            @socket.io/redis-adapter  io.of('/collab')    ├─ rooms
                            (socket↔socket, all ns)   io.of('/…')         ┘
```

Two Redis hops: the **redis-adapter** fans socket↔socket *within* the cluster
(set once on the `Server`, applies to every namespace, channels namespace-prefixed);
each descriptor's **`channel`** carries persisted events from Next into the gateway.

---

## Tests

`npx vitest run modules/websocket` (no network beyond `127.0.0.1`, no external services).

- `server/gateway.ts` holds the wiring (`createGateway({ httpServer, io, redisFactory, descriptors, port })` returning
  `{ start, stop, drain }`, and `startWsNode`, the production composition `bootstrap()` runs over the registry's descriptors);
  `server/index.ts` is a thin entry that calls `runWsProcess()` (`websocket.process.ts`: the gateway, or with
  `PROC_WS_ENABLED=true` its supervisor), so `npm run ws:start` and the `ws` image are unchanged.
- Primitive unit tests use the in-memory `server/tests/redis-fake.ts` (strings with EX/NX, GETDEL, MGET, ZSET, pub/sub).
- `gateway.integration.test.ts` runs a real Socket.IO server on an ephemeral port with `socket.io-client`
  (ticket handshake, room-scoped bridged delivery, malformed payload drop, `onConnection` isolation, drain).
- `websocket.fanout.test.ts` covers the delivery and limit options below (coalescing, volatile, connection / room / inbound
  caps, the buffered-bytes guard, metrics registration) against in-process gateways.
- `websocket.except.test.ts` covers `to(room).except(room)` on the bridge emit target: one node, two clustered nodes,
  volatile, the coalescer's identity, and every gateway delivery path.
- `modules/websocket/scripts/ws-load/dashboard-live-smoke.ts` (`npx tsx`) drives a really running gateway process with real sockets
  (needs local Redis): ticket flow, coalescing rate, connection cap, `/metrics`, heartbeat v2.
- `modules/websocket/scripts/ws-load/stats.test.ts` covers the load harness's pure maths (percentiles, duplicate / cross-room detection).
- `gateway.drain.test.ts` (07 task 7): the scale-down drain on a real server (stops accepting, no socket cut before the
  grace, hint and close after it, early end when idle, escalation), `startWsNode`'s drain routing, and websocket-only
  (a polling client and a raw polling handshake are refused). `websocket.scaling.test.ts`, `websocket.process.test.ts`:
  the load ratio, the socket grace, the entry's supervisor / child split.
- `ws.cluster.e2e.test.ts` (needs local Redis, ~30 s): a real supervisor as `cluster` primary with gateway children on one
  port (`tests/fixtures/ws-cluster-entry.ts`): a socket's room broadcast on one child reaches the other child's socket
  (Redis adapter), a bridge event reaches each socket once, polling is refused, and a real scale-down keeps the drained
  child's socket for its grace while every new client lands on the other child.
- `websocket.ticket-replace.test.ts` (recording socket) and `ticket-replace.security.test.ts` (real sockets, S25.websocket.51):
  `ticket:replace`, its ack, limit, single use, same user / tenant / session, the room swap and the session expiry.
- `descriptors.contract.test.ts` loads every contributed `websocket:namespace` descriptor through the extension
  registry and asserts unique `channel`/`path`, a `/` prefix and that `parseEvent` drops `'{}'` and non-JSON.

## Scaling (docs/phases/14-docker/07 task 7)

With `PROC_WS_ENABLED=true` the ws process (`websocket.process.ts`, `runWsProcess`) is the **supervisor** of kind `ws` and
the Node `cluster` primary (process_host `startSupervisor({ cluster: true })`). It loads none of the gateway; its children
(the same entry, `PROC_CHILD=1`) run `bootstrap` and all listen on `WS_PORT`, the primary handing each new TCP
connection to the next child (round-robin). The group's `/healthz` (worst child wins) and `/metrics` (merged) are on
`WS_SUPERVISOR_PORT` (default 4014, must differ from `WS_PORT`); `WS_PORT/healthz` answers one child's own health (a
liveness check through the shared port), `WS_PORT/metrics` is 404 under supervision. Unset or false: one process, exactly
as before.

- **Transport: websocket-only, no sticky routing (decision).** Long-polling would need every request of a session to reach
  the same child. Every client connects websocket-only already (`transports: ['websocket']` in messaging, telephony,
  dashboard, fleet, automation live, collab, the public status page, and the native client in
  `expo-react-native-boilerplate/libs/realtime.ts`), and the gateway refuses polling (`transports: ['websocket']` on the
  server; a polling handshake gets 400). One TCP connection is one child for its whole life, so no sticky routing exists.
- **Cross-child delivery.** Socket-originated room emits (`socket.to(room)`, `ns.to(room)`, `ns.in(room).allSockets()`) go
  through `@socket.io/redis-adapter` and reach every child. Bridge events reach every child from Redis and each serves its
  own sockets (`ns.local`), so each socket gets an event once. The drain notice is local too (`io.local`, fixed in task
  7: through the adapter one node's `server:draining` reached every node's sockets). Reads of `ns.adapter.rooms` are
  per child: telephony's seat presence counts a seat's sockets on one child, which self-heals within its 15 s heartbeat
  (as it already did across ws nodes).
- **Signal.** Each child reports `max(connections / 5000, event-loop lag p99 / 50 ms)` every 5 s (`websocket.scaling.ts`,
  `perf_hooks.monitorEventLoopDelay`); the supervisor averages them: up at ≥ 1 held 60 s, down below 0.5 held 30 min
  (`PROC_WS_UP_AT`, `_DOWN_AT`, `_UP_FOR`, `_DOWN_FOR` override). The heartbeat info carries `load: { connections,
  lagP99Ms, ratio }`.
- **Drain (scale-down).** The drained child (the newest) closes its listener at once (the primary routes new connections
  to its siblings), keeps its sockets until they all left or the socket grace passed (the supervisor's drain grace minus a
  tenth, at most a minute: 11 min → **10 min**; `PROC_WS_DRAIN_MS`), then sends the reconnect hint — `server:draining`
  on every namespace, the same notice a rolling deploy sends — and closes the rest in ten batches over 5 s. Clients
  reconnect on it already (dashboard, fleet and automation re-ticket on `server:draining`; messaging, telephony and the
  native client on the disconnect that follows, with backoff; collab and the status page through socket.io's own
  reconnection). A SIGTERM during that wait escalates it (hint and close at once). A SIGTERM or a group shutdown drains as
  before (notice, close, within `SHUTDOWN_GRACE_MS`).

## Sockets follow the session (control channel)

Authentication is a **single-use ticket at the handshake**; nothing re-checks it afterwards. So that a revoked session, a removed or suspended member and a deleted account do not leave a live socket behind, the gateway also subscribes to one **control channel** (`ws:control`, `websocket.control.ts`, socket.io-free like the rest of the publish side). The HTTP process publishes `{ kind: 'disconnect_user', userId, tenantId? }` and every node drops **its own** matching sockets in every namespace (`disconnectUserSockets`; an identity with no tenant matches on the user alone). Two extension contributions feed it, from the separate leaf module [`websocket_session`](../websocket_session/README.md) (contributing from `websocket` itself would close the contribution cycle `websocket → tenant_member → dashboard → websocket`): `user_session:session_revoked` (logout, sign out other devices, log out everywhere, password change, account deletion) and `tenant_member:membership_ended` (removed, suspended, deprovisioned). A second kind, `{ kind: 'disconnect_tenant', tenantId }`, drops every socket of a tenant on every node; `websocket_session` publishes it from `tenant:lifecycle_sink` when a tenant is suspended, its deletion starts, or it is purged (risk register websocket.09). The ticket carries no session id, so a revoked session drops all of that user's sockets **in that tenant**; a device still signed in reconnects with a fresh ticket. Sessions that only *expire* are not announced (nothing deletes them eagerly), so the ticket may also carry `sessionExpiresAt` (epoch ms): the gateway arms a timer per socket (`armSessionExpiry`, `websocket.session-expiry.ts`) and at the deadline sends `server:reauth` and drops it — the client mints a new ticket, which the HTTP side refuses if the session is gone and grants if it was renewed. A minting route builds the ticket's identity with `wsTicketSubject({ user, userSession })` (`websocket.session-binding.ts`, socket.io-free); messaging, `/collab`, `/fleet`, `/automation`, `/dashboard`, `/telephony` and `/telemetry-tail` all do. It returns `{ userId, userSessionId, sessionExpiresAt }` and **only a full user session gets one**: a caller with no user session (an API key, an IoT device credential) gets 403, a session still waiting for its OTP 401 `OTP_REQUIRED`, a revoked, expired or other user's session 401; nothing is minted. A native app's device-login bearer is a user session and passes. The ticket store enforces the other half: `createWsTicketService` refuses to mint a payload with no `userId` and `consume` treats one as no ticket, so the handshake answers `unauthorized`. See `docs/phases/13-websocket/04-session-lifecycle.md` §4.8.
Authentication is a **single-use ticket at the handshake**; nothing re-checks it afterwards. So that a revoked session, a removed or suspended member and a deleted account do not leave a live socket behind, the gateway also subscribes to one **control channel** (`ws:control`, `websocket.control.ts`, socket.io-free like the rest of the publish side). The HTTP process publishes `{ kind: 'disconnect_user', userId, tenantId? }` and every node drops **its own** matching sockets in every namespace (`disconnectUserSockets`; an identity with no tenant matches on the user alone). Two extension contributions feed it, from the separate leaf module [`websocket_session`](../websocket_session/README.md) (contributing from `websocket` itself would close the contribution cycle `websocket → tenant_member → dashboard → websocket`): `user_session:session_revoked` (logout, sign out other devices, log out everywhere, password change, account deletion) and `tenant_member:membership_ended` (removed, suspended, deprovisioned). A suspended **tenant** is a third case (`tenant:suspension`, also in `websocket_session`): `{ kind: 'disconnect_tenant', tenantId }` drops every socket whose identity names that tenant (`disconnectTenantSockets`), and the tenant fence (`websocket.tenant-fence.ts`, `ws:tenant-fence:<tenantId>`, 120 s, lifted on resume) makes the handshake middleware refuse that tenant as `unauthorized` even with a ticket minted just before the suspension (a fence read that fails refuses too). The ticket carries no session id, so a revoked session drops all of that user's sockets **in that tenant**; a device still signed in reconnects with a fresh ticket. Sessions that only *expire* are not announced (nothing deletes them eagerly), so the ticket may also carry `sessionExpiresAt` (epoch ms): the gateway arms a timer per socket (`armSessionExpiry`, `websocket.session-expiry.ts`) and at the deadline sends `server:reauth` and drops it — the client mints a new ticket, which the HTTP side refuses if the session is gone and grants if it was renewed. A minting route copies both session fields with `wsSessionBinding(userSession)` (`websocket.session-binding.ts`, socket.io-free); messaging, `/collab`, `/fleet`, `/automation`, `/dashboard` and `/telephony` all do. See `docs/phases/13-websocket/04-session-lifecycle.md`.

**Control orders on a stream** (2026-11-03, D247, D248; docs/audits/2026-11-03-redis-outage.md): the control orders now travel on the Redis stream `ws:control:stream` (field `e`, `MAXLEN ~ 100000`), written by `websocket_session` through the [`session_end`](../session_end/README.md) outbox, so an order Redis refused is relayed once it is back. Every node reads every entry from its last place (`websocket.control-stream.ts`, the `iot:kicks` reader's rules): an order written while a node was reconnecting is read when it is back (pub/sub lost it), an entry's `oid` is acted on once, and a GAP (the stream no longer runs through the node's place: Redis lost its data) sends `server:reauth` to every local socket and closes it, tenant by tenant, 200 a second (`reticketAll`), so the HTTP side judges every new ticket against the database. The `ws:control` channel above is still read for one release (an older HTTP process publishes there) and no longer written.


## Re-ticketing an open socket (`ticket:replace`)

A namespace that declares `replace` (`RealtimeReplace` in [websocket.types.ts](server/websocket.types.ts)) lets its client
present a fresh ticket on the socket it already has instead of opening another (docs/phases/07-dashboard/40 D40-4,
D40-5; `/dashboard` is the first): when what it may receive changes (a page switch) and before the namespace's
re-authorisation deadline. The client sends `ticket:replace` `{ ticket }` **with an ack**; the gateway
([websocket.ticket-replace.ts](server/websocket.ticket-replace.ts)) answers `{ ok: true }` or `{ ok: false, reason }`:

- `rate_limited` before any lookup: more than `replace.perMinute` (default 10) replaces of this socket in a minute,
  granted or refused, or an address over its budget of refused tickets (websocket.06);
- `busy`: another replace of this socket is still being checked;
- `unauthorized`: the ticket failed the handshake's own checks (`identityFromTicket` in
  [websocket.auth.ts](server/websocket.auth.ts), shared with the handshake middleware: single use, revocations, the
  socket's upgrade Origin, the tenant fence) or names another user, tenant or session than the socket's. A ticket that is
  no ticket, or someone else's, is counted against the address like a refused handshake.

A refused replace leaves the socket exactly as it was, so a client paced with `rate_limited` or `busy` keeps it (its old
rooms keep flowing) and asks again after a backoff; `unauthorized` is the answer that calls for a new socket with a fresh
ticket (`/dashboard`'s `BoardLiveProvider` does both). A granted one leaves every room the new identity does not name,
joins the ones it does (through the room cap, as on connect) and never leaves a room both name, so their events keep
flowing; then it binds the new identity, re-arms the session expiry (`rearmSessionExpiry`, which also drops the old
timer's `disconnect` listener) and calls `replace.onReplaced`, where the namespace restarts what it keeps per identity
(`/dashboard`: its 900 s bound). The swap and the ack happen in one turn, so every event of a room the socket left
reached it before the ack and none after. A replace without an ack is ignored, nothing looked up. The siege case is
S25.websocket.51 (`ticket-replace.security.test.ts`); the inventory lists `ticket:replace` as an inbound event of every
namespace that declares `replace`.

## Public API

| Export | Source | Use |
|---|---|---|
| `publishToChannel(channel, payload)` | [websocket.pubsub.ts](server/websocket.pubsub.ts) | Publish-side of the Redis bridge. **socket.io-free leaf** — safe to import from the Next HTTP process. |
| `tenantEntityRoom(t, kind, id)` | [websocket.pubsub.ts](server/websocket.pubsub.ts) | Conventional room name `t:<t>:<kind>:<id>`. |
| `createPresence(nsKey, opts)` | [websocket.presence.ts](server/websocket.presence.ts) | Redis TTL presence + short-lived markers (typing, etc.), namespaced by `nsKey`. |
| `createWsTicketService(prefix, opts)` | [websocket.ticket.service.ts](server/websocket.ticket.service.ts) | Single-use handshake tickets (GETDEL, no replay), keyed by `prefix`. Every payload names a user (`userId`); one that does not is never minted or accepted. |
| `makeTicketAuthMiddleware(descriptor)` | [websocket.auth.ts](server/websocket.auth.ts) | `ns.use(...)` handshake middleware that binds `socket.data.identity`. |
| `identityFromTicket(descriptor, ticket, origin, hooks)` | [websocket.auth.ts](server/websocket.auth.ts) | The checks a presented ticket passes to become an identity (authenticate, revocations, Origin, tenant fence); the handshake and `ticket:replace` share them. |
| `installTicketReplace(socket, descriptor, hooks)` | [websocket.ticket-replace.ts](server/websocket.ticket-replace.ts) | The gateway's `ticket:replace` handler for a namespace that declares `replace`. |
| `wsTicketSubject({ user, userSession })` | [websocket.session-binding.ts](server/websocket.session-binding.ts) | The ticket's identity, `{ userId, userSessionId, sessionExpiresAt }`; throws 401/403 unless the caller is a full user session (§4.8). Every mint route calls it. **socket.io-free leaf.** |
| `wsSessionBinding(session)` | [websocket.session-binding.ts](server/websocket.session-binding.ts) | Just the session fields, `{ userSessionId?, sessionExpiresAt? }`, with no check; `wsTicketSubject` uses it. **socket.io-free leaf.** |
| `RealtimeNamespace<Id, Evt>` (type) | [websocket.types.ts](server/websocket.types.ts) | The descriptor contract a domain contributes. Type-only. |
| `RealtimeEmitTarget` / `RealtimeRoomEmitter` (types) | [websocket.types.ts](server/websocket.types.ts) | What `dispatch(target, event)` gets: `target.to(room).emit(...)` (this node's sockets only), optionally narrowed with `.except(room \| rooms)` to leave a room's sockets out (2026-10-17; honoured on the plain, volatile and coalesced paths; optional in the type so emit-only test doubles still fit). |
| gateway process | [index.ts](server/index.ts) | `ws:start`/`ws:dev` entry point. |

## Delivery options, limits and metrics (descriptor fields)

Both are optional; a descriptor without them behaves exactly as before. Types: `RealtimeDelivery`, `RealtimeLimits` in
[websocket.types.ts](server/websocket.types.ts). Enforced by the gateway, never by the descriptor.

```ts
delivery: { coalesceMs: 250, keyOf: (e) => e.topic, volatile: false, maxBufferedBytes: 2_000_000 },
limits:   { maxConnectionsPerTenant: 500, maxConnectionsPerUser: 10, maxRoomsPerSocket: 200, inboundEventsPerMinute: 120 },
```

| Field | Effect |
|---|---|
| `delivery.coalesceMs` + `keyOf` | Bridge events: keep the newest emit per `(room, except rooms, key, event)` and flush every window (latest wins). |
| `delivery.volatile` | Emit with `.volatile`; a socket that cannot take the packet drops it. |
| `delivery.maxBufferedBytes` | Socket over it on two consecutive sweeps: `server:lagging`, then disconnect (client re-tickets and re-fetches). |
| `limits.maxConnectionsPerTenant` / `PerUser` | Cluster-wide, in Redis; over the cap the handshake fails with `Error('limit_exceeded')`, `err.data = { code: 'connection_limit', scope }`. A crashed node's slots expire in 90 s. Identity must carry `tenantId` / `userId`. |
| `limits.maxRoomsPerSocket` | `socket.join` beyond the cap is ignored (the own-id room does not count). |
| `limits.inboundEventsPerMinute` | Per-socket sliding window; extra events are dropped and answered with `server:rate_limited`. |
| `replace` | `{ rooms(identity), onReplaced?, perMinute? }`: the socket takes a fresh ticket in place (`ticket:replace`, above). |

Engine settings are explicit (`GATEWAY_ENGINE_OPTIONS`): `maxHttpBufferSize` 1 MB, `pingInterval` 25 s, `pingTimeout` 20 s.

Metrics (per `namespace` label, on the process port's `/metrics` when `METRICS_ENABLED=true`): `ws_sockets`,
`ws_bridged_events_total`, `ws_emits_total`, `ws_coalesced_dropped_total`, `ws_volatile_dropped_total`,
`ws_lagging_disconnects_total`, `ws_session_expired_total`, `ws_rooms_refused_total`, `ws_inbound_dropped_total`,
`ws_ticket_replaced_total`, `ws_ticket_replace_refused_total`,
`ws_connections_refused_total{reason=unauthorized|tenant_limit|user_limit}`. The node heartbeat is `v: 2` with
`namespaces: [{ path, sockets }]`; `readWsNodes()` accepts v1 and v2.

---

## ⚠️ socket.io-free split

`socket.io` is value-imported **only** in `index.ts` + `websocket.auth.ts` (and
in each consumer's descriptor, which the gateway loads lazily). `websocket.pubsub.ts`,
`websocket.presence.ts`, `websocket.ticket.service.ts`, and `websocket.types.ts`
import no WS runtime, so the Next HTTP process can use them without loading socket.io.
**Import the specific subpath, never the barrel**, from Next-side code.

---

## Registering a namespace (consumer side)

1. Add a `server/realtime-namespace.ts` that `export default`s a `RealtimeNamespace`.
2. Declare it in the consumer's `module.json`:
   `extensions: [{ point: "websocket:namespace", key: "<id>", export: "<id>/server/realtime-namespace" }]`
   and add `"./server/realtime-namespace"` to the consumer's `package.json` exports.
3. Add `"websocket"` to the consumer's `dependencies.requires`.
4. Run `npm run registry:snapshot`.

See `modules/messaging` for the reference implementation.

---

## Pre-launch load check (required for high-rate namespaces)

A namespace expected to carry more than a few events per second per node, or thousands of concurrent sockets
(telemetry, presence-heavy, collaborative cursors), is **not launched** until its owner has run the load harness
against its expected socket count and event rate and recorded the p95 latency, Redis CPU and the zero-duplicate /
zero-cross-room / zero-drop result:

```bash
npm run ws:load -- --embedded 1 --sockets <N> --rooms <M> --rate <K> --duration 60 --json result.json
# multi-node: docker compose --profile loadtest up -d --build --scale ws-load-node=4 redis ws-load-node ws-lb
#             npm run ws:load -- --urls http://127.0.0.1:4100 ...
```

Method, harness internals, adapter / channel-partition / sizing / rolling-deploy decisions: [SCALING.md](SCALING.md).

---

## Config

| Env | Default | Use |
|---|---|---|
| `WS_PORT` | `4001` (via `MESSAGING_WS_PORT`) | Gateway listen port. |
| `WS_PUBLIC_URL` | — | Public URL returned to browsers with the handshake ticket. |
| `WS_CORS_ORIGIN` | permissive | Allowed CORS origin. |
| `PROC_WS_ENABLED` | `false` | `true`: supervisor + `cluster` children sharing `WS_PORT` (see "Scaling"). `PROC_WS_MIN`, `_MAX`, `_UP_AT`, `_DOWN_AT`, `_UP_FOR`, `_DOWN_FOR`, `_DRAIN_MS`, `_CHILD_MB` tune it. |
| `WS_SUPERVISOR_PORT` | `4014` | The supervisor's `/healthz` and `/metrics` when supervised (must differ from `WS_PORT`). |

Legacy `MESSAGING_WS_*` values are honoured as a fallback for back-compat.

No entities, no routes, no settings — pure infrastructure.
