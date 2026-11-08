// smtp: HOST-SIDE raw-SMTP transport for sandboxed mail provider plugins. A V8
// isolate has no TCP sockets, so it cannot speak SMTP — it hands the (non-secret)
// transport config + message here and the broker sends via nodemailer. The SMTP
// password is read host-side from the plugin's encrypted secrets (never enters the
// isolate), mirroring the crypto.* capabilities.
//
// The host and port come from the plugin, so the broker (the tier that holds the
// credentials and sits inside the network) is an SSRF vector (plugin_runtime.02):
// the host is resolved here, every address it resolves to must be public
// (common/server/ip-guard plus multicast / reserved), and the connection goes to the
// checked address with the host name kept as the TLS servername, so a DNS rebind
// between check and connect cannot move it. PLUGIN_SMTP_INTERNAL_HOSTS (operator env
// only) lists the host:port pairs that may be internal, e.g. a local relay.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import nodemailer from 'nodemailer';
import { isBlockedIp, ipv4ToInt, ipv6ToBigInt } from '@kuraykaraaslan-labs/common/server/ip-guard';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption';
import type { Json } from '../../../sdk/types';
import { SECRET_PREFIX, configTenantOf, type BrokerCtx } from '../broker.context';

interface SmtpSendConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user?: string;
  /** Name of the plugin secret holding the SMTP password (decrypted host-side). */
  passwordSecret?: string;
}
/**
 * The Content-IDs nodemailer may write: the host checks them (`notification_mail.attachments`), but this message comes
 * from the isolate, so a cid that is not plain characters is dropped and the file goes as an ordinary attachment.
 */
const CID_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;
/**
 * A leaf content type (the host's `notification_mail.attachments` check, repeated because this message comes from the
 * isolate). `message/*` and `multipart/*` are refused: nodemailer would write their bytes into SMTP DATA unencoded
 * and `message/rfc822` inline, a forged message inside the real one.
 */
const CONTENT_TYPE_RE = /^(?:application|image|text|audio|video|font)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;

/**
 * The message's files as nodemailer attachments. Every one is sent base64 (`contentTransferEncoding`), whatever its
 * type, so no tenant or plugin byte ever reaches SMTP DATA raw: no NUL, no bare CR, no line over 998 characters.
 */
