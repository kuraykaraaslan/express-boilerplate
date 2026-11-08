/**
 * Types of the Emscripten module in xgboost.mjs (built by build.sh). Only what the wrapper (server/engines/xgboost.wasm.ts) uses:
 * pointers are wasm32 numbers, `bst_ulong` (uint64_t) parameters are BigInt (WASM_BIGINT), every `XG*` returns 0 on success.
 */
export type Ptr = number;

export interface XgBoostModule {
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPU8: Uint8Array;
  UTF8ToString(ptr: Ptr, maxBytes?: number): string;
  stringToUTF8(text: string, ptr: Ptr, maxBytes: number): void;
  lengthBytesUTF8(text: string): number;
  getValue(ptr: Ptr, type: 'i32' | 'double' | 'float' | '*'): number;
  setValue(ptr: Ptr, value: number, type: 'i32' | 'double' | 'float' | '*'): void;
  _malloc(bytes: number): Ptr;
  _free(ptr: Ptr): void;
  _XGBGetLastError(): Ptr;
  _XGDMatrixCreateFromMat(data: Ptr, nrow: bigint, ncol: bigint, missing: number, out: Ptr): number;
  _XGDMatrixSetFloatInfo(handle: Ptr, field: Ptr, array: Ptr, len: bigint): number;
  _XGDMatrixSetStrFeatureInfo(handle: Ptr, field: Ptr, features: Ptr, size: bigint): number;
  _XGDMatrixFree(handle: Ptr): number;
  _XGBoosterCreate(dmats: Ptr, len: bigint, out: Ptr): number;
  _XGBoosterFree(handle: Ptr): number;
  _XGBoosterSetParam(handle: Ptr, name: Ptr, value: Ptr): number;
  _XGBoosterSetStrFeatureInfo(handle: Ptr, field: Ptr, features: Ptr, size: bigint): number;
  _XGBoosterUpdateOneIter(handle: Ptr, iter: number, dtrain: Ptr): number;
  _XGBoosterPredictFromDMatrix(handle: Ptr, dmat: Ptr, config: Ptr, outShape: Ptr, outDim: Ptr, outResult: Ptr): number;
  _XGBoosterSaveModelToBuffer(handle: Ptr, config: Ptr, outLen: Ptr, outDptr: Ptr): number;
  _XGBoosterLoadModelFromBuffer(handle: Ptr, buf: Ptr, len: bigint): number;
}

declare function createXgBoost(options?: Record<string, unknown>): Promise<XgBoostModule>;
export default createXgBoost;
