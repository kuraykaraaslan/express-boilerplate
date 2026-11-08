/**
 * The holdout split by time, not at random (docs/phases/55-ai-firewall/04-tree-models.md 4.1, D55-100): rows are ordered by the hour
 * their behaviour happened (the export's `hour`, truncated to the UTC hour), and the newest hours are held out. One hour never straddles
 * two parts, so a burst of rows from one hour (a probe run's minute, one actor's session) is never half trained on and half scored.
 *
 *   train        the oldest hours (default 70 % of the rows)        the trees are fitted here
 *   calibration  the next hours  (default 15 %)                     early stopping and the thresholds for the 4.7 targets
 *   test         the newest hours (default 15 %)                    the reported metrics and the independence report (4.4)
 *
 * The calibration and test slices together are the time holdout; the thresholds are never chosen on the rows the metrics are reported on.
 */

export type SplitFractions = { readonly train: number; readonly calibration: number };
export const DEFAULT_SPLIT: SplitFractions = { train: 0.7, calibration: 0.15 };

export type SplitPart<T> = { readonly rows: T[]; readonly from: string | null; readonly to: string | null };
export type TimeSplit<T> = { readonly train: SplitPart<T>; readonly calibration: SplitPart<T>; readonly test: SplitPart<T> };

export class SplitRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SplitRefusedError';
  }
}

const part = <T extends { hour: string }>(rows: T[]): SplitPart<T> => ({ rows, from: rows[0]?.hour ?? null, to: rows.at(-1)?.hour ?? null });

/**
 * Splits rows by hour (pure; the input order is irrelevant, the output keeps each part in time order). The calibration part starts at
 * the first hour before which at least `train` of the rows lie, the test part at the first hour before which at least
 * `train + calibration` lie; every part gets at least one hour. Refused with fewer than three distinct hours.
 */
export function timeSplit<T extends { hour: string }>(rows: readonly T[], fractions: SplitFractions = DEFAULT_SPLIT): TimeSplit<T> {
  const { train, calibration } = fractions;
  if (!(train > 0 && calibration > 0 && train + calibration < 1)) throw new SplitRefusedError('split fractions must be positive and leave a test part');
  const sorted = [...rows].sort((a, b) => (a.hour < b.hour ? -1 : a.hour > b.hour ? 1 : 0));
  const hours: string[] = [];
  const before: number[] = []; // rows before each distinct hour
  sorted.forEach((r, i) => {
    if (hours.at(-1) !== r.hour) { hours.push(r.hour); before.push(i); }
  });
  if (hours.length < 3) throw new SplitRefusedError(`the rows span ${hours.length} hour(s): a time split needs at least three`);
  const n = sorted.length;
  const firstAt = (share: number, min: number, max: number) => {
    let h = min;
    while (h < max && before[h] < share * n) h++;
    return h;
  };
  // The calibration part starts no later than the second-to-last hour, the test part after it and no later than the last.
  const c = firstAt(train, 1, hours.length - 2);
  const t = firstAt(train + calibration, c + 1, hours.length - 1);
  const cAt = before[c];
  const tAt = before[t];
  return { train: part(sorted.slice(0, cAt)), calibration: part(sorted.slice(cAt, tAt)), test: part(sorted.slice(tAt)) };
}
