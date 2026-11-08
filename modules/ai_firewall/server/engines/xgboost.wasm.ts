/**
 * The official XGBoost 3.4.2 library, compiled to WebAssembly and vendored in the module (vendor/xgboost, D55-2): the reference the
 * TypeScript evaluator is checked against (04.3) and the trainer of the offline pipeline (04.1). The request path uses the
 * TypeScript evaluator.
 *
 * Thin wrapper over the C API: every call checks the return code (`XGBGetLastError` on failure), every allocation is freed in
 * `finally`, a booster's handle is freed by `dispose()`. XGBoost reads features as float32 (`XGDMatrixCreateFromMat`), with NaN as
 * missing.
 */
import createXgBoost, { type Ptr, type XgBoostModule } from '../../vendor/xgboost/xgboost.mjs';

export class XgBoostError extends Error {
  constructor(call: string, detail: string) {
    super(`${call}: ${detail}`);
    this.name = 'XgBoostError';
  }
}

/** `PredictionType` of `XGBoosterPredictFromDMatrix`: 0 value, 1 margin, 2 contributions. */
export const PREDICT_VALUE = 0;
export const PREDICT_MARGIN = 1;
export const PREDICT_CONTRIBUTIONS = 2;

let instance: Promise<XgBoost> | null = null;

/** The library, instantiated once per process. */
export function loadXgBoost(): Promise<XgBoost> {
  instance ??= createXgBoost().then((m) => new XgBoost(m));
  return instance;
}

export type XgTrainInput = {
  readonly data: ArrayLike<number>;
  readonly nrow: number;
  readonly ncol: number;
  readonly labels: ArrayLike<number>;
  /** Optional per-row weights (> 0): class weights for the imbalance times the label's confidence (04.1). */
  readonly weights?: ArrayLike<number>;
  /** Optional per-feature weights (> 0, ncol values): the column sampling's chance of each feature (4.11, `feature_weights`). */
  readonly featureWeights?: ArrayLike<number>;
  readonly featureNames: readonly string[];
  /** XGBoost parameters (`objective`, `max_depth`, …); `nthread=1` and `verbosity=0` are added. */
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly rounds: number;
};

export class XgBoost {
  constructor(private readonly m: XgBoostModule) {}

  /** @internal */ check(call: string, rc: number): void {
    if (rc !== 0) throw new XgBoostError(call, this.m.UTF8ToString(this.m._XGBGetLastError()));
  }

  /** @internal */ withString<T>(text: string, fn: (ptr: Ptr) => T): T {
    const bytes = this.m.lengthBytesUTF8(text) + 1;
    const ptr = this.m._malloc(bytes);
    try {
      this.m.stringToUTF8(text, ptr, bytes);
      return fn(ptr);
    } finally {
      this.m._free(ptr);
    }
  }

  /** @internal */ withSlot<T>(bytes: number, fn: (ptr: Ptr) => T): T {
    const ptr = this.m._malloc(bytes);
    try {
      this.m.HEAPU8.fill(0, ptr, ptr + bytes);
      return fn(ptr);
    } finally {
      this.m._free(ptr);
    }
  }

  /** @internal */ matrix<T>(rows: ArrayLike<number>, nrow: number, ncol: number, fn: (dmat: Ptr) => T): T {
    const { m } = this;
    if (rows.length !== nrow * ncol) throw new RangeError('rows must hold nrow * ncol values');
    const data = m._malloc(Math.max(4, rows.length * 4));
    try {
      m.HEAPF32.set(Float32Array.from(rows), data >> 2);
      const dmat = this.withSlot(4, (out) => {
        this.check('XGDMatrixCreateFromMat', m._XGDMatrixCreateFromMat(data, BigInt(nrow), BigInt(ncol), Number.NaN, out));
        return m.getValue(out, '*');
      });
      try {
        return fn(dmat);
      } finally {
        m._XGDMatrixFree(dmat);
      }
    } finally {
      m._free(data);
    }
  }

