/**
 * The module permissions an API key brought to a request (docs/phases/48-api-key-scopes D48-4), kept beside the request for
 * the life of the request only (a WeakMap, so nothing outlives it).
 *
 * The key lane of the tenant guard answers as the key's holder, and a route may then ask `grantedPermissions` about further
 * permissions for that same caller (what to show, which extra action to allow). Asked as the holder alone, that would hand a
 * key whatever its holder may do; the bulk resolver therefore keeps only what the key itself holds (`keyGrantsOf`).
 */
const KEY_GRANTS = new WeakMap<object, ReadonlySet<string>>();

/** Record that this request is a key's, with the permissions the key may use (its list, already narrowed to grantable ones). */
export function markKeyRequest(request: object, permissions: Iterable<string>): void {
  KEY_GRANTS.set(request, new Set(permissions));
}

/** The permissions of the key that made this request, or undefined for any other caller. */
export function keyGrantsOf(request: object): ReadonlySet<string> | undefined {
  return KEY_GRANTS.get(request);
}
