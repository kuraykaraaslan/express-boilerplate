import { z } from 'zod';
import { IsoSecondsSchema, isoSeconds } from './attest.schema';

/**
 * Backup horizons of a purge (docs/phases/02-fleet/08 section 4 item 3, 06 section 4 "Retention tiers", 05 section 7 stage 9): the latest instant each
 * backup tier of a node may still hold a tenant it purged, and `backupHorizonAt`, the latest of them. A node puts them in its PURGED receipt (the
 * deletion purge and a migration's source purge alike); the directory records `backupHorizonAt` on the tenant's row, and for a migrated tenant keeps the
 * later of the former home's and the final home's (05 section 6: `backupHorizonAt = max(source, target)`).
 *
 * How each tier's horizon follows from the node's retention (all relative to the purge, whole seconds):
 *  - `PITR`: pgBackRest keeps fulls by time (`repo1-retention-full-type=time`, `FLEET_BACKUP_RETENTION_DAYS`) and always the full a kept point in time
 *    needs, so a backup taken just before the purge ages out at most `pitrDays + fullIntervalDays` later (the full it depends on can be one interval
 *    older than the window);
 *  - `OBJECT_VERSIONS`: the backup bucket is versioned and the backup credential may not delete versions, so a file pgBackRest expires stays a
 *    noncurrent version for the bucket's lifecycle rule (`FLEET_BACKUP_NONCURRENT_DAYS`) after the PITR horizon;
 *  - `SCRATCH_RESTORE`: a restore drill may start from the last backup still holding the tenant, and its scratch instance is destroyed within
 *    `SCRATCH_RESTORE_MAX_HOURS` (06 section 4 "Verification"), so this is the PITR horizon plus that lifetime;
 *  - `MONTHLY_FULL` (a second repository, where the policy asks for monthly fulls) and `STANDBY_WAL` (a DR profile's archive): listed only when the node
 *    runs them; a node without them has no such copy.
 * A tier the node runs but whose retention it cannot state (no noncurrent-version days in its report) is named in `unknownTiers`, never guessed: the
 * receipt then promises nothing about it. Class G: an enum, timestamps.
 */
export const BACKUP_TIERS = ['PITR', 'MONTHLY_FULL', 'STANDBY_WAL', 'OBJECT_VERSIONS', 'SCRATCH_RESTORE'] as const;
export type BackupTier = (typeof BACKUP_TIERS)[number];

/** The weekly full of `infra/compose/backup/fleet-backup-full.timer` (a compose test pins the timer to it). */
export const BACKUP_FULL_INTERVAL_DAYS = 7;
/** The longest a restore drill's scratch instance may live before the drill destroys it. */
export const SCRATCH_RESTORE_MAX_HOURS = 24;
/** No tier keeps a backup longer than this after a purge (a bound on what a receipt may claim, not a retention). */
export const MAX_BACKUP_HORIZON_DAYS = 3660;

const DAY = 86_400;
const unique = <T,>(a: readonly T[]): boolean => new Set(a).size === a.length;

export const BackupHorizonsSchema = z.object({
  tiers: z.partialRecord(z.enum(BACKUP_TIERS), IsoSecondsSchema),
  /**
   * Tiers the node runs whose horizon it cannot state. After a merge (a migrated tenant), a tier one copy could state and the other could not is
   * both in `tiers` (the stated horizon) and here.
   */
  unknownTiers: z.array(z.enum(BACKUP_TIERS)).max(BACKUP_TIERS.length).refine(unique, 'duplicate tier'),
  backupHorizonAt: IsoSecondsSchema,
}).strict().superRefine((h, ctx) => {
  const at = Object.values(h.tiers).filter((v): v is string => typeof v === 'string');
  if (at.length === 0) { ctx.addIssue({ code: 'custom', message: 'no tier', path: ['tiers'] }); return; }
  if (at.reduce((a, b) => (a > b ? a : b)) !== h.backupHorizonAt) ctx.addIssue({ code: 'custom', message: 'backupHorizonAt is not the latest tier', path: ['backupHorizonAt'] });
});
export type BackupHorizons = z.infer<typeof BackupHorizonsSchema>;

/** What the node knows of its own retention (from the acknowledged BACKUP_INVENTORY); a null number is a tier it cannot state. */
export interface BackupRetention {
  pitrDays: number | null;
  noncurrentDays: number | null;
  /** Days a monthly full is kept, where the node runs the monthly repository; absent or null when it does not. */
  monthlyRetentionDays?: number | null;
  /** Days the standby WAL archive is kept, where the node runs a DR profile; absent or null when it does not. */
  standbyWalDays?: number | null;
  /** Tiers the node runs but whose retention its report does not state (e.g. a second repository in the report): named in `unknownTiers`, never guessed. */
  unstated?: readonly BackupTier[];
}

const bounded = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_BACKUP_HORIZON_DAYS;

/**
 * The horizons of a purge at `purgedAtSec` (unix seconds) under `retention`; null when the node cannot state even its PITR window (no backup report, or
 * one without retention days): a receipt then carries no horizons and the directory records none, rather than a guess.
 */
