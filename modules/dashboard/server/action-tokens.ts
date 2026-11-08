/**
 * Action tokens (16.5, 16.8): `{{param_<key>}}` and `{{row_<column>}}` inside a `navigate` path,
 * an `openUrl` URL or a `showNotification` message stand for a board parameter's current value and
 * (on a row source only) the clicked row's column. `{{attr_<key>}}` (phase 24.6b) stands for a field of
 * the placement's own `record` slot (the entity's attributes); an action with an attribute token that has
 * no value does not run, rather than going to a half-built address. Same spelling as the title tokens
 * (`ui/title-tokens.ts`), and the same rule: a text substitution, never an expression.
 *
 * The stored string is the TEMPLATE and is validated as one: tokens are replaced by a neutral
 * placeholder and the result must pass the same check a literal would (an internal path, an
 * absolute http(s) URL). In a URL a token may only appear after the origin, so a parameter (which a
 * pasted link can set) can never pick the host. The runner re-checks the EXPANDED value too, with
 * every value URL-encoded first. Pure: no zod, no React.
 */
const TOKEN = /\{\{\s*(param|row|attr)_([A-Za-z0-9_.-]{1,100})\s*\}\}/g;

/** Does the template read an attribute of the placement's record? */
export function usesAttrToken(s: string | null | undefined): boolean {
  return !!s && [...s.matchAll(TOKEN)].some((m) => m[1] === 'attr');
}

/** An attribute token whose field is missing, empty or not a plain value: the action must not run. */
export function missingAttr(s: string, attrs: Record<string, unknown> | undefined): boolean {
  return [...s.matchAll(TOKEN)].some((m) => {
    if (m[1] !== 'attr') return false;
    const v = attrs?.[m[2]];
    return !(typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== ''));
  });
}

/** The neutral text a token is replaced by when a template is validated. */
const PLACEHOLDER = 'x';

export function hasActionTokens(s: string | null | undefined): boolean {
  return !!s && new RegExp(TOKEN.source).test(s);
}

/** Does the template read the clicked row? Only valid on a source that carries one. */
export function usesRowToken(s: string | null | undefined): boolean {
  return !!s && [...s.matchAll(TOKEN)].some((m) => m[1] === 'row');
}

/** The board parameters a template reads through `{{param_<key>}}` tokens (phase 35, E9: checked against the board). */
export function paramTokenKeys(s: string | null | undefined): string[] {
  return s ? [...s.matchAll(TOKEN)].filter((m) => m[1] === 'param').map((m) => m[2]) : [];
}

/** The template with every token replaced by a placeholder: what a literal-only check validates. */
export function tokenPlaceholder(s: string): string {
  return s.replace(TOKEN, PLACEHOLDER);
}

const text = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(String).join(',');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * Replace the tokens with their values. An unset parameter or a missing cell expands to nothing.
 * `encode` URL-encodes each value (a path or a URL): a value can then never add a `/`, a `?`, a
 * backslash or a control character to the result. A value of `.` or `..` stays a dot-segment in any
 * encoding (URL parsers resolve `%2E%2E` too), so the runner refuses such a result (`hasDotSegment`).
 */
export function expandActionTokens(
  s: string,
  params: Record<string, unknown> | undefined,
  row: Record<string, unknown> | undefined,
  encode: boolean,
  attrs?: Record<string, unknown>,
): string {
  if (!hasActionTokens(s)) return s;
  return s.replace(TOKEN, (_, kind: string, key: string) => {
    const v = text(kind === 'row' ? row?.[key] : kind === 'attr' ? attrs?.[key] : params?.[key]);
    return encode ? encodeURIComponent(v) : v;
  });
}

/**
 * In a URL template, every token sits after the origin: the part before the first token is a whole
 * `http(s)://host[:port]` followed by a `/`, `?` or `#`. A template without tokens passes.
 */
export function tokensAfterOrigin(s: string): boolean {
  const m = new RegExp(TOKEN.source).exec(s);
  if (!m) return true;
  return /^https?:\/\/[^/?#\\{}]+[/?#]/i.test(s.slice(0, m.index));
}

/** The origin of an absolute URL, or null when it does not parse. */
export function urlOrigin(s: string): string | null {
  try { return new URL(s).origin; } catch { return null; }
}

/**
 * Does the path part of an expanded path or URL contain a `.` or `..` segment, in any encoding? A browser
 * resolves those (`/a/%2E%2E/b` opens `/b`), so a token value could pick a route the template never named, or
 * climb out of the tenant prefix. The runner refuses such a result rather than trying to escape it.
 */
export function hasDotSegment(pathOrUrl: string): boolean {
  const path = pathOrUrl.replace(/^https?:\/\/[^/?#]*/i, '').split(/[?#]/)[0]
  return path.split('/').some((seg) => {
    let s = seg
    try { s = decodeURIComponent(seg) } catch { /* a malformed escape is not a dot segment */ }
    return s === '.' || s === '..'
  })
}

