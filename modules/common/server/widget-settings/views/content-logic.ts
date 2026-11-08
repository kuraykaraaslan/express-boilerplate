// Vendored from kui-react f7db139: modules/app/WidgetKit/views/content-logic.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// Pure safety logic of the Content widgets (markdown, image, links, embed). No React: the
// templates' save-time rules and the views' render-time checks use the same functions.
//
// Ported from next-boilerplate `modules/dashboard/ui/data-widgets/content-logic.ts` (phase 14).
// The rule across all four: an author-supplied string is DATA until proven otherwise. Markdown is
// parsed to a node tree that React renders (no HTML string is ever built, so raw HTML in the source
// is shown as text, never executed); URLs pass an allow-list of schemes; the embed URL also refuses
// private hosts.

import type { IssueCode, IssueParams } from '../settings/types';

// ── URLs ───────────────────────────────────────────────────────────────────

export interface SafeLink { href: string; external: boolean }

const CONTROL = /[\u0000-\u001f\u007f\s]/;

/**
 * Link target allow-list: an INTERNAL path (`/x`, never `//host`, never a backslash trick),
 * `https:`, `http:` or `mailto:`. Anything else (`javascript:`, `data:`, `vbscript:`, a scheme-less
 * host) is null, so a link is dropped rather than made inert-but-present. Control characters and
 * whitespace are refused outright because browsers strip them before resolving a scheme
 * (`java\tscript:`).
 */
export function resolveLink(raw: unknown): SafeLink | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.length > 2048 || CONTROL.test(v)) return null;
  if (/^\/(?![/\\])/.test(v)) return { href: v, external: false };
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') return { href: u.toString(), external: true };
  } catch { /* not absolute */ }
  return null;
}

/** Image source allow-list: an internal path or `https:` / `http:`. No `data:` (SVG can carry script in some contexts). */
export function resolveImageSrc(raw: unknown): string | null {
  const link = resolveLink(raw);
  if (!link || link.href.startsWith('mailto:')) return null;
  return link.href;
}

/**
 * An internal path rewritten by the host (e.g. a tenant prefix), then checked again: the rewritten
 * address must still pass the same allow-list, or the link is dropped. External links are untouched.
 */
export function hostLink(link: SafeLink | null, resolveUrl?: (url: string) => string): SafeLink | null {
  if (!link || link.external || !resolveUrl) return link;
  return resolveLink(resolveUrl(link.href));
}

/** An image source rewritten by the host when internal, then checked again. */
export function hostImageSrc(raw: unknown, resolveUrl?: (url: string) => string): string | null {
  const src = resolveImageSrc(raw);
  if (!src || !resolveUrl || !src.startsWith('/')) return src;
  return resolveImageSrc(resolveUrl(src));
}

// ── Attribute tokens ───────────────────────────────────────────────────────

const ATTR_TOKEN = /\{\{attr_([A-Za-z][A-Za-z0-9_]{0,59})\}\}/g;

/** Whether an address template carries `{{attr_<key>}}` tokens. */
export function hasAttrTokens(raw: unknown): boolean {
  return typeof raw === 'string' && new RegExp(ATTR_TOKEN.source).test(raw);
}

/**
 * A record field's text for a token: a number, a string or a boolean; nothing else (an object or a
 * missing field is no value).
 */
function attrText(record: Record<string, unknown> | undefined, key: string): string | null {
  const v = record?.[key];
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return null;
}

/**
 * The address with `{{attr_<key>}}` filled from the placement's record slot (the entity's attributes).
 * The scheme and host stay what the setting says: a token before the end of the authority (`https://{{attr_h}}/`,
 * `https://x@{{attr_h}}`) makes the whole address unusable, and each value is URL-encoded, so a value can
 * add neither a host, a scheme nor a path escape. An address without tokens comes back unchanged; one with a
 * token that has no value is `null` (the link or frame is dropped, never half-built). The result still goes through
 * `resolveLink` / `resolveEmbedUrl` like any other address.
 */
export function expandAttrTemplate(raw: unknown, record: Record<string, unknown> | undefined): unknown {
  if (!hasAttrTokens(raw)) return raw;
  const template = raw as string;
  const authorityEnd = /^[a-z][a-z0-9+.-]*:\/\//i.test(template) ? template.indexOf('/', template.indexOf('//') + 2) : 0;
  const head = authorityEnd === -1 ? template : template.slice(0, authorityEnd);
  if (authorityEnd !== 0 && hasAttrTokens(head)) return null;
  let missing = false;
  const out = template.replace(ATTR_TOKEN, (_, key: string) => {
    const t = attrText(record, key);
    if (t === null) { missing = true; return ''; }
    return encodeURIComponent(t);
  });
  return missing ? null : out;
}

// ── Embed ──────────────────────────────────────────────────────────────────

export type EmbedResult =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'scheme' | 'credentials' | 'host' | 'port' }
  /** The address is a valid public one, but the host's allow-list does not name its site. */
  | { ok: false; reason: 'notAllowed'; host: string };

