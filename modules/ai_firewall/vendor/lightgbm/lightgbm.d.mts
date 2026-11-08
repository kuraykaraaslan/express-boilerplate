/**
 * Types of the Emscripten module in lightgbm.mjs (built by build.sh). Only what the wrapper (server/engines/lightgbm.wasm.ts) uses:
 * pointers are wasm32 numbers, `int64_t` parameters are BigInt (WASM_BIGINT), every `LGBM_*` returns 0 on success.
 */
export type Ptr = number;

export interface LightGbmModule {
  HEAPF64: Float64Array;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  UTF8ToString(ptr: Ptr): string;
  stringToUTF8(text: string, ptr: Ptr, maxBytes: number): void;
  lengthBytesUTF8(text: string): number;
  getValue(ptr: Ptr, type: 'i32' | 'double' | 'float' | '*'): number;
  setValue(ptr: Ptr, value: number, type: 'i32' | 'double' | 'float' | '*'): void;
  _malloc(bytes: number): Ptr;
  _free(ptr: Ptr): void;
  _LGBM_GetLastError(): Ptr;
  _LGBM_BoosterLoadModelFromString(modelStr: Ptr, outNumIterations: Ptr, outHandle: Ptr): number;
  _LGBM_BoosterFree(handle: Ptr): number;
  _LGBM_BoosterGetNumClasses(handle: Ptr, outLen: Ptr): number;
  _LGBM_BoosterGetNumFeature(handle: Ptr, outLen: Ptr): number;
  _LGBM_BoosterGetCurrentIteration(handle: Ptr, outIteration: Ptr): number;
  _LGBM_BoosterCalcNumPredict(handle: Ptr, numRow: number, predictType: number, startIteration: number, numIteration: number, outLen: Ptr): number;
  _LGBM_BoosterPredictForMat(
    handle: Ptr, data: Ptr, dataType: number, nrow: number, ncol: number, isRowMajor: number, predictType: number,
    startIteration: number, numIteration: number, parameter: Ptr, outLen: Ptr, outResult: Ptr,
  ): number;
  _LGBM_BoosterSaveModelToString(
    handle: Ptr, startIteration: number, numIteration: number, featureImportanceType: number, bufferLen: bigint, outLen: Ptr, outStr: Ptr,
  ): number;
  _LGBM_DatasetCreateFromMat(data: Ptr, dataType: number, nrow: number, ncol: number, isRowMajor: number, parameters: Ptr, reference: Ptr, out: Ptr): number;
  _LGBM_DatasetSetField(handle: Ptr, fieldName: Ptr, fieldData: Ptr, numElement: number, type: number): number;
  _LGBM_DatasetFree(handle: Ptr): number;
  _LGBM_DatasetSetFeatureNames(handle: Ptr, featureNames: Ptr, numFeatureNames: number): number;
  _LGBM_BoosterCreate(trainData: Ptr, parameters: Ptr, out: Ptr): number;
  _LGBM_BoosterUpdateOneIter(handle: Ptr, isFinished: Ptr): number;
  _LGBM_BoosterAddValidData(handle: Ptr, validData: Ptr): number;
  _LGBM_BoosterGetEvalCounts(handle: Ptr, outLen: Ptr): number;
  _LGBM_BoosterGetEval(handle: Ptr, dataIdx: number, outLen: Ptr, outResults: Ptr): number;
}

declare function createLightGbm(options?: Record<string, unknown>): Promise<LightGbmModule>;
export default createLightGbm;
