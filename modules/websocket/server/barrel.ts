// Barrel for the websocket module. WARNING: this re-exports the gateway/auth,
// which value-import `socket.io`. The Next.js HTTP process MUST NOT import this
// barrel — import the specific socket.io-free subpath instead
// (`@kuraykaraaslan-labs/websocket/server/websocket.pubsub`).
export { publishToChannel, tenantEntityRoom } from './websocket.pubsub';
export { createPresence } from './websocket.presence';
export type { Presence, PresenceOptions } from './websocket.presence';
export { createWsTicketService } from './websocket.ticket.service';
export type { WsTicketService, WsTicketServiceOptions, WsTicketPayloadBase } from './websocket.ticket.service';
export { makeTicketAuthMiddleware } from './websocket.auth';
export type { RealtimeNamespace, RealtimeEmitTarget, RealtimeRoomEmitter, WsIdentity, WsSocketData } from './websocket.types';
export { localEmitTarget } from './websocket.delivery';
