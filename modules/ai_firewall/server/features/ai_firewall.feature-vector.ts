import type { ActorKind, SignalLane } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import {
  ATTACK_V1, BEHAVIOUR_V1, catalogueHash, type BaselineRef, type FeatureDef, type FeatureSource,
} from './ai_firewall.feature-catalogue';
import type { ActorWindows } from './ai_firewall.feature-read';
import { windowSeconds } from './ai_firewall.feature-windows';
import { BASELINE_MIN_DAYS, MAP_MIN_WEIGHT, type Baseline, type BaselineData } from './ai_firewall.baseline';

/**
 * Assembles an actor's feature vector for a catalogue (docs/phases/55-ai-firewall/02 §2.1): the rule scorer (2.2), the dataset export
 * (03) and the request cascade (04.8) all call this, so the vector a model was trained on is the vector it is scored on.
 *
 * Pure: the actor's windows (`readActorWindows`), its own baseline, its role prior and the request's context in; one number per
 * feature, in the catalogue's order, out. A value that cannot be known is NaN (missing), never a guessed 0: the tree evaluator sends a
 * missing value down each split's default branch, as both libraries do.
 *
 *   - a feature that does not apply to the actor kind is missing;
 *   - without windows (Redis down or slow) every window feature is missing;
 *   - a deviation from the baseline uses the actor's own baseline once it has BASELINE_MIN_DAYS days, else the role prior, else missing
 *     (cold start: the cascade sends such an actor to stage 2, 04.8); `unusual_hour` and the `new_*` features read the actor's OWN
 *     baseline only (a prior's hours are a hint, a role has no countries).
 */
export interface FeatureInput {
  actorKind: ActorKind;
  lane: SignalLane;
  windows: ActorWindows | null;
  baseline: Baseline | null;
  prior: Baseline | null;
  nowMs: number;
  accountAgeDays?: number | null;
  mfaEnrolled?: boolean | null;
  /** The registered kinds' `defaultWeight` (`ai_firewall:signal`), for the `signalWeight` features of rules.v1; absent = missing. */
  kindWeights?: ReadonlyMap<string, number> | null;
}

/** What a vector is built from: a catalogue's name, id and features (the two model catalogues and rules.v1). */
export interface VectorCatalogue {
  id: string;
  name: string;
  features: readonly FeatureDef[];
}

export interface FeatureVector {
  /** `behaviour.v1` / `attack.v1`. */
  catalogue: string;
  hash: string;
  names: string[];
  values: number[];
}

const sum = (counters: Record<string, number>, fields: readonly string[]): number => fields.reduce((s, f) => s + (counters[f] ?? 0), 0);

function usualOf(ref: BaselineRef, data: BaselineData): number {
  switch (ref.kind) {
    case 'volume': return data.volume[ref.routeClass] ?? 0;
    case 'volumeTotal': return Object.values(data.volume).reduce<number>((s, v) => s + (v ?? 0), 0);
    case 'exportBytes': return data.exportBytes;
    case 'subjects': return data.subjects;
    case 'adminActions': return data.adminActions;
    case 'addresses': return data.addresses;
  }
}

const ownBaseline = (input: FeatureInput): Baseline | null => (input.baseline && input.baseline.days >= BASELINE_MIN_DAYS ? input.baseline : null);
const comparedTo = (input: FeatureInput): Baseline | null => ownBaseline(input) ?? (input.prior && input.prior.days > 0 ? input.prior : null);

const PREFIX = { countries: 'c:', asns: 'a:', devices: 'd:' } as const;

