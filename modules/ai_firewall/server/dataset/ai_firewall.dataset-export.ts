import { createHmac } from 'node:crypto';
import {
  ACTOR_KIND_CODES, ATTACK_V1, BEHAVIOUR_V1, LANE_CODES, catalogueHash, featureNames, type FeatureCatalogue,
} from '../features/ai_firewall.feature-catalogue';
import { LABEL_CLASSES, LABEL_REF_KINDS, LABEL_SOURCES, type LabelClass, type LabelRefKind, type LabelSource } from '../labels/ai_firewall.label-model';
import { storedVectorsOf } from './ai_firewall.vector-capture';

/**
 * The dataset export's pure core (docs/phases/55-ai-firewall/03 §3.5, D55-88 to D55-91): labels joined to the feature vectors they are
 * about, as the offline trainer of 04.1 reads them, with no personal data. The CLI (`scripts/export-dataset.mts`,
 * `npm run ai-firewall:export-dataset`) guards the install, reads the rows and writes the files; everything that decides what leaves is
 * here and tested (`ai_firewall.dataset-export.test.ts`).
 *
 * WHERE: a staging or demo install only (`INSTALL_ROLE`, the explicit setting of 03 §3.3, never inferred), and every database it opens
 * must say so by its name (`…staging`, `…demo`); anything else is refused before a connection opens (`exportEnvGuard`) and again on the
 * live connections (`exportDatabaseGuard`). A customer's (production) install keeps no vector to export in the first place
 * (`ai_firewall.vector-capture.ts`) and never sends data out (FWO-7 open: an opt-in is the owner's decision).
 *
 * WHAT (one file per model, one JSON object per line, every key from DATASET_COLUMNS and nothing else):
 *   ref, tenant, actor, run   ids RE-KEYED under an export key: HMAC-SHA256(exportKey, "<domain>:<value>"), base64url, 22 characters.
 *                             The actor's value is its keyed feature id of 02 (`featureIdOf`, never the raw id), so the export key
 *                             is applied over the install's own key. The export key is 32 random bytes per export, held in memory and
 *                             never written: one export's ids group its own rows (an actor's labels, a run's labels, a reference's
 *                             labels from several sources) and join to nothing else, not to the install and not to another export;
 *   refKind, actorKind, lane, source, labelClass, verdict   closed lists (a value outside its list drops the row; a lane outside the
 *                             catalogue's codes is `unknown`);
 *   hour                      when the labelled behaviour happened, truncated to the hour (UTC): enough for 04.1's time-split
 *                             holdout, too coarse to pick one request out of an install's logs;
 *   confidence                0..1, three decimals; coldStart a boolean;
 *   x                         the catalogue's vector as 02 assembled it (`featureVector`), one number per feature in the catalogue's
 *                             order, null for missing; the names, version and hash are in the manifest.
 * Never: an address, a user, session, key, device or tenant id, a name, an e-mail address, a tenant name, a signal kind, a detector, an
 * attribute, free text, the exact time, the person who labelled. `datasetRowProblem` checks every row against the allow-list before it
 * is written and the export is refused on the first one that fails (it cannot, by construction; the check is the guarantee).
 *
 * WHOSE labels (D55-92): a staging install exports every source (its people are the platform's own operators and its traffic the probe
 * runner's); a DEMO install exports `benign_traffic` labels only (its scripted traffic, marked with the benign credential). The demo's
 * tenants are handed to prospects and testers: their verdicts (`admin`), their decoy touches and their bans have no known truth, and a
 * global model must not learn from them (data poisoning). `EXPORT_SOURCES` is the policy; the source's SQL reads only those sources (the
 * rest counted `source_not_allowed`), `buildDataset` drops any other row again, and the manifest names the policy.
 *
 * WHICH rows: one per label (a reference labelled by two sources is two rows with the same `ref`) and per catalogue whose own features
 * apply to the actor's kind (behaviour.v1: a person, a session, an API key; attack.v1: every kind). Skipped and counted in the manifest:
 * `unsure` verdicts (no truth), labels of an erased person (`erased`), labels with no kept vector (`no_vectors`), rows with a value
 * outside its list (`malformed`), an actor with no feature id (`no_actor_id`), and per dataset a vector of another catalogue version
 * (`catalogue_mismatch`), a kind the catalogue does not describe (`not_applicable`), a vector read without windows (`no_windows`).
 */
export const DATASET_FORMAT = 'nb.ai_firewall.dataset/1';
export const MANIFEST_FILE = 'manifest.json';

