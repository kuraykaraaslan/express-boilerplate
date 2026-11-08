import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ApprovalQueueItem as ApprovalQueueItemEntity } from './entities/approval_queue_item.entity';
import type { ApprovalChainVerificationResult } from './approval.types';
import { ApprovalChainHead } from './entities/approval_chain_head.entity';
import { approvalHeadSeal, computeRowHash, computeDecisionHash, matchApprovalRow, sealDecision, type ApprovalHashRow } from './approval.constants';
import { ChainVersionGuard } from '@kuraykaraaslan-labs/common/server/common.hash-chain';

const hashRow = (row: ApprovalQueueItemEntity): ApprovalHashRow => ({
  approvalItemId: row.approvalItemId,
  tenantId: row.tenantId,
  entityType: row.entityType,
  entityId: row.entityId,
  submittedByUserId: row.submittedByUserId,
  priority: row.priority,
  reason: row.reason,
  createdAt: row.createdAt,
});

/**
 * Append-only chain link, computed once when an item is first inserted. Links
 * the new row to the previous head for the tenant (the row with the latest
 * `createdAt`, excluding the row itself). Only immutable insert-time content
 * is hashed, so later claim / decide mutations never invalidate the chain.
 * Runs inside the caller's transaction so the head read + write are atomic —
 * `qr` is the tenant chokepoint's QueryRunner (`submit`), or `{ manager }` for
 * the seed. Serialised per tenant by an advisory lock (see below).
 */
export async function chainOnInsert(
  qr: { manager: EntityManager },
  tenantId: string,
  row: ApprovalQueueItemEntity,
): Promise<ApprovalQueueItemEntity> {
  const repo = qr.manager.getRepository(ApprovalQueueItemEntity);

  // Excluding the row itself (`approvalItemId <> $2`) was the first fix, and the bug it closed is the
  // opposite of what it looked like.
  //
  // The caller SAVES the row and then calls this, so the head query used to see
  // the row itself. Whenever the new row had the strictly-latest `createdAt` —
  // i.e. almost always — it WAS the head, the guard below turned that into
  // `prevHash = null`, and the chain was never linked at all. It only appeared
  // to work when two rows landed in the same millisecond, because the stable
  // sort then returned the older one first.
  //
  // So the flake everyone chased was backwards: the chain broke when the clock
  // ADVANCED and held together when it tied. Excluding the row in the query
  // rather than detecting it afterwards is what makes the head the genuine
  // predecessor in both cases.
  // Two more gaps, closed 2026-09-25, both of which forked the chain so that
  // `verifyChain` reported tampering nobody did:
  //
  // 1. **Concurrency.** Two submits in flight both read the same head and
  //    both linked to it. A per-tenant transaction advisory lock serialises
  //    the link step. Under READ COMMITTED, the head query that follows the
  //    lock sees the previous holder's committed row.
  // 2. **Same-millisecond ties.** "Latest createdAt" is ambiguous when two
  //    rows share a timestamp, and it could pick a row that already had a
  //    successor. The head is now the chain's TIP, the linked row whose hash
  //    nobody names as `prevHash`. createdAt only breaks a tie between tips,
  //    which can exist only in a chain that is already forked.
  await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`approval_chain:${tenantId}`]);
  const tips = (await qr.manager.query(
    `SELECT t."rowHash" FROM "approval_queue_items" t
      WHERE t."tenantId" = $1 AND t."approvalItemId" <> $2 AND t."rowHash" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "approval_queue_items" n WHERE n."tenantId" = $1 AND n."prevHash" = t."rowHash")
      ORDER BY t."createdAt" DESC LIMIT 1`,
    [tenantId, row.approvalItemId],
  )) as Array<{ rowHash: string }>;
  const prev = tips[0] ?? null;
  const prevHash = prev ? prev.rowHash : null;
  row.prevHash = prevHash;
  row.rowHash = computeRowHash(prevHash, hashRow(row));
  // The decision state at insert (PENDING, nobody, no note) is sealed too, so resetting a decided item to a pristine
  // PENDING later is as visible as any other decision edit (approval.06).
  sealDecision(row);
  const saved = await repo.save(row);

  // The external anchor (approval.08), in the same transaction and under the same lock: the new tip and the chain's
  // length. A tenant chained before the anchor existed starts counting from its current rows.
  const heads = qr.manager.getRepository(ApprovalChainHead);
  const head = await heads.findOne({ where: { tenantId } });
  let length: number;
  if (head) length = head.length + 1;
  else {
    const others = await repo.find({ where: { tenantId } });
    length = others.filter((r) => r.approvalItemId !== row.approvalItemId && r.rowHash != null).length + 1;
  }
  // A head whose seal no longer verifies is not laundered: the break is carried forward and verifyChain keeps reporting it.
  const headHash = saved.rowHash as string;
  const intact = !head || head.seal === approvalHeadSeal(tenantId, head.headHash, head.length);
  const seal = intact ? approvalHeadSeal(tenantId, headHash, length) : '0'.repeat(64);
  await heads.save(heads.create({ ...(head ?? {}), tenantId, headHash, length, seal }));
  return saved;
}

