/**
 * The official LightGBM 4.7.0 library, compiled to WebAssembly and vendored in the module (vendor/lightgbm, D55-2). It is the
 * reference the TypeScript evaluator is checked against (04.3: parity on every shipped model, in CI, no Python) and the trainer of
 * the offline pipeline (04.1). The request path uses the TypeScript evaluator: it needs no wasm instance and no memory management.
 *
 * Thin wrapper over the C API: every call checks the return code and turns a failure into `LightGbmError` with
 * `LGBM_GetLastError()`; every allocation is freed in `finally`; a booster's handle is freed by `dispose()`.
 */
import createLightGbm, { type LightGbmModule, type Ptr } from '../../vendor/lightgbm/lightgbm.mjs';

/** `C_API_DTYPE_*` and `C_API_PREDICT_*` in LightGBM's c_api.h. */
const DTYPE_FLOAT32 = 0;
const DTYPE_FLOAT64 = 1;
export const PREDICT_NORMAL = 0;
export const PREDICT_RAW_SCORE = 1;
export const PREDICT_CONTRIB = 3;

export class LightGbmError extends Error {
  constructor(call: string, detail: string) {
    super(`${call}: ${detail}`);
    this.name = 'LightGbmError';
  }
}

let instance: Promise<LightGbm> | null = null;

/** The library, instantiated once per process. */
export function loadLightGbm(): Promise<LightGbm> {
  instance ??= createLightGbm().then((m) => new LightGbm(m));
  return instance;
}

export type TrainInput = {
  /** Row-major features, `nrow * ncol` values (NaN for missing). */
  readonly data: ArrayLike<number>;
  readonly nrow: number;
  readonly ncol: number;
  readonly labels: ArrayLike<number>;
  /** Optional per-row weights (> 0): class weights for the imbalance times the label's confidence (04.1). */
  readonly weights?: ArrayLike<number>;
  readonly featureNames: readonly string[];
  /** LightGBM parameters (`objective`, `num_leaves`, …); `verbose=-1` is added. */
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly rounds: number;
};

export class LightGbm {
  constructor(private readonly m: LightGbmModule) {}

  private check(call: string, rc: number): void {
    if (rc !== 0) throw new LightGbmError(call, this.m.UTF8ToString(this.m._LGBM_GetLastError()));
  }

  private withString<T>(text: string, fn: (ptr: Ptr) => T): T {
    const bytes = this.m.lengthBytesUTF8(text) + 1;
    const ptr = this.m._malloc(bytes);
    try {
      this.m.stringToUTF8(text, ptr, bytes);
      return fn(ptr);
    } finally {
      this.m._free(ptr);
    }
  }

  private withDoubles<T>(values: ArrayLike<number>, fn: (ptr: Ptr) => T): T {
    const ptr = this.m._malloc(Math.max(8, values.length * 8));
    try {
      this.m.HEAPF64.set(values instanceof Float64Array ? values : Float64Array.from(values), ptr >> 3);
      return fn(ptr);
    } finally {
      this.m._free(ptr);
    }
  }

  private withSlot<T>(bytes: number, fn: (ptr: Ptr) => T): T {
    const ptr = this.m._malloc(bytes);
    try {
      this.m.HEAPU8.fill(0, ptr, ptr + bytes);
      return fn(ptr);
    } finally {
      this.m._free(ptr);
    }
  }

  /** Loads a text model (`LGBM_BoosterLoadModelFromString`). */
  booster(modelText: string): WasmBooster {
    const handle = this.withString(modelText, (str) =>
      this.withSlot(4, (iters) =>
        this.withSlot(4, (out) => {
          this.check('LGBM_BoosterLoadModelFromString', this.m._LGBM_BoosterLoadModelFromString(str, iters, out));
          return this.m.getValue(out, '*');
        }),
      ),
    );
    return new WasmBooster(this, this.m, handle);
  }

  /** Trains a booster and returns its text model (`LGBM_DatasetCreateFromMat`, `LGBM_BoosterCreate`, `UpdateOneIter`). */
  train(input: TrainInput): string {
    const { m } = this;
    if (input.data.length !== input.nrow * input.ncol) throw new RangeError('data must hold nrow * ncol values');
    if (input.labels.length !== input.nrow) throw new RangeError('labels must hold nrow values');
    if (input.featureNames.length !== input.ncol) throw new RangeError('featureNames must name every column');
    if (input.weights && input.weights.length !== input.nrow) throw new RangeError('weights must hold nrow values');
    const params = Object.entries({ verbose: -1, ...input.params })
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    const dataset = this.withDoubles(input.data, (data) =>
      this.withString(params, (p) =>
        this.withSlot(4, (out) => {
          this.check('LGBM_DatasetCreateFromMat', m._LGBM_DatasetCreateFromMat(data, DTYPE_FLOAT64, input.nrow, input.ncol, 1, p, 0, out));
          return m.getValue(out, '*');
        }),
      ),
    );
    try {
      const labels = m._malloc(input.nrow * 4);
      try {
        m.HEAPF32.set(Float32Array.from(input.labels), labels >> 2);
        this.withString('label', (name) => this.check('LGBM_DatasetSetField', m._LGBM_DatasetSetField(dataset, name, labels, input.nrow, DTYPE_FLOAT32)));
      } finally {
        m._free(labels);
      }
      if (input.weights) this.setFloatField(dataset, 'weight', input.weights);
      this.setFeatureNames(dataset, input.featureNames);
      const booster = this.withString(params, (p) =>
        this.withSlot(4, (out) => {
          this.check('LGBM_BoosterCreate', m._LGBM_BoosterCreate(dataset, p, out));
          return m.getValue(out, '*');
        }),
      );
      const wrapped = new WasmBooster(this, m, booster);
      try {
        this.withSlot(4, (finished) => {
          for (let i = 0; i < input.rounds; i++) {
            this.check('LGBM_BoosterUpdateOneIter', m._LGBM_BoosterUpdateOneIter(booster, finished));
            if (m.getValue(finished, 'i32') !== 0) break;
          }
        });
        return wrapped.modelText();
      } finally {
        wrapped.dispose();
      }
    } finally {
      m._LGBM_DatasetFree(dataset);
    }
  }

