import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The ticket of a protected pack (dashboard phase 33, ADR-0016, contract C2-C4): what the pack route checks before it serves a
 * pack's code. A module's ticket route decides who may have which packs (a member's session, a display link) and asks for one;
 * the pack route then checks only this signature, so a pack request costs no database query.
 *
 * `<base64url claims>.<base64url HMAC-SHA-256>`, the key derived from the deployment's ACCESS_TOKEN_SECRET for this use only
 * (`kui-pack-ticket-v1`), compared in constant time. Short-lived: a page asks again when it runs out.
 */

export const PACK_TICKET_TTL_SECONDS = 600;

/** What a ticket says. Short names: the ticket travels in every pack URL. */
export interface PackTicketClaims {
  /** Tenant. */
  t: string;
  /** Module whose packs it opens. */
  m: string;
  /** The packs it opens. */
  p: string[];
  /** The mark of this download (16 hex), written into every pack served under it. */
  k: string;
  /** Expiry, unix seconds. */
  e: number;
  /** Who asked: `u:<userId>` or `d:<displayLinkId>`. */
  s: string;
}

const MARK_RE = /^[0-9a-f]{16}$/;
const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/** A fresh mark id: 64 random bits as 16 lower-case hex. */
export const newPackMark = (): string => randomBytes(8).toString('hex');

const keyFor = (secret: string): Buffer => createHmac('sha256', secret).update('kui-pack-ticket-v1').digest();
const mac = (body: string, secret: string): Buffer => createHmac('sha256', keyFor(secret)).update(body).digest();

export function signPackTicket(claims: PackTicketClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${mac(body, secret).toString('base64url')}`;
}

function isClaims(v: unknown): v is PackTicketClaims {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.t === 'string' && typeof c.m === 'string' && ID_RE.test(c.m)
    && Array.isArray(c.p) && c.p.length <= 200 && c.p.every((x) => typeof x === 'string' && ID_RE.test(x))
    && typeof c.k === 'string' && MARK_RE.test(c.k)
    && typeof c.e === 'number' && Number.isSafeInteger(c.e)
    && typeof c.s === 'string' && c.s.length <= 80;
}

/** The claims of a ticket whose signature holds and that has not run out; null for anything else. */
export function verifyPackTicket(ticket: string, secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): PackTicketClaims | null {
  if (typeof ticket !== 'string' || ticket.length > 8192) return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0 || dot !== ticket.lastIndexOf('.')) return null;
  const body = ticket.slice(0, dot);
  const given = Buffer.from(ticket.slice(dot + 1), 'base64url');
  const want = mac(body, secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isClaims(claims) || claims.e <= nowSeconds) return null;
  return claims;
}
