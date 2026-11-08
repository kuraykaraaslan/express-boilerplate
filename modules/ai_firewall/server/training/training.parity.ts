import { PREDICT_CONTRIB, PREDICT_NORMAL, PREDICT_RAW_SCORE, type LightGbm } from '../engines/lightgbm.wasm';
import { PREDICT_CONTRIBUTIONS, PREDICT_MARGIN, PREDICT_VALUE, type XgBoost } from '../engines/xgboost.wasm';
import { predict } from '../trees/tree-ensemble.predict';
import { contributions } from '../trees/tree-shap';
import type { TreeEnsemble } from '../trees/tree-ensemble.types';
import { rng } from './training.random';

/**
 * Parity of a trained model before it is written (docs/phases/55-ai-firewall/04-tree-models.md 4.3: "every shipped model is checked
 * the same way before it is embedded"): the vendored library and the TypeScript evaluator score the same rows, built to hit the edges
 * as the parity tests build them (a row on every split threshold of the first trees, NaN, 0, values inside LightGBM's zero threshold),
 * plus real holdout rows, and must agree on raw scores, outputs and contributions: LightGBM to 1e-9 relative, XGBoost to 1e-5 (float32).
 */

export const PARITY_TOLERANCE = { lightgbm: 1e-9, xgboost: 1e-5 } as const;

/** Edge rows over `base` rows (real rows of the dataset): each split threshold of the first trees, then NaN / 0 / tiny values. */
export function parityRows(model: TreeEnsemble, base: readonly Float64Array[], seed: number, maxTrees = 6): Float64Array[] {
  const rand = rng(seed);
  const ncol = model.numFeatures;
  const pick = () => Float64Array.from(base.length ? base[Math.floor(rand() * base.length)] : new Float64Array(ncol));
  const rows: Float64Array[] = [];
  for (const tree of model.trees.slice(0, maxTrees)) {
    for (let n = 0; n < tree.size; n++) {
      if (tree.isLeaf[n]) continue;
      const row = pick();
      row[tree.feature[n]] = tree.threshold[n];
      rows.push(row);
    }
  }
  const edges = model.library === 'lightgbm' ? [Number.NaN, 0, 1e-36, -1e-36, -0] : [Number.NaN, 0, -0];
  for (let i = 0; i < 40; i++) {
    const row = pick();
    row[Math.floor(rand() * ncol)] = edges[i % edges.length];
    rows.push(row);
  }
  rows.push(Float64Array.from({ length: ncol }, () => Number.NaN), new Float64Array(ncol));
  for (const b of base) rows.push(Float64Array.from(b));
  return rows;
}

export type ParityResult = { rows: number; mismatches: string[] };

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function compare(model: TreeEnsemble, rows: readonly Float64Array[], tol: number, raw: ArrayLike<number>, out: ArrayLike<number>, contrib: ArrayLike<number>): ParityResult {
  const k = model.numOutputs;
  const ncol = model.numFeatures;
  const mismatches: string[] = [];
  rows.forEach((row, i) => {
    const ours = predict(model, row);
    const phi = contributions(model, row);
    for (let c = 0; c < k; c++) {
      if (!close(ours.raw[c], raw[i * k + c], tol)) mismatches.push(`raw row ${i} output ${c}: ${ours.raw[c]} vs ${raw[i * k + c]}`);
      if (!close(ours.output[c], out[i * k + c], tol)) mismatches.push(`output row ${i} output ${c}: ${ours.output[c]} vs ${out[i * k + c]}`);
      for (let f = 0; f <= ncol; f++) {
        const theirs = contrib[i * k * (ncol + 1) + c * (ncol + 1) + f];
        if (!close(phi[c][f], theirs, tol)) mismatches.push(`contribution row ${i} output ${c} feature ${f}: ${phi[c][f]} vs ${theirs}`);
      }
    }
  });
  return { rows: rows.length, mismatches };
}

const flatten = (rows: readonly Float64Array[], ncol: number) => {
  const flat = new Float64Array(rows.length * ncol);
  rows.forEach((r, i) => flat.set(r, i * ncol));
  return flat;
};

/** LightGBM 4.7.0 against the evaluator on `rows`. */
export function lightGbmParity(lib: LightGbm, text: string, model: TreeEnsemble, rows: readonly Float64Array[]): ParityResult {
  const booster = lib.booster(text);
  try {
    const ncol = model.numFeatures;
    const flat = flatten(rows, ncol);
    return compare(
      model, rows, PARITY_TOLERANCE.lightgbm,
      booster.predict(flat, rows.length, ncol, PREDICT_RAW_SCORE),
      booster.predict(flat, rows.length, ncol, PREDICT_NORMAL),
      booster.predict(flat, rows.length, ncol, PREDICT_CONTRIB),
    );
  } finally {
    booster.dispose();
  }
}

/** XGBoost 3.4.2 against the evaluator on `rows`. */
export function xgBoostParity(lib: XgBoost, json: string, model: TreeEnsemble, rows: readonly Float64Array[]): ParityResult {
  const booster = lib.booster(json);
  try {
    const ncol = model.numFeatures;
    const flat = flatten(rows, ncol);
    return compare(
      model, rows, PARITY_TOLERANCE.xgboost,
      booster.predict(flat, rows.length, ncol, PREDICT_MARGIN).values,
      booster.predict(flat, rows.length, ncol, PREDICT_VALUE).values,
      booster.predict(flat, rows.length, ncol, PREDICT_CONTRIBUTIONS).values,
    );
  } finally {
    booster.dispose();
  }
}
