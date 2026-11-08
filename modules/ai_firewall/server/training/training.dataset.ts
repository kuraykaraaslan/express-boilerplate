import {
  CATALOGUE_HISTORY, FEATURE_CATALOGUES, catalogueHash, featureNames, type FeatureCatalogue,
} from '../features/ai_firewall.feature-catalogue';
import {
  DATASET_COLUMNS, DATASET_FORMAT, datasetFileOf, datasetRowProblem, type DatasetRow,
} from '../dataset/ai_firewall.dataset-export';
import { LABEL_SOURCES, type LabelSource } from '../labels/ai_firewall.label-model';
import { ATTACK_MODEL_CLASSES, attackClassOf, behaviourTargetOf, type AttackModelClass } from './training.classes';
import { isSyntheticTenant } from './training.synthetic-marks';

/**
 * Reading the 03.5 dataset export for the trainer (docs/phases/55-ai-firewall/04-tree-models.md 4.1). Pure over the files' texts (the
 * CLI reads the directory): the manifest's format and columns, each dataset's catalogue name, version and pinned hash against the
 * catalogue the evaluator reads today (a model trained on another vector must never be fed this one), every row against the export's own
 * allow-list (`datasetRowProblem`), the row count against the manifest (a truncated file is refused). Then the rows a model learns from:
 * one per labelled reference, its target, its weight.
 */

export type ModelName = 'behaviour' | 'attack';

export class DatasetRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'DatasetRefusedError';
  }
}
const refuse = (reason: string): never => {
  throw new DatasetRefusedError(reason);
};

/** The manifest fields the trainer reads (the rest is the export's record). */
export interface DatasetHeader {
  format: string;
  createdHour: string | null;
  installRole: 'staging' | 'demo' | 'synthetic';
  /** True for the synthetic generator's datasets (by the manifest or by the generator's tenant marks): never shipped. */
  synthetic: boolean;
}

export interface LoadedDataset {
  catalogue: FeatureCatalogue;
  hash: string;
  rows: DatasetRow[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The manifest's header, refused when it is not the export's format. */
export function readManifest(text: string): { header: DatasetHeader; raw: Record<string, unknown> } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse('manifest.json is not JSON');
  }
  if (!isRecord(raw)) return refuse('manifest.json is not an object');
  if (raw.format !== DATASET_FORMAT) return refuse(`manifest format "${String(raw.format)}" is not ${DATASET_FORMAT}`);
  const columns = raw.columns;
  if (!Array.isArray(columns) || columns.length !== DATASET_COLUMNS.length || columns.some((c, i) => c !== DATASET_COLUMNS[i])) {
    return refuse('manifest columns are not the export\'s columns');
  }
  const role = raw.installRole;
  if (role !== 'staging' && role !== 'demo' && role !== 'synthetic') return refuse(`manifest installRole "${String(role)}" is not staging, demo or synthetic`);
  if (raw.synthetic !== undefined && typeof raw.synthetic !== 'boolean') return refuse('manifest synthetic must be a boolean');
  if (role === 'synthetic' && raw.synthetic !== true) return refuse('a synthetic install role must say synthetic: true');
  if (raw.synthetic === true && role !== 'synthetic') return refuse('a synthetic dataset must name the install role synthetic');
  if (!Array.isArray(raw.datasets)) return refuse('manifest datasets is not a list');
  return {
    header: { format: DATASET_FORMAT, createdHour: typeof raw.createdHour === 'string' ? raw.createdHour : null, installRole: role, synthetic: raw.synthetic === true },
    raw,
  };
}

/** The pinned hash of a catalogue's version, or null when that version was never released. */
export function pinnedHashOf(catalogue: Pick<FeatureCatalogue, 'id' | 'version'>): string | null {
  return CATALOGUE_HISTORY[catalogue.id]?.find((h) => h.version === catalogue.version)?.hash ?? null;
}

/**
 * One model's dataset: its manifest entry must name today's catalogue (name, version, the pinned hash, the features in order), and
 * every line must pass the export's allow-list. Throws DatasetRefusedError on the first problem.
 */
export function readDataset(manifest: Record<string, unknown>, model: ModelName, fileText: string | undefined): LoadedDataset {
  const catalogue = FEATURE_CATALOGUES[model];
  const hash = catalogueHash(catalogue);
  const pinned = pinnedHashOf(catalogue);
  if (pinned !== hash) return refuse(`${catalogue.name}: the catalogue's hash is not the pinned one (a catalogue change needs a version bump)`);
  const entries = (manifest.datasets as unknown[]).filter((d) => isRecord(d) && d.catalogue === catalogue.name) as Record<string, unknown>[];
  if (entries.length !== 1) return refuse(`the manifest has ${entries.length} entries for ${catalogue.name}, expected one`);
  const entry = entries[0];
  if (entry.id !== catalogue.id || entry.version !== catalogue.version) return refuse(`${catalogue.name}: the manifest names id ${String(entry.id)} version ${String(entry.version)}`);
  if (entry.hash !== pinned) return refuse(`${catalogue.name}: the dataset's hash ${String(entry.hash).slice(0, 12)} is not the pinned ${pinned.slice(0, 12)}`);
  if (entry.library !== catalogue.library) return refuse(`${catalogue.name}: the dataset names library ${String(entry.library)}`);
  const names = featureNames(catalogue);
  const listed = entry.features;
  if (!Array.isArray(listed) || listed.length !== names.length || listed.some((n, i) => n !== names[i])) {
    return refuse(`${catalogue.name}: the dataset's features are not the catalogue's, in order`);
  }
  if (entry.file !== datasetFileOf(catalogue)) return refuse(`${catalogue.name}: the dataset file is "${String(entry.file)}", expected ${datasetFileOf(catalogue)}`);
  if (fileText === undefined) return refuse(`${datasetFileOf(catalogue)} is missing`);

  const rows: DatasetRow[] = [];
  const lines = fileText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      return refuse(`${datasetFileOf(catalogue)} line ${i + 1} is not JSON`);
    }
    const problem = datasetRowProblem(row, names.length);
    if (problem) return refuse(`${datasetFileOf(catalogue)} line ${i + 1}: ${problem}`);
    rows.push(row as DatasetRow);
  }
  if (rows.length !== entry.rows) return refuse(`${datasetFileOf(catalogue)} has ${rows.length} rows, the manifest says ${String(entry.rows)} (truncated?)`);
  return { catalogue, hash, rows };
}

