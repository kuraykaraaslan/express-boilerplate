import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { AuditActorIdentity } from './entities/audit_actor_identity.entity';
import { AuditChainAnchor } from './entities/audit_chain_anchor.entity';
import { AuditChainCheckpoint } from './entities/audit_chain_checkpoint.entity';
import { AuditChainImport } from './entities/audit_chain_import.entity';
import { AuditChainPolicy } from './entities/audit_chain_policy.entity';
import { AuditChainVerifyRun } from './entities/audit_chain_verify_run.entity';

/**
 * Synthetic tenants (in no `tenants` table): one on the sealed chain that carries the chain
 * bookkeeping, one that is explicitly on the legacy chain. No real tenant's chain mode,
 * retention or verification changes.
 */
export const SYNTHETIC_AUDIT_TENANT_IDS = {
  sealed: 'c0000000-0000-4000-8000-0000000000a3',
  legacy: 'c0000000-0000-4000-8000-0000000000a4',
} as const;

const DAY = 24 * 60 * 60 * 1000;
const ANCHOR = Date.UTC(2026, 6, 1, 3, 0, 0);
const at = (days: number) => new Date(ANCHOR + days * DAY);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** A deterministic uuid-shaped id from a label (v4 layout), for ids that must stay stable across runs. */
const idOf = (label: string) => {
  const h = hash(label);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/**
 * Full-load seed for the audit chain's bookkeeping tables: chain policies, pseudonymous actor
 * identities (live and erased), control-plane anchors, retention checkpoints, imported
 * histories, restore marks and weekly verification runs.
 *
 * Why not in the default seed: each of these is written by the database functions, the
 * anchoring seam or the verify job, and fake ones in a real tenant would be false evidence.
 *
 * How this stays harmless:
 *  - every tenant-scoped row belongs to a synthetic tenant ({@link SYNTHETIC_AUDIT_TENANT_IDS});
 *  - restore marks use transaction ids long in the past, so the trigger never matches one;
 *  - the verification runs are historic (fixed 2026 dates): the newest real run the job writes
 *    supersedes them, and until then a stale run answers the same as no run.
 * Idempotent: keyed on fixed natural keys; dates are fixed.
 */
export async function seedAuditLogFull(ctx: SeedContext): Promise<void> {
  const { foc } = ctx;
  const sealed = SYNTHETIC_AUDIT_TENANT_IDS.sealed;
  const legacy = SYNTHETIC_AUDIT_TENANT_IDS.legacy;

  // Chain policy: one sealed tenant with a retention window, one explicitly legacy tenant.
  const policyRepo = ctx.repo<AuditChainPolicy>(AuditChainPolicy);
  await foc(policyRepo, { tenantId: sealed } as FindOptionsWhere<AuditChainPolicy>, { tenantId: sealed, mode: 'sealed', retentionDays: 365 });
  await foc(policyRepo, { tenantId: legacy } as FindOptionsWhere<AuditChainPolicy>, { tenantId: legacy, mode: 'legacy', retentionDays: null });

  // Actor identities: live mappings and erased tombstones (actorId NULL, erasedAt set).
  const identityRepo = ctx.repo<AuditActorIdentity>(AuditActorIdentity);
  const identities = Math.min(ctx.count(4), 50);
  for (let i = 0; i < identities; i++) {
    const actorRef = `ar1_${hash(`seed-actor-${i}`).slice(0, 40)}`;
    const erased = i % 4 === 3;
    await foc(identityRepo, { tenantId: sealed, actorRef } as FindOptionsWhere<AuditActorIdentity>, {
      tenantId: sealed, actorRef, actorId: erased ? null : `c0000000-0000-4000-8000-00000000a3${String(i).padStart(2, '0')}`,
      keyVersion: i % 5 === 0 ? 2 : 1, createdAt: at(-200 + i), erasedAt: erased ? at(-10) : null,
    });
  }

  // Anchors (one per acknowledged attestation) and the checkpoints that cite them.
  const anchorRepo = ctx.repo<AuditChainAnchor>(AuditChainAnchor);
  const checkpointRepo = ctx.repo<AuditChainCheckpoint>(AuditChainCheckpoint);
  let purgedTotal = 0;
  for (let i = 0; i < 6; i++) {
    const attestationId = idOf(`seed-attestation-${i}`);
    const rowCount = 500 * (i + 1);
    const anchor = await foc(anchorRepo, { tenantId: sealed, attestationId } as FindOptionsWhere<AuditChainAnchor>, {
      tenantId: sealed, attestationId, headHash: hash(`seed-anchor-head-${i}`), rowCount, ackedAt: at(-180 + i * 30),
    });
    if (i < 3) {
      const covered = 300 + i * 50;
      purgedTotal += covered;
      const coveredThroughId = idOf(`seed-checkpoint-row-${i}`);
      await foc(checkpointRepo, { tenantId: sealed, coveredThroughId } as FindOptionsWhere<AuditChainCheckpoint>, {
        tenantId: sealed, coveredThrough: at(-170 + i * 30), coveredThroughId, headHash: hash(`seed-checkpoint-head-${i}`),
        rowCount: covered, purgedTotal: String(purgedTotal), anchorId: anchor.anchorId,
      });
    }
  }

  // Imported histories: every verdict, with the column combinations the check constraint allows.
  const importRepo = ctx.repo<AuditChainImport>(AuditChainImport);
  const imports = [
    { sourceNodeId: 'seed-node-ist-1', verdict: 'PROVEN', chainStatus: 'VERIFIED', headProven: true, rows: 1200 },
    { sourceNodeId: 'seed-node-fra-1', verdict: 'IMPORTED_UNVERIFIED', chainStatus: 'BROKEN', headProven: false, rows: 800 },
    { sourceNodeId: 'seed-node-fra-2', verdict: 'IMPORTED_UNVERIFIED', chainStatus: 'NOT_VERIFIABLE', headProven: false, rows: 40 },
    { sourceNodeId: 'seed-node-nyc-1', verdict: 'EMPTY', chainStatus: 'VERIFIED', headProven: false, rows: 0 },
  ];
  for (const [i, d] of imports.entries()) {
    const empty = d.verdict === 'EMPTY';
    await foc(importRepo, { tenantId: sealed, sourceNodeId: d.sourceNodeId } as FindOptionsWhere<AuditChainImport>, {
      tenantId: sealed, sourceNodeId: d.sourceNodeId, verdict: d.verdict, chainStatus: d.chainStatus, headProven: d.headProven,
      coveredThrough: empty ? null : at(-220 + i), coveredThroughId: empty ? null : idOf(`seed-import-row-${i}`),
      headHash: empty ? null : hash(`seed-import-head-${i}`), rowCount: d.rows, importedAt: at(-215 + i),
    });
  }

  // Restore marks: written only by audit_chain_import_begin() in production; here historic txids that never recur.
  // In the synthetic tenant's own query context: the marks are that tenant's rows, not the seeded tenant's.
  for (const txid of [101, 102]) {
    await ctx.asTenant(sealed, () => ctx.ds.query(
      `INSERT INTO audit_chain_import_marks ("txid", "tenantId", "markedAt") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [txid, sealed, at(-215)],
    ));
  }

  // Weekly verification runs: one that found a break, then green ones (all historic).
  const runRepo = ctx.repo<AuditChainVerifyRun>(AuditChainVerifyRun);
  for (let w = 0; w < 6; w++) {
    const startedAt = at(-42 + w * 7);
    await foc(runRepo, { startedAt } as FindOptionsWhere<AuditChainVerifyRun>, {
      startedAt, finishedAt: new Date(startedAt.getTime() + (90 + w * 5) * 1000), tenants: 3 + (w % 2), checked: String(12000 + w * 900),
      broken: w === 1 ? 1 : 0, errors: w === 2 ? 1 : 0,
    } as never);
  }

  ctx.refs.syntheticAuditTenantId = sealed;
  ctx.log(`audit_log(full): 2 chain policies, ${identities} actor identities, 6 anchors, 3 checkpoints, ${imports.length} imports, 2 restore marks, 6 verify runs for synthetic tenants`);
}
