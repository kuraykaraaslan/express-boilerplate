/**
 * Where an in-app notification leads (docs/phases/07-dashboard/40, D40-15). Pure, and imported by the bell in the browser too.
 *
 * A target is an internal app path only: a leading `/`, never `//` (protocol-relative), no backslash and no control character,
 * at most 2 000 characters (the rule of `notification_external`'s deep link and the dashboard's `navigate` action), so a payload
 * can never turn the bell into an open redirect. It is an app path (`/admin/iot/devices/<id>`): the bell puts the tenant's prefix
 * in front of it, so its path has no `.` or `..` segment, percent-encoded or not (the browser would resolve one out of that
 * prefix, into another tenant's page).
 */

const MAX_PATH = 2_000;

/** `value` when it is an internal app path, else null. */
export function internalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_PATH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.split(/[?#]/, 1)[0].split('/').some(isDotSegment)) return null;
  return value;
}

/** `.` or `..` as the URL parser reads a segment (`%2e` is a dot); an encoding that does not decode is refused too. */
function isDotSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\');
}

/**
 * The stored `path` of a notification from what a producer sent: `path`, else the aliases `link` (the IoT notices) and `url` (the
 * deep link `notification_external` reads), the first that is an internal path. Anything else is dropped, never stored.
 */
export function targetFromData(data: { path?: unknown; link?: unknown; url?: unknown }): string | null {
  return internalPath(data.path) ?? internalPath(data.link) ?? internalPath(data.url);
}

/** A call-to-action as it is stored: a label and a URL (both text), else null. The bell opens its URL only as an internal path. */
export function actionFromData(action: unknown): { label: string; url: string } | null {
  if (!action || typeof action !== 'object') return null;
  const a = action as { label?: unknown; url?: unknown };
  return typeof a.label === 'string' && a.label.trim() && typeof a.url === 'string' && a.url.trim()
    ? { label: a.label, url: a.url }
    : null;
}

/**
 * The page a click on a stored notification opens: its `path`, else its action's URL, when it is an internal path. An external
 * URL is never opened from the bell: nothing marks one as allowed, so a notification cannot send the viewer off the site.
 */
export function notificationTarget(n: { path?: unknown; action?: { url?: unknown } | null }): string | null {
  return internalPath(n.path) ?? internalPath(n.action?.url);
}
