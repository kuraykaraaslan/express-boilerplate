import type { MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { PROBE_CLASS_ATTR, PROBE_RUN_ATTR, PROBE_RUN_ID_RE } from '@kuraykaraaslan-labs/common/server/common.firewall-probe-run';
import type { EventRow } from '../store/ai_firewall.store';
import { LABEL_CONFIDENCE, SYSTEM_LABELLERS, isLabelClass, type LabelClass, type LabelWrite } from './ai_firewall.label-model';

/**
 * The label collector's run-id rule, its second half (docs/phases/55-ai-firewall/03 §3.3, §3.4; D55-83, D55-86). PURE but for the
 * process counters below.
 *
 * The first half is the dispatcher's (common.firewall-probe-gate.ts): it believes a request's probe-run mark only on a staging install
 * (benign marks also on the demo) and only with the runner's own credential, and only then do the request's signals carry `probe.run` and
 * `probe.class` (stamped by `emitSecuritySignal`, which drops any such attribute a producer passed). The collector checks again, in the
 * worker, before a stamped event becomes a label:
 *
 *   - the install role (`installRole`): on a production install a stamped event is NEVER a label (ignored and counted as
 *     `not_staging`; a stream written by hand, or a worker sharing Redis with a staging web process, cannot make one); on the demo only a
 *     `benign` stamp is (an attack class there is `class_refused`);
 *   - the run id's shape and the class: one of LABEL_CLASSES (`malformed` / `class_refused` otherwise);
 *   - `benign` becomes source `benign_traffic` (confidence 0.9, labeller `benign_run`), any other class source `synthetic` (confidence 1,
 *     labeller `probe_run`); the run id travels in the label (`runId`), so a run's labels can be found, exported or withdrawn together.
 *
 * Every stamped event the collector sees is counted under what became of it (`ai_firewall_probe_labels_total{result}`).
 */
export type InstallRoleView = 'production' | 'staging' | 'demo';

export const PROBE_LABEL_RESULTS = ['labelled', 'not_staging', 'malformed', 'class_refused'] as const;
export type ProbeLabelResult = (typeof PROBE_LABEL_RESULTS)[number];

/** A stored attribute's plain text (a stamp is written as a plain string; anything else is not a stamp). */
const plain = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Whether a stored event carries a probe-run stamp at all (either attribute: a half stamp is malformed, never ignored silently). */
export const isStamped = (row: Pick<EventRow, 'attrs'>): boolean =>
  row.attrs?.[PROBE_RUN_ATTR] !== undefined || row.attrs?.[PROBE_CLASS_ATTR] !== undefined;

/** What the collector makes of one stamped event on an install of `role`: its label, or why none. */
export function probeLabelOf(row: EventRow, role: InstallRoleView, atIso: string): { result: ProbeLabelResult; label: LabelWrite | null } {
  if (role !== 'staging' && role !== 'demo') return { result: 'not_staging', label: null };
  const runId = plain(row.attrs?.[PROBE_RUN_ATTR]);
  const declared = plain(row.attrs?.[PROBE_CLASS_ATTR]);
  if (!runId || !PROBE_RUN_ID_RE.test(runId) || !declared) return { result: 'malformed', label: null };
  if (!isLabelClass(declared)) return { result: 'class_refused', label: null };
  const labelClass: LabelClass = declared;
  if (role === 'demo' && labelClass !== 'benign') return { result: 'class_refused', label: null };
  const benign = labelClass === 'benign';
  return {
    result: 'labelled',
    label: {
      tenantId: row.tenantId,
      refKind: 'event',
      refId: row.signalId,
      refAt: row.at,
      actorKind: row.actorKind,
      actorId: row.actorId,
      lane: row.lane,
      kind: row.kind,
      detectors: [],
      labelClass,
      verdict: null,
      source: benign ? 'benign_traffic' : 'synthetic',
      confidence: benign ? LABEL_CONFIDENCE.benignTraffic : LABEL_CONFIDENCE.synthetic,
      labelledBy: null,
      labelledBySystem: benign ? SYSTEM_LABELLERS.benign : SYSTEM_LABELLERS.probe,
      labelledAt: atIso,
      runId,
    },
  };
}

/** The stamped events of a batch as labels on an install of `role`, with the count per result (pure). */
export function planProbeLabels(rows: readonly EventRow[], role: InstallRoleView, atIso: string): { labels: LabelWrite[]; results: Record<ProbeLabelResult, number> } {
  const results = Object.fromEntries(PROBE_LABEL_RESULTS.map((r) => [r, 0])) as Record<ProbeLabelResult, number>;
  const labels: LabelWrite[] = [];
  for (const row of rows) {
    if (!isStamped(row)) continue;
    const { result, label } = probeLabelOf(row, role, atIso);
    results[result] += 1;
    if (label) labels.push(label);
  }
  return { labels, results };
}

/* ───────────────────────────── The process's counters ───────────────────────────── */

const STATE_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.probeLabels');
const holder = globalThis as unknown as Record<symbol, Record<ProbeLabelResult, number> | undefined>;
const counts = (): Record<ProbeLabelResult, number> =>
  (holder[STATE_KEY] ??= Object.fromEntries(PROBE_LABEL_RESULTS.map((r) => [r, 0])) as Record<ProbeLabelResult, number>);

/** Adds a batch's results to the process's counts. */
export function countProbeLabels(results: Partial<Record<ProbeLabelResult, number>>): void {
  const c = counts();
  for (const r of PROBE_LABEL_RESULTS) c[r] += Math.max(0, Number(results[r]) || 0);
}

export function probeLabelCounts(): Record<ProbeLabelResult, number> {
  return { ...counts() };
}

/** Test seam. */
export function resetProbeLabelCounts(): void {
  holder[STATE_KEY] = undefined;
}

/** The collector's series, on the worker's `/metrics` (registered by the signal consumer's boot task). */
export function probeLabelMetricSources(): MetricSource[] {
  return [{
    name: 'ai_firewall_probe_labels_total',
    help: 'Stored security events that carried a probe-run stamp (phase 55 03 §3.3, §3.4), by what the label collector made of them: labelled (a synthetic or benign_traffic label), or ignored: not_staging (a production install never labels a stamp), malformed, class_refused (not a label class, or an attack class on the demo).',
    labelNames: ['result'],
    read: async () => PROBE_LABEL_RESULTS.map((result) => ({ labels: { result }, value: counts()[result] })),
  }];
}
