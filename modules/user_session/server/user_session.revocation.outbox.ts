import { IsNull, LessThanOrEqual } from 'typeorm';
import { withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { SessionRevocationOutbox } from './entities/session_revocation_outbox.entity';
import type { RevokedSession } from './user_session.revocation';

/**
 * common.29: the durable outbox of `user_session:session_revoked` notifications that did not complete.
 *
 * `notifySessionsRevoked` records one row per workspace whose fan-out reported a failed or abandoned hook; the drain (a
 * BullMQ repeat job, user_session.revocation.job.ts) replays the fan-out for every due row. Hooks are cleanups (delete a
 * push token, end dependent access), so telling every hook again is safe. A row is done when a replay has no failure;
 * after MAX_ATTEMPTS it is kept as a dead letter (`deadAt`) for an operator, never silently dropped.
 *
 * RLS: the table is tenant-keyed and carries the generated policy pair (migration 127). A row is written and changed in its OWN tenant's
 * context (`withTenantRepositoryFor`), like task_event_outbox; only the drain's read of the due rows, which spans every tenant by nature,
 * runs under the system context (`withSystemRLS`). Without them the policy would refuse the write and hide every row from the drain
 * once RLS is forced.
 */
export const MAX_ATTEMPTS = 10;
const BATCH = 100;

/** Backoff of the next attempt: 1, 2, 4 … minutes, at most an hour. */
export function nextAttemptDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

export async function recordRevocationRetry(tenantId: string, sessions: RevokedSession[], failedContributions: string[], error?: string): Promise<void> {
  try {
    await withTenantRepositoryFor(tenantId, SessionRevocationOutbox, (repo) => repo.save(repo.create({
      tenantId,
      sessions,
      failedContributions,
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs(1)),
      deadAt: null,
      lastError: error ?? null,
    })));
  } catch (err) {
    // The outbox itself is down: the revocation already happened, so only the follow-up is lost. Say so loudly.
    Logger.error(`[user_session] could not record a session-revocation retry for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Replays every due row once. `replay` runs the fan-out and answers the contributions that failed again. */
export async function drainRevocationOutbox(
  replay: (tenantId: string, sessions: RevokedSession[]) => Promise<string[]>,
  now: Date = new Date(),
): Promise<{ done: number; retried: number; dead: number }> {
  // across tenants: the system context reads every tenant's due rows
  const due = await withSystemRLS((qr) => qr.manager.getRepository(SessionRevocationOutbox).find({
    where: { deadAt: IsNull(), nextAttemptAt: LessThanOrEqual(now) }, order: { nextAttemptAt: 'ASC' }, take: BATCH,
  }));
  let done = 0; let retried = 0; let dead = 0;
  for (const row of due) {
    let failed: string[];
    let error: string | null = null;
    try {
      failed = await replay(row.tenantId, row.sessions);
    } catch (err) {
      failed = row.failedContributions.length ? row.failedContributions : ['*'];
      error = err instanceof Error ? err.message : String(err);
    }
    // each row is changed in its own tenant's context
    const inTenant = <T>(fn: (repo: import('typeorm').Repository<SessionRevocationOutbox>) => Promise<T>) => withTenantRepositoryFor(row.tenantId, SessionRevocationOutbox, fn);
    if (failed.length === 0) {
      await inTenant((repo) => repo.delete({ outboxId: row.outboxId, tenantId: row.tenantId }));
      done += 1;
      continue;
    }
    const attempts = row.attempts + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    await inTenant((repo) => repo.update({ outboxId: row.outboxId, tenantId: row.tenantId }, {
      attempts,
      failedContributions: failed,
      lastError: error ?? row.lastError,
      nextAttemptAt: new Date(now.getTime() + nextAttemptDelayMs(attempts)),
      deadAt: giveUp ? now : null,
    }));
    if (giveUp) {
      dead += 1;
      Logger.error(`[user_session] session-revocation hooks still failing after ${attempts} attempts (tenant ${row.tenantId}, ${failed.join(', ')}): dead-lettered`);
    } else {
      retried += 1;
    }
  }
  return { done, retried, dead };
}