/** The two model catalogues, each its own dataset (04.1: one dataset per model). */
export const DATASET_CATALOGUES: readonly FeatureCatalogue[] = [BEHAVIOUR_V1, ATTACK_V1];
export const datasetFileOf = (c: Pick<FeatureCatalogue, 'name'>): string => `${c.name}.jsonl`;

/** Every key a dataset row has, in its order. Nothing else is ever written. */
export const DATASET_COLUMNS = [
  'ref', 'refKind', 'tenant', 'actor', 'actorKind', 'lane', 'hour', 'source', 'labelClass', 'verdict', 'confidence', 'run', 'coldStart', 'x',
] as const;
export type DatasetColumn = (typeof DATASET_COLUMNS)[number];

/** The verdicts a row may carry (null for a system source); `unsure` is skipped. */
export const DATASET_VERDICTS = ['true_positive', 'false_positive'] as const;
export type DatasetVerdict = (typeof DATASET_VERDICTS)[number];

export const EXPORT_ID_LENGTH = 22;
const EXPORT_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/;

/** The actor id the erasure leaves on an incident and its labels (`ai_firewall.privacy-erasure.ts` ERASED_ACTOR). */
export const ERASED_ACTOR_ID = 'erased';

export const EXPORT_SKIPS = ['unsure', 'erased', 'no_vectors', 'malformed', 'no_actor_id', 'source_not_allowed'] as const;
export type ExportSkip = (typeof EXPORT_SKIPS)[number];
export const DATASET_SKIPS = ['catalogue_mismatch', 'not_applicable', 'no_windows'] as const;
export type DatasetSkip = (typeof DATASET_SKIPS)[number];

/* ──────────────────────────────── Where: the install guard ──────────────────────────────── */

export type ExportRole = 'staging' | 'demo';
export type ExportGuardVerdict = { ok: true; role: ExportRole } | { ok: false; reason: string };

/**
 * The label sources an install of each role exports (D55-92): staging every source; the demo its benign traffic only (prospects' and
 * testers' verdicts, decoy touches and bans on the demo have no known truth and would poison a global model).
 */
export const EXPORT_SOURCES: Readonly<Record<ExportRole, readonly LabelSource[]>> = Object.freeze({
  staging: Object.freeze([...LABEL_SOURCES]),
  demo: Object.freeze(['benign_traffic'] as LabelSource[]),
});

/** Whether an install of `role` exports labels of `source` (anything else, an unknown role included: no). */
export const exportsSource = (role: unknown, source: unknown): boolean =>
  (role === 'staging' || role === 'demo') && typeof source === 'string' && (EXPORT_SOURCES[role] as readonly string[]).includes(source);

/** Every database URL the platform may open (as the staging seed's guard, scripts/fw-probe/lib/staging-guard.ts). */
export const EXPORT_DATABASE_URL_KEYS = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'DATABASE_URL_ADMIN', 'DATABASE_READ_REPLICA_URL'] as const;

/** A database of an install of `role`: its name ends in the role and says nothing of another install or of tests. */
export function isExportDatabaseName(role: ExportRole, name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return role === 'staging'
    ? /staging$/.test(n) && !/(prod|demo|test|live)/.test(n)
    : /demo$/.test(n) && !/(prod|staging|test|live)/.test(n);
}

/** The database a connection URL names, null without one. */
export function exportDatabaseNameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

/** The guard over the environment, before any connection (pure). */
export function exportEnvGuard(env: Record<string, string | undefined>): ExportGuardVerdict {
  const raw = env.INSTALL_ROLE;
  if (raw !== 'staging' && raw !== 'demo') {
    return { ok: false, reason: `INSTALL_ROLE is "${raw ?? ''}": the dataset export runs on a staging or demo install only (a customer's install never sends data out, FWO-7)` };
  }
  const role: ExportRole = raw;
  const configured = EXPORT_DATABASE_URL_KEYS.filter((k) => k === 'DATABASE_URL' || !!env[k]?.trim()).map((key) => ({ key, name: exportDatabaseNameOf(env[key]) }));
  const bad = configured.filter((c) => !isExportDatabaseName(role, c.name));
  if (bad.length) {
    return { ok: false, reason: `${bad.map((c) => `${c.key} (${c.name ?? 'no database'})`).join(', ')}: not a ${role} database (its name must end in "${role}")` };
  }
  return { ok: true, role };
}