  private newBooster(dmats: Ptr[]): Ptr {
    const { m } = this;
    return this.withSlot(Math.max(4, dmats.length * 4), (array) => {
      dmats.forEach((d, i) => m.setValue(array + i * 4, d, '*'));
      return this.withSlot(4, (out) => {
        this.check('XGBoosterCreate', m._XGBoosterCreate(array, BigInt(dmats.length), out));
        return m.getValue(out, '*');
      });
    });
  }

  /** Loads a JSON model (`XGBoosterLoadModelFromBuffer`). */
  booster(modelJson: string): XgBooster {
    const { m } = this;
    const handle = this.newBooster([]);
    try {
      const bytes = new TextEncoder().encode(modelJson);
      const buf = m._malloc(Math.max(1, bytes.length));
      try {
        m.HEAPU8.set(bytes, buf);
        this.check('XGBoosterLoadModelFromBuffer', m._XGBoosterLoadModelFromBuffer(handle, buf, BigInt(bytes.length)));
      } finally {
        m._free(buf);
      }
      return new XgBooster(this, m, handle);
    } catch (err) {
      m._XGBoosterFree(handle);
      throw err;
    }
  }

  /** Trains a booster and returns its JSON model. */
  train(input: XgTrainInput): string {
    const { m } = this;
    if (input.labels.length !== input.nrow) throw new RangeError('labels must hold nrow values');
    if (input.featureNames.length !== input.ncol) throw new RangeError('featureNames must name every column');
    if (input.weights && input.weights.length !== input.nrow) throw new RangeError('weights must hold nrow values');
    if (input.featureWeights && input.featureWeights.length !== input.ncol) throw new RangeError('featureWeights must hold ncol values');
    return this.matrix(input.data, input.nrow, input.ncol, (dmat) => {
      const labels = m._malloc(input.nrow * 4);
      try {
        m.HEAPF32.set(Float32Array.from(input.labels), labels >> 2);
        this.withString('label', (f) => this.check('XGDMatrixSetFloatInfo', m._XGDMatrixSetFloatInfo(dmat, f, labels, BigInt(input.nrow))));
      } finally {
        m._free(labels);
      }
      if (input.weights) {
        const weights = m._malloc(input.nrow * 4);
        try {
          m.HEAPF32.set(Float32Array.from(input.weights), weights >> 2);
          this.withString('weight', (f) => this.check('XGDMatrixSetFloatInfo', m._XGDMatrixSetFloatInfo(dmat, f, weights, BigInt(input.nrow))));
        } finally {
          m._free(weights);
        }
      }
      if (input.featureWeights) {
        const fw = m._malloc(input.ncol * 4);
        try {
          m.HEAPF32.set(Float32Array.from(input.featureWeights), fw >> 2);
          this.withString('feature_weights', (f) => this.check('XGDMatrixSetFloatInfo', m._XGDMatrixSetFloatInfo(dmat, f, fw, BigInt(input.ncol))));
        } finally {
          m._free(fw);
        }
      }
      this.setFeatureNames(dmat, input.featureNames, 'matrix');
      const handle = this.newBooster([dmat]);
      const booster = new XgBooster(this, m, handle);
      try {
        // The saved model carries the booster's names, not the matrix's (the C API does not copy them).
        this.setFeatureNames(handle, input.featureNames, 'booster');
        for (const [k, v] of Object.entries({ nthread: 1, verbosity: 0, ...input.params })) {
          this.withString(k, (name) => this.withString(String(v), (value) => this.check(`XGBoosterSetParam(${k})`, m._XGBoosterSetParam(handle, name, value))));
        }
        for (let i = 0; i < input.rounds; i++) this.check('XGBoosterUpdateOneIter', m._XGBoosterUpdateOneIter(handle, i, dmat));
        return booster.modelJson();
      } finally {
        booster.dispose();
      }
    });
  }

