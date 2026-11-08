/**
 * Re-encrypt run for node-field-key rotation (docs/phases/38-security 5.5). While SETTINGS_ENCRYPTION_KEY_PREVIOUS is set, values written under the old
 * key still open; this walks the known encrypted columns and rewrites every value that opens only under a previous key (`reencryptField`), in batches
 * keyed by primary key so a run is RESUMABLE (pass the last id back as `after`) and idempotent (a rewritten value needs no second rewrite). A value
 * whose old key is not held makes the run fail loudly: it must not be silently skipped and then lost when the old key is dropped.
 *
 * Not covered here, on purpose: tenant and user data keys (`tdek-`, `udek-`) rotate through the db module's own key services, and the scattered
 * one-off ciphertext fields outside `REENCRYPT_TARGETS` (add them there: one line per column).
 */
import { reencryptField } from '@kuraykaraaslan-labs/common/server/field-encryption';

export type ReencryptTarget = { name: string; entity: unknown; pk: string; columns: readonly string[] };

type Repo = {
  find(opts: { order: Record<string, 'ASC'>; take: number; where?: unknown }): Promise<Array<Record<string, unknown>>>;
  update(criteria: Record<string, unknown>, patch: Record<string, unknown>): Promise<unknown>;
};

export type ReencryptProgress = { scanned: number; rewritten: number; lastId: string | null; done: boolean };

/**
 * One batch of one target. `after` is the last primary key of the previous batch (null for the first). `moreThan` builds the "pk > after" condition
 * (TypeORM's MoreThan, injected so this file stays free of the driver).
 */
export async function reencryptBatch(
  repo: Repo,
  target: ReencryptTarget,
  opts: { after: string | null; batch: number; moreThan: (v: string) => object; dryRun?: boolean },
): Promise<ReencryptProgress> {
  const rows = await repo.find({
    order: { [target.pk]: 'ASC' },
    take: opts.batch,
    ...(opts.after ? { where: { [target.pk]: opts.moreThan(opts.after) } } : {}),
  });
  let rewritten = 0;
  for (const row of rows) {
    const patch: Record<string, unknown> = {};
    for (const column of target.columns) {
      const value = row[column];
      if (typeof value !== 'string') continue;
      const next = reencryptField(value); // throws when the old key is not held
      if (next !== null) patch[column] = next;
    }
    if (Object.keys(patch).length > 0) {
      if (!opts.dryRun) await repo.update({ [target.pk]: row[target.pk] as string }, patch);
      rewritten += 1;
    }
  }
  const last = rows.length > 0 ? String(rows[rows.length - 1][target.pk]) : opts.after;
  return { scanned: rows.length, rewritten, lastId: last, done: rows.length < opts.batch };
}

/** Whole target, batch after batch. Progress is reported through `onBatch` (the CLI prints it). */
export async function reencryptAll(
  repo: Repo,
  target: ReencryptTarget,
  opts: { batch?: number; after?: string | null; moreThan: (v: string) => object; dryRun?: boolean; onBatch?: (p: ReencryptProgress) => void },
): Promise<{ scanned: number; rewritten: number }> {
  let after = opts.after ?? null;
  let scanned = 0;
  let rewritten = 0;
  for (;;) {
    const p = await reencryptBatch(repo, target, { after, batch: opts.batch ?? 200, moreThan: opts.moreThan, dryRun: opts.dryRun });
    scanned += p.scanned;
    rewritten += p.rewritten;
    opts.onBatch?.(p);
    if (p.done) break;
    after = p.lastId;
  }
  return { scanned, rewritten };
}
