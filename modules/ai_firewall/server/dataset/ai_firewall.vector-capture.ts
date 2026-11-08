import type { ActorFeatureRequest, ActorFeatures } from '../features/ai_firewall.feature-store';
import type { FeatureVector } from '../features/ai_firewall.feature-vector';
import { ACTOR_KIND_CODES, LANE_CODES } from '../features/ai_firewall.feature-catalogue';
import type { ActorKind, SignalLane } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

/**
 * The labelled vectors (docs/phases/55-ai-firewall/03 §3.5, D55-88): the feature store of 02 keeps an actor's windows in Redis for a day
 * at most, so the vector a label is about has to be kept when it exists, or the dataset export finds nothing to join its labels to.
 *
 *   - an incident keeps the vectors of its PEAK scoring (`ai_firewall_incidents."peakVectors"`, written by the incident grouping with the
 *     scoring that set the peak, from the very vectors the rule scorer read: `actorFeatures`, 02 §2.1); a person's verdict on it, given
 *     later, copies them into its label (the label store's INSERT, in SQL);
 *   - an event label made without a person (a decoy touch, an operator's ban decision, a probe or benign-traffic run) gets the actor's
 *     vectors read when the label is produced, seconds after the event (`captureEventVectors`, the label producer);
 *   - both are kept ONLY on an install whose role allows the export (`INSTALL_ROLE` staging or demo, 03 §3.3): a production install
 *     stores no vector at all (least data; nothing on a customer install is ever exported, FWO-7 open).
 *
 * What is kept is the catalogue's name, its content hash and one number per feature in the catalogue's order, a missing value as null
 * (JSON has no NaN): numbers only, no actor, no name, no address. Pure but for `captureEventVectors`, which reads through the injected
 * (or lazily imported) feature store and fails open.
 */
export const VECTORS_FORMAT = 1 as const;

export interface CapturedVector {
  /** `behaviour.v1` / `attack.v1`. */
  catalogue: string;
  /** The catalogue's content hash the vector was built with (CATALOGUE_HISTORY). */
  hash: string;
  /** One per feature, the catalogue's order; null = missing (NaN). */
  values: Array<number | null>;
}

export interface CapturedVectors {
  v: typeof VECTORS_FORMAT;
  /** When the vectors were read, ISO 8601 UTC. */
  at: string;
  /** No own baseline yet (04.8 cold start). */
  coldStart: boolean;
  /** False when the windows could not be read: the window features are missing. */
  windowsRead: boolean;
  behaviour: CapturedVector;
  attack: CapturedVector;
}

/** The install roles that keep labelled vectors and may export them (03 §3.3: one explicit setting, never inferred). */
export const VECTOR_CAPTURE_ROLES = ['staging', 'demo'] as const;

/** Whether an install of `role` keeps labelled vectors. Anything else (production, unset, misspelt) keeps none. */
export const vectorCaptureOn = (role: unknown): boolean => role === 'staging' || role === 'demo';

/**
 * Whether an install of `role` keeps the vectors of an incident's peak scoring (D55-92): staging only. On the demo the only labels the
 * export takes are its benign traffic's (EXPORT_SOURCES), so an incident's vectors (which a person's verdict would copy) are never kept
 * there: least data, and a demo tenant's verdict carries no vector at all.
 */
export const incidentVectorCaptureOn = (role: unknown): boolean => role === 'staging';

/** One vector as it is kept (pure): a value that is not a finite number is null. */
export function capturedVectorOf(v: Pick<FeatureVector, 'catalogue' | 'hash' | 'values'>): CapturedVector {
  return { catalogue: v.catalogue, hash: v.hash, values: v.values.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)) };
}

/** Both vectors of one scoring or read as they are kept (pure). */
export function capturedVectorsOf(f: Pick<ActorFeatures, 'behaviour' | 'attack' | 'coldStart' | 'windowsRead'>, atIso: string): CapturedVectors {
  return {
    v: VECTORS_FORMAT,
    at: atIso,
    coldStart: f.coldStart === true,
    windowsRead: f.windowsRead === true,
    behaviour: capturedVectorOf(f.behaviour),
    attack: capturedVectorOf(f.attack),
  };
}

