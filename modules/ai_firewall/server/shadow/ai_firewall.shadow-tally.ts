import { createHash } from 'node:crypto';
import type { ModelShadowScore, ShadowModelId } from '../detect/ai_firewall.risk';
import { binCount, binOf, isoWeekOf, scoreBin, SCORE_BINS, type DriftHistogram, type FeatureEdges } from '../promotion/ai_firewall.drift';

/**
 * What shadow mode counts for the promotion gate and the drift check (docs/phases/55-ai-firewall/04-tree-models.md 4.6, 4.7, 4.9), in the
 * worker's detection evaluator, per model and per model file (its short sha: a new model starts from nothing):
 *
 *   fw:sh:a:<model>:<sha>:<YYYY-MM-DD>   a HyperLogLog of the actors the model scored that UTC day (the "active actors" of 4.7);
 *   fw:sh:f:<model>:<sha>:<YYYY-MM-DD>   a HyperLogLog of the actors it flagged that day (a rung of step-up or above);
 *   fw:sh:h:<model>:<sha>:<YYYY-Www>     a hash of that ISO week's histogram: `n`, the score's bins `s:<b>`, each feature's `f:<i>:<b>`.
 *
 * The members are a hash of (tenant, actor kind, actor id) cut to 16 hex characters, and a HyperLogLog keeps no member anyway: nothing in
 * these keys names a person. Day keys live DAY_KEY_TTL_S (the gate reads the last 28 days), week keys WEEK_KEY_TTL_S (the gate keeps the
 * reference week in its own row). Counted in process and written every FLUSH_MS as one pipeline; a flush that fails is dropped and counted,
 * never retried (FWA-7), and a full buffer drops further actors of the day and counts them.
 */
export const DAY_KEY_TTL_S = 40 * 86_400;
export const WEEK_KEY_TTL_S = 70 * 86_400;
export const FLUSH_MS = 60_000;
/** Actors buffered per model and day between flushes, and histogram fields per model and week (both bounded). */
export const MAX_MEMBERS = 20_000;

export const shadowActiveKey = (model: ShadowModelId, sha: string, day: string): string => `fw:sh:a:${model}:${sha}:${day}`;
export const shadowFlaggedKey = (model: ShadowModelId, sha: string, day: string): string => `fw:sh:f:${model}:${sha}:${day}`;
export const shadowHistogramKey = (model: ShadowModelId, sha: string, week: string): string => `fw:sh:h:${model}:${sha}:${week}`;

/** The UTC day of a time, `YYYY-MM-DD`. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** An actor as a tally member: not reversible, not joinable to anything else. */
export const tallyMember = (tenantId: string, kind: string, id: string): string =>
  createHash('sha256').update(`nb.fw-shadow/1\n${tenantId.toLowerCase()}\n${kind}\n${id}`, 'utf8').digest('hex').slice(0, 16);

export interface TallyPipeline {
  pfadd(key: string, ...members: string[]): unknown;
  hincrby(key: string, field: string, by: number): unknown;
  expire(key: string, seconds: number): unknown;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}
export interface TallyRedis {
  pipeline(): TallyPipeline;
}

export interface TallyStats {
  flushes: number;
  failedFlushes: number;
  droppedMembers: number;
}

/** One scoring to count: the model's score, the row it scored, and how the model's bins are cut. */
export interface TallyEntry {
  model: ShadowModelId;
  sha: string;
  member: string;
  atMs: number;
  score: Pick<ModelShadowScore, 'probability' | 'flagged'>;
  values: ReadonlyArray<number | null>;
  edges: FeatureEdges;
  rule: 'lightgbm' | 'xgboost';
}

export class ShadowTally {
  readonly stats: TallyStats = { flushes: 0, failedFlushes: 0, droppedMembers: 0 };
  /** key -> members (active and flagged day keys). */
  private members = new Map<string, Set<string>>();
  /** histogram key -> field -> count. */
  private bins = new Map<string, Map<string, number>>();

  record(e: TallyEntry): void {
    const day = utcDay(e.atMs);
    this.add(shadowActiveKey(e.model, e.sha, day), e.member);
    if (e.score.flagged) this.add(shadowFlaggedKey(e.model, e.sha, day), e.member);
    const key = shadowHistogramKey(e.model, e.sha, isoWeekOf(e.atMs));
    let fields = this.bins.get(key);
    if (!fields) { fields = new Map(); this.bins.set(key, fields); }
    const inc = (f: string) => fields!.set(f, (fields!.get(f) ?? 0) + 1);
    inc('n');
    inc(`s:${scoreBin(e.score.probability)}`);
    e.edges.forEach((edges, i) => {
      const v = e.values[i];
      inc(`f:${i}:${binOf(edges, typeof v === 'number' ? v : Number.NaN, e.rule)}`);
    });
  }

