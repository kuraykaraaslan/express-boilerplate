/**
 * The Markdown of an announcement body, sanitised by construction: the text is parsed into a small tree that holds only
 * what is allowed (paragraphs with line breaks, bullet lists, bold, italic, inline code and links), and every renderer
 * writes text as text. There is no raw HTML: a `<script>` in the body is shown as those characters, never run. Pure, so
 * the shell renders the same tree in the browser (announcement-live) as the mail gets as HTML here.
 *
 * A link is kept only when its target is an app path (`/status`), an https URL or a mailto address; anything else
 * (`javascript:`, `data:`, `//host`) stays as its plain text.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MdInline[] }
  | { type: 'br' };

export type MdBlock =
  | { type: 'p'; children: MdInline[] }
  | { type: 'ul'; items: MdInline[][] };

const MAX_SOURCE = 10_000;
const BULLET = /^\s*[-*]\s+/;

/** An allowed link target, or null. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.length === 0 || href.length > 2000) return null;
  if (/[\s\u0000-\u001f\u007f\\]/.test(href)) return null;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (/^https:\/\/[^/?#]+/i.test(href)) return href;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(href)) return href;
  return null;
}

/** Parses the inline marks of one line or paragraph. Unclosed marks stay as text. */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let text = '';
  const flush = () => { if (text) { out.push({ type: 'text', text }); text = ''; } };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest[0] === '\n') { flush(); out.push({ type: 'br' }); i += 1; continue; }
    if (rest[0] === '`') {
      const end = rest.indexOf('`', 1);
      if (end > 1) { flush(); out.push({ type: 'code', text: rest.slice(1, end) }); i += end + 1; continue; }
    }
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2);
      if (end > 2) { flush(); out.push({ type: 'strong', children: parseInline(rest.slice(2, end)) }); i += end + 2; continue; }
    }
    if ((rest[0] === '*' || rest[0] === '_') && rest[1] !== rest[0] && rest[1] !== ' ') {
      const end = rest.indexOf(rest[0], 1);
      if (end > 1) { flush(); out.push({ type: 'em', children: parseInline(rest.slice(1, end)) }); i += end + 1; continue; }
    }
    if (rest[0] === '[') {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
      if (m) {
        const href = safeHref(m[2]);
        flush();
        if (href) out.push({ type: 'link', href, children: parseInline(m[1]) });
        else out.push({ type: 'text', text: m[1] });
        i += m[0].length;
        continue;
      }
    }
    text += rest[0];
    i += 1;
  }
  flush();
  return out;
}

/** Parses a body into blocks: blank lines separate paragraphs, `- ` / `* ` lines make a list. */
export function parseMarkdown(source: string): MdBlock[] {
  const src = source.replace(/\r\n?/g, '\n').slice(0, MAX_SOURCE);
  const blocks: MdBlock[] = [];
  for (const chunk of src.split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((l) => BULLET.test(l))) {
      blocks.push({ type: 'ul', items: lines.map((l) => parseInline(l.replace(BULLET, '').trim())) });
      continue;
    }
    blocks.push({ type: 'p', children: parseInline(lines.map((l) => l.trim()).join('\n')) });
  }
  return blocks;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

function inlineHtml(nodes: MdInline[], linkBase: string | null): string {
  return nodes.map((n) => {
    switch (n.type) {
      case 'text': return escapeHtml(n.text);
      case 'br': return '<br>';
      case 'code': return `<code>${escapeHtml(n.text)}</code>`;
      case 'strong': return `<strong>${inlineHtml(n.children, linkBase)}</strong>`;
      case 'em': return `<em>${inlineHtml(n.children, linkBase)}</em>`;
      case 'link': {
        // A mail has no app around it: an app path needs the installation's address, else it stays text.
        const href = n.href.startsWith('/') ? (linkBase ? `${linkBase.replace(/\/+$/, '')}${n.href}` : null) : n.href;
        const label = inlineHtml(n.children, linkBase);
        return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
      }
    }
  }).join('');
}

/** The body as mail HTML. `linkBase` (the installation's address) makes app-path links absolute. */
export function markdownToHtml(source: string, linkBase: string | null = null): string {
  return parseMarkdown(source).map((b) => (b.type === 'p'
    ? `<p>${inlineHtml(b.children, linkBase)}</p>`
    : `<ul>${b.items.map((i) => `<li>${inlineHtml(i, linkBase)}</li>`).join('')}</ul>`)).join('');
}

function inlineText(nodes: MdInline[]): string {
  return nodes.map((n) => {
    switch (n.type) {
      case 'text': case 'code': return n.text;
      case 'br': return '\n';
      case 'strong': case 'em': return inlineText(n.children);
      case 'link': return inlineText(n.children);
    }
  }).join('');
}

/** The body as plain text (the bell, push and SMS): marks dropped, list items as `- ` lines. */
export function markdownToText(source: string): string {
  return parseMarkdown(source).map((b) => (b.type === 'p'
    ? inlineText(b.children)
    : b.items.map((i) => `- ${inlineText(i)}`).join('\n'))).join('\n\n');
}
