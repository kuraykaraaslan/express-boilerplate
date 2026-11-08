import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { TenantUsage } from './entities/tenant_usage.entity';
import { TenantUsageMetricRow } from './entities/tenant_usage_metric.entity';

/**
 * Demo-data seed for the `tenant_usage` module.
 *
 * Mirrors the reference `store.seed.ts`:
 *  - Tenant-scoped entity (has a `tenantId` column) → `ctx.repo<Entity>(Entity)`.
 *  - Natural key = the `@Unique(['tenantId', 'month'])` constraint, so `foc`
 *    reuses an existing month bucket on re-run instead of duplicating it.
 *  - Numbers are numbers; `aiTokens` / `storageBytes` are bigint columns but the
 *    seeded values stay well within the safe-integer range.
 *
 * `TenantUsage` is the monthly rollup the cron job flushes from Redis. We seed a
 * trailing window of months with *varied*, realistic counters so dashboards have
 * something to chart: an early low-traffic month, a busy growth month, and the
 * current (partial) month.
 *
 * `tenant_usage_metrics` is the open per-metric store behind the same counters
 * (one row per tenant, period and declared metric, `value` an absolute running
 * total stored as a bigint string). It is seeded with three FIXED, fully
 * elapsed months (2026-06 .. 2026-08) for every built-in metric. Never the
 * current period: the read API takes the current month from this table when
 * Redis has no counter, and the quota check enforces against that number, so a
 * seeded current-month value could push the demo tenant over a plan limit. The
 * period never moves with the clock, so the `(tenantId, period, metric)` key
 * is stable and a re-run adds nothing.
 */
export async function seedTenantUsage(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx;

  // Current month as 'YYYY-MM' plus the two preceding months, computed from a
  // real Date (this file runs under tsx/Node, so the Date constructor exists).
  const fmtMonth = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const now = new Date();
  const monthOffset = (back: number): string =>
    fmtMonth(new Date(now.getFullYear(), now.getMonth() - back, 1));

  type UsageDef = {
    month: string;
    apiCalls: number;
    aiTokens: number;
    storageBytes: number;
    emailSends: number;
    smsSends: number;
  };

  // Three contrasting buckets: quiet onboarding month → busy month → current.
  const usageDefs: UsageDef[] = [
    {
      month: monthOffset(2),
      apiCalls: 1_240,
      aiTokens: 85_000,
      storageBytes: 268_435_456, // 256 MB
      emailSends: 42,
      smsSends: 0,
    },
    {
      month: monthOffset(1),
      apiCalls: 28_750,
      aiTokens: 2_450_000,
      storageBytes: 5_368_709_120, // 5 GB
      emailSends: 1_310,
      smsSends: 96,
    },
    {
      month: monthOffset(0),
      apiCalls: 9_865,
      aiTokens: 740_000,
      storageBytes: 7_516_192_768, // 7 GB
      emailSends: 388,
      smsSends: 24,
    },
  ];

  const usageRepo = ctx.repo<TenantUsage>(TenantUsage);
  let firstUsageId: string | undefined;
  for (const def of usageDefs) {
    const row = await foc(usageRepo,
      { tenantId, month: def.month } as FindOptionsWhere<TenantUsage>,
      { tenantId, ...def },
    );
    firstUsageId ??= row.usageId;
  }

  // ── Per-metric store: fixed past months for every built-in metric ───────────
  // Keys are the built-in metric declarations of `tenant_usage.metrics`.
  // Growth from a quiet first month to a busy one; deliberately the same shape
  // as the legacy rollup above so the two stores tell one story.
  const METRIC_HISTORY: Record<string, number[]> = {
    apiCalls: [1_240, 28_750, 41_300],
    aiTokens: [85_000, 2_450_000, 3_100_000],
    storageBytes: [268_435_456, 5_368_709_120, 6_442_450_944],
    emailSends: [42, 1_310, 1_875],
    smsSends: [0, 96, 140],
    webhookCalls: [310, 4_820, 7_205],
  };
  const PAST_PERIODS = ['2026-06', '2026-07', '2026-08'];
  const metricRepo = ctx.repo<TenantUsageMetricRow>(TenantUsageMetricRow);
  let metricRows = 0;
  for (const [metric, history] of Object.entries(METRIC_HISTORY)) {
    for (let i = 0; i < PAST_PERIODS.length; i++) {
      await foc(metricRepo,
        { tenantId, period: PAST_PERIODS[i], metric } as FindOptionsWhere<TenantUsageMetricRow>,
        { tenantId, period: PAST_PERIODS[i], metric, value: String(history[i]) },
      );
      metricRows += 1;
    }
  }

  // Publish a reference in case a later module wants to point at a usage bucket.
  ctx.refs.tenantUsageId = firstUsageId;

  ctx.log(`tenant_usage: ${usageDefs.length} monthly usage buckets, ${metricRows} per-metric rows for ${tenantId}`);
}