  private setFeatureNames(target: Ptr, names: readonly string[], on: 'matrix' | 'booster'): void {
    const { m } = this;
    const pointers = names.map((n) => {
      const bytes = m.lengthBytesUTF8(n) + 1;
      const p = m._malloc(bytes);
      m.stringToUTF8(n, p, bytes);
      return p;
    });
    const array = m._malloc(Math.max(4, pointers.length * 4));
    try {
      pointers.forEach((p, i) => m.setValue(array + i * 4, p, '*'));
      this.withString('feature_name', (field) =>
        on === 'matrix'
          ? this.check('XGDMatrixSetStrFeatureInfo', m._XGDMatrixSetStrFeatureInfo(target, field, array, BigInt(names.length)))
          : this.check('XGBoosterSetStrFeatureInfo', m._XGBoosterSetStrFeatureInfo(target, field, array, BigInt(names.length))),
      );
    } finally {
      m._free(array);
      pointers.forEach((p) => m._free(p));
    }
  }
}

export class XgBooster {
  private handle: Ptr | null;

  constructor(
    private readonly lib: XgBoost,
    private readonly m: XgBoostModule,
    handle: Ptr,
  ) {
    this.handle = handle;
  }

  private get h(): Ptr {
    if (this.handle === null) throw new XgBoostError('booster', 'used after dispose()');
    return this.handle;
  }

  /**
   * `XGBoosterPredictFromDMatrix` over row-major rows (read as float32). Returns the values and their shape: `[nrow]` or
   * `[nrow, classes]` for values and margins, `[nrow, ncol + 1]` or `[nrow, classes, ncol + 1]` for contributions.
   */
  predict(rows: ArrayLike<number>, nrow: number, ncol: number, type: number): { values: Float64Array; shape: number[] } {
    const { m, lib } = this;
    return lib.matrix(rows, nrow, ncol, (dmat) =>
      lib.withString(JSON.stringify({ type, training: false, iteration_begin: 0, iteration_end: 0, strict_shape: false }), (config) =>
        lib.withSlot(4, (shapeOut) =>
          lib.withSlot(8, (dimOut) =>
            lib.withSlot(4, (resultOut) => {
              lib.check('XGBoosterPredictFromDMatrix', m._XGBoosterPredictFromDMatrix(this.h, dmat, config, shapeOut, dimOut, resultOut));
              const dim = m.getValue(dimOut, 'i32');
              const shapePtr = m.getValue(shapeOut, '*');
              // bst_ulong is uint64; shapes are far below 2^32, so the low word is the value.
              const shape = Array.from({ length: dim }, (_, i) => m.HEAPU32[(shapePtr >> 2) + i * 2]);
              const count = shape.reduce((a, b) => a * b, 1);
              const result = m.getValue(resultOut, '*');
              return { values: Float64Array.from(m.HEAPF32.subarray(result >> 2, (result >> 2) + count)), shape };
            }),
          ),
        ),
      ),
    );
  }

  /** The model as XGBoost writes it in JSON (`XGBoosterSaveModelToBuffer`, `{"format": "json"}`). */
  modelJson(): string {
    const { m, lib } = this;
    return lib.withString('{"format":"json"}', (config) =>
      lib.withSlot(8, (lenOut) =>
        lib.withSlot(4, (dataOut) => {
          lib.check('XGBoosterSaveModelToBuffer', m._XGBoosterSaveModelToBuffer(this.h, config, lenOut, dataOut));
          const len = m.getValue(lenOut, 'i32');
          const ptr = m.getValue(dataOut, '*');
          return new TextDecoder().decode(m.HEAPU8.subarray(ptr, ptr + len));
        }),
      ),
    );
  }

  dispose(): void {
    if (this.handle !== null) {
      this.m._XGBoosterFree(this.handle);
      this.handle = null;
    }
  }
}
