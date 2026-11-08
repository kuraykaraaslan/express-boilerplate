/**
 * Evasion, the hovering half (docs/phases/55-ai-firewall/04-tree-models.md 4.11): an attacker who learns where a threshold sits keeps its
 * score just under it. The watch counts, per actor and threshold, the scorings that fall in the band just below the threshold
 * ([threshold × (1 − BAND), threshold)) within a window; an actor with at least MIN_NEAR of them and NONE at or above the threshold in
 * that window is "hovering". Real users scatter around their own level and cross now and then; a tuned client sits under the line.
 *
 * What it changes (D55-121): a request of an actor hovering under stage 1's `suspicion` goes to stage 2 even though stage 1 called it
 * normal (`decideCascade`'s `hovering`, capped at a challenge: stage 1 did not turn its key); hovering under stage 2's `challenge` or
 * `block` is counted and named in the actor's cascade signal, so the rule scorer and a person see it; nothing is enforced on it alone.
 *
 * One scoring is one INDEPENDENT read of the actor (D55-126): the cascade scores the actor's cached snapshot, refreshed at most every few
 * seconds, so the requests of one page load all read the same score. A note carries the snapshot's identity (`scoring`, its read time)
 * and a repeat of the scoring last counted for that actor and line changes nothing: hovering needs MIN_NEAR refreshes, not MIN_NEAR
 * requests.
 *
 * Bounded: at most `maxActors` actors per threshold (the oldest entry goes first); a window that ended starts afresh. In memory only,
 * per process (an attacker spread over several processes is seen by each with its share of the traffic). Never throws.
 */
export const HOVER_BAND = 0.15;
export const HOVER_MIN_NEAR = 8;
export const HOVER_WINDOW_MS = 10 * 60_000;
export const HOVER_MAX_ACTORS = 10_000;

export type HoverLine = 'suspicion' | 'challenge' | 'block';

interface Entry {
  start: number;
  near: number;
  crossed: boolean;
  /** The scoring last counted (a snapshot's read time), so a repeat of it is not counted again. */
  last: string | number | null;
}

export interface HoverOptions {
  band?: number;
  minNear?: number;
  windowMs?: number;
  maxActors?: number;
}

export class HoverWatch {
  readonly stats = { notes: 0, repeats: 0, hovering: 0, evicted: 0 };
  private readonly lines = new Map<HoverLine, Map<string, Entry>>();
  private readonly band: number;
  private readonly minNear: number;
  private readonly windowMs: number;
  private readonly maxActors: number;

  constructor(o: HoverOptions = {}) {
    this.band = o.band ?? HOVER_BAND;
    this.minNear = o.minNear ?? HOVER_MIN_NEAR;
    this.windowMs = o.windowMs ?? HOVER_WINDOW_MS;
    this.maxActors = o.maxActors ?? HOVER_MAX_ACTORS;
  }

  /**
   * Records one scoring of `actor` against `line` at `threshold`; answers whether the actor is hovering under it now. `scoring` names the
   * scoring (the snapshot's read time): the same one noted again for this actor and line is not counted twice (absent: every note counts).
   */
  note(line: HoverLine, actor: string, score: number, threshold: number, nowMs: number, scoring?: string | number): boolean {
    try {
      if (!Number.isFinite(score) || !(threshold > 0)) return false;
      let map = this.lines.get(line);
      if (!map) { map = new Map(); this.lines.set(line, map); }
      let e = map.get(actor);
      if (!e || nowMs - e.start > this.windowMs) {
        if (!e && map.size >= this.maxActors) {
          const oldest = map.keys().next().value;
          if (oldest !== undefined) { map.delete(oldest); this.stats.evicted += 1; }
        }
        if (e) map.delete(actor);
        e = { start: nowMs, near: 0, crossed: false, last: null };
        map.set(actor, e);
      }
      if (scoring !== undefined && e.last === scoring) {
        this.stats.repeats += 1;
        return !e.crossed && e.near >= this.minNear;
      }
      if (scoring !== undefined) e.last = scoring;
      this.stats.notes += 1;
      if (score >= threshold) e.crossed = true;
      else if (score >= threshold * (1 - this.band)) e.near += 1;
      const hovering = !e.crossed && e.near >= this.minNear;
      if (hovering) this.stats.hovering += 1;
      return hovering;
    } catch {
      return false;
    }
  }

  /** Whether `actor` is hovering under `line` (without recording a scoring). */
  isHovering(line: HoverLine, actor: string, nowMs: number): boolean {
    const e = this.lines.get(line)?.get(actor);
    return !!e && nowMs - e.start <= this.windowMs && !e.crossed && e.near >= this.minNear;
  }

  /** Actors tracked under a line (for the tests and the gauge). */
  size(line: HoverLine): number {
    return this.lines.get(line)?.size ?? 0;
  }
}
