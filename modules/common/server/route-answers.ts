import type { NextRequest } from 'next/server';

/**
 * Sees every answer of the tenant API dispatcher (`app/tenant/[tenantId]/api/[...slug]/route.ts`): the request, its API path and the
 * answer's status. The limiter counts each client address's 401 / 403 / 404 answers here (docs/phases/07-dashboard/40-data-traffic.md,
 * D40-10(d)). `common` is a leaf and cannot import the limiter, so the limiter registers its watcher at boot (`instrumentation.ts`), the
 * way observability registers the unhandled-error sink of route-error.ts. Held on `globalThis` so the instrumentation hook and the route
 * bundles, which can load this file twice, see the same one. With no watcher (a test, a tool that never booted the app) nothing happens.
 * The dispatcher does not wait for the watcher: the answer is already decided and is sent at once.
 */
export type AnswerWatcher = (request: NextRequest, apiPath: string, status: number) => Promise<void>;
const WATCHER_KEY = Symbol.for('kuraykaraaslan-labs.common.answerWatcher');
const watcherHolder = globalThis as unknown as Record<symbol, AnswerWatcher | null | undefined>;

export function setAnswerWatcher(watcher: AnswerWatcher | null): void {
  watcherHolder[WATCHER_KEY] = watcher;
}

/** Hands an answer to the watcher. Never throws: watching must not change the answer. */
export async function watchAnswer(request: NextRequest, apiPath: string, status: number): Promise<void> {
  try {
    await watcherHolder[WATCHER_KEY]?.(request, apiPath, status);
  } catch {
    // a failing watcher never changes the answer
  }
}
