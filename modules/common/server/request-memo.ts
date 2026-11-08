import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * A memo that lives for one bounded unit of work (one authorization decision, one bulk permission check) and is
 * shared by everything that unit awaits.
 *
 * A permission check reads the tenant's role set and ABAC policy set several times (the custom-role union, the
 * role-matrix fallback, and once more per permission in a bulk check), each a Redis GET plus a JSON parse. Inside a
 * scope each set is read once. Outside a scope `requestMemo` simply calls the loader, so behaviour is unchanged.
 *
 * Scopes are deliberately short and opened around a decision, not around a whole HTTP request: a streaming (SSE)
 * handler can live for minutes, and a role or policy change must still reach its next check. Nested scopes reuse
 * the outer one.
 */
const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function runWithRequestMemo<T>(fn: () => T): T {
  if (store.getStore()) return fn();
  return store.run(new Map(), fn);
}

export function requestMemo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = store.getStore();
  if (!memo) return load();
  const hit = memo.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const promise = load();
  memo.set(key, promise);
  // A failed load is not remembered: the next reader in the scope tries again.
  promise.catch(() => { if (memo.get(key) === promise) memo.delete(key); });
  return promise;
}

/** Drop `key` from the current scope (a write inside the scope invalidated what it holds). */
export function forgetRequestMemo(key: string): void {
  store.getStore()?.delete(key);
}
