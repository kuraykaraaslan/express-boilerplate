import Logger from '@kuraykaraaslan-labs/logger';
import type { MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import type { ScoredDetection } from '../detect/ai_firewall.risk';
import type { RecordResult } from './ai_firewall.incident-store';

/**
 * The incident grouping in the worker (docs/phases/55-ai-firewall/02 §2.4, D55-36): subscribes to the detectors' hand-off
 * (`onScoredDetection`, detect/ai_firewall.detection-queue.ts) in the same process as the evaluator and writes each scored detection
 * into its actor's incident (`recordDetection`). The evaluator already bounds the work (at most 100 actors per 2 s tick and worker, one
 * scoring per actor per 30 s), so this is at most one short tenant transaction per scored actor.
 *
 * Observe (2.7): an incident is recorded, never acted on. Fail open (FWA-7): a write that fails is counted and logged (at most once a
 * minute), never retried and never rethrown; no request, sign-in or audit write waits on it.
 */
export const RECORD_RESULTS = ['opened', 'joined', 'reopened', 'conflict', 'failed'] as const;
export type RecorderResult = (typeof RECORD_RESULTS)[number];

export interface RecorderStats {
  results: Record<RecorderResult, number>;
}

export interface IncidentRecorderOptions {
  record?: (d: ScoredDetection) => Promise<RecordResult>;
  now?: () => number;
  warn?: (text: string) => void;
}

export class IncidentRecorder {
  readonly stats: RecorderStats = { results: { opened: 0, joined: 0, reopened: 0, conflict: 0, failed: 0 } };
  private lastWarn = Number.NEGATIVE_INFINITY;

  constructor(private readonly o: IncidentRecorderOptions = {}) {}

  private async record(d: ScoredDetection): Promise<RecordResult> {
    if (this.o.record) return this.o.record(d);
    const { recordDetection } = await import('./ai_firewall.incident-store');
    return recordDetection(d);
  }

  /** Never rejects. */
  async handle(d: ScoredDetection): Promise<RecorderResult> {
    try {
      const result = await this.record(d);
      this.stats.results[result] += 1;
      return result;
    } catch (e) {
      this.stats.results.failed += 1;
      const now = (this.o.now ?? Date.now)();
      if (now - this.lastWarn >= 60_000) {
        this.lastWarn = now;
        this.o.warn?.(`incidents: a scored detection could not be recorded: ${e instanceof Error ? e.message : String(e)}`);
      }
      return 'failed';
    }
  }
}

const CURRENT_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.incidentRecorder');
const holder = globalThis as unknown as Record<symbol, { recorder: IncidentRecorder; stop(): Promise<void> } | undefined>;

export function incidentMetricSources(read: () => RecorderStats | undefined = () => holder[CURRENT_KEY]?.recorder.stats): MetricSource[] {
  return [{
    name: 'ai_firewall_incident_recordings_total',
    help: 'Scored detections the AI firewall\'s incident grouping wrote in this worker, by result: opened a new incident, joined the actor\'s open one, re-opened an acknowledged one whose severity rose, lost a race twice, failed (observe: nothing acts on them).',
    labelNames: ['result'],
    read: async () => RECORD_RESULTS.map((result) => ({ labels: { result }, value: read()?.results[result] ?? 0 })),
  }];
}

/**
 * `common:boot_task` of the worker (phase `scheduler`, `parallel`: every worker process records what its own evaluator scored).
 * Subscribes to the hand-off, puts the series on `/metrics`, unsubscribes on drain. Idempotent.
 */
export async function startIncidentRecorder(): Promise<{ stop(): Promise<void> }> {
  const running = holder[CURRENT_KEY];
  if (running) return { stop: () => running.stop() };
  const [{ registerDrainHook, registerMetricSource }, { onScoredDetection }] = await Promise.all([
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('../detect/ai_firewall.detection-queue'),
  ]);
  const recorder = new IncidentRecorder({ warn: (text) => Logger.warn(`[ai_firewall] ${text}`) });
  const unsubscribe = onScoredDetection((d) => recorder.handle(d).then(() => undefined));
  const stop = async () => {
    unsubscribe();
    if (holder[CURRENT_KEY]?.recorder === recorder) holder[CURRENT_KEY] = undefined;
  };
  holder[CURRENT_KEY] = { recorder, stop };
  for (const source of incidentMetricSources()) registerMetricSource(source);
  registerDrainHook('ai-firewall-incidents', stop);
  return { stop };
}
