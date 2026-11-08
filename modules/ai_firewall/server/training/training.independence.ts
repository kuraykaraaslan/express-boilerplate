import { ablation, falsePositiveOverlap, pearson, round6, withinClassCorrelation, type Ablation, type FalsePositiveOverlap } from './training.metrics';

/**
 * The independence report (docs/phases/55-ai-firewall/04-tree-models.md 4.4, D55-103): two models only add anything when they make
 * different mistakes. On the JOINT holdout (the labelled references in both models' test slices; the export gives a label the same
 * `ref` in both datasets) it reports
 *   - the correlation of the two models' errors: over the residuals (truth − the model's suspicion: the behaviour probability,
 *     1 − P(benign) of the attack model), pooled within each class of the truth (`withinClassCorrelation`: the truth alone makes two
 *     residuals share their sign); the plain Pearson beside it, and the correlation of their mistakes at their thresholds (phi over
 *     the error indicators);
 *   - the overlap of their false positives (benign references both flag);
 *   - each model alone and combined (ablation): both keys (the cascade's block, FWA-13) and either key.
 * A residual correlation above the bound flags the run (the second model adds little); too few joint rows or no variance is
 * `insufficient`. Only `ok` passes the promotion gate (`promotionRefusals`).
 */

/** One model's scored test row: the truth (1 = attack / anomalous), how suspicious the model finds it, whether it flags it. */
export type JointInput = { ref: string; y: number; suspicion: number; flag: boolean };

/** Fewer joint references than this and the correlation says nothing. */
export const MIN_JOINT_ROWS = 30;

export type IndependenceReport = {
  status: 'ok' | 'flagged' | 'insufficient';
  bound: number;
  jointRows: number;
  /** References whose truth the two datasets disagree on (left out). */
  conflicts: number;
  /** The residuals' correlation pooled within each class (the one the bound applies to); null when undefined. */
  errorCorrelation: number | null;
  /** Plain Pearson over the residuals (inflated by the shared truth; for the record). */
  rawErrorCorrelation: number | null;
  /** Phi over the error indicators at each model's threshold; null when undefined. */
  mistakeCorrelation: number | null;
  falsePositives: FalsePositiveOverlap;
  ablation: Ablation;
};

/** The report over the two models' test rows (pure). */
export function independenceOf(behaviour: readonly JointInput[], attack: readonly JointInput[], bound: number): IndependenceReport {
  const byRef = new Map(attack.map((a) => [a.ref, a]));
  const pairs: Array<[JointInput, JointInput]> = [];
  let conflicts = 0;
  for (const b of behaviour) {
    const a = byRef.get(b.ref);
    if (!a) continue;
    if (!!a.y !== !!b.y) { conflicts += 1; continue; }
    pairs.push([b, a]);
  }
  const y = pairs.map(([b]) => (b.y ? 1 : 0));
  const residualB = pairs.map(([b], i) => y[i] - b.suspicion);
  const residualA = pairs.map(([, a], i) => y[i] - a.suspicion);
  const errB = pairs.map(([b], i) => (b.flag !== !!y[i] ? 1 : 0));
  const errA = pairs.map(([, a], i) => (a.flag !== !!y[i] ? 1 : 0));
  const flagB = pairs.map(([b]) => b.flag);
  const flagA = pairs.map(([, a]) => a.flag);
  const errorCorrelation = withinClassCorrelation(residualB, residualA, y);
  const status: IndependenceReport['status'] = pairs.length < MIN_JOINT_ROWS || errorCorrelation === null
    ? 'insufficient'
    : errorCorrelation > bound ? 'flagged' : 'ok';
  return {
    status,
    bound,
    jointRows: pairs.length,
    conflicts,
    errorCorrelation: round6(errorCorrelation),
    rawErrorCorrelation: round6(pearson(residualB, residualA)),
    mistakeCorrelation: round6(pearson(errB, errA)),
    falsePositives: falsePositiveOverlap(flagB, flagA, y),
    ablation: ablation(flagB, flagA, y),
  };
}