/** The guard over the live connections' `current_database()` (pure). */
export function exportDatabaseGuard(role: ExportRole, names: ReadonlyArray<string | null | undefined>): ExportGuardVerdict {
  if (names.length === 0) return { ok: false, reason: 'no database connection to check' };
  const bad = names.filter((n) => !isExportDatabaseName(role, n));
  return bad.length ? { ok: false, reason: `the live database "${bad.map((n) => n ?? '?').join('", "')}" is not a ${role} database` } : { ok: true, role };
}

/* ──────────────────────────────── What: rows ──────────────────────────────── */

/** A label as the source reads it (`ai_firewall.dataset-source.ts`); every field is checked, none is trusted. */
export interface ExportLabelRow {
  tenantId: unknown;
  refKind: unknown;
  refId: unknown;
  refAt: unknown;
  actorKind: unknown;
  actorId: unknown;
  lane: unknown;
  labelClass: unknown;
  verdict: unknown;
  source: unknown;
  confidence: unknown;
  runId: unknown;
  vectors: unknown;
}

export interface DatasetRow {
  ref: string;
  refKind: LabelRefKind;
  tenant: string;
  actor: string;
  actorKind: string;
  lane: string;
  hour: string;
  source: LabelSource;
  labelClass: LabelClass;
  verdict: DatasetVerdict | null;
  confidence: number;
  run: string | null;
  coldStart: boolean;
  x: Array<number | null>;
}

/** An id re-keyed under the export key (pure): HMAC-SHA256(key, "<domain>:<value>"), base64url, EXPORT_ID_LENGTH characters. */
export function exportIdOf(key: Buffer, domain: 'ref' | 'tenant' | 'actor' | 'run', value: string): string {
  return createHmac('sha256', key).update(`${domain}:${value}`).digest('base64url').slice(0, EXPORT_ID_LENGTH);
}

/** A time truncated to its UTC hour, `YYYY-MM-DDTHH:00:00Z`; null when it is no time. */
export function hourOf(v: unknown): string | null {
  const d = v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
  if (!d || !Number.isFinite(d.getTime())) return null;
  const h = new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
  return h.toISOString().replace('.000Z', 'Z');
}

const inList = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Whether a catalogue describes an actor of `kind` (one of its own features applies; the shared lane and kind do not count). */
export const catalogueApplies = (c: FeatureCatalogue, kind: string): boolean =>
  c.features.some((f) => f.model !== 'shared' && (f.actorKinds as readonly string[]).includes(kind));

/**
 * What is wrong with a row about to be written, or null (pure): its keys are exactly DATASET_COLUMNS, every id has the re-keyed shape,
 * every other string is from its closed list, the hour is an hour, the vector numbers or null. The export refuses on the first problem.
 */
export function datasetRowProblem(row: unknown, features?: number): string | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'not an object';
  const r = row as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== DATASET_COLUMNS.length || keys.some((k, i) => k !== DATASET_COLUMNS[i])) return `keys ${keys.join(',')} are not the allow-list`;
  for (const k of ['ref', 'tenant', 'actor'] as const) if (typeof r[k] !== 'string' || !EXPORT_ID_RE.test(r[k] as string)) return `${k} is not a re-keyed id`;
  if (r.run !== null && (typeof r.run !== 'string' || !EXPORT_ID_RE.test(r.run))) return 'run is not a re-keyed id';
  if (!inList(LABEL_REF_KINDS, r.refKind)) return 'refKind';
  if (!inList(ACTOR_KIND_CODES, r.actorKind)) return 'actorKind';
  if (!inList(LANE_CODES, r.lane)) return 'lane';
  if (typeof r.hour !== 'string' || !HOUR_RE.test(r.hour)) return 'hour';
  if (!inList(LABEL_SOURCES, r.source)) return 'source';
  if (!inList(LABEL_CLASSES, r.labelClass)) return 'labelClass';
  if (r.verdict !== null && !inList(DATASET_VERDICTS, r.verdict)) return 'verdict';
  if (typeof r.confidence !== 'number' || !(r.confidence >= 0 && r.confidence <= 1)) return 'confidence';
  if (typeof r.coldStart !== 'boolean') return 'coldStart';
  if (!Array.isArray(r.x) || !r.x.every((n) => n === null || (typeof n === 'number' && Number.isFinite(n)))) return 'x';
  if (features !== undefined && r.x.length !== features) return 'x length';
  return null;
}

/* ──────────────────────────────── The dataset ──────────────────────────────── */

