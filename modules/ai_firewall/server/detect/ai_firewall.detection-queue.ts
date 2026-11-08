import {
  ACTOR_KINDS, SIGNAL_LANES, isUntrustedText, type ActorKind, type ActorRef, type SignalLane,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { EventRow } from '../store/ai_firewall.store';
import type { ScoredDetection } from './ai_firewall.risk';

/**
 * The detectors' work list and their hand-off (docs/phases/55-ai-firewall/02 §2.3 → §2.4). Small on purpose: the feature group's
 * consumer (`ai_firewall.signal-fold.ts`) imports it to name the actors its batch touched, the evaluator
 * (`ai_firewall.detection-evaluator.ts`) takes them a bounded number per tick, and the incident grouping of 2.4 subscribes to what
 * it scores (`onScoredDetection`). Everything lives in this process's memory: the raw actor ids are the ones the `fw:signals` entries
 * already carried, and nothing here writes them anywhere (the feature store keeps keyed hashes only, D55-22).
 *
 * Bounded: at most QUEUE_MAX actors wait (a new one beyond is dropped and counted); an actor is scored at most once per COOLDOWN_MS
 * (a burst of its signals waits for one scoring after the burst, not one per signal); a scoring waits SETTLE_MS after the actor's
 * first signal so the windows hold what the same batch folded.
 */
export const QUEUE_MAX = 5_000;
export const SETTLE_MS = 2_000;
export const COOLDOWN_MS = 30_000;
/** Most "last scored" stamps kept (cleared when full: at worst an actor is scored once more than needed). */
export const SCORED_STAMPS_MAX = 20_000;

export interface DetectionTarget {
  /** The tenant its rows are stored under (ROOT for the platform). */
  tenantId: string;
  actor: ActorRef;
  lane: SignalLane;
  /** The member role the signal named (the request-pattern signal carries it), for the cold-start prior. */
  role: string | null;
}

export interface DetectionQueueOptions {
  max?: number;
  settleMs?: number;
  cooldownMs?: number;
}

const keyOf = (t: DetectionTarget): string => `${t.tenantId.toLowerCase()}|${t.actor.kind}|${t.actor.id}`;

export class DetectionQueue {
  private pending = new Map<string, { target: DetectionTarget; readyAt: number }>();
  private scored = new Map<string, number>();
  enqueued = 0;
  dropped = 0;

  constructor(private readonly o: DetectionQueueOptions = {}) {}

  get size(): number {
    return this.pending.size;
  }

  /** Adds an actor (or refreshes the lane and role of one already waiting). Answers false when it was dropped (queue full). */
  enqueue(target: DetectionTarget, nowMs: number): boolean {
    const key = keyOf(target);
    const waiting = this.pending.get(key);
    if (waiting) {
      waiting.target = { ...target, role: target.role ?? waiting.target.role };
      return true;
    }
    if (this.pending.size >= (this.o.max ?? QUEUE_MAX)) { this.dropped += 1; return false; }
    const last = this.scored.get(key);
    const readyAt = Math.max(nowMs + (this.o.settleMs ?? SETTLE_MS), last === undefined ? 0 : last + (this.o.cooldownMs ?? COOLDOWN_MS));
    this.pending.set(key, { target, readyAt });
    this.enqueued += 1;
    return true;
  }

  /** Up to `n` actors whose time has come, oldest first; they leave the queue and are stamped as scored now. */
  take(n: number, nowMs: number): DetectionTarget[] {
    const out: DetectionTarget[] = [];
    for (const [key, entry] of this.pending) {
      if (out.length >= n) break;
      if (entry.readyAt > nowMs) continue;
      this.pending.delete(key);
      if (this.scored.size >= SCORED_STAMPS_MAX) this.scored.clear();
      this.scored.set(key, nowMs);
      out.push(entry.target);
    }
    return out;
  }
}

const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : isUntrustedText(v) ? v.text : null);
const ADDRESS = /^[0-9A-Fa-f:.]{2,64}$/;
const isActorKind = (v: string): v is ActorKind => (ACTOR_KINDS as readonly string[]).includes(v);
const laneOf = (v: string): SignalLane => ((SIGNAL_LANES as readonly string[]).includes(v) ? (v as SignalLane) : 'unknown');

/**
 * The actors a batch of stored-signal rows names: each row's actor and the address it carries (`attrs.ip`, scored in the platform
 * scope under ROOT). An anonymous actor without a stable id (`system`, `anonymous`) is not an actor to score.
 */
export function targetsOfRows(rows: readonly EventRow[]): DetectionTarget[] {
  const out: DetectionTarget[] = [];
  for (const row of rows) {
    const lane = laneOf(row.lane);
    const role = textOf(row.attrs?.role);
    if (isActorKind(row.actorKind) && row.actorId && !(row.actorKind === 'anon' && (row.actorId === 'system' || row.actorId === 'anonymous'))) {
      const platform = row.actorKind === 'ip' || row.actorKind === 'anon';
      out.push({ tenantId: platform ? ROOT_TENANT_ID : row.tenantId, actor: { kind: row.actorKind, id: row.actorId }, lane, role: platform ? null : role });
    }
    const ip = row.actorKind === 'ip' ? null : textOf(row.attrs?.ip);
    if (ip && ADDRESS.test(ip)) out.push({ tenantId: ROOT_TENANT_ID, actor: { kind: 'ip', id: ip }, lane, role: null });
  }
  return out;
}

/* ──────────────────────────── The process's queue and the hand-off to 2.4 ──────────────────────────── */

export type ScoredDetectionListener = (detection: ScoredDetection) => void | Promise<void>;

interface Holder {
  queue: DetectionQueue | null;
  listeners: Set<ScoredDetectionListener>;
}
const HOLDER_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.detections');
const holder = (): Holder => {
  const g = globalThis as unknown as Record<symbol, Holder | undefined>;
  return (g[HOLDER_KEY] ??= { queue: null, listeners: new Set() });
};

/** The evaluator's boot task installs its queue here (null on stop); with none, enqueuing does nothing. */
export function setDetectionQueue(queue: DetectionQueue | null): void {
  holder().queue = queue;
}

/** Called by the feature group's consumer after a batch was folded. Never throws. */
export function enqueueDetectionRows(rows: readonly EventRow[], nowMs: number = Date.now()): void {
  try {
    const queue = holder().queue;
    if (!queue) return;
    for (const t of targetsOfRows(rows)) queue.enqueue(t, nowMs);
  } catch {
    // the detectors are best effort; the fold's acknowledgement never depends on them (FWA-7)
  }
}

/** 2.4 subscribes here to every scored detection of this process. Answers the unsubscribe. */
export function onScoredDetection(listener: ScoredDetectionListener): () => void {
  holder().listeners.add(listener);
  return () => { holder().listeners.delete(listener); };
}

/** Hands a scored detection to every listener; a listener that throws or rejects is counted by the caller, never rethrown. */
export async function publishScoredDetection(detection: ScoredDetection): Promise<number> {
  let failed = 0;
  for (const listener of [...holder().listeners]) {
    try {
      await listener(detection);
    } catch {
      failed += 1;
    }
  }
  return failed;
}
