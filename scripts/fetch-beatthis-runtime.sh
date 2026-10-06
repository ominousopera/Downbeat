#!/bin/sh
# Vendors onnxruntime-web (WASM, CPU backend) for Downbeat's beat-position
# analysis (worker/beatthis-worker.js) and checks the Beat This! ONNX models
# in models/ against their pinned SHA-256.
#
# The WASM build is used, not the native onnxruntime-node addon, so one
# artifact serves all platforms.
#
# The version is pinned via the committed package.json / package-lock.json in
# scripts/beatthis-runtime-src/, so re-running resolves the same dependency
# tree (the lockfile is what is pinned and reviewed; versions are never
# updated automatically). `npm ci` verifies each package's
# integrity against the lockfile's recorded hashes. Only the files the
# runtime needs are copied out of node_modules/ into runtime/onnxruntime-web/:
# onnxruntime-web's own node_modules is large (it includes @types/node,
# TypeScript-only undici-types and every WASM backend variant -
# WebGPU/JSEP/JSPI/asyncify - that this offline CPU-only Node subprocess does
# not use).
#
# License: MIT (CPJKU/beat_this, Institute of Computational Perception, JKU
# Linz; see NOTICE.md).

set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$HERE/scripts/beatthis-runtime-src"
ORT_OUT_DIR="$HERE/runtime/onnxruntime-web"
MODELS_OUT_DIR="$HERE/models"

MEL_MODEL_SHA256="fdd59e65c515331308e4c8841edf99972deca646bdf6197744c2a5b7755e3de9"
BEAT_MODEL_INT8_SHA256="0869fcdfa66fcdecb7af5d0022d3c3fadc55c07f69f16febdcac681531676751"

# --- onnxruntime-web (WASM) + its transitive dependencies ---
if [ -d "$ORT_OUT_DIR/node_modules/onnxruntime-web" ]; then
  echo "Already present, skipping onnxruntime-web: $ORT_OUT_DIR/node_modules"
  echo "  (delete it and re-run to force a re-fetch)"
else
  if [ ! -f "$SRC_DIR/package-lock.json" ]; then
    echo "Missing $SRC_DIR/package-lock.json - it ships with the repository; restore it."
    exit 1
  fi
  echo "Running 'npm ci' in $SRC_DIR (pinned by its committed package-lock.json)..."
  ( cd "$SRC_DIR" && npm ci --no-audit --no-fund )

  echo "Trimming and vendoring into $ORT_OUT_DIR ..."
  rm -rf "$ORT_OUT_DIR/node_modules"
  mkdir -p "$ORT_OUT_DIR/node_modules"
  for pkg in onnxruntime-web onnxruntime-common protobufjs flatbuffers @protobufjs long platform guid-typescript; do
    if [ -d "$SRC_DIR/node_modules/$pkg" ]; then
      mkdir -p "$ORT_OUT_DIR/node_modules/$(dirname "$pkg")"
      cp -R "$SRC_DIR/node_modules/$pkg" "$ORT_OUT_DIR/node_modules/$pkg"
    fi
  done
  # Trim onnxruntime-web's own dist/ down to the plain CPU Node entry + its
  # wasm binary; the WebGPU/JSEP/JSPI/asyncify variants and browser bundles
  # are not used by this offline Node subprocess.
  ORT_DIST="$ORT_OUT_DIR/node_modules/onnxruntime-web/dist"
  if [ -d "$ORT_DIST" ]; then
    KEEP="$(mktemp -d)"
    for f in ort.node.min.js ort.node.min.js.map ort-wasm-simd-threaded.wasm ort-wasm-simd-threaded.mjs; do
      [ -f "$ORT_DIST/$f" ] && cp "$ORT_DIST/$f" "$KEEP/"
    done
    rm -rf "$ORT_DIST"
    mkdir -p "$ORT_DIST"
    cp "$KEEP"/* "$ORT_DIST/"
    rm -rf "$KEEP"
  fi
  echo "  -> $ORT_OUT_DIR/node_modules/onnxruntime-web (trimmed)"
fi

# --- Beat This! model weights ---
mkdir -p "$MODELS_OUT_DIR"

verify_model() {
  NAME="$1"
  EXPECTED_SHA="$2"
  FILE="$MODELS_OUT_DIR/$NAME"
  if [ ! -f "$FILE" ]; then
    echo "Missing $FILE - restore it from the repository."
    exit 1
  fi
  ACTUAL_SHA="$(shasum -a 256 "$FILE" | awk '{print $1}')"
  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    echo "$FILE does not match its pinned SHA-256 - restore it from the repository."
    echo "  expected: $EXPECTED_SHA"
    echo "  actual:   $ACTUAL_SHA"
    exit 1
  fi
  echo "  ok: $FILE"
}

verify_model "mel_spectrogram.onnx" "$MEL_MODEL_SHA256"
# The destination file name is fixed by the model path in
# worker/beatthis-worker.js; the file is the int8 export.
verify_model "beat_this_own_export.onnx" "$BEAT_MODEL_INT8_SHA256"

echo ""
echo "Done."
du -sh "$ORT_OUT_DIR" "$MODELS_OUT_DIR"
