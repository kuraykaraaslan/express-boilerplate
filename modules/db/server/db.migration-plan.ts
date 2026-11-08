import { createHash } from 'node:crypto';

/**
 * Pure rules for the SQL migration ledger: the header a file uses to declare its
 * phase, the checksum, and what is pending against a ledger snapshot. No fs, no
 * database, no env, so every branch is unit-testable and the release pipeline
 * (`modules/db/scripts/db-migration-manifest.ts`) and the deploy runner share one definition.
 *
 * `MigrationPhase` and the `{ name, checksum, kind, reversible }` shape mirror
 * `ReleaseMigration` of `fleet_protocol` (contract.schema.ts). `db` is
 * infrastructure that `fleet_protocol` does not know and must not depend on, so
 * the minimal type is mirrored here and `db.migration-plan.test.ts` proves both
 * agree (shape, and the phase-order verdict of `checkMigrationPlan`).
 */

export const MIGRATION_PHASES = ['expand', 'migrate', 'contract'] as const;
export type MigrationPhase = (typeof MIGRATION_PHASES)[number];

/** Same shape as `ReleaseMigration` in fleet_protocol. */
export interface PlannedMigration {
  /** Ledger identity: `<module>:<file>`. */
  name: string;
  /** sha256 hex of the file, line endings normalised to LF. */
  checksum: string;
  kind: MigrationPhase;
  reversible: boolean;
}

export interface MigrationDirectives {
  kind: MigrationPhase;
  reversible: boolean;
  /** Re-applied when its checksum changes instead of failing (generated, idempotent files). */
  repeatable: boolean;
  /**
   * Checksums of earlier versions of this file that an applied ledger row may carry: the author declares the edit
   * changes nothing for a database that already ran the old text, so the row is re-stamped instead of failing.
   * Absent when the file declares none.
   */
  supersedes?: string[];
}

/** A migration file read from disk, with its ledger identity. */
export interface LoadedMigration {
  moduleId: string;
  file: string;
  name: string;
  sql: string;
}

/** A migration the runner will execute: the plan entry plus why it is pending. */
export interface PendingMigration extends PlannedMigration {
  repeatable: boolean;
  /** `new`: no ledger row. `changed`: a repeatable file whose checksum differs from the ledger (or has none). */
  reason: 'new' | 'changed';
}

/** Ledger rows by name: the stored checksum, or `null` for a row written before checksums existed. */
export type LedgerSnapshot = ReadonlyMap<string, string | null>;

export interface LedgerClassification {
  pending: PendingMigration[];
  /** Already applied and unchanged. */
  skipped: string[];
  /**
   * Applied rows whose checksum is rewritten without running the file: no stored checksum (trust-on-first-use,
   * `from: null`), or a checksum the file declares it `supersedes` (`from` is that checksum).
   */
  stamp: Array<{ name: string; checksum: string; from: string | null }>;
  /** Applied rows whose file no longer matches the stored checksum, and are not repeatable. */
  mismatched: Array<{ name: string; stored: string; found: string }>;
}

/** Checksum of a migration file. CRLF is normalised so a Windows checkout and a Linux build agree. */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

const DIRECTIVE_KEYS = ['kind', 'reversible', 'repeatable', 'supersedes'] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
type DirectiveKey = (typeof DIRECTIVE_KEYS)[number];

function isDirectiveKey(value: string): value is DirectiveKey {
  return (DIRECTIVE_KEYS as readonly string[]).includes(value);
}

function parseBool(name: string, key: string, value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`[db-deploy] migration ${name}: "${key}" must be true or false, got "${value}"`);
}

