import { createHash } from 'node:crypto';
import {
  ACTOR_KIND_CODES, ATTACK_V1, BEHAVIOUR_V1, LANE_CODES, catalogueHash, type FeatureCatalogue, type FeatureDef,
} from '../features/ai_firewall.feature-catalogue';
import { MANIFEST_FILE, buildDataset, type DatasetManifest, type ExportLabelRow } from '../dataset/ai_firewall.dataset-export';
import type { CapturedVectors } from '../dataset/ai_firewall.vector-capture';
import type { LabelClass, LabelSource } from '../labels/ai_firewall.label-model';
import { rng } from './training.random';
import { SYNTHETIC_EXPORT_KEY, SYNTHETIC_TENANT_COUNT, syntheticTenantRawId } from './training.synthetic-marks';

/**
 * A SYNTHETIC dataset in the 03.5 export's format (docs/phases/55-ai-firewall/04-tree-models.md 4.1, D55-104), for CI and for a smoke
 * run of the trainer. NEVER shipped: the manifest says `synthetic: true` (install role `synthetic`), its tenant ids are the generator's
 * public marks (`training.synthetic-marks.ts`), a model trained on it carries `synthetic: true` in its meta, and the embed step, the
 * loader and the promotion gate refuse such a model.
 *
 * The rows go through the export's own `buildDataset` (the same allow-list, re-keying, ordering and manifest), so a trainer that reads
 * this reads a real export. The values are drawn per class: each attack class shifts a few features of each catalogue by a few standard
 * deviations; a per-reference difficulty, partly shared by the two catalogues (`sharedDifficulty`), weakens both signals together, which
 * gives the two models partly correlated errors as real data would. Missing values (null) at a small rate, cold-start rows, duplicate
 * labels of one reference from two sources and `unsure` verdicts (skipped by the export) are included.
 */

export type SyntheticOptions = {
  /** Labelled references (default 3 000). */
  readonly refs?: number;
  readonly seed?: number;
  /** The span of the rows' hours (default 14 days). */
  readonly days?: number;
  /** The first hour (default 2026-10-01T00:00Z). */
  readonly start?: Date;
  /** 0..1: how much of a reference's difficulty the two catalogues share (default 0.3). */
  readonly sharedDifficulty?: number;
  readonly now?: Date;
};

export type SyntheticManifest = Omit<DatasetManifest, 'installRole'> & {
  installRole: 'synthetic';
  synthetic: true;
  generator: { name: string; seed: number; refs: number; days: number; sharedDifficulty: number; note: string };
};

/** How often each label class is drawn (benign the large majority, as in real traffic). */
const CLASS_MIX: ReadonlyArray<[LabelClass, number]> = [
  ['benign', 0.8],
  ['credential_stuffing', 0.03], ['password_spray', 0.02], ['enumeration', 0.03], ['session_hijack', 0.02], ['data_exfiltration', 0.02],
  ['public_bot', 0.03], ['signup_abuse', 0.01], ['admin_misuse', 0.01], ['api_key_abuse', 0.01], ['device_lane', 0.005],
  ['honeytoken_touch', 0.01], ['other', 0.005],
];

type Kind = (typeof ACTOR_KIND_CODES)[number];
const KINDS_OF: Readonly<Record<LabelClass, ReadonlyArray<[Kind, number]>>> = {
  benign: [['user', 0.4], ['session', 0.15], ['apiKey', 0.1], ['ip', 0.25], ['anon', 0.05], ['device', 0.05]],
  credential_stuffing: [['ip', 0.6], ['user', 0.4]],
  password_spray: [['ip', 0.6], ['user', 0.4]],
  enumeration: [['user', 0.5], ['ip', 0.3], ['apiKey', 0.2]],
  session_hijack: [['session', 0.7], ['user', 0.3]],
  data_exfiltration: [['user', 0.6], ['apiKey', 0.4]],
  public_bot: [['ip', 0.7], ['anon', 0.3]],
  signup_abuse: [['ip', 0.6], ['user', 0.4]],
  admin_misuse: [['user', 1]],
  api_key_abuse: [['apiKey', 1]],
  device_lane: [['device', 0.7], ['node', 0.3]],
  honeytoken_touch: [['user', 0.5], ['ip', 0.5]],
  other: [['user', 0.5], ['ip', 0.5]],
};