function attachmentsOf(list: SmtpMessage['attachments']) {
  if (list === undefined || list === null) return undefined;
  if (!Array.isArray(list)) throw new Error('smtp.send: attachments must be a list');
  return list.map((a, i) => {
    const contentType = a?.contentType === undefined || a.contentType === '' ? undefined : String(a.contentType);
    if (contentType !== undefined && !CONTENT_TYPE_RE.test(contentType)) {
      throw new Error(`smtp.send: attachment ${i + 1} has a content type that cannot be sent`);
    }
    const cid = typeof a?.cid === 'string' && CID_RE.test(a.cid) ? a.cid : undefined;
    return {
      filename: String(a?.filename ?? ''),
      content: Buffer.from(typeof a?.contentBase64 === 'string' ? a.contentBase64 : '', 'base64'),
      // Without a type nodemailer guesses one from the name (`x.eml` -> message/rfc822, which it would make inline):
      // the disposition is therefore set here, inline only for an image the HTML references by Content-ID.
      ...(contentType !== undefined && { contentType }),
      contentDisposition: cid && (!contentType || /^image\//i.test(contentType)) ? 'inline' as const : 'attachment' as const,
      contentTransferEncoding: 'base64' as const,
      ...(cid && { cid }),
    };
  });
}

interface SmtpMessage {
  from?: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  /** A file with a `cid` is an inline image the HTML shows as `cid:<id>`. */
  attachments?: Array<{ filename: string; contentBase64: string; contentType?: string; cid?: string }>;
  /**
   * Extra headers, already sanitised host-side by
   * `notification_mail.sanitizeMailHeaders` (no CRLF, no recipient or sender
   * fields). nodemailer writes these verbatim, so that check is load-bearing —
   * this is the one transport in the tree where a newline in a value would
   * split the header block.
   */
  headers?: Record<string, string>;
  /**
   * Threading fields, passed as nodemailer's first-class options rather than
   * inside `headers`. Given both, nodemailer would emit the header twice and
   * receivers disagree about which wins — so the caller picks one road and this
   * is it.
   */
  messageId?: string;
  inReplyTo?: string;
  references?: string;
}

/**
 * Header fields a plugin may not set (the host's `notification_mail.sanitizeMailHeaders` list, repeated because this
 * message comes from the isolate): recipients, sender and the MIME structure nodemailer owns.
 */
const FORBIDDEN_HEADERS = new Set([
  'bcc', 'cc', 'to', 'from', 'return-path', 'sender',
  'content-type', 'content-transfer-encoding', 'content-disposition', 'mime-version',
]);
/** RFC 5322 field name: printable US-ASCII except colon. */
const HEADER_NAME_RE = /^[!-9;-~]{1,128}$/;

/**
 * nodemailer writes `headers` verbatim, so a CR/LF in a value would end the header block and a `Bcc` would add a
 * hidden recipient (plugin_runtime.02). The host sanitises what it passes, but the isolate can pass anything: refused
 * here with fixed messages.
 */
function checkedHeaders(headers: SmtpMessage['headers']): Record<string, string> | undefined {
  if (headers === undefined || headers === null) return undefined;
  if (typeof headers !== 'object' || Array.isArray(headers)) throw new Error('smtp.send: headers must be an object');
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim();
    const value = String(rawValue ?? '');
    if (!HEADER_NAME_RE.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new Error('smtp.send: header not allowed');
    if (/[\r\n\0]/.test(value)) throw new Error('smtp.send: header contains a line break');
    out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** True for IPv4 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved, broadcast), IPv6 ff00::/8 and their mapped forms. */
function isMulticastOrReserved(ip: string): boolean {
  if (ip.includes(':')) {
    const big = ipv6ToBigInt(ip);
    if (big === null) return false;
    if (big >> BigInt(120) === BigInt(0xff)) return true;
    // IPv4-mapped ::ffff:0:0/96: judge the embedded IPv4.
    if (big >> BigInt(32) === BigInt(0xffff)) return (Number(big & BigInt(0xffffffff)) >>> 28) >= 0xe;
    return false;
  }
  const v4 = ipv4ToInt(ip);
  return v4 !== null && v4 >>> 28 >= 0xe;
}

/** Loopback, private, link-local (metadata), CGNAT, multicast, reserved: never an SMTP target for a plugin. */
const isInternalAddress = (ip: string): boolean => isBlockedIp(ip) || isMulticastOrReserved(ip);

/** A host as the plugin names it: lower case, an IPv6 literal without its brackets, no trailing dot. */
function normalizeHost(raw: string): string {
  const h = raw.trim().toLowerCase();
  const unbracketed = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
  return unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed;
}

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * PLUGIN_SMTP_INTERNAL_HOSTS: the operator's `host:port` pairs that may be internal (`127.0.0.1:1025,[::1]:25`). Read
 * from the process environment on every call; no tenant setting or plugin argument reaches it.
 */
function internalHostAllowlist(): Set<string> {
  const out = new Set<string>();
  for (const entry of String(process.env.PLUGIN_SMTP_INTERNAL_HOSTS ?? '').split(',')) {
    const e = entry.trim();
    const colon = e.lastIndexOf(':');
    if (colon <= 0) continue;
    const port = Number(e.slice(colon + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    out.add(`${normalizeHost(e.slice(0, colon))}|${port}`);
  }
  return out;
}

/**
 * Resolve the plugin's SMTP host and pick the address to connect to. Every address must be public unless the exact
 * host:port is on the operator's list; the first one is pinned. Fixed messages: the address is never quoted back.
 */
async function resolveSmtpTarget(rawHost: string, port: number): Promise<{ address: string; servername?: string }> {
  const host = normalizeHost(String(rawHost));
  const literal = isIP(host) !== 0;
  if (!literal && !HOSTNAME_RE.test(host)) throw new Error('smtp.send: invalid host');
  let addresses: Array<{ address: string }>;
  if (literal) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error('smtp.send: host could not be resolved');
    }
  }
  if (!addresses.length) throw new Error('smtp.send: host could not be resolved');
  if (!internalHostAllowlist().has(`${host}|${port}`) && addresses.some((a) => isInternalAddress(a.address))) {
    throw new Error('smtp.send: host resolves to an internal address');
  }
  return { address: addresses[0]!.address, ...(literal ? {} : { servername: host }) };
}

export const smtp = {
  async send(ctx: BrokerCtx, config: SmtpSendConfig, message: SmtpMessage): Promise<Json> {
    const c = config ?? ({} as SmtpSendConfig);
    if (!c.host) throw new Error('smtp.send: host required');
    const port = Number(c.port) || 587;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('smtp.send: invalid port');
    // Checked and pinned before any secret is read or transport exists; the host name stays the TLS servername
    // (SNI + certificate check).
    const target = await resolveSmtpTarget(c.host, port);
    const m = message ?? ({} as SmtpMessage);
    const headers = checkedHeaders(m.headers);
    let pass: string | undefined;
    if (c.user) {
      const raw = await SettingService.getValue(configTenantOf(ctx), SECRET_PREFIX(ctx.pluginId) + (c.passwordSecret ?? 'smtpPassword'));
      const dec = decryptFieldOpt(raw);
      pass = typeof dec === 'string' ? dec : undefined;
    }
    const transport = nodemailer.createTransport({
      host: target.address,
      // nodemailer hands `tls` to tls.connect for implicit TLS and STARTTLS alike: SNI and the certificate check use it.
      ...(target.servername ? { tls: { servername: target.servername } } : {}),
      port,
      secure: c.secure ?? port === 465,
      auth: c.user ? { user: c.user, pass: pass ?? '' } : undefined,
    });
    const attachments = attachmentsOf(m.attachments); // checked before anything is sent
    const result = await transport.sendMail({
      from: m.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      replyTo: m.replyTo,
      cc: m.cc?.join(', '),
      bcc: m.bcc?.join(', '),
      headers,
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
      references: m.references,
      attachments,
    });
    return { messageId: result.messageId ?? null } as Json;
  },
};