/** Whether a dataset is synthetic: the manifest says so, or a row carries one of the generator's tenant marks. */
export const datasetIsSynthetic = (header: DatasetHeader, datasets: readonly LoadedDataset[]): boolean =>
  header.synthetic || datasets.some((d) => d.rows.some((r) => isSyntheticTenant(r.tenant)));

/* ──────────────────────────────── The rows a model learns from ──────────────────────────────── */

export interface PreparedRow {
  ref: string;
  actor: string;
  hour: string;
  /** The UTC day of `hour` (the actor-day of 4.7). */
  day: string;
  source: LabelSource;
  labelClass: DatasetRow['labelClass'];
  confidence: number;
  /** Behaviour: 0 / 1. Attack: the class's index in ATTACK_MODEL_CLASSES (the trainer re-indexes over the classes it trains). */
  target: number;
  /** The attack class (attack rows only). */
  attackClass?: AttackModelClass;
  /** The features in catalogue order, NaN for missing. */
  x: Float64Array;
}

export const PREPARE_SKIPS = ['cold_start', 'no_attack_class', 'zero_confidence', 'duplicate', 'conflict'] as const;
export type PrepareSkip = (typeof PREPARE_SKIPS)[number];

/** When one reference has rows from several sources of the same confidence, the first source here wins. */
const SOURCE_PRIORITY: readonly LabelSource[] = ['honeytoken', 'synthetic', 'ban_confirmed', 'admin', 'benign_traffic'];

/**
 * The rows of one model (pure, D55-101):
 * - behaviour: cold-start rows are left out (the cascade never scores a cold-start actor with stage 1, 04.8); target 0 for benign, 1
 *   for anything else;
 * - attack: a label class with no attack class is left out (`ATTACK_CLASS_OF_LABEL`);
 * - a label of confidence 0 teaches nothing and is left out;
 * - one row per reference: a reference labelled by several sources keeps its most confident label (ties by SOURCE_PRIORITY); when two
 *   equally confident labels disagree on the target, the reference is left out (`conflict`).
 */
export function prepareRows(model: ModelName, rows: readonly DatasetRow[]): { rows: PreparedRow[]; skipped: Record<PrepareSkip, number> } {
  const skipped = Object.fromEntries(PREPARE_SKIPS.map((k) => [k, 0])) as Record<PrepareSkip, number>;
  const byRef = new Map<string, PreparedRow[]>();
  for (const r of rows) {
    if (model === 'behaviour' && r.coldStart) { skipped.cold_start += 1; continue; }
    if (!(r.confidence > 0)) { skipped.zero_confidence += 1; continue; }
    let target: number;
    let attackClass: AttackModelClass | undefined;
    if (model === 'behaviour') {
      target = behaviourTargetOf(r.labelClass);
    } else {
      const c = attackClassOf(r.labelClass);
      if (!c) { skipped.no_attack_class += 1; continue; }
      attackClass = c;
      target = ATTACK_MODEL_CLASSES.indexOf(c);
    }
    const prepared: PreparedRow = {
      ref: r.ref, actor: r.actor, hour: r.hour, day: r.hour.slice(0, 10), source: r.source, labelClass: r.labelClass,
      confidence: r.confidence, target, ...(attackClass ? { attackClass } : {}),
      x: Float64Array.from(r.x, (v) => (v === null ? Number.NaN : v)),
    };
    const list = byRef.get(r.ref);
    if (list) list.push(prepared);
    else byRef.set(r.ref, [prepared]);
  }
  const out: PreparedRow[] = [];
  const rank = (s: LabelSource) => {
    const i = SOURCE_PRIORITY.indexOf(s);
    return i < 0 ? SOURCE_PRIORITY.length + LABEL_SOURCES.indexOf(s) : i;
  };
  for (const list of byRef.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    list.sort((a, b) => b.confidence - a.confidence || rank(a.source) - rank(b.source));
    const top = list.filter((p) => p.confidence === list[0].confidence);
    if (top.some((p) => p.target !== top[0].target)) { skipped.conflict += list.length; continue; }
    out.push(list[0]);
    skipped.duplicate += list.length - 1;
  }
  out.sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return { rows: out, skipped };
}