export interface DatasetManifestEntry {
  file: string;
  catalogue: string;
  id: FeatureCatalogue['id'];
  version: number;
  hash: string;
  library: FeatureCatalogue['library'];
  /** The names of `x`, in order. */
  features: string[];
  rows: number;
  /** Rows per label class (every class listed, zeros included). */
  classes: Record<LabelClass, number>;
  sources: Record<LabelSource, number>;
  verdicts: Record<DatasetVerdict | 'none', number>;
  /** The first and the last hour of its rows (null when empty). */
  from: string | null;
  to: string | null;
  skipped: Record<DatasetSkip, number>;
}

export interface DatasetManifest {
  format: typeof DATASET_FORMAT;
  createdHour: string;
  installRole: ExportRole;
  /** The label sources this role exports (D55-92) and why; labels of any other source are counted `source_not_allowed`. */
  sourcePolicy: { allowed: LabelSource[]; rule: string };
  ids: { scheme: string; length: number; actor: string; key: string };
  missing: string;
  columns: DatasetColumn[];
  labelsRead: number;
  skipped: Record<ExportSkip, number>;
  /** Tenants whose rows could not be read, or were cut at the per-tenant bound (counts only; no tenant is named). */
  tenantsFailed: number;
  tenantsTruncated: number;
  datasets: DatasetManifestEntry[];
}

export interface BuildOptions {
  /** 32 random bytes, this export's only (never stored). */
  exportKey: Buffer;
  /** The install's keyed feature id of an actor (02 `featureIdOf`); null when it cannot be made. */
  featureId: (kind: string, id: string) => string | null;
  installRole: ExportRole;
  now: Date;
  /** Labels the source counted without vectors (they are not read). */
  withoutVectors?: number;
  /** Labels the source counted of a source this role does not export (they are not read). */
  sourceRefused?: number;
  tenantsFailed?: number;
  tenantsTruncated?: number;
}

