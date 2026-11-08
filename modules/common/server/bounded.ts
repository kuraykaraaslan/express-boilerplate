/**
 * Wait for `work`, but never longer than `ms`.
 *
 * For best-effort side effects hung off a security action (revoking a session, removing a member):
 * the action has already happened and must not be held up — or, if the side effect awaits a
 * dependency that is down (an offline Redis client queues a publish instead of failing it), held
 * up indefinitely — by cleanup that merely has trouble. Resolves `{ timedOut: true }` instead of
 * rejecting; a rejection of `work` itself still propagates, so the caller's own `catch` logs it.
 * The abandoned work is not cancelled (JavaScript cannot), only no longer awaited.
 */
export async function boundedBy<T>(work: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ timedOut: false as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
