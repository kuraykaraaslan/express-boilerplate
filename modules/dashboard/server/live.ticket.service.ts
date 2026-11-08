import { createWsTicketService } from '@kuraykaraaslan-labs/websocket/server/websocket.ticket.service'
import { LIVE_TICKET_PREFIX, type LiveTicketPayload } from './live.types'

/** Single-use `/dashboard` handshake tickets; the payload IS the authorised topic list. */
export const liveTicketService = createWsTicketService<LiveTicketPayload>(LIVE_TICKET_PREFIX)