  private setFloatField(dataset: Ptr, field: string, values: ArrayLike<number>): void {
    const { m } = this;
    const ptr = m._malloc(Math.max(4, values.length * 4));
    try {
      m.HEAPF32.set(Float32Array.from(values), ptr >> 2);
      this.withString(field, (name) => this.check('LGBM_DatasetSetField', m._LGBM_DatasetSetField(dataset, name, ptr, values.length, DTYPE_FLOAT32)));
    } finally {
      m._free(ptr);
    }
  }

  private setFeatureNames(dataset: Ptr, names: readonly string[]): void {
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
      this.check('LGBM_DatasetSetFeatureNames', m._LGBM_DatasetSetFeatureNames(dataset, array, names.length));
    } finally {
      m._free(array);
      pointers.forEach((p) => m._free(p));
    }
  }

  /** @internal */ checkCall(call: string, rc: number): void {
    this.check(call, rc);
  }
  /** @internal */ doubles<T>(values: ArrayLike<number>, fn: (ptr: Ptr) => T): T {
    return this.withDoubles(values, fn);
  }
  /** @internal */ slot<T>(bytes: number, fn: (ptr: Ptr) => T): T {
    return this.withSlot(bytes, fn);
  }
  /** @internal */ string<T>(text: string, fn: (ptr: Ptr) => T): T {
    return this.withString(text, fn);
  }
}

export class WasmBooster {
  private handle: Ptr | null;

  constructor(
    private readonly lib: LightGbm,
    private readonly m: LightGbmModule,
    handle: Ptr,
  ) {
    this.handle = handle;
  }

  private get h(): Ptr {
    if (this.handle === null) throw new LightGbmError('booster', 'used after dispose()');
    return this.handle;
  }

  private intOut(call: string, fn: (out: Ptr) => number): number {
    return this.lib.slot(4, (out) => {
      this.lib.checkCall(call, fn(out));
      return this.m.getValue(out, 'i32');
    });
  }

  get numFeatures(): number {
    return this.intOut('LGBM_BoosterGetNumFeature', (out) => this.m._LGBM_BoosterGetNumFeature(this.h, out));
  }

  get numClasses(): number {
    return this.intOut('LGBM_BoosterGetNumClasses', (out) => this.m._LGBM_BoosterGetNumClasses(this.h, out));
  }

  /**
   * `LGBM_BoosterPredictForMat` over row-major float64 rows. Returns `nrow * width` values: width 1 per output for normal and raw
   * scores, `outputs * (ncol + 1)` for contributions (per output: the features, then the bias).
   */
  predict(rows: ArrayLike<number>, nrow: number, ncol: number, predictType: number): Float64Array {
    const { m } = this;
    const outputs = Math.max(1, this.numClasses);
    const width = predictType === PREDICT_CONTRIB ? outputs * (ncol + 1) : outputs;
    return this.lib.doubles(rows, (data) =>
      this.lib.string('', (param) =>
        this.lib.slot(8, (outLen) =>
          this.lib.slot(nrow * width * 8, (result) => {
            this.lib.checkCall(
              'LGBM_BoosterPredictForMat',
              m._LGBM_BoosterPredictForMat(this.h, data, DTYPE_FLOAT64, nrow, ncol, 1, predictType, 0, -1, param, outLen, result),
            );
            const len = m.getValue(outLen, 'i32');
            if (len !== nrow * width) throw new LightGbmError('LGBM_BoosterPredictForMat', `returned ${len} values, expected ${nrow * width}`);
            return Float64Array.from(m.HEAPF64.subarray(result >> 3, (result >> 3) + len));
          }),
        ),
      ),
    );
  }

  /** The model as LightGBM writes it (`LGBM_BoosterSaveModelToString`, all iterations, split importance). */
  modelText(): string {
    const { m } = this;
    return this.lib.slot(8, (outLen) => {
      let size = 1 << 20;
      for (;;) {
        const text = this.lib.slot(size, (buffer) => {
          this.lib.checkCall('LGBM_BoosterSaveModelToString', m._LGBM_BoosterSaveModelToString(this.h, 0, -1, 0, BigInt(size), outLen, buffer));
          const needed = m.getValue(outLen, 'i32');
          return needed <= size ? m.UTF8ToString(buffer) : null;
        });
        if (text !== null) return text;
        size = m.getValue(outLen, 'i32');
      }
    });
  }

  dispose(): void {
    if (this.handle !== null) {
      this.m._LGBM_BoosterFree(this.handle);
      this.handle = null;
    }
  }
}
