import type { WsTicketService } from '@kuraykaraaslan-labs/websocket/server/websocket.ticket.service';
import { TAIL_TICKET_PREFIX, type TailTicketPayload } from './telemetry.tail.realtime';

/**
 * Single-use `/telemetry-tail` handshake tickets (Redis, GETDEL: a ticket cannot be replayed). The payload IS the authorised identity.
 *
 * `websocket` is an OPTIONAL dependency of this module, so the ticket service is reached through `import()` (EXT-14), once, on first use.
 * Both callers are already on a path where the module is there: the gateway (which is the websocket module) and the ticket route (which
 * answers "no live tail" before it gets here when the module is absent).
 */
let service: Promise<WsTicketService<TailTicketPayload>> | null = null;
function ticketService(): Promise<WsTicketService<TailTicketPayload>> {
  service ??= import('@kuraykaraaslan-labs/websocket/server/websocket.ticket.service').then((m) => m.createWsTicketService<TailTicketPayload>(TAIL_TICKET_PREFIX));
  return service;
}

export const tailTicketService = {
  async mint(payload: TailTicketPayload): Promise<{ ticket: string; expiresIn: number }> { return (await ticketService()).mint(payload); },
  async consume(ticket: string): Promise<TailTicketPayload | null> { return (await ticketService()).consume(ticket); },
};
