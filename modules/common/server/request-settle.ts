/**
 * Work that waits until the handler of a dispatched request has answered (docs/phases/48-api-key-scopes, review 2026-10-28).
 *
 * A guard can run several times in one handler (one call per permission it checks). A side effect that must happen only when the
 * whole request was let through (the key lane's usage stamp) therefore cannot run at the first call that passed: a later call may
 * still refuse the request. The tenant API dispatcher (`app/tenant/[tenantId]/api/[...slug]/route.ts`) opens a request here before
 * its handler runs and settles it once the handler returned or threw; whatever was deferred then runs, in order. Outside the
 * dispatcher (a file route, a test, an internal caller) nothing is open, `deferUntilSettled` answers false and the caller does the
 * work at once, as before.
 *
 * Kept beside the request (a WeakMap, so nothing outlives it) and held on `globalThis`, because the route bundle and a module the
 * guard loads lazily can load this file twice (as route-answers.ts notes).
 */
type Pending = Array<() => void>;
const KEY = Symbol.for('kuraykaraaslan-labs.common.requestSettle');
const holder = globalThis as unknown as Record<symbol, WeakMap<object, Pending> | undefined>;
const open = (): WeakMap<object, Pending> => (holder[KEY] ??= new WeakMap());

/** The dispatcher: this request's handler is about to run; work deferred from now on waits for {@link settleRequest}. */
export function openRequestSettle(request: object): void {
  open().set(request, []);
}

/** Defer `fn` until the request settles. False when no dispatcher opened the request: the caller then runs `fn` itself. */
export function deferUntilSettled(request: object, fn: () => void): boolean {
  const pending = open().get(request);
  if (!pending) return false;
  pending.push(fn);
  return true;
}

/** The dispatcher: the handler answered. Runs what was deferred; a failing step never changes the answer or stops the others. */
export function settleRequest(request: object): void {
  const pending = open().get(request);
  open().delete(request);
  for (const fn of pending ?? []) {
    try { fn(); } catch { /* bookkeeping never changes the answer */ }
  }
}