/**
 * Read the directives a file declares in its LEADING comment block (up to the
 * first line that is neither blank nor a `--` comment). A directive line is
 * `-- key: value[; key: value ...]` with keys `kind` (`expand|migrate|contract`,
 * default `expand`), `reversible` and `repeatable` (`true|false`):
 *
 *   -- kind: migrate; reversible: false
 *   -- repeatable: true
 *   -- supersedes: <sha256 hex>[,<sha256 hex> ...]
 *
 * `supersedes` lists the checksums of earlier versions of the file (lowercase sha256 hex, comma-separated, no
 * spaces). Only a non-repeatable file may declare it (a repeatable file is re-applied anyway). It is for an edit
 * that is a no-op for a database that already ran the old text, such as a column default that only a fresh
 * schema will ever use; anything else belongs in a new file.
 *
 * A comment line whose first key is not one of these is plain prose. A directive
 * line that is malformed, repeats a key, or contradicts the contract rules
 * (`contract` is never reversible) throws, so a typo cannot silently run a
 * destructive step as `expand`.
 *
 * `reversible` defaults to true for `expand` (N-1 code ignores the addition) and
 * to false for `migrate` and `contract` (a data movement is assumed to be one-way
 * until its author says otherwise).
 */
export function parseMigrationDirectives(name: string, sql: string): MigrationDirectives {
  const seen = new Map<DirectiveKey, string>();
  for (const raw of sql.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('--')) break;
    const parts = line.slice(2).split(';');
    const first = /^\s*([A-Za-z_]+)\s*:/.exec(parts[0]!);
    if (!first || !isDirectiveKey(first[1]!.toLowerCase())) continue;
    for (const part of parts) {
      const m = /^\s*([A-Za-z_]+)\s*:\s*(\S+)\s*$/.exec(part);
      if (!m || !isDirectiveKey(m[1]!.toLowerCase())) {
        throw new Error(`[db-deploy] migration ${name}: malformed directive "${part.trim()}"`);
      }
      const key = m[1]!.toLowerCase() as DirectiveKey;
      if (seen.has(key)) throw new Error(`[db-deploy] migration ${name}: directive "${key}" declared twice`);
      seen.set(key, m[2]!);
    }
  }

  const kindRaw = seen.get('kind') ?? 'expand';
  if (!(MIGRATION_PHASES as readonly string[]).includes(kindRaw)) {
    throw new Error(`[db-deploy] migration ${name}: kind must be one of ${MIGRATION_PHASES.join('|')}, got "${kindRaw}"`);
  }
  const kind = kindRaw as MigrationPhase;
  const reversibleRaw = seen.get('reversible');
  const reversible = reversibleRaw === undefined ? kind === 'expand' : parseBool(name, 'reversible', reversibleRaw);
  if (kind === 'contract' && reversible) {
    throw new Error(`[db-deploy] migration ${name}: a contract migration cannot be reversible`);
  }
  const repeatableRaw = seen.get('repeatable');
  const repeatable = repeatableRaw === undefined ? false : parseBool(name, 'repeatable', repeatableRaw);
  if (repeatable && kind !== 'expand') {
    throw new Error(`[db-deploy] migration ${name}: only an expand migration can be repeatable`);
  }
  const supersedesRaw = seen.get('supersedes');
  const supersedes = supersedesRaw === undefined ? [] : supersedesRaw.split(',');
  for (const sum of supersedes) {
    if (!SHA256_HEX.test(sum)) {
      throw new Error(`[db-deploy] migration ${name}: "supersedes" takes lowercase sha256 hex checksums, got "${sum}"`);
    }
  }
  if (new Set(supersedes).size !== supersedes.length) {
    throw new Error(`[db-deploy] migration ${name}: "supersedes" lists a checksum twice`);
  }
  if (supersedes.length > 0 && repeatable) {
    throw new Error(`[db-deploy] migration ${name}: a repeatable migration cannot declare "supersedes"`);
  }
  return supersedes.length > 0 ? { kind, reversible, repeatable, supersedes } : { kind, reversible, repeatable };
}

/** The `{ name, checksum, kind, reversible }` entry of one file: the unit of the release manifest. */
export function planMigration(file: LoadedMigration): PlannedMigration & { repeatable: boolean; supersedes: string[] } {
  const { kind, reversible, repeatable, supersedes = [] } = parseMigrationDirectives(file.name, file.sql);
  return { name: file.name, checksum: migrationChecksum(file.sql), kind, reversible, repeatable, supersedes };
}