  private add(key: string, member: string): void {
    let set = this.members.get(key);
    if (!set) { set = new Set(); this.members.set(key, set); }
    if (set.has(member)) return;
    if (set.size >= MAX_MEMBERS) { this.stats.droppedMembers += 1; return; }
    set.add(member);
  }

  /** Whether anything waits to be written. */
  get pending(): boolean {
    return this.members.size > 0 || this.bins.size > 0;
  }

  /** Writes what was counted as one pipeline and forgets it, written or not. Never rejects. */
  async flush(redis: TallyRedis): Promise<void> {
    if (!this.pending) return;
    const members = this.members;
    const bins = this.bins;
    this.members = new Map();
    this.bins = new Map();
    try {
      const pipe = redis.pipeline();
      for (const [key, set] of members) {
        pipe.pfadd(key, ...set);
        pipe.expire(key, DAY_KEY_TTL_S);
      }
      for (const [key, fields] of bins) {
        for (const [field, n] of fields) pipe.hincrby(key, field, n);
        pipe.expire(key, WEEK_KEY_TTL_S);
      }
      const replies = await pipe.exec();
      if (!replies || replies.some(([err]) => err)) this.stats.failedFlushes += 1;
      else this.stats.flushes += 1;
    } catch {
      this.stats.failedFlushes += 1;
    }
  }
}

/* ──────────────────────────────── The gate's reads ──────────────────────────────── */

export interface CountRedis {
  pipeline(): { pfcount(key: string): unknown; exec(): Promise<Array<[Error | null, unknown]> | null> };
}

/** Per day, the actors the model scored and flagged (HyperLogLog counts, about 0.8 % error). Throws when Redis cannot answer. */
export async function readShadowCounts(redis: CountRedis, model: ShadowModelId, sha: string, days: readonly string[]): Promise<Array<{ day: string; active: number; flagged: number }>> {
  if (days.length === 0) return [];
  const pipe = redis.pipeline();
  for (const day of days) {
    pipe.pfcount(shadowActiveKey(model, sha, day));
    pipe.pfcount(shadowFlaggedKey(model, sha, day));
  }
  const replies = await pipe.exec();
  if (!replies || replies.length !== days.length * 2 || replies.some(([err]) => err)) throw new Error('the shadow counts could not be read');
  return days.map((day, i) => ({ day, active: Number(replies[i * 2]![1]) || 0, flagged: Number(replies[i * 2 + 1]![1]) || 0 }));
}

/** A week's hash as a histogram with the model's bins (fields it does not know are ignored). Pure. */
export function histogramOf(week: string, hash: Record<string, string> | null | undefined, edges: FeatureEdges): DriftHistogram {
  const score = new Array<number>(SCORE_BINS).fill(0);
  const features = edges.map((e) => new Array<number>(binCount(e)).fill(0));
  let n = 0;
  for (const [field, raw] of Object.entries(hash ?? {})) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    if (field === 'n') { n = value; continue; }
    const parts = field.split(':');
    if (parts[0] === 's' && parts.length === 2) {
      const b = Number(parts[1]);
      if (Number.isInteger(b) && b >= 0 && b < SCORE_BINS) score[b] = value;
    } else if (parts[0] === 'f' && parts.length === 3) {
      const i = Number(parts[1]);
      const b = Number(parts[2]);
      if (Number.isInteger(i) && i >= 0 && i < features.length && Number.isInteger(b) && b >= 0 && b < features[i]!.length) features[i]![b] = value;
    }
  }
  return { week, n, score, features };
}

export interface HashRedis {
  hgetall(key: string): Promise<Record<string, string>>;
}

/** The model's histogram of one week (empty when nothing was counted). Throws when Redis cannot answer. */
export async function readHistogram(redis: HashRedis, model: ShadowModelId, sha: string, week: string, edges: FeatureEdges): Promise<DriftHistogram> {
  return histogramOf(week, await redis.hgetall(shadowHistogramKey(model, sha, week)), edges);
}
