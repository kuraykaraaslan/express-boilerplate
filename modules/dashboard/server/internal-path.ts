/**
 * Is `to` an internal, path-absolute target (`/admin/orders?x=1`)? Pure, shared by
 * the `navigate` action schema, the client action runner, `tenantHref` and the map
 * link template, so the rule cannot drift between them.
 *
 * Refused: anything not starting with a single `/`; `//host` and `/\host` (a browser
 * reads a backslash as a slash, so both are protocol-relative); a tab, CR or LF (the
 * URL parser strips them, so `/<TAB>/host` becomes `//host`); other control characters;
 * and a `/scheme:` lookalike.
 */
export function isInternalPath(to: unknown): to is string {
  if (typeof to !== 'string') return false
  if (!/^\/(?![\/\\])/.test(to)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(to)) return false
  return !/^\/\s*[a-z][a-z0-9+.-]*:/i.test(to)
}
