#!/usr/bin/env bash
# Rebuild vendor/xgboost/xgboost.mjs: the official XGBoost C library compiled to WebAssembly, one ES module with the wasm inside
# (docs/phases/55-ai-firewall/04-tree-models.md 4.3; D55-2). Reproducible from pinned inputs:
#
#   XGBoost   v3.4.2, the release's source tarball (with dmlc-core), sha256 below (GitHub dmlc/xgboost)
#   Emscripten 6.0.13 (emsdk), installed outside the repository
#
#   EMSDK=~/.cache/nb-toolchains/emsdk bash modules/ai_firewall/vendor/xgboost/build.sh            # build and replace
#   EMSDK=~/.cache/nb-toolchains/emsdk bash modules/ai_firewall/vendor/xgboost/build.sh --check    # build and compare the sha256
#
# Build choices: no OpenMP (single-threaded wasm), C++ exceptions as wasm exceptions, the C API functions in EXPORTED_FUNCTIONS
# only, Node only, SINGLE_FILE. XGBoost assumes a 64-bit size_t in a few brace initialisers; `-Wno-c++11-narrowing` lets wasm32
# compile them (values stay far below 2^32 at the firewall's sizes; the parity tests are the proof).
set -euo pipefail

XGBOOST_VERSION=3.4.2
XGBOOST_URL="https://github.com/dmlc/xgboost/releases/download/v${XGBOOST_VERSION}/xgboost-src-${XGBOOST_VERSION}.tar.gz"
XGBOOST_SHA256=d7de76bdaf48e9e0bc84b27c0c42f15f3d831e624d102d6c019bab7027b3cabd
EMSCRIPTEN_VERSION=6.0.13

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMSDK="${EMSDK:-$HOME/.cache/nb-toolchains/emsdk}"
[ -f "$EMSDK/emsdk_env.sh" ] || { echo "emsdk not found at $EMSDK (install ${EMSCRIPTEN_VERSION}: ./emsdk install ${EMSCRIPTEN_VERSION} && ./emsdk activate ${EMSCRIPTEN_VERSION})" >&2; exit 1; }
# shellcheck disable=SC1091
. "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
emcc --version | head -1 | grep -q " ${EMSCRIPTEN_VERSION} " || { echo "Emscripten ${EMSCRIPTEN_VERSION} is required" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/src"
curl -sSL -o "$WORK/src.tar.gz" "$XGBOOST_URL"
echo "${XGBOOST_SHA256}  $WORK/src.tar.gz" | sha256sum -c - >/dev/null
tar -xzf "$WORK/src.tar.gz" -C "$WORK/src"

# The temporary build path reaches the binary through __FILE__ (dmlc CHECK messages); map it to a fixed prefix.
FLAGS="-fwasm-exceptions -Wno-c++11-narrowing -ffile-prefix-map=$WORK=/xgboost"
(cd "$WORK" && emcmake cmake -S "$WORK/src/xgboost" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DUSE_OPENMP=OFF \
  -DBUILD_STATIC_LIB=ON -DADD_PKGCONFIG=OFF -DCMAKE_CXX_FLAGS="$FLAGS" -DCMAKE_C_FLAGS="$FLAGS" >/dev/null)
emmake make -C "$WORK/build" -j"$(nproc)" >/dev/null 2>&1

EXPORTS='_malloc,_free,_XGBGetLastError,_XGDMatrixCreateFromMat,_XGDMatrixSetFloatInfo,_XGDMatrixSetStrFeatureInfo,_XGDMatrixFree,_XGBoosterCreate,_XGBoosterFree,_XGBoosterSetParam,_XGBoosterSetStrFeatureInfo,_XGBoosterUpdateOneIter,_XGBoosterPredictFromDMatrix,_XGBoosterSaveModelToBuffer,_XGBoosterLoadModelFromBuffer'
em++ -O3 -fwasm-exceptions "$WORK/src/xgboost/lib/libxgboost.a" "$WORK/build/dmlc-core/libdmlc.a" -o "$WORK/xgboost.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createXgBoost -sENVIRONMENT=node -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB -sSTACK_SIZE=2MB \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPF64,HEAPF32,HEAP32,HEAPU32,HEAPU8,getValue,setValue 2>/dev/null

NEW_SHA="$(sha256sum "$WORK/xgboost.mjs" | cut -d' ' -f1)"
if [ "${1:-}" = "--check" ]; then
  OLD_SHA="$(sha256sum "$HERE/xgboost.mjs" | cut -d' ' -f1)"
  [ "$NEW_SHA" = "$OLD_SHA" ] && { echo "xgboost.mjs reproduces ($NEW_SHA)"; exit 0; }
  echo "xgboost.mjs differs: built $NEW_SHA, vendored $OLD_SHA" >&2
  exit 1
fi
cp "$WORK/xgboost.mjs" "$HERE/xgboost.mjs"
cat > "$HERE/BUILD.json" <<JSON
{
  "library": "xgboost",
  "version": "${XGBOOST_VERSION}",
  "source": "${XGBOOST_URL}",
  "sourceSha256": "${XGBOOST_SHA256}",
  "toolchain": "emscripten ${EMSCRIPTEN_VERSION}",
  "output": "xgboost.mjs",
  "outputSha256": "${NEW_SHA}"
}
JSON
echo "wrote xgboost.mjs ($NEW_SHA)"
