/** The noise assistant over the tenant's stored alerts (phase 20.4). Read-only: it returns suggestions and changes nothing. */
import { MoreThanOrEqual } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Alert } from '../entities/alert.entity';
import { analyzeNoise, type NoiseSuggestion } from './ai.noise';

export const MAX_NOISE_DAYS = 60;
const MAX_ALERTS = 10_000;

export async function noiseSuggestions(tenantId: string, days = 14, now: Date = new Date()): Promise<{ windowDays: number; analysed: number; truncated: boolean; suggestions: NoiseSuggestion[] }> {
  const windowDays = Math.min(MAX_NOISE_DAYS, Math.max(1, Math.floor(days)));
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const rows = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({ where: { tenantId, startsAt: MoreThanOrEqual(since) }, order: { startsAt: 'DESC' }, take: MAX_ALERTS + 1 }));
  const truncated = rows.length > MAX_ALERTS;
  const used = rows.slice(0, MAX_ALERTS);
  return { windowDays, analysed: used.length, truncated, suggestions: analyzeNoise(used.map((a) => ({ ...a, labels: a.labels ?? {} })), { windowDays, now }) };
}
