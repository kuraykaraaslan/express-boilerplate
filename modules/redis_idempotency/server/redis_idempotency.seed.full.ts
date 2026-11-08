import 'reflect-metadata'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { IdempotencyClaim } from './entities/idempotency_claim.entity'

const DAY = 24 * 60 * 60 * 1000
const ANCHOR = Date.UTC(2026, 5, 1, 9, 0, 0)
const at = (daysBeforeAnchor: number) => new Date(ANCHOR - daysBeforeAnchor * DAY)

/**
 * Full-load seed for `redis_idempotency`: the durable claim table (`idempotency_claims`, redis_idempotency.02).
 *
 * Why this is NOT in the default seed (the module is exempt as `runtime-state`): a claim is written by a request that sent an
 * `Idempotency-Key` while it runs; a fabricated one on a real tenant would refuse that tenant's next request with the same key.
 * The full-load lane (guarded test database only) still needs the table filled.
 *
 * Why these rows are inert: the keys name a tenant segment no tenant has (`seed-synthetic`), and every row expired long ago,
 * so the durable store treats it as absent; the expiry sweep may remove them. One pending and one completed claim, the two states.
 *
 * Idempotent: keyed on the fixed `claimKey`; all dates are fixed.
 */
export async function seedRedisIdempotencyFull(ctx: SeedContext): Promise<void> {
  const repo = ctx.systemRepo(IdempotencyClaim)
  const rows: Array<{ claimKey: string; status: string; expiresAt: Date }> = [
    { claimKey: 'idempotency:seed-synthetic:pending-0001', status: 'pending', expiresAt: at(30) },
    { claimKey: 'idempotency:seed-synthetic:completed-0001', status: 'completed', expiresAt: at(29) },
  ]
  for (const row of rows) await ctx.foc(repo, { claimKey: row.claimKey }, row)
  ctx.log(`[seed] redis_idempotency_full: ${rows.length} expired synthetic claims`)
}
