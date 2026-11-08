import Logger from '@kuraykaraaslan-labs/logger'

/**
 * The last completed run of a sweep that asked to be recorded (`defineRetentionSweepJob`), kept in Redis so whichever trigger ran it (the BullMQ
 * worker or the HTTP cron twin, in any process) leaves the same evidence. A node's compliance check `privacy.sweepers_scheduled` reads it: a sweeper
 * that is declared but never runs (background jobs off and no external cron) is the failure the check exists to find, and the declaration alone
 * cannot show it.
 *
 * G-class only: when, how many tenants, how many failed, and when the last run was that swept every tenant (`cleanAt`). No tenant id, no row count.
 * A record has no expiry: the key set is fixed (one per retention job) and a record that expired would turn "stopped long ago" into "never ran".
 * Redis being unreachable never fails a sweep (the write is best effort) but does fail the read, so the check reports ERROR rather than a pass it
 * cannot back.
 *
 * The other half of the evidence is the WATCH mark (`markSweepWatch`): the first time a node's check looked for a sweeper's runs. A sweeper with no
 * run record that has been watched for longer than its allowed run age has not run where it should have (a node with no worker and no cron), and
 * the check fails it. A flushed Redis loses both, so the node gets one grace window again, then fails.
 */
export interface SweepRunRecord {
  /** Epoch ms when the run finished. */
  at: number
  tenants: number
  failed: number
  /** Epoch ms of the last run in which no tenant failed (null when none has yet): the time every tenant was last swept. */
  cleanAt: number | null
}

export const sweepRunKey = (name: string): string => `cron:sweep-run:${name}`
export const sweepWatchKey = (name: string): string => `cron:sweep-watch:${name}`

interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: string[]): Promise<unknown>
  mget(...keys: string[]): Promise<(string | null)[]>
}

const defaultRedis = async (): Promise<RedisLike> => (await import('@kuraykaraaslan-labs/redis')).default as unknown as RedisLike

/** Records a finished run, carrying the last clean run forward from the previous record. Never throws. */
export async function recordSweepRun(name: string, run: { tenants: number; failed: number }, at = Date.now(), redis: () => Promise<RedisLike> = defaultRedis): Promise<void> {
  try {
    const r = await redis()
    const prev = run.failed === 0 ? null : parseSweepRun(await r.get(sweepRunKey(name)))
    const record: SweepRunRecord = { at, tenants: run.tenants, failed: run.failed, cleanAt: run.failed === 0 ? at : (prev?.cleanAt ?? null) }
    await r.set(sweepRunKey(name), JSON.stringify(record))
  } catch (err) {
    Logger.warn(`[CronJob:${name}] run record not written: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const int = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

/** A stored value back into a record, or null for anything that is not one (a missing key, a value written by something else). */
export function parseSweepRun(raw: string | null | undefined): SweepRunRecord | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<SweepRunRecord>
    if (!(int(v.at) && int(v.tenants) && int(v.failed))) return null
    // a record written before `cleanAt` existed: its own run is the only evidence
    const cleanAt = v.cleanAt === undefined ? (v.failed === 0 ? v.at : null) : v.cleanAt
    if (cleanAt !== null && !int(cleanAt)) return null
    return { at: v.at, tenants: v.tenants, failed: v.failed, cleanAt }
  } catch {
    return null
  }
}

/** The last run of each named sweep (null = no record). Throws when Redis cannot be read. */
export async function lastSweepRuns(names: readonly string[], redis: () => Promise<RedisLike> = defaultRedis): Promise<Record<string, SweepRunRecord | null>> {
  if (names.length === 0) return {}
  const values = await (await redis()).mget(...names.map(sweepRunKey))
  return Object.fromEntries(names.map((n, i) => [n, parseSweepRun(values[i])]))
}

/**
 * Since when this node has been looking for each named sweep's runs: sets the mark to `now` where none exists (SET NX, no expiry) and returns every
 * mark. Throws when Redis cannot be read or written (the check reports ERROR).
 */
export async function markSweepWatch(names: readonly string[], now = Date.now(), redis: () => Promise<RedisLike> = defaultRedis): Promise<Record<string, number>> {
  if (names.length === 0) return {}
  const r = await redis()
  await Promise.all(names.map((n) => r.set(sweepWatchKey(n), String(now), 'NX')))
  const values = await r.mget(...names.map(sweepWatchKey))
  const out: Record<string, number> = {}
  for (const [i, n] of names.entries()) {
    const v = Number(values[i])
    if (values[i] !== null && int(v) && v <= now) { out[n] = v; continue }
    // a mark that is not a past time (written by something else, or lost between the two calls) is replaced: the grace window starts again
    await r.set(sweepWatchKey(n), String(now))
    out[n] = now
  }
  return out
}