/** Every file in apply order, as manifest entries (no ledger: this is what a release carries). */
export function planAllMigrations(files: ReadonlyArray<LoadedMigration>): PlannedMigration[] {
  return files.map((file) => {
    const { name, checksum, kind, reversible } = planMigration(file);
    return { name, checksum, kind, reversible };
  });
}

/**
 * Compare the files with a ledger snapshot.
 *
 * - no row                      -> pending (`new`)
 * - row, same checksum          -> skipped
 * - row, NULL checksum          -> a repeatable file is re-applied (it cannot be known which generation ran), any
 *                                  other file is stamped from the current file. This TRUSTS the file as it is now:
 *                                  a migration edited after it was applied, before checksums existed, is accepted.
 * - row, different checksum     -> a repeatable file is re-applied; a checksum the file declares it `supersedes` is
 *                                  re-stamped to the current one without running the file; anything else is a
 *                                  mismatch (fail closed)
 */
export function classifyAgainstLedger(
  files: ReadonlyArray<LoadedMigration>,
  ledger: LedgerSnapshot,
): LedgerClassification {
  const out: LedgerClassification = { pending: [], skipped: [], stamp: [], mismatched: [] };
  for (const file of files) {
    const plan = planMigration(file);
    const pending = (reason: PendingMigration['reason']): PendingMigration => ({
      name: plan.name, checksum: plan.checksum, kind: plan.kind, reversible: plan.reversible, repeatable: plan.repeatable, reason,
    });
    if (!ledger.has(file.name)) {
      out.pending.push(pending('new'));
      continue;
    }
    const stored = ledger.get(file.name) ?? null;
    if (stored === plan.checksum) out.skipped.push(file.name);
    else if (plan.repeatable) out.pending.push(pending('changed'));
    else if (stored === null) out.stamp.push({ name: file.name, checksum: plan.checksum, from: null });
    else if (plan.supersedes.includes(stored)) out.stamp.push({ name: file.name, checksum: plan.checksum, from: stored });
    else out.mismatched.push({ name: file.name, stored, found: plan.checksum });
  }
  return out;
}

/** What is left to run against a ledger snapshot, in the shape the release manifest and the deployd preflight use. */
export function planPendingMigrations(
  files: ReadonlyArray<LoadedMigration>,
  ledger: LedgerSnapshot,
): PlannedMigration[] {
  return classifyAgainstLedger(files, ledger).pending.map(({ name, checksum, kind, reversible }) => ({
    name, checksum, kind, reversible,
  }));
}

export type PendingPlanDecision = 'REJECTED_PHASE_ORDER' | 'REJECTED_CONTRACT_NOT_ALLOWED';

const PHASE_RANK: Readonly<Record<MigrationPhase, number>> = { expand: 0, migrate: 1, contract: 2 };

/** Phases never go backwards within one run (same rule as `checkMigrationPlan` in fleet_protocol). */
export function phasesGoBackwards(pending: ReadonlyArray<Pick<PlannedMigration, 'kind'>>): boolean {
  let max = 0;
  for (const m of pending) {
    const rank = Object.hasOwn(PHASE_RANK, m.kind) ? PHASE_RANK[m.kind] : undefined;
    if (rank === undefined || rank < max) return true;
    max = rank;
  }
  return false;
}

/**
 * Gate before anything is applied. A pending `contract` migration is destructive and runs only when the caller
 * says so (`allowContract`, set by the node helper inside a READ_ONLY maintenance window after the backup).
 */
export function checkPendingPlan(
  pending: ReadonlyArray<Pick<PlannedMigration, 'kind'>>,
  opts: { allowContract: boolean },
): PendingPlanDecision | null {
  if (phasesGoBackwards(pending)) return 'REJECTED_PHASE_ORDER';
  if (!opts.allowContract && pending.some((m) => m.kind === 'contract')) return 'REJECTED_CONTRACT_NOT_ALLOWED';
  return null;
}