export interface BuiltDataset {
  manifest: DatasetManifest;
  rows: Record<string, DatasetRow[]>;
  /** File name -> its text (the manifest pretty-printed, each dataset one JSON object per line). */
  files: Record<string, string>;
}

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** The dataset of `labels` (pure but for the HMAC): see the header. Throws when a row would leave the allow-list (it cannot). */
export function buildDataset(labels: readonly ExportLabelRow[], o: BuildOptions): BuiltDataset {
  if (!Buffer.isBuffer(o.exportKey) || o.exportKey.length < 32) throw new Error('the export key must be 32 random bytes');
  if (o.installRole !== 'staging' && o.installRole !== 'demo') throw new Error('the dataset export runs on a staging or demo install only');
  const skipped = zeros(EXPORT_SKIPS);
  skipped.no_vectors += Math.max(0, Math.floor(o.withoutVectors ?? 0));
  skipped.source_not_allowed += Math.max(0, Math.floor(o.sourceRefused ?? 0));
  const out = DATASET_CATALOGUES.map((c) => ({ c, hash: catalogueHash(c), rows: [] as DatasetRow[], skipped: zeros(DATASET_SKIPS) }));

  for (const l of labels) {
    // D55-92: the role's sources only, whatever the source read (the SQL already filters; this is the guarantee)
    if (!exportsSource(o.installRole, l.source)) { skipped.source_not_allowed += 1; continue; }
    const verdict = l.verdict === null || l.verdict === undefined ? null : l.verdict;
    if (verdict === 'unsure') { skipped.unsure += 1; continue; }
    if (l.actorId === ERASED_ACTOR_ID) { skipped.erased += 1; continue; }
    if (l.vectors === null || l.vectors === undefined) { skipped.no_vectors += 1; continue; }
    const vectors = storedVectorsOf(l.vectors);
    const tenantId = text(l.tenantId);
    const refId = text(l.refId);
    const actorId = text(l.actorId);
    const hour = hourOf(l.refAt);
    const confidence = typeof l.confidence === 'number' || typeof l.confidence === 'string' ? Number(l.confidence) : Number.NaN;
    const runId = l.runId === null || l.runId === undefined ? null : text(l.runId);
    if (
      !vectors || !tenantId || !refId || !actorId || !hour || !(confidence >= 0 && confidence <= 1)
      || !inList(LABEL_REF_KINDS, l.refKind) || !inList(ACTOR_KIND_CODES, l.actorKind) || !inList(LABEL_SOURCES, l.source)
      || !inList(LABEL_CLASSES, l.labelClass) || (verdict !== null && !inList(DATASET_VERDICTS, verdict))
      || (l.runId !== null && l.runId !== undefined && !runId)
    ) { skipped.malformed += 1; continue; }
    const featureId = o.featureId(l.actorKind, actorId);
    if (!featureId) { skipped.no_actor_id += 1; continue; }
    const lane = inList(LANE_CODES, l.lane) ? l.lane : 'unknown';
    const base = {
      ref: exportIdOf(o.exportKey, 'ref', `${tenantId.toLowerCase()}:${l.refKind}:${refId}`),
      refKind: l.refKind,
      tenant: exportIdOf(o.exportKey, 'tenant', tenantId.toLowerCase()),
      actor: exportIdOf(o.exportKey, 'actor', featureId),
      actorKind: l.actorKind,
      lane,
      hour,
      source: l.source,
      labelClass: l.labelClass,
      verdict: verdict as DatasetVerdict | null,
      confidence: Math.round(confidence * 1000) / 1000,
      run: runId ? exportIdOf(o.exportKey, 'run', runId) : null,
    };
    for (const d of out) {
      if (!catalogueApplies(d.c, l.actorKind)) { d.skipped.not_applicable += 1; continue; }
      const v = vectors[d.c.id];
      if (v.catalogue !== d.c.name || v.hash !== d.hash || v.values.length !== d.c.features.length) { d.skipped.catalogue_mismatch += 1; continue; }
      if (!vectors.windowsRead) { d.skipped.no_windows += 1; continue; }
      const row: DatasetRow = { ...base, coldStart: vectors.coldStart, x: [...v.values] };
      const problem = datasetRowProblem(row, d.c.features.length);
      if (problem) throw new Error(`dataset export refused: a ${d.c.name} row failed the allow-list (${problem})`);
      d.rows.push(row);
    }
  }

  const rows: Record<string, DatasetRow[]> = {};
  const files: Record<string, string> = {};
  const datasets: DatasetManifestEntry[] = out.map((d) => {
    d.rows.sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
    const classes = zeros(LABEL_CLASSES);
    const sources = zeros(LABEL_SOURCES);
    const verdicts = zeros([...DATASET_VERDICTS, 'none'] as const);
    for (const r of d.rows) {
      classes[r.labelClass] += 1;
      sources[r.source] += 1;
      verdicts[r.verdict ?? 'none'] += 1;
    }
    const file = datasetFileOf(d.c);
    rows[d.c.name] = d.rows;
    files[file] = d.rows.map((r) => JSON.stringify(r)).join('\n') + (d.rows.length ? '\n' : '');
    return {
      file, catalogue: d.c.name, id: d.c.id, version: d.c.version, hash: d.hash, library: d.c.library, features: featureNames(d.c),
      rows: d.rows.length, classes, sources, verdicts, from: d.rows[0]?.hour ?? null, to: d.rows.at(-1)?.hour ?? null, skipped: d.skipped,
    };
  });
  const manifest: DatasetManifest = {
    format: DATASET_FORMAT,
    createdHour: hourOf(o.now) ?? hourOf(0)!,
    installRole: o.installRole,
    sourcePolicy: {
      allowed: [...EXPORT_SOURCES[o.installRole]],
      rule: o.installRole === 'demo'
        ? 'demo: benign_traffic only (its scripted traffic); verdicts, decoy touches and bans of prospects and testers are not exported'
        : 'staging: every source',
    },
    ids: {
      scheme: 'HMAC-SHA256(exportKey, "<domain>:<value>"), base64url, first 22 characters; domains ref, tenant, actor, run',
      length: EXPORT_ID_LENGTH,
      actor: 'the keyed feature id of 02 (featureIdOf), re-keyed',
      key: '32 random bytes per export, never stored: ids join within this export only',
    },
    missing: 'null in x is a missing feature (NaN): the trainer passes it as missing, never as 0',
    columns: [...DATASET_COLUMNS],
    labelsRead: labels.length + Math.max(0, Math.floor(o.withoutVectors ?? 0)) + Math.max(0, Math.floor(o.sourceRefused ?? 0)),
    skipped,
    tenantsFailed: Math.max(0, Math.floor(o.tenantsFailed ?? 0)),
    tenantsTruncated: Math.max(0, Math.floor(o.tenantsTruncated ?? 0)),
    datasets,
  };
  files[MANIFEST_FILE] = `${JSON.stringify(manifest, null, 2)}\n`;
  return { manifest, rows, files };
}