/** One feature's value. */
export function featureValue(source: FeatureSource, input: FeatureInput): number {
  switch (source.op) {
    case 'context': {
      if (source.key === 'lane' || source.key === 'actorKind') {
        const v = source.key === 'lane' ? input.lane : input.actorKind;
        const i = source.codes.indexOf(v);
        return i === -1 ? NaN : i;
      }
      if (source.key === 'accountAgeDays') return typeof input.accountAgeDays === 'number' && Number.isFinite(input.accountAgeDays) ? input.accountAgeDays : NaN;
      if (source.key === 'mfaEnrolled') return typeof input.mfaEnrolled === 'boolean' ? (input.mfaEnrolled ? 1 : 0) : NaN;
      return input.baseline ? input.baseline.days : 0;
    }
    case 'count': {
      const w = input.windows?.windows[source.window];
      return w ? sum(w.counters, source.fields) : NaN;
    }
    case 'ratio': {
      const w = input.windows?.windows[source.window];
      if (!w) return NaN;
      const den = sum(w.counters, source.den);
      return den > 0 ? (sum(w.counters, source.num) / den) * (source.scale ?? 1) : NaN;
    }
    case 'distinct': {
      const w = input.windows?.windows[source.window];
      return w ? w.distinct[source.dim] ?? 0 : NaN;
    }
    case 'nonzero': {
      const w = input.windows?.windows[source.window];
      if (!w) return NaN;
      let n = 0;
      for (const [k, v] of Object.entries(w.counters)) if (k.startsWith(source.prefix) && v > 0) n += 1;
      return n;
    }
    case 'vsBaseline': {
      const w = input.windows?.windows[source.window];
      const base = comparedTo(input);
      if (!w || !base) return NaN;
      const current = source.dim ? w.distinct[source.dim] ?? 0 : sum(w.counters, source.fields ?? []);
      const usual = usualOf(source.baseline, base.data) * (source.dim ? 1 : windowSeconds(source.window) / 86_400);
      return Math.log2((current + 1) / (usual + 1));
    }
    case 'unusualHour': {
      const base = ownBaseline(input);
      if (!base) return NaN;
      const share = base.data.hours[new Date(input.nowMs).getUTCHours()] ?? 0;
      return 1 - Math.min(1, share * 24);
    }
    case 'newValues': {
      const base = ownBaseline(input);
      if (!base || !input.windows) return NaN;
      const known = base.data[source.of];
      const prefix = PREFIX[source.of];
      let n = 0;
      for (const [k, v] of Object.entries(input.windows.today)) {
        if (k.startsWith(prefix) && v > 0 && (known[k.slice(prefix.length)] ?? 0) < MAP_MIN_WEIGHT) n += 1;
      }
      return n;
    }
    case 'signalWeight': {
      const w = input.windows?.windows[source.window];
      const weights = input.kindWeights;
      if (!w || !weights) return NaN;
      let mass = 0;
      for (const [k, v] of Object.entries(w.counters)) {
        if (!k.startsWith('k:') || !(v > 0)) continue;
        const weight = weights.get(k.slice(2));
        if (weight !== undefined && Number.isFinite(weight) && weight > 0) mass += weight * v;
      }
      return mass;
    }
  }
}

const applies = (f: FeatureDef, kind: ActorKind): boolean => f.actorKinds.includes(kind);

const hashes = new Map<VectorCatalogue, string>();
const hashOf = (c: VectorCatalogue): string => {
  let h = hashes.get(c);
  if (!h) { h = catalogueHash(c); hashes.set(c, h); }
  return h;
};

/** The actor's vector for one catalogue. Never throws: a feature that fails is missing. */
export function featureVector(catalogue: VectorCatalogue, input: FeatureInput): FeatureVector {
  const values = catalogue.features.map((f) => {
    if (!applies(f, input.actorKind)) return NaN;
    try {
      const v = featureValue(f.source, input);
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;
    }
  });
  return { catalogue: catalogue.name, hash: hashOf(catalogue), names: catalogue.features.map((f) => f.name), values };
}

/** Both vectors of an actor: what the cascade's two stages read. */
export function actorFeatureVectors(input: FeatureInput): { behaviour: FeatureVector; attack: FeatureVector } {
  return { behaviour: featureVector(BEHAVIOUR_V1, input), attack: featureVector(ATTACK_V1, input) };
}

/** Whether an actor is in cold start for the behaviour model: no baseline of its own yet (04.8: such a request skips stage 1). */
export const isColdStart = (input: Pick<FeatureInput, 'baseline'>): boolean => !input.baseline || input.baseline.days < BASELINE_MIN_DAYS;