export function deriveBackupHorizons(purgedAtSec: number, retention: BackupRetention): BackupHorizons | null {
  if (!bounded(retention.pitrDays)) return null;
  const iso = (sec: number) => isoSeconds(sec * 1000);
  const pitr = purgedAtSec + (retention.pitrDays + BACKUP_FULL_INTERVAL_DAYS) * DAY;
  const tiers: Partial<Record<BackupTier, string>> = { PITR: iso(pitr), SCRATCH_RESTORE: iso(pitr + SCRATCH_RESTORE_MAX_HOURS * 3600) };
  const unknownTiers: BackupTier[] = [];
  if (bounded(retention.noncurrentDays)) tiers.OBJECT_VERSIONS = iso(pitr + retention.noncurrentDays * DAY);
  else unknownTiers.push('OBJECT_VERSIONS');
  // a monthly full taken the day before the purge lives its whole retention, and the next one is a month away
  if (bounded(retention.monthlyRetentionDays)) tiers.MONTHLY_FULL = iso(purgedAtSec + (retention.monthlyRetentionDays + 31) * DAY);
  if (bounded(retention.standbyWalDays)) tiers.STANDBY_WAL = iso(purgedAtSec + retention.standbyWalDays * DAY);
  for (const t of retention.unstated ?? []) if (tiers[t] === undefined && !unknownTiers.includes(t)) unknownTiers.push(t);
  return finish(tiers, unknownTiers);
}

/** The later horizon of each tier over several copies of a tenant (a migrated tenant: its former homes and its last home), null for none. */
export function mergeBackupHorizons(...all: ReadonlyArray<BackupHorizons | null | undefined>): BackupHorizons | null {
  const present = all.filter((h): h is BackupHorizons => !!h);
  if (present.length === 0) return null;
  const tiers: Partial<Record<BackupTier, string>> = {};
  const unknown = new Set<BackupTier>();
  for (const h of present) {
    for (const t of BACKUP_TIERS) {
      const v = h.tiers[t];
      if (v && (!tiers[t] || v > tiers[t]!)) tiers[t] = v;
    }
    for (const t of h.unknownTiers) unknown.add(t);
  }
  return finish(tiers, BACKUP_TIERS.filter((t) => unknown.has(t)));
}

function finish(tiers: Partial<Record<BackupTier, string>>, unknownTiers: BackupTier[]): BackupHorizons {
  const ordered: Partial<Record<BackupTier, string>> = {};
  for (const t of BACKUP_TIERS) if (tiers[t]) ordered[t] = tiers[t];
  const backupHorizonAt = Object.values(ordered).reduce((a, b) => (a! > b! ? a : b))!;
  return BackupHorizonsSchema.parse({ tiers: ordered, unknownTiers, backupHorizonAt });
}

/** Whether every horizon lies at or after the purge it belongs to and within MAX_BACKUP_HORIZON_DAYS of it (`occurredAt`: the receipt's time). */
export function horizonsFitPurge(h: BackupHorizons, occurredAt: string): boolean {
  const start = Date.parse(occurredAt);
  const end = start + MAX_BACKUP_HORIZON_DAYS * DAY * 1000;
  return Object.values(h.tiers).every((v) => { const t = Date.parse(v!); return t >= start && t <= end; });
}

/**
 * What the agent tells the app about the node's backup retention (decision F35): the numbers of the helper's report, which the app needs when a purge
 * writes its receipt (`deriveBackupHorizons`). Class G: integers and tier names. `reportAt` is when the helper's report was written (unix seconds), so the
 * app can tell a fresh fact from a stale one and promise nothing from the latter.
 */
export const BackupRetentionFactsSchema = z.object({
  pitrDays: z.number().int().min(1).max(MAX_BACKUP_HORIZON_DAYS),
  noncurrentDays: z.number().int().min(0).max(MAX_BACKUP_HORIZON_DAYS).nullable(),
  unstated: z.array(z.enum(BACKUP_TIERS)).max(BACKUP_TIERS.length).refine(unique, 'duplicate tier').default([]),
  /** Where the repositories of the report are: REMOTE (object storage at a known endpoint), LOCAL (a path on a host), UNKNOWN (the residency page's backup location). */
  locationClass: z.enum(['REMOTE', 'LOCAL', 'UNKNOWN']).default('UNKNOWN'),
  reportAt: z.number().int().min(0).max(4_102_444_800),
}).strict();
export type BackupRetentionFacts = z.infer<typeof BackupRetentionFactsSchema>;

/** A retention fact older than this is not a basis for a promise (a node whose backups stopped reporting gives no horizons). */
export const BACKUP_FACTS_MAX_AGE_SECONDS = 7 * DAY;

/** Whether a fact is a basis for a statement at `nowSec`: not older than a week, not from the future. */
export const backupFactsFresh = (f: Pick<BackupRetentionFacts, 'reportAt'> | null, nowSec: number): boolean =>
  !!f && f.reportAt <= nowSec + 3600 && nowSec - f.reportAt <= BACKUP_FACTS_MAX_AGE_SECONDS;

/** The retention a purge at `nowSec` may rely on: the facts when they are fresh (not older than a week, not from the future), else null. */
export function retentionFromFacts(f: BackupRetentionFacts | null, nowSec: number): BackupRetention | null {
  if (!f || !backupFactsFresh(f, nowSec)) return null;
  return { pitrDays: f.pitrDays, noncurrentDays: f.noncurrentDays, unstated: f.unstated };
}