/** One event label's reference and its actor, whose vectors the producer keeps. */
export interface VectorRef {
  refId: string;
  actorKind: string;
  actorId: string;
  lane: string;
}

/** Actors read per call at most (the producer writes at most 500 labels per call), and at once. */
export const CAPTURE_MAX = 500;
export const CAPTURE_CONCURRENCY = 10;

export interface CaptureDeps {
  /** Reads an actor's vectors (default `actorFeatures`: one bounded Redis pipeline and the cached baseline). */
  features?: (req: ActorFeatureRequest) => Promise<ActorFeatures>;
  now?: () => number;
}

const isActorKind = (k: string): k is ActorKind => (ACTOR_KIND_CODES as readonly string[]).includes(k);
const laneOf = (lane: string): SignalLane => ((LANE_CODES as readonly string[]).includes(lane) ? lane : 'unknown') as SignalLane;

/**
 * The vectors of each reference's actor, read now (one read per distinct actor and lane, CAPTURE_CONCURRENCY at a time, CAPTURE_MAX
 * actors at most). A reference whose actor kind is unknown, whose read fails or whose windows cannot be read gets none (fail open,
 * FWA-7: the label is still written, without vectors, and the export counts it as `no_vectors`). Never throws.
 */
export async function captureEventVectors(tenantId: string, refs: readonly VectorRef[], deps: CaptureDeps = {}): Promise<Map<string, CapturedVectors>> {
  const out = new Map<string, CapturedVectors>();
  const byActor = new Map<string, { kind: ActorKind; id: string; lane: SignalLane; refIds: string[] }>();
  for (const r of refs) {
    if (!r.refId || !r.actorId || !isActorKind(r.actorKind)) continue;
    const lane = laneOf(r.lane);
    const key = `${r.actorKind}\u0000${r.actorId}\u0000${lane}`;
    const hit = byActor.get(key);
    if (hit) { hit.refIds.push(r.refId); continue; }
    if (byActor.size >= CAPTURE_MAX) continue;
    byActor.set(key, { kind: r.actorKind, id: r.actorId, lane, refIds: [r.refId] });
  }
  if (byActor.size === 0) return out;
  const read = deps.features ?? (async (req: ActorFeatureRequest) => (await import('../features/ai_firewall.feature-store')).actorFeatures(req));
  const now = deps.now ?? Date.now;
  const actors = [...byActor.values()];
  for (let i = 0; i < actors.length; i += CAPTURE_CONCURRENCY) {
    await Promise.all(actors.slice(i, i + CAPTURE_CONCURRENCY).map(async (a) => {
      try {
        const nowMs = now();
        const f = await read({ tenantId, actor: { kind: a.kind, id: a.id }, lane: a.lane, nowMs });
        if (!f.windowsRead) return;
        const v = capturedVectorsOf(f, new Date(nowMs).toISOString());
        for (const refId of a.refIds) out.set(refId, v);
      } catch {
        // fail open: this reference keeps no vectors
      }
    }));
  }
  return out;
}

/** A stored jsonb value as captured vectors, or null when it is not one (the driver may hand a string). Pure. */
export function storedVectorsOf(raw: unknown): CapturedVectors | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const vectorOf = (x: unknown): CapturedVector | null => {
    if (!x || typeof x !== 'object') return null;
    const c = x as Record<string, unknown>;
    if (typeof c.catalogue !== 'string' || typeof c.hash !== 'string' || !Array.isArray(c.values)) return null;
    if (!c.values.every((n) => n === null || (typeof n === 'number' && Number.isFinite(n)))) return null;
    return { catalogue: c.catalogue, hash: c.hash, values: c.values as Array<number | null> };
  };
  const behaviour = vectorOf(o.behaviour);
  const attack = vectorOf(o.attack);
  if (o.v !== VECTORS_FORMAT || !behaviour || !attack || typeof o.at !== 'string') return null;
  return { v: VECTORS_FORMAT, at: o.at, coldStart: o.coldStart === true, windowsRead: o.windowsRead === true, behaviour, attack };
}
