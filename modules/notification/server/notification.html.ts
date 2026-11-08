import sanitizeHtml from 'sanitize-html';

/**
 * The HTML body of a notification written by a tenant (`action.notify` with `format: html`, G-072): a strict allowlist,
 * and the plain text the other channels get instead.
 *
 * Allowed: basic formatting and structure (`p br hr b strong i em u s del ins mark small sub sup code pre blockquote
 * h1-h6 ul ol li span div table thead tbody tfoot tr th td caption`), links and images. Nothing else survives: no
 * `style` (tag or attribute), `class`, `id`, event handler, form, `script`, `iframe`, `object`, `svg` or `math`; the
 * content of `script`, `style`, `svg`, `math`, `iframe`, `object`, `embed`, `template`, `noscript` and `textarea` is
 * dropped with them, the text of any other unknown tag is kept.
 *
 * - `a`: `href` only with `http:`, `https:` or `mailto:` (no protocol-relative `//host`), plus `title`; every link gets
 *   `rel="noopener noreferrer"`, whatever the author wrote. A link whose `href` is refused stays as its text.
 * - `img`: `src` only `cid:<id>` for an inline image the same send carries (`inlineIds`), or `https:`; `alt`, `title`,
 *   `width`, `height`. `http:` (mixed content, readable on the wire), `data:` and an unknown `cid:` are refused, and an
 *   image without an accepted `src` is removed.
 * - `ol start`, `td`/`th` `colspan` and `rowspan`.
 */
const TAGS = [
  'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'code', 'pre',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'span', 'div', 'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
];
const DROPPED_WITH_CONTENT = ['script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'template', 'noscript', 'textarea', 'option', 'title', 'head'];
const LINK_REL = 'noopener noreferrer';

export function sanitizeNotificationHtml(html: string, inlineIds: Iterable<string> = []): string {
  const cids = new Set(inlineIds);
  const imageSrcAllowed = (src: string | undefined): boolean => {
    if (!src) return false;
    if (/^https:\/\//i.test(src)) return true;
    const cid = /^cid:(.+)$/i.exec(src)?.[1];
    return cid !== undefined && cids.has(cid);
  };
  return sanitizeHtml(html, {
    allowedTags: TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      ol: ['start'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'cid'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    nonTextTags: DROPPED_WITH_CONTENT,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: LINK_REL } }),
    },
    // after the attribute filter: an image whose src was refused (or never there) is removed, not left as a broken box
    exclusiveFilter: (frame) => frame.tag === 'img' && !imageSrcAllowed(frame.attribs.src),
  }).trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/**
 * The plain-text form of a sanitised body, for the channels that cannot show HTML (in-app, push, SMS): block ends and
 * `<br>` become line breaks, list items a leading `- `, a link `text (url)` when the URL is not its text, images their
 * `alt`; entities are decoded and runs of blank lines collapsed. Takes the output of `sanitizeNotificationHtml` (the
 * repo had no server-side HTML-to-text helper; the `stripTags` in `search` and `dynamic_page` only drop tags).
 */
export function notificationHtmlToText(safeHtml: string): string {
  const marked = safeHtml
    .replace(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const url = href.replace(/^mailto:/i, '');
      const label = decodeEntities(inner.replace(/<[^>]*>/g, '')).trim();
      if (!label) return url;
      return label === decodeEntities(url) ? inner : `${inner} (${url})`;
    })
    .replace(/<img\b[^>]*?\balt="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|blockquote|pre|table|ul|ol|caption)>|<hr\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ');
  const text = decodeEntities(marked.replace(/<[^>]*>/g, ''));
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
