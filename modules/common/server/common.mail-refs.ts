/**
 * The wire format that ties an outbound mail to the reply that comes back.
 *
 * ## Why this is its own file, with no imports
 *
 * Two modules read this shape and they are deliberately strangers: the sender
 * (`contact.OutboundGateService`) writes the `Message-ID`, and the receiver
 * (`mail_inbound`, W2) parses `In-Reply-To`/`References` looking for it. Neither
 * may import the other — gelen posta giden postayı tanımaz — so without a shared
 * definition each would carry its own regex, the two would drift, and the
 * symptom would be the worst kind: "the customer replied but the sequence kept
 * emailing them." A cadence that cannot hear "no" is the single most expensive
 * bug in outbound.
 *
 * So the format lives once, at the bottom of the dependency graph, importing
 * nothing. Same call the tree already makes for `common.crm-contracts.ts`.
 *
 * ## The format
 *
 *     <mi.{outboundId}.{t8}@{domain}>
 *
 * - `mi.` — a fixed prefix, so a foreign `Message-ID` is rejected by shape
 *   before anything is parsed out of it.
 * - `outboundId` — a uuid the sender generated and stored. This is the whole
 *   payload; everything else is framing.
 * - `t8` — the first 8 hex chars of the tenant id, with the dashes removed. NOT
 *   a security boundary and not a lookup key: it is a cheap sanity check that a
 *   reply landing on tenant A's alias really belongs to tenant A, and a way to
 *   tell two tenants' ids apart in a log. The authoritative tenant scoping is
 *   the alias the mail arrived on plus the `tenantId` column on the row.
 * - `domain` — the sending domain. Receivers do not have to honour it, and some
 *   providers overwrite the whole header (see the SES note in
 *   `notification_mail/server/providers/base.provider.ts`), which is exactly why
 *   `parseOutboundRef` must never be the ONLY way a reply is matched.
 */

/**
 * `activities.sourceModule` for an outbound email, and the third thing the two
 * strangers have to agree on.
 *
 * The sender writes one activity row per message with
 * `(sourceModule, externalRef) = (OUTBOUND_SOURCE_MODULE, outboundId)`, and the
 * receiver finds the message a reply answers by looking that pair up. Written
 * as a literal on either side, the two would be one rename apart from a state
 * where every reply opens a new lead and no sequence ever stops.
 *
 * The value is the MODULE that owns the send (`contact`), not a channel name —
 * `logFromSource`'s partial unique index is `(tenantId, sourceModule,
 * externalRef)`, and `sourceModule` there means "which module wrote this row"
 * everywhere else in the tree.
 */
export const OUTBOUND_SOURCE_MODULE = 'contact';

/** The uuid a sender stores so a reply can be traced back to one message. */
export interface OutboundRef {
  outboundId: string;
  /** First 8 hex chars of the sending tenant's id. */
  tenantHint: string;
  domain: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `<mi.{uuid}.{8 hex}@{domain}>`
 *
 * Anchored, and the domain is deliberately permissive (anything without `>`,
 * `@` or whitespace) — we are recognising OUR OWN id, not validating somebody
 * else's hostname, and a stricter pattern would only reject valid replies from
 * a sending domain we did not anticipate.
 */
const OUTBOUND_REF_RE =
  /^mi\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{8})@([^\s@<>]+)$/i;

/** First 8 hex chars of a tenant uuid, dashes removed. */
export function tenantHint(tenantId: string): string {
  return tenantId.replace(/-/g, '').slice(0, 8).toLowerCase();
}

/**
 * Build the `Message-ID` value for an outbound mail — angle brackets included,
 * because that is what the header field actually carries and callers that build
 * them by hand forget one side.
 */
export function buildOutboundRef(outboundId: string, tenantId: string, domain: string): string {
  return `<mi.${outboundId.toLowerCase()}.${tenantHint(tenantId)}@${domain}>`;
}

/**
 * Recognise one of our own message ids. Returns `null` for anything else —
 * including a well-formed `Message-ID` from a stranger, which is the common
 * case and not an error.
 *
 * Accepts the value with or without angle brackets: `In-Reply-To` arrives
 * bracketed, but header parsers vary and a caller that already stripped them
 * should not get a silent miss.
 */
export function parseOutboundRef(messageId: string | null | undefined): OutboundRef | null {
  if (!messageId) return null;
  const bare = messageId.trim().replace(/^</, '').replace(/>$/, '').trim();
  const m = OUTBOUND_REF_RE.exec(bare);
  if (!m) return null;
  return { outboundId: m[1]!.toLowerCase(), tenantHint: m[2]!.toLowerCase(), domain: m[3]! };
}

/**
 * Walk a `References` chain newest-first and return the first id that is ours.
 *
 * Newest-first because the nearest ancestor is the most specific answer: a long
 * thread may reference several of our messages, and the reply is a reply to the
 * last one. Callers pass the header already split into ids.
 *
 * Bounded at 10 by default. `References` grows without limit on a long thread
 * and an unbounded scan over an attacker-supplied header is a cheap way to burn
 * CPU on every inbound message.
 */
export function findOutboundRef(references: readonly string[], limit = 10): OutboundRef | null {
  const tail = references.slice(-limit);
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const ref = parseOutboundRef(tail[i]);
    if (ref) return ref;
  }
  return null;
}

/** True when `value` is a syntactically valid outbound id (a plain uuid). */
export function isOutboundId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * The domain half of a mailbox — `Name <box@domain>` or a bare address.
 *
 * Here, in the file neither side may import the other from, because BOTH sides
 * derive the same thing from it: the sender scopes the `Message-ID` to this
 * domain and stamps `X-Loop` with it, and the receiver compares its own loop
 * token against the answer. Two regexes in two modules would drift, and the
 * symptom of that drift is a mail loop that nobody notices until a mailbox has
 * ten thousand messages in it — the exact failure `loopToken` exists to stop.
 *
 * Returns null rather than a placeholder: a caller that cannot name its own
 * sending domain must decide for itself what that means, and for the inbound
 * side it means "skip loop detection", not "compare against a fake domain that
 * matches nothing".
 */
export function domainOfMailbox(from: string | null | undefined): string | null {
  if (!from) return null;
  const match = /@([^\s>]+?)>?\s*$/.exec(from.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * The `X-Loop` value we stamp on outbound mail, and recognise on inbound.
 *
 * Two automated systems answering each other forever is the classic mail
 * failure, and the only thing that stops it is each side recognising its own
 * mail coming back. So this lives next to the `Message-ID` format for the same
 * reason: the sender and the receiver are two modules that may not import each
 * other, and a second definition of "is this ours" would drift into a loop that
 * nobody can see until a mailbox has ten thousand messages in it.
 *
 * The value is the SENDING DOMAIN, not an alias address. A tenant has one
 * sending domain and many aliases; keying on the domain means a reply that came
 * back through any of them is still recognised, and the inbound side does not
 * have to load the alias table before it can decide.
 */
export function loopToken(sendingDomain: string): string {
  return sendingDomain.trim().toLowerCase();
}

/**
 * Did this message originate from us?
 *
 * `header` is the raw `X-Loop` value as received. Compared case-insensitively
 * because header values survive round trips through gateways that do not
 * preserve case.
 */
export function isOurLoopToken(header: string | null | undefined, sendingDomain: string): boolean {
  if (!header) return false;
  return header.trim().toLowerCase() === loopToken(sendingDomain);
}