/**
 * Re-derive the per-tenant decision hash chain and confirm every `rowHash`
 * matches. Any after-the-fact edit to a decision breaks the chain at that row.
 *
 * ## The chain is WALKED, not sorted
 *
 * This used to read the rows `ORDER BY createdAt ASC` and assume that was the
 * order they had been written in. It usually was — and roughly one run in
 * three it was not, because two items submitted in the same millisecond order
 * arbitrarily. The chain then verified in a different sequence than it was
 * built and reported tampering that had not happened. That made this the
 * repo's best-known flaky test and cost at least one session hunting a
 * regression that did not exist.
 *
 * The obvious repair — add `approvalItemId` as a tie-break — was tried and is
 * WRONG, measurably: a uuid4 carries no chronology, so for a same-millisecond
 * pair it picks an order unrelated to insertion and the chain breaks EVERY
 * time instead of one in three. (Verified: with that tie-break the test failed
 * 5 runs out of 5.)
 *
 * The fix is to stop inferring the order at all. `prevHash` → `rowHash` IS a
 * linked list, and following it recovers the exact sequence the writer used,
 * whatever the clock did. Timestamps are now only data that gets hashed, never
 * the thing that decides order.
 */
export async function verifyChain(tenantId: string): Promise<ApprovalChainVerificationResult> {
  // The anchor is read FIRST: an item inserted while this runs then only makes the chain longer than the anchor, which is checked
  // at the anchor's own position below, never a false mismatch.
  const head = await withTenantRepositoryFor(tenantId, ApprovalChainHead, (repo) => repo.findOne({ where: { tenantId } }));
  const rows = await withTenantRepositoryFor(tenantId, ApprovalQueueItemEntity, (repo) => repo.find({
    where: { tenantId },
  }));
  // An emptied queue is only "ok, 0 checked" when no chain was ever anchored (approval.08).
  if (rows.length === 0) {
    return head ? { ok: false, checked: 0, brokenAt: null } : { ok: true, checked: 0, brokenAt: null };
  }

  // `prevHash` → the row that claims to follow it. A well-formed chain has
  // exactly one row per link; two rows claiming the same predecessor is a fork,
  // which is itself evidence of tampering rather than something to pick between.
  const byPrev = new Map<string, ApprovalQueueItemEntity>();
  for (const row of rows) {
    const key = row.prevHash ?? '';
    const existing = byPrev.get(key);
    if (existing) {
      return { ok: false, checked: 0, brokenAt: row.approvalItemId };
    }
    byPrev.set(key, row);
  }

  let expectedPrev: string | null = null;
  let checked = 0;
  let sawV2 = false;
  let hashAtHead: string | null = null;
  const guard = new ChainVersionGuard();

  for (;;) {
    const row = byPrev.get(expectedPrev ?? '');
    if (!row) break;
    checked += 1;

    // v2 (keyed) or v1 (legacy) link, and never a v1 row after the first v2 one (a forger without the key cannot
    // append unkeyed rows after the cutover).
    const version = matchApprovalRow(expectedPrev, hashRow(row), row.rowHash);
    if (!guard.accept(version)) {
      return { ok: false, checked, brokenAt: row.approvalItemId };
    }
    if (version === 2) sawV2 = true;
    if (head && checked === head.length) hashAtHead = row.rowHash ?? null;
    // The decision seal: checked wherever it exists, and required on every v2 row (approval.06).
    if (row.decisionHash || version === 2) {
      if (!row.decisionHash || computeDecisionHash(row) !== row.decisionHash) {
        return { ok: false, checked, brokenAt: row.approvalItemId };
      }
    }
    expectedPrev = row.rowHash ?? null;

    // A row whose hash is its own predecessor would loop forever. It cannot
    // happen through `chainOnInsert`, which is exactly why an explicit bound
    // belongs here: the audit surface must terminate on malformed data too.
    if (checked > rows.length) {
      return { ok: false, checked, brokenAt: row.approvalItemId };
    }
  }

  // Every row must be ON the chain. A row the walk never reached is one whose
  // predecessor does not exist — inserted outside `chainOnInsert`, or left
  // behind when its link was edited.
  if (checked !== rows.length) {
    const reached = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < checked; i += 1) {
      const row = byPrev.get(cursor ?? '');
      if (!row) break;
      reached.add(row.approvalItemId);
      cursor = row.rowHash ?? null;
    }
    const orphan = rows.find((row) => !reached.has(row.approvalItemId));
    return { ok: false, checked, brokenAt: orphan?.approvalItemId ?? null };
  }

  // The tail (approval.08). The walk cannot see rows deleted from its end; the anchor can. With a head (read before the rows),
  // the chain must reach the anchor's length with the anchor's hash at that position; rows after it were written while this
  // ran and are verified like every other. Without a head, only a legacy (all v1) chain is acceptable: every v2 link writes
  // the head, so a v2 chain without it lost its anchor.
  const tip = expectedPrev;
  const last = rows.find((r) => r.rowHash === tip) ?? null;
  if (head) {
    if (head.seal !== approvalHeadSeal(tenantId, head.headHash, head.length) || checked < head.length || hashAtHead !== head.headHash) {
      return { ok: false, checked, brokenAt: last?.approvalItemId ?? null };
    }
  } else if (sawV2) {
    return { ok: false, checked, brokenAt: last?.approvalItemId ?? null };
  }

  return { ok: true, checked, brokenAt: null };
}
