import type { ActorRef, SignalLane } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { featureIdKey, featureIdOf } from './ai_firewall.feature-id';
import { scopeOf, scopeTenant } from './ai_firewall.feature-windows';
import { readActorWindows, type ReadRedis } from './ai_firewall.feature-read';
import { actorFeatureVectors, featureVector, isColdStart, type FeatureInput, type FeatureVector } from './ai_firewall.feature-vector';
import { RULES_V1 } from './ai_firewall.rule-catalogue';
import { baselineAndPrior, BASELINE_ACTOR_KINDS, type BaselineLookupDeps } from './ai_firewall.baseline.store';

/**
 * The feature store's one entry point for scoring (docs/phases/55-ai-firewall/02 §2.1; used by the rule scorer of 2.2 and later by the
 * request cascade of 04.8): an actor in, both feature vectors out (`behaviour.v1` for LightGBM, `attack.v1` for XGBoost), with whether
 * the actor is in cold start (no baseline of its own yet: the cascade sends it to stage 2 directly), and rules.v1 for the rule scorer.
 *
 * The actor's id is turned into its keyed feature id here and goes no further; its windows are read in one bounded pipeline and its
 * baseline and role prior from the (cached) baselines table. Every read fails open: what cannot be read is missing in the vectors.
 */
export interface ActorFeatureRequest {
  /** The tenant of the request or signal; null = the platform. Addresses are always read in the platform scope. */
  tenantId: string | null;
  actor: ActorRef;
  lane: SignalLane;
  /** The member's role (for the prior); null outside a membership. */
  role?: string | null;
  accountAgeDays?: number | null;
  mfaEnrolled?: boolean | null;
  /** The registered kinds' default weights, for rules.v1's weighted signal mass (absent: that feature is missing). */
  kindWeights?: ReadonlyMap<string, number> | null;
  nowMs?: number;
}

export interface ActorFeatures {
  behaviour: FeatureVector;
  attack: FeatureVector;
  /** rules.v1 (02 §2.2): what only the rule scorer and the detectors read, from the same windows. */
  rules: FeatureVector;
  coldStart: boolean;
  /** False when the windows could not be read (Redis down or slow): the window features are missing. */
  windowsRead: boolean;
  /**
   * 04.8, D55-125: the sessions of the person that proved a second factor in the last hour or so (the request fold's `sup:<tag>` counters
   * of a successful step-up, keyed session tags whose 1 h sliding estimate is above zero, at most STEP_UP_SESSIONS_MAX): the request
   * cascade does not ask THOSE sessions for another step-up meanwhile. Not a feature.
   */
  stepUpSessions?: readonly string[];
}

/** The prefix of the request fold's counter of a step-up proved by the caller's session: `sup:<keyed session tag>`. */
export const STEP_UP_PROVED_PREFIX = 'sup:';
/** The most proved sessions an actor's snapshot carries (a person with more step-ups in an hour than this is asked again). */
export const STEP_UP_SESSIONS_MAX = 16;

/** The keyed session tags with a step-up proved in the 1 h window (pure). */
export function stepUpSessionsOf(counters: Readonly<Record<string, number>> | undefined): string[] {
  const out: string[] = [];
  if (!counters) return out;
  for (const [field, n] of Object.entries(counters)) {
    if (out.length >= STEP_UP_SESSIONS_MAX) break;
    if (field.startsWith(STEP_UP_PROVED_PREFIX) && field.length > STEP_UP_PROVED_PREFIX.length && n > 0) out.push(field.slice(STEP_UP_PROVED_PREFIX.length));
  }
  return out;
}

export interface ActorFeatureDeps {
  redis?: ReadRedis;
  key?: Buffer | null;
  baselines?: Partial<BaselineLookupDeps>;
}

export async function actorFeatures(req: ActorFeatureRequest, deps: ActorFeatureDeps = {}): Promise<ActorFeatures> {
  const nowMs = req.nowMs ?? Date.now();
  const key = deps.key === undefined ? featureIdKey() : deps.key;
  const hash = featureIdOf(req.actor.kind, req.actor.id, key);
  const scope = scopeOf(req.actor.kind, req.tenantId ?? ROOT_TENANT_ID);
  const input: FeatureInput = {
    actorKind: req.actor.kind, lane: req.lane, windows: null, baseline: null, prior: null, nowMs,
    accountAgeDays: req.accountAgeDays ?? null, mfaEnrolled: req.mfaEnrolled ?? null, kindWeights: req.kindWeights ?? null,
  };
  if (hash && scope) {
    const redis = deps.redis ?? ((await import('@kuraykaraaslan-labs/redis')).default as unknown as ReadRedis);
    const tenant = scopeTenant(scope, ROOT_TENANT_ID);
    const wantsBaseline = (BASELINE_ACTOR_KINDS as readonly string[]).includes(req.actor.kind);
    const [windows, base] = await Promise.all([
      readActorWindows(redis, { scope, kind: req.actor.kind, hash }, nowMs),
      wantsBaseline && tenant ? baselineAndPrior(tenant, { kind: req.actor.kind, key: hash }, req.role ?? null, deps.baselines) : Promise.resolve({ baseline: null, prior: null }),
    ]);
    input.windows = windows;
    input.baseline = base.baseline;
    input.prior = base.prior;
  }
  const vectors = actorFeatureVectors(input);
  return {
    ...vectors, rules: featureVector(RULES_V1, input), coldStart: isColdStart(input), windowsRead: input.windows !== null,
    stepUpSessions: stepUpSessionsOf(input.windows?.windows['1h']?.counters),
  };
}
