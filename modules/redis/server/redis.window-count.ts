import redis from './redis.service';

/**
 * A fixed-window counter for a limit that must not be LIFTED by a Redis outage (docs/audits/2026-11-03-redis-outage.md §6, D250).
 *
 * `INCR` (and `EXPIRE` on the window's first count) on the shared Redis, bounded by `timeoutMs`. When Redis errors or does not
 * answer in time, the count comes from a window of this process instead: the limit then holds per process (at worst the limit
 * times the number of processes for the length of the outage), never "unlimited", and nobody is refused who would not have
 * been refused by a working Redis on one node. This is the `api_key.02` rule (api_key.verify.helpers.ts) as a shared helper.
 *
 * `local` says which counter answered, so a caller can log the degradation. Never throws.
 */

/** The longest a count waits on Redis before the process window answers (the shared client queues commands while Redis is gone). */
export const WINDOW_COUNT_TIMEOUT_MS = 1_000;
/** Process windows kept at most; past it the expired ones go first, then all (a flood of distinct keys must not grow the heap). */
const MAX_LOCAL_WINDOWS = 10_000;

const localWindows = new Map<string, { count: number; expiresAt: number }>();

/** Test seam: forget the process windows. */
export function resetLocalWindowCounts(): void { localWindows.clear(); }

function countLocally(key: string, windowSeconds: number, now: number): number {
  const hit = localWindows.get(key);
  if (hit && hit.expiresAt > now) {
    hit.count += 1;
    return hit.count;
  }
  if (localWindows.size >= MAX_LOCAL_WINDOWS) {
    for (const [k, v] of localWindows) if (v.expiresAt <= now) localWindows.delete(k);
    if (localWindows.size >= MAX_LOCAL_WINDOWS) localWindows.clear();
  }
  localWindows.set(key, { count: 1, expiresAt: now + windowSeconds * 1_000 });
  return 1;
}

export interface WindowCount {
  /** The count in the window, this call included. */
  count: number;
  /** True when Redis could not count and this process's window answered. */
  local: boolean;
}

export async function countInWindow(
  key: string,
  windowSeconds: number,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<WindowCount> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // SET NX EX then INCR in one MULTI: the key always carries the window's TTL (an INCR whose EXPIRE was lost would count forever)
  const counted = (async () => {
    const replies = await redis.multi().set(key, '0', 'EX', windowSeconds, 'NX').incr(key).exec();
    const [err, n] = replies?.[1] ?? [new Error('no reply'), null];
    if (err) throw err;
    return Number(n);
  })();
  counted.catch(() => {}); // a late rejection after the bound must not surface as unhandled
  try {
    const n = await Promise.race([
      counted,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), opts.timeoutMs ?? WINDOW_COUNT_TIMEOUT_MS); }),
    ]);
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return { count: n, local: false };
  } catch { /* Redis could not count: the process window below */ } finally {
    if (timer) clearTimeout(timer);
  }
  return { count: countLocally(key, windowSeconds, (opts.now ?? Date.now)()), local: true };
}
