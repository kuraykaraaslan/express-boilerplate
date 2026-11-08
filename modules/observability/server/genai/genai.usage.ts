/**
 * Token and cost per tenant for NB's own model calls (phase 20.6), read from the usage log `ai` already writes for every call
 * (`ai_usage_logs`: provider, model, kind, tokens, cost). No second ledger. `ai` is an optional dependency: without it the answer is
 * `available: false`, not an error.
 */
import { MoreThanOrEqual } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { loadAiPeer } from '../peers/peers';

const MAX_ROWS = 50_000;
export const MAX_USAGE_DAYS = 90;

export interface UsageRow { provider: string; model: string; kind: string; inputTokens: number; outputTokens: number; totalTokens: number; costUsd?: number | string | null; createdAt: Date | string }

export interface UsageLine { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number | null }
export interface TenantAiUsage {
  available: boolean;
  days: number;
  truncated: boolean;
  total: UsageLine;
  byModel: Array<UsageLine & { provider: string; model: string }>;
  byDay: Array<UsageLine & { day: string }>;
}

const empty = (): UsageLine => ({ calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: null });

function add(line: UsageLine, r: UsageRow): void {
  line.calls += 1;
  line.inputTokens += Number(r.inputTokens) || 0;
  line.outputTokens += Number(r.outputTokens) || 0;
  line.totalTokens += Number(r.totalTokens) || 0;
  // A model with no price in the table has no cost: the total stays "unknown" only while NOTHING in it has one.
  if (r.costUsd !== null && r.costUsd !== undefined && Number.isFinite(Number(r.costUsd))) line.costUsd = (line.costUsd ?? 0) + Number(r.costUsd);
}

/** Pure: roll the usage rows up by model and by UTC day. */
export function rollUpUsage(rows: readonly UsageRow[], days: number, truncated = false): TenantAiUsage {
  const total = empty();
  const byModel = new Map<string, UsageLine & { provider: string; model: string }>();
  const byDay = new Map<string, UsageLine & { day: string }>();
  for (const r of rows) {
    add(total, r);
    const mk = `${r.provider}\u0000${r.model}`;
    if (!byModel.has(mk)) byModel.set(mk, { ...empty(), provider: r.provider, model: r.model });
    add(byModel.get(mk)!, r);
    const day = new Date(r.createdAt).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { ...empty(), day });
    add(byDay.get(day)!, r);
  }
  const round = <T extends UsageLine>(l: T): T => ({ ...l, costUsd: l.costUsd === null ? null : Math.round(l.costUsd * 1e6) / 1e6 });
  return {
    available: true, days, truncated, total: round(total),
    byModel: [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens).map(round),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map(round),
  };
}

export async function tenantAiUsage(tenantId: string, days: number, now: Date = new Date()): Promise<TenantAiUsage> {
  const d = Math.min(MAX_USAGE_DAYS, Math.max(1, Math.floor(days)));
  const ai = await loadAiPeer(tenantId);
  if (!ai) return { ...rollUpUsage([], d), available: false };
  const since = new Date(now.getTime() - d * 86_400_000);
  const rows = await withTenantRepositoryFor(tenantId, ai.usageLogEntity, (repo) => repo.find({ where: { tenantId, createdAt: MoreThanOrEqual(since) }, order: { createdAt: 'DESC' }, take: MAX_ROWS + 1 }));
  const truncated = rows.length > MAX_ROWS;
  return rollUpUsage(rows.slice(0, MAX_ROWS) as unknown as UsageRow[], d, truncated);
}