function ipv4Blocked(h: string): boolean {
  const p = h.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)   // carrier-grade NAT
    || (a === 169 && b === 254)             // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}

function ipv6Blocked(h: string): boolean {
  const v = h.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped) return ipv4Blocked(mapped[1]);
  if (v.startsWith('::ffff:')) return true;                        // hex-spelled mapped IPv4
  return /^(fc|fd|fe[89ab]|ff)/.test(v);                           // ULA, link-local, multicast
}

/** A hostname that names no public internet host. */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (h.includes(':')) return ipv6Blocked(h);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return ipv4Blocked(h);
  // Exotic numeric spellings that URL did not normalise to IPv4 (hex `0x7f.1`, octal, a bare 32-bit integer) are refused.
  if (h.split('.').every((l) => /^(0x[0-9a-f]*|\d+)$/i.test(l))) return true;
  if (!h.includes('.')) return true;                                // `intranet`, `localhost`
  return /\.(local|localhost|internal|intranet|lan|home|corp|test|example|invalid)$/.test(h);
}

/**
 * The embed gate. The BROWSER loads the URL, so the risk is the viewer's browser being pointed at
 * an internal address (admin consoles, router pages, metadata endpoints) or a credentialed URL.
 * Hence: `https:` only, no `user:pass@`, default port only, no private/loopback/link-local/single-label host.
 */
export function resolveEmbedUrl(raw: unknown, allowedHosts?: readonly string[]): EmbedResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' };
  const v = raw.trim();
  if (v.length > 2048 || CONTROL.test(v)) return { ok: false, reason: 'invalid' };
  let u: URL;
  try { u = new URL(v); } catch { return { ok: false, reason: 'invalid' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (u.username || u.password) return { ok: false, reason: 'credentials' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'port' };
  if (isPrivateHostname(u.hostname)) return { ok: false, reason: 'host' };
  if (allowedHosts && !embedHostAllowed(u.hostname, allowedHosts)) return { ok: false, reason: 'notAllowed', host: u.hostname };
  return { ok: true, url: u.toString(), host: u.hostname };
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * One allow-list entry, normalised: a public hostname (`grafana.example.com`) or a wildcard for its
 * subdomains (`*.example.com`, which does NOT match `example.com` itself). Case and a trailing dot are
 * dropped; anything else (a scheme, port, path, IP address, private or single-label name, a bare `*`)
 * is `null`. Hosts are named, never addresses: an IP entry would allow whatever answers on it.
 */
export function normalizeEmbedHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/\.$/, '');
  const wild = v.startsWith('*.');
  const name = wild ? v.slice(2) : v;
  if (!name || name.length > 253) return null;
  const labels = name.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1]) || isPrivateHostname(name)) return null;
  return wild ? `*.${name}` : name;
}

/**
 * Whether `hostname` is on the allow-list. Entries go through `normalizeEmbedHost` (an invalid one
 * allows nothing); an empty list allows nothing.
 */
export function embedHostAllowed(hostname: string, allowed: readonly string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return allowed.some((raw) => {
    const e = normalizeEmbedHost(raw);
    if (!e) return false;
    return e.startsWith('*.') ? h.endsWith(e.slice(1)) : h === e;
  });
}

/**
 * The sandbox of every embed frame: scripts may run INSIDE the frame but it is an opaque origin
 * (`allow-same-origin` is deliberately absent), so even a URL resolving to the app's own origin
 * cannot reach cookies, storage or DOM. Popups stay sandboxed. No top navigation, modals or downloads.
 */
export const EMBED_SANDBOX = 'allow-scripts allow-popups allow-forms allow-presentation';
export const EMBED_REFERRER_POLICY = 'no-referrer';

/** The permissions an author may switch OFF (the setting's option values), each one token of `EMBED_SANDBOX`. */
export const EMBED_PERMISSIONS = ['scripts', 'forms', 'popups', 'presentation'] as const;

/**
 * The sandbox for an author's permission list. A setting can only REMOVE permissions from
 * `EMBED_SANDBOX`, never add one: anything not in `EMBED_PERMISSIONS` (`same-origin`,
 * `top-navigation`, a crafted string) is ignored. Not a list = the full default set.
 * An empty result is the strictest sandbox (`sandbox=""`).
 */
export function embedSandbox(allow: unknown): string {
  if (!Array.isArray(allow)) return EMBED_SANDBOX;
  const wanted = new Set(allow.filter((x): x is string => typeof x === 'string'));
  return EMBED_PERMISSIONS.filter((p) => wanted.has(p)).map((p) => `allow-${p}`).join(' ');
}

// ── Links ──────────────────────────────────────────────────────────────────

export interface QuickLink {
  label: string;
  description: string;
  icon: string | null;
  iconColor?: unknown;
  color?: unknown;
  link: SafeLink;
}

