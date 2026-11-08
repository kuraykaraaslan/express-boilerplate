import { getSystemDataSource } from '@kuraykaraaslan-labs/db';
import { AuditChainVerifyRun } from './entities/audit_chain_verify_run.entity';

/** What one run of the weekly chain verification found (`runAuditVerifySweep`). */
export interface VerifyRunCounts { tenants: number; checked: number; broken: number; errors: number }

/** Records a finished run of the weekly verification (node-level, system DataSource). */
export async function recordVerifyRun(counts: VerifyRunCounts, startedAt: Date, finishedAt: Date): Promise<void> {
  const repo = (await getSystemDataSource()).getRepository(AuditChainVerifyRun);
  await repo.insert({ startedAt, finishedAt, tenants: counts.tenants, checked: String(counts.checked), broken: counts.broken, errors: counts.errors });
}

/** The newest run of the weekly verification, or null when it never ran here. */
export async function latestVerifyRun(): Promise<(VerifyRunCounts & { startedAt: Date; finishedAt: Date }) | null> {
  const repo = (await getSystemDataSource()).getRepository(AuditChainVerifyRun);
  const [row] = await repo.find({ order: { finishedAt: 'DESC', runId: 'DESC' }, take: 1 });
  return row ? { startedAt: row.startedAt, finishedAt: row.finishedAt, tenants: row.tenants, checked: Number(row.checked), broken: row.broken, errors: row.errors } : null;
}