const LANE_OF: Readonly<Record<string, (typeof LANE_CODES)[number]>> = {
  user: 'human-web', session: 'human-web', apiKey: 'machine-apikey', ip: 'public-anon', anon: 'public-anon', device: 'device-iot', node: 'machine-agent',
};

function pickWeighted<T>(rand: () => number, items: ReadonlyArray<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let u = rand() * total;
  for (const [v, w] of items) {
    u -= w;
    if (u <= 0) return v;
  }
  return items[items.length - 1][0];
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const seedOf = (text: string) => createHash('sha256').update(text).digest().readUInt32LE(0);

/** Each attack class's shifts over a catalogue's own features: five features, 2 to 4 standard deviations (deterministic). */
function shiftsOf(catalogue: FeatureCatalogue, labelClass: LabelClass, seed: number): Float64Array {
  const shifts = new Float64Array(catalogue.features.length);
  if (labelClass === 'benign') return shifts;
  const rand = rng(seedOf(`${seed}:${catalogue.name}:${labelClass}`));
  const own = catalogue.features.map((f, i) => ({ f, i })).filter(({ f }) => f.model !== 'shared');
  for (let k = 0; k < 5; k++) shifts[own[Math.floor(rand() * own.length)].i] += 2 + 2 * rand();
  return shifts;
}

function valueOf(f: FeatureDef, signal: number): number {
  switch (f.type) {
    case 'flag': return signal > 1 ? 1 : 0;
    case 'count':
    case 'distinct': return Math.max(0, Math.round(2 + 1.5 * signal));
    case 'ratio':
    case 'share': return round3(Math.min(1, Math.max(0, 0.1 + 0.15 * signal)));
    case 'deviation': return round3(0.5 * signal);
    case 'number': return round3(Math.max(0, 30 + 10 * signal));
    default: return round3(signal);
  }
}

function vectorOf(c: FeatureCatalogue, kind: Kind, labelClass: LabelClass, strength: number, rand: () => number, shifts: Float64Array): Array<number | null> {
  return c.features.map((f, i) => {
    if (f.name === 'lane') return LANE_CODES.indexOf(LANE_OF[kind]);
    if (f.name === 'actor_kind') return ACTOR_KIND_CODES.indexOf(kind);
    if (!(f.actorKinds as readonly string[]).includes(kind)) return null;
    if (rand() < 0.04) return null;
    return valueOf(f, shifts[i] * strength + gaussian(rand));
  });
}

/** The synthetic dataset: the same files an export writes (`manifest.json`, `behaviour.v1.jsonl`, `attack.v1.jsonl`). */
export function syntheticDataset(o: SyntheticOptions = {}): { manifest: SyntheticManifest; files: Record<string, string> } {
  const refs = Math.max(1, Math.floor(o.refs ?? 3000));
  const seed = o.seed ?? 7;
  const days = Math.max(1, Math.floor(o.days ?? 14));
  const start = (o.start ?? new Date('2026-10-01T00:00:00Z')).getTime();
  const shared = Math.min(1, Math.max(0, o.sharedDifficulty ?? 0.3));
  const now = o.now ?? new Date(start + days * 86_400_000);
  const rand = rng(seed);
  const shifts = new Map<string, Float64Array>();
  const shiftOf = (c: FeatureCatalogue, l: LabelClass) => {
    const key = `${c.name}:${l}`;
    let s = shifts.get(key);
    if (!s) { s = shiftsOf(c, l, seed); shifts.set(key, s); }
    return s;
  };
  const actorsPerKind = Math.max(3, Math.floor(refs / 20));
  const bHash = catalogueHash(BEHAVIOUR_V1);
  const aHash = catalogueHash(ATTACK_V1);

  const labels: ExportLabelRow[] = [];
  for (let i = 0; i < refs; i++) {
    const labelClass = pickWeighted(rand, CLASS_MIX);
    const kind = pickWeighted(rand, KINDS_OF[labelClass]);
    const tenantId = syntheticTenantRawId(Math.floor(rand() * SYNTHETIC_TENANT_COUNT));
    const actorId = `synthetic-${kind}-${Math.floor(rand() * actorsPerKind)}`;
    const refAt = new Date(start + Math.floor(rand() * days * 24) * 3_600_000 + Math.floor(rand() * 3_600_000));
    // Difficulty: part shared by both catalogues, part each its own; a hard reference shows little of its class.
    const h = rand();
    const strengthB = 1 - (shared * h + (1 - shared) * rand());
    const strengthA = 1 - (shared * h + (1 - shared) * rand());
    const vectors: CapturedVectors = {
      v: 1,
      at: refAt.toISOString(),
      coldStart: rand() < 0.1,
      windowsRead: true,
      behaviour: { catalogue: BEHAVIOUR_V1.name, hash: bHash, values: vectorOf(BEHAVIOUR_V1, kind, labelClass, strengthB, rand, shiftOf(BEHAVIOUR_V1, labelClass)) },
      attack: { catalogue: ATTACK_V1.name, hash: aHash, values: vectorOf(ATTACK_V1, kind, labelClass, strengthA, rand, shiftOf(ATTACK_V1, labelClass)) },
    };
    const benign = labelClass === 'benign';
    const u = rand();
    let source: LabelSource;
    let verdict: string | null = null;
    let confidence: number;
    if (labelClass === 'honeytoken_touch') { source = 'honeytoken'; confidence = 1; }
    else if (benign) {
      if (u < 0.6) { source = 'benign_traffic'; confidence = 0.9; } else { source = 'admin'; verdict = 'false_positive'; confidence = 0.9; }
    } else if (u < 0.7) { source = 'synthetic'; confidence = 1; }
    else if (u < 0.9) { source = 'admin'; verdict = 'true_positive'; confidence = 0.9; }
    else { source = 'ban_confirmed'; confidence = 0.9; }
    const runId = source === 'synthetic' ? `probe-run-${i % 7}` : source === 'benign_traffic' ? `benign-run-${i % 5}` : null;
    const base = { tenantId, refKind: 'event', refId: `synthetic-ref-${i}`, refAt, actorKind: kind, actorId, lane: LANE_OF[kind], vectors };
    labels.push({ ...base, labelClass, verdict, source, confidence, runId });
    // A few references carry a second label from another source (the trainer keeps one), and a few an unsure verdict (the export skips it).
    const extra = rand();
    if (extra < 0.03 && source !== 'honeytoken') {
      const second: LabelSource = source === 'admin' ? (benign ? 'benign_traffic' : 'synthetic') : 'admin';
      labels.push({
        ...base, labelClass, source: second,
        verdict: second === 'admin' ? (benign ? 'false_positive' : 'true_positive') : null,
        confidence: second === 'synthetic' ? 1 : 0.9,
        runId: second === 'synthetic' ? `probe-run-${i % 7}` : second === 'benign_traffic' ? `benign-run-${i % 5}` : null,
      });
    } else if (extra < 0.05 && source !== 'admin') {
      labels.push({ ...base, labelClass, verdict: 'unsure', source: 'admin', confidence: 0.5, runId: null });
    }
  }

  const built = buildDataset(labels, {
    exportKey: SYNTHETIC_EXPORT_KEY,
    featureId: (kind, id) => `synthetic:${kind}:${id}`,
    installRole: 'staging',
    now,
  });
  const manifest: SyntheticManifest = {
    ...built.manifest,
    installRole: 'synthetic',
    synthetic: true,
    sourcePolicy: { allowed: built.manifest.sourcePolicy.allowed, rule: 'synthetic: every source, generated' },
    ids: { ...built.manifest.ids, key: 'a PUBLIC key (training.synthetic-marks.ts): the synthetic tenants are recognisable by their ids' },
    generator: {
      name: 'ai_firewall synthetic dataset',
      seed,
      refs,
      days,
      sharedDifficulty: shared,
      note: 'SYNTHETIC, generated for CI and smoke runs; a model trained on it is never shipped or promoted',
    },
  };
  return { manifest, files: { ...built.files, [MANIFEST_FILE]: `${JSON.stringify(manifest, null, 2)}\n` } };
}