/** Repeater rows → links. A row with no label or an unsafe target is dropped; capped. */
export function toQuickLinks(raw: unknown, max = 24, record?: Record<string, unknown>): QuickLink[] {
  const out: QuickLink[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= max) break;
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    const link = resolveLink(expandAttrTemplate(o.href, record));
    if (!label || !link) continue;
    out.push({
      label: label.slice(0, 80),
      description: typeof o.description === 'string' ? o.description.slice(0, 160) : '',
      icon: typeof o.icon === 'string' && o.icon ? o.icon : null,
      iconColor: o.iconColor,
      color: o.color,
      link,
    });
  }
  return out;
}

// ── Template rules ─────────────────────────────────────────────────────────
// Each issue carries a `code` (and the field's `label` when the text names it): the message stays
// English for logs and API callers, and a host shows the code in its language (`messages.issues`).

type RuleIssue = { path: string; message: string; code: IssueCode; params?: IssueParams };
type Rule = (v: Record<string, unknown>) => RuleIssue[];

/** Save-time: a link field must be an internal path, https, http or mailto. */
export const safeLinkRule = (key: string, label: string): Rule => (v) =>
  typeof v[key] === 'string' && v[key] !== '' && !resolveLink(v[key])
    ? [{ path: key, message: `${label} must be an internal path (/…) or an https, http or mailto address`, code: 'linkTarget', params: { label } }]
    : [];

/** Save-time: an image address must be an internal path, https or http. */
export const safeImageRule = (key: string): Rule => (v) =>
  typeof v[key] === 'string' && v[key] !== '' && !resolveImageSrc(v[key])
    ? [{ path: key, message: 'The image must be an internal path (/…) or an https or http address', code: 'imageSrc' }]
    : [];

/** Save-time: a media address (video, poster, subtitle file) must be an internal path or an https / http address. */
export const safeMediaRule = (key: string, label: string): Rule => (v) =>
  typeof v[key] === 'string' && v[key] !== '' && !resolveImageSrc(v[key])
    ? [{ path: key, message: `${label} must be an internal path (/…) or an https or http address`, code: 'mediaSrc', params: { label } }]
    : [];

/** Save-time: every subtitle track's file passes the media check. */
export const safeSubtitlesRule = (key: string): Rule => (v) => {
  const list = Array.isArray(v[key]) ? (v[key] as Array<Record<string, unknown>>) : [];
  return list.flatMap((t, i) => (typeof t?.src === 'string' && t.src !== '' && !resolveImageSrc(t.src)
    ? [{ path: `${key}.${i}.src`, message: 'A subtitle file must be an internal path (/…) or an https or http address', code: 'subtitleSrc' }]
    : []));
};

/** Save-time: an embed address must pass the embed gate. */
export const safeEmbedRule = (key: string): Rule => (v) => {
  if (typeof v[key] !== 'string' || v[key] === '') return [];
  const r = resolveEmbedUrl(v[key]);
  return r.ok ? [] : [{ path: key, message: 'Only a public https address can be embedded (no private hosts, ports or credentials)', code: 'embedUrl' }];
};

/** Save-time: every repeater row's target must be a safe link. */
export const safeRowLinksRule = (key: string, field: string): Rule => (v) => {
  const rows = Array.isArray(v[key]) ? (v[key] as Array<Record<string, unknown>>) : [];
  const out: RuleIssue[] = [];
  rows.forEach((row, i) => {
    const target = row && typeof row === 'object' ? row[field] : undefined;
    if (typeof target === 'string' && target !== '' && !resolveLink(target)) {
      out.push({ path: `${key}.${i}.${field}`, message: 'Target must be an internal path (/…) or an https, http or mailto address', code: 'rowLinkTarget' });
    }
  });
  return out;
};

/**
 * A 3D model address (`viewer.model`): an internal path or `https:` only. No `http:` (a secure page
 * cannot fetch it), no `data:` or `blob:` (a stored setting must not carry the model itself).
 */
export function resolveModelUrl(raw: unknown): string | null {
  const link = resolveLink(raw);
  if (!link) return null;
  if (!link.external) return link.href;
  return link.href.startsWith('https:') ? link.href : null;
}

/** Save-time: every model row's address must be an internal path or https. */
export const safeModelUrlsRule = (key: string, field = 'url'): Rule => (v) => {
  const rows = Array.isArray(v[key]) ? (v[key] as Array<Record<string, unknown>>) : [];
  const out: RuleIssue[] = [];
  rows.forEach((row, i) => {
    const url = row && typeof row === 'object' ? row[field] : undefined;
    if (typeof url === 'string' && url !== '' && !resolveModelUrl(url)) {
      out.push({ path: `${key}.${i}.${field}`, message: 'A model must be an internal path (/…) or an https address', code: 'modelUrl' });
    }
  });
  return out;
};

/** Save-time: a positive step. */
export const positiveStep = (key: string): Rule => (v) =>
  typeof v[key] === 'number' && (v[key] as number) <= 0 ? [{ path: key, message: 'Step must be greater than 0', code: 'positiveStep' }] : [];
