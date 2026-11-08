#!/usr/bin/env bash
# Rebuild vendor/lightgbm/lightgbm.mjs: the official LightGBM C library compiled to WebAssembly, one ES module with the wasm inside
# (docs/phases/55-ai-firewall/04-tree-models.md 4.3; D55-2). Reproducible from pinned inputs:
#
#   LightGBM  v4.7.0, the release's complete source tarball, sha256 below (GitHub lightgbm-org/LightGBM, commit 8f7036f0)
#   Emscripten 6.0.13 (emsdk), installed outside the repository
#
#   EMSDK=~/.cache/nb-toolchains/emsdk bash modules/ai_firewall/vendor/lightgbm/build.sh            # build and replace
#   EMSDK=~/.cache/nb-toolchains/emsdk bash modules/ai_firewall/vendor/lightgbm/build.sh --check    # build and compare the sha256
#
# Build choices: no OpenMP (single-threaded wasm), C++ exceptions as wasm exceptions (LightGBM's C API catches them), no CLI, the
# C API functions in EXPORTED_FUNCTIONS only, memory growth up to 2 GB (training on the build host), Node only, SINGLE_FILE so every
# bundle carries the wasm as code with no file to trace.
set -euo pipefail

LIGHTGBM_VERSION=4.7.0
LIGHTGBM_URL="https://github.com/lightgbm-org/LightGBM/releases/download/v${LIGHTGBM_VERSION}/LightGBM-complete_source_code_tar_gz.tar.gz"
LIGHTGBM_SHA256=cfcad32ac96e4683240d736f328d17f1471aae3e5049a669ebec540d64706915
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
curl -sSL -o "$WORK/src.tar.gz" "$LIGHTGBM_URL"
echo "${LIGHTGBM_SHA256}  $WORK/src.tar.gz" | sha256sum -c - >/dev/null
tar -xzf "$WORK/src.tar.gz" -C "$WORK/src"

# The temporary build path reaches the binary through __FILE__ (LightGBM's CHECK messages); map it to a fixed prefix so two builds
# are byte-identical. cmake runs inside $WORK so nothing is written next to this script.
FLAGS="-fwasm-exceptions -ffile-prefix-map=$WORK=/lightgbm"
(cd "$WORK" && emcmake cmake -S "$WORK/src" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DUSE_OPENMP=OFF -DBUILD_CLI=OFF \
  -DBUILD_STATIC_LIB=ON -DINSTALL_HEADERS=OFF -DCMAKE_CXX_FLAGS="$FLAGS" -DCMAKE_C_FLAGS="$FLAGS" >/dev/null)
emmake make -C "$WORK/build" -j"$(nproc)" >/dev/null

EXPORTS='_malloc,_free,_LGBM_GetLastError,_LGBM_BoosterLoadModelFromString,_LGBM_BoosterFree,_LGBM_BoosterGetNumClasses,_LGBM_BoosterGetNumFeature,_LGBM_BoosterGetCurrentIteration,_LGBM_BoosterCalcNumPredict,_LGBM_BoosterPredictForMat,_LGBM_BoosterSaveModelToString,_LGBM_DatasetCreateFromMat,_LGBM_DatasetSetField,_LGBM_DatasetFree,_LGBM_DatasetSetFeatureNames,_LGBM_BoosterCreate,_LGBM_BoosterUpdateOneIter,_LGBM_BoosterAddValidData,_LGBM_BoosterGetEvalCounts,_LGBM_BoosterGetEval'
em++ -O3 -fwasm-exceptions "$WORK/src/lib_lightgbm.a" "$WORK/build/external_libs/nanoarrow/libnanoarrow_static.a" -o "$WORK/lightgbm.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLightGbm -sENVIRONMENT=node -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB -sSTACK_SIZE=1MB \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPF64,HEAPF32,HEAP32,HEAPU8,getValue,setValue

NEW_SHA="$(sha256sum "$WORK/lightgbm.mjs" | cut -d' ' -f1)"
if [ "${1:-}" = "--check" ]; then
  OLD_SHA="$(sha256sum "$HERE/lightgbm.mjs" | cut -d' ' -f1)"
  [ "$NEW_SHA" = "$OLD_SHA" ] && { echo "lightgbm.mjs reproduces ($NEW_SHA)"; exit 0; }
  echo "lightgbm.mjs differs: built $NEW_SHA, vendored $OLD_SHA" >&2
  exit 1
fi
cp "$WORK/lightgbm.mjs" "$HERE/lightgbm.mjs"
cat > "$HERE/BUILD.json" <<EOF
{
  "library": "lightgbm",
  "version": "${LIGHTGBM_VERSION}",
  "source": "${LIGHTGBM_URL}",
  "sourceSha256": "${LIGHTGBM_SHA256}",
  "sourceCommit": "8f7036f03627054d5a54a6f965b13f4b9ff2cb63",
  "toolchain": "emscripten ${EMSCRIPTEN_VERSION}",
  "output": "lightgbm.mjs",
  "outputSha256": "${NEW_SHA}"
}
EOF
echo "wrote lightgbm.mjs ($NEW_SHA)"
