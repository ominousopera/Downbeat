#!/bin/sh
# Builds self-signed, installable packages for Downbeat into ../zxp-build/ (a
# separate top-level folder, not inside the plugin source tree): one .zxp for
# Mac and one for Windows.
#
# Adobe's signing guide (Adobe-CEP/Getting-Started-guides, "Package
# Distribute Install") lists "Signature valid -> Extension runs normally" and
# offers self-signing via ZXPSignCmd as a normal option. What breaks a signed
# install is any change to its files after signing; that is why the plugin
# keeps its data in Documents/Downbeat/ (js/persistence.js) and why this
# script verifies the finished package below.
#
# Signing tool: Adobe's ZXPSignCmd. Its path goes in scripts/build.local.sh
# (ZXPSIGNCMD="..."), which is not in git, or in the ZXPSIGNCMD environment
# variable, or on the PATH.
#
# Source comments ship by default; STRIP_COMMENTS=1 builds a copy without code
# comments (see the strip step below).
#
# Only the files that ship are staged (CSXS/, assets/, index.html, css/, js/,
# jsx/, worker/, runtime/, models/, plus LICENSE, NOTICE.md and GUIDE.md for
# the Settings buttons) into a clean temp folder before signing. worker/ holds
# the essentia.js subprocess and the Beat This! subprocess
# (worker/beatthis-worker.js); js/bridge.js spawns them by full path rather
# than through a <script> tag, but they are runtime dependencies. runtime/ is
# the bundled Node.js binaries and onnxruntime-web (WASM) those subprocesses
# run under (see NOTICE.md, scripts/fetch-node-runtime.sh,
# scripts/fetch-beatthis-runtime.sh); models/ holds the ONNX weights. Signing
# the source folder directly would also ship scripts/ and the dev docs.
#
# A dev symlink install (scripts/dev-install.sh) is fine for development but
# not for a build that gets installed elsewhere. This script refuses to run
# while the dev symlink is present; use dev-uninstall.sh first.

set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NAME="Downbeat"
OUT_DIR="$ROOT/zxp-build"
EXT_ID="com.downbeat.pro"
SYMLINK_PATH="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"
# Where ZXPSignCmd is: $ZXPSIGNCMD, else scripts/build.local.sh (not in git -
# machine-specific paths stay out of the published source), else the PATH.
if [ -f "$HERE/scripts/build.local.sh" ]; then
  . "$HERE/scripts/build.local.sh"
fi
ZXPSIGNCMD="${ZXPSIGNCMD:-$(command -v ZXPSignCmd || true)}"
# Its password is made at random when the certificate is made and kept next to
# it in zxp-build/ (outside git), never in this script. Losing both only means
# a new certificate: nothing checks that versions share one.
CERT="$OUT_DIR/downbeat-selfsigned.p12"
CERT_PASSWORD_FILE="$OUT_DIR/downbeat-selfsigned.password"

if [ -z "$ZXPSIGNCMD" ] || [ ! -x "$ZXPSIGNCMD" ]; then
  echo "ZXPSignCmd not found at:"
  echo "  $ZXPSIGNCMD"
  echo "See this script's header comment for where to get it."
  exit 1
fi

# Pre-build checks: each one catches a defect that would still sign and
# install but leave a blank or half-working panel.
echo "Running pre-build checks..."

python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse(sys.argv[1])" "$HERE/CSXS/manifest.xml" \
  || { echo "CSXS/manifest.xml is not well-formed XML - not building"; exit 1; }
echo "  manifest XML valid"

# Every local file index.html points at must exist - a missing <script src> is
# a blank panel.
MISSING=0
for REF in $(grep -oE '(src|href)="[^"#:]+"' "$HERE/index.html" | sed -E 's/^(src|href)="(\.\/)?//;s/"$//'); do
  if [ ! -f "$HERE/$REF" ]; then
    echo "  index.html references a missing file: $REF"
    MISSING=1
  fi
done
[ "$MISSING" = "0" ] || { echo "not building"; exit 1; }
echo "  index.html references resolve"

# Every element id the panel's scripts look up exists in the markup, and the
# hidden attribute is enforced globally.
python3 "$HERE/scripts/check-dom-ids.py" || { echo "not building"; exit 1; }

# Code checks (scripts/check-code.js): whitespace, a header comment per
# script, no undeclared names in the panel scripts, and every module main.js
# makes getting exactly the ctx keys it reads.
node "$HERE/scripts/check-code.js" || { echo "not building"; exit 1; }

SYNTAX_TMP="$(mktemp -d)"
for JSFILE in "$HERE"/js/*.js "$HERE"/worker/*.js; do
  node --check "$JSFILE" 2>/dev/null \
    || { echo "  $(basename "$JSFILE") has a syntax error - not building"; rm -rf "$SYNTAX_TMP"; exit 1; }
done
for JSXFILE in "$HERE"/jsx/*.jsx "$HERE"/jsx/*.js; do
  [ -f "$JSXFILE" ] || continue
  grep -v '^#include' "$JSXFILE" > "$SYNTAX_TMP/check.js"
  node --check "$SYNTAX_TMP/check.js" 2>/dev/null \
    || { echo "  $(basename "$JSXFILE") has a syntax error - not building"; rm -rf "$SYNTAX_TMP"; exit 1; }
done
rm -rf "$SYNTAX_TMP"
echo "  all scripts parse"

# init() actually runs to its last line, Delete my data removes only the
# plugin's own files, and booting writes nothing into the extension folder.
node "$HERE/scripts/test-panel-boot.js" > /dev/null 2>&1 \
  || { echo "  panel boot test FAILED - run: node scripts/test-panel-boot.js"; exit 1; }
echo "  panel boots"

node "$HERE/scripts/test-host-ae.js" > /dev/null 2>&1 \
  || { echo "  After Effects host test FAILED - run: node scripts/test-host-ae.js"; exit 1; }
node "$HERE/scripts/test-marker-replace.js" > /dev/null 2>&1 \
  || { echo "  marker replace test FAILED - run: node scripts/test-marker-replace.js"; exit 1; }
node "$HERE/scripts/test-frame-snap.js" > /dev/null 2>&1 \
  || { echo "  frame snap test FAILED - run: node scripts/test-frame-snap.js"; exit 1; }
node "$HERE/scripts/test-even-out.js" > /dev/null 2>&1 \
  || { echo "  even-out test FAILED - run: node scripts/test-even-out.js"; exit 1; }
node "$HERE/scripts/test-lib-preview.js" > /dev/null 2>&1 \
  || { echo "  Library preview pane test FAILED - run: node scripts/test-lib-preview.js"; exit 1; }
echo "  host and marker tests passed"

node "$HERE/scripts/test-pitch.js" > /dev/null 2>&1 \
  || { echo "  pitch calculator tests FAILED - run: node scripts/test-pitch.js"; exit 1; }
echo "  pitch calculator tests passed"

node "$HERE/scripts/test-worker-smoke.js" > /dev/null 2>&1 \
  || { echo "  worker smoke test FAILED - run: node scripts/test-worker-smoke.js"; exit 1; }
node "$HERE/scripts/test-beat-merge.js" > /dev/null 2>&1 \
  || { echo "  Beat This! beat merge test FAILED - run: node scripts/test-beat-merge.js"; exit 1; }
echo "  analysis worker starts and answers"

# A real Analyze through the real workers on two local test tracks; skips
# when ffmpeg or the tracks are missing (see scripts/test-tracks.js).
node "$HERE/scripts/test-analyze-pipeline.js" > /dev/null 2>&1 \
  || { echo "  Analyze pipeline test FAILED - run: node scripts/test-analyze-pipeline.js"; exit 1; }
echo "  Analyze pipeline (essentia + Beat This!) end to end"

# Library and audio-reading tests: file-name tags, WAV/AIFF fallback, Insert
# through the real host scripts, the whole Library tab end to end, S-KEY, SFX
# pitch gate, search, searchable dropdowns. Tests that need ffmpeg and the
# local test tracks skip without them.
node "$HERE/scripts/test-name-tags.js" > /dev/null 2>&1 \
  || { echo "  file-name key/BPM test FAILED - run: node scripts/test-name-tags.js"; exit 1; }
node "$HERE/scripts/test-audio-fallback.js" > /dev/null 2>&1 \
  || { echo "  AIFF / WAV fallback test FAILED - run: node scripts/test-audio-fallback.js"; exit 1; }
node "$HERE/scripts/test-wav-excerpt.js" > /dev/null 2>&1 \
  || { echo "  WAV/AIFF reader test FAILED - run: node scripts/test-wav-excerpt.js"; exit 1; }
node "$HERE/scripts/test-host-insert.js" > /dev/null 2>&1 \
  || { echo "  Library insert test FAILED - run: node scripts/test-host-insert.js"; exit 1; }
node "$HERE/scripts/test-library-tab.js" > /dev/null 2>&1 \
  || { echo "  Library tab test FAILED - run: node scripts/test-library-tab.js"; exit 1; }
node "$HERE/scripts/test-update-check.js" > /dev/null 2>&1 \
  || { echo "  Update notice test FAILED - run: node scripts/test-update-check.js"; exit 1; }
node "$HERE/scripts/test-key-confidence-words.js" > /dev/null 2>&1 \
  || { echo "  Key confidence words test FAILED - run: node scripts/test-key-confidence-words.js"; exit 1; }
node "$HERE/scripts/test-update-question.js" > /dev/null 2>&1 \
  || { echo "  Update question test FAILED - run: node scripts/test-update-question.js"; exit 1; }
node "$HERE/scripts/test-library-decode-queue.js" > /dev/null 2>&1 \
  || { echo "  Library decode queue test FAILED - run: node scripts/test-library-decode-queue.js"; exit 1; }
node "$HERE/scripts/test-library-skey.js" > /dev/null 2>&1 \
  || { echo "  Library S-KEY key test FAILED - run: node scripts/test-library-skey.js"; exit 1; }
node "$HERE/scripts/test-sfx-pitch-gate.js" > /dev/null 2>&1 \
  || { echo "  SFX pitch check test FAILED - run: node scripts/test-sfx-pitch-gate.js"; exit 1; }
node "$HERE/scripts/test-sfx-search.js" > /dev/null 2>&1 \
  || { echo "  Library search test FAILED - run: node scripts/test-sfx-search.js"; exit 1; }
node "$HERE/scripts/test-ui-select-search.js" > /dev/null 2>&1 \
  || { echo "  searchable dropdown test FAILED - run: node scripts/test-ui-select-search.js"; exit 1; }
echo "  Library tab scans, searches and inserts"

# The delete code can never touch anything that is not the plugin's own.
node "$HERE/scripts/test-delete-safety.js" > /dev/null 2>&1 \
  || { echo "  delete-safety test FAILED - run: node scripts/test-delete-safety.js"; exit 1; }
echo "  delete safety holds"

# Bundled Node.js runtime (js/bridge.js's _resolveNodeExecutable(), see
# NOTICE.md) - gitignored, fetched via scripts/fetch-node-runtime.sh, not
# auto-run here on purpose (that script hits the network; this one should
# not).
for platform_arch in darwin-arm64 darwin-x64 win-x64; do
  if [ "$platform_arch" = "win-x64" ]; then
    bin_name="node.exe"
  else
    bin_name="node"
  fi
  if [ ! -f "$HERE/runtime/node/$platform_arch/$bin_name" ]; then
    echo "Missing bundled runtime: runtime/node/$platform_arch/$bin_name"
    echo "Run scripts/fetch-node-runtime.sh first."
    exit 1
  fi
done

# Bundled onnxruntime-web (WASM) + Beat This! ONNX model weights
# (worker/beatthis-worker.js, see NOTICE.md and
# scripts/fetch-beatthis-runtime.sh) - same "refuse to build without it"
# reasoning as the Node runtime guard above. One WASM artifact serves all
# platforms (no per-arch loop, unlike the native Node runtime).
if [ ! -f "$HERE/runtime/onnxruntime-web/node_modules/onnxruntime-web/dist/ort.node.min.js" ] || \
   [ ! -f "$HERE/runtime/onnxruntime-web/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm" ]; then
  echo "Missing bundled onnxruntime-web runtime."
  echo "Run scripts/fetch-beatthis-runtime.sh first."
  exit 1
fi
for model_name in mel_spectrogram.onnx beat_this_own_export.onnx skey.onnx; do
  if [ ! -f "$HERE/models/$model_name" ]; then
    echo "Missing bundled model: models/$model_name"
    echo "Beat This! models: run scripts/fetch-beatthis-runtime.sh."
    echo "skey.onnx: run scripts/skey-export/export_skey_onnx.py (see NOTICE.md)."
    exit 1
  fi
done

if [ -L "$SYMLINK_PATH" ]; then
  echo "Refusing to build: dev symlink is active at:"
  echo "  $SYMLINK_PATH"
  echo "Remove it first:"
  echo "  \"$HERE/scripts/dev-uninstall.sh\""
  echo "...so the .zxp install doesn't get shadowed by (or silently shadow)"
  echo "the dev copy."
  exit 1
fi

VERSION=$(grep -o 'ExtensionBundleVersion="[^"]*"' "$HERE/CSXS/manifest.xml" | head -1 | cut -d'"' -f2)
mkdir -p "$OUT_DIR"
BUILD_GLOB="${NAME}-[0-9]*.zxp"
# The Mac package carries both Mac builds (Apple Silicon and Intel), the
# Windows package the x64 one.
ZXP_MAC="$OUT_DIR/${NAME}-${VERSION}-mac.zxp"
ZXP_WIN="$OUT_DIR/${NAME}-${VERSION}-win.zxp"

if [ -f "$ZXP_MAC" ] || [ -f "$ZXP_WIN" ]; then
  echo "Refusing to overwrite: ${NAME}-${VERSION}-mac/-win.zxp already exists."
  echo "Bump ExtensionBundleVersion in CSXS/manifest.xml first - some ZXP"
  echo "installer tools silently no-op a reinstall if the version string"
  echo "didn't change, even though the contents did."
  exit 1
fi

# Only the newest build is ever meaningful to keep around - remove older
# Downbeat-<version>.zxp files so zxp-build/ doesn't quietly accumulate stale
# ones that end up being handed out by mistake.
find "$OUT_DIR" -maxdepth 1 -name "$BUILD_GLOB" -not -name "$(basename "$ZXP_MAC")" -not -name "$(basename "$ZXP_WIN")" -delete

if [ ! -f "$CERT" ]; then
  echo "No self-signed certificate yet at $CERT - making one (one-time)..."
  ( umask 077; openssl rand -hex 24 > "$CERT_PASSWORD_FILE" )
  "$ZXPSIGNCMD" -selfSignedCert US CA "Downbeat" "Downbeat" \
    "$(cat "$CERT_PASSWORD_FILE")" "$CERT" -validityDays 7300
fi
[ -f "$CERT_PASSWORD_FILE" ] || { echo "The certificate's password file is missing: $CERT_PASSWORD_FILE - not building"; exit 1; }
CERT_PASSWORD="$(cat "$CERT_PASSWORD_FILE")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$HERE/CSXS" "$STAGE/"
cp -R "$HERE/assets" "$STAGE/"
cp "$HERE/index.html" "$STAGE/"
cp -R "$HERE/css" "$STAGE/"
cp -R "$HERE/js" "$STAGE/"
cp -R "$HERE/jsx" "$STAGE/"
cp -R "$HERE/worker" "$STAGE/"
cp -R "$HERE/runtime" "$STAGE/"
cp -R "$HERE/models" "$STAGE/"
cp "$HERE/LICENSE" "$STAGE/"
cp "$HERE/NOTICE.md" "$STAGE/"
cp "$HERE/GUIDE.md" "$STAGE/"
cp "$HERE/GUIDE.ru.md" "$STAGE/"
cp "$HERE/GUIDE.es.md" "$STAGE/"
find "$STAGE" -name '.DS_Store' -delete
find "$STAGE" -name '__MACOSX' -prune -exec rm -rf {} +

# Optional: a package without code comments (STRIP_COMMENTS=1).
if [ "${STRIP_COMMENTS:-0}" = "1" ]; then
  node "$HERE/scripts/strip-comments.js" "$STAGE" \
    || { echo "  comment stripping FAILED - not building"; exit 1; }
  for t in test-panel-boot test-host-ae test-host-insert test-self-test test-worker-smoke test-lib-preview test-library-tab test-update-check test-analyze-pipeline; do
    DOWNBEAT_ROOT="$STAGE" node "$HERE/scripts/$t.js" > /dev/null 2>&1 \
      || { echo "  $t FAILED on the stripped release copy - rerun it with DOWNBEAT_ROOT set to a staged copy"; exit 1; }
  done
  echo "  the stripped release copy passes the panel, host and worker tests"
fi

# Adobe's own known issue (CEP-Resources ZXPSignCMD/KnownIssue2024.md):
# symlinks inside a package break signature verification after a Creative
# Cloud install. Refuse rather than ship one.
if [ -n "$(find "$STAGE" -type l | head -1)" ]; then
  echo "The staged package contains symlinks - not building:"
  find "$STAGE" -type l | sed "s#^$STAGE/#  #"
  exit 1
fi
# The plugin must never ship (or later write) a data/ folder inside itself -
# see js/persistence.js's header.
if [ -e "$STAGE/data" ]; then
  echo "The staged package contains a data/ folder - not building."
  exit 1
fi

# Split into the two platform packages (the tests above ran on the shared
# copy, with every runtime in it).
STAGE_MAC="$(mktemp -d)"
STAGE_WIN="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$STAGE_MAC" "$STAGE_WIN"' EXIT
cp -R "$STAGE/." "$STAGE_MAC/"
cp -R "$STAGE/." "$STAGE_WIN/"
rm -rf "$STAGE_MAC/runtime/node/win-x64"
rm -rf "$STAGE_WIN/runtime/node/darwin-arm64" "$STAGE_WIN/runtime/node/darwin-x64"

# The signing tool comes from an npm package and is not code-signed itself, so
# the package is also compared with its staged copy: exactly the same files,
# byte for byte (only the signature in META-INF/ and the mimetype entry are
# new).
sign_and_check() {
  "$ZXPSIGNCMD" -sign "$1" "$2" "$CERT" "$CERT_PASSWORD" > /dev/null \
    || { echo "Signing FAILED for $2"; exit 1; }
  "$ZXPSIGNCMD" -verify "$2" > /dev/null \
    || { echo "Signature check FAILED on $2 - do not ship it."; exit 1; }
  VERIFY_DIR="$(mktemp -d)"
  unzip -q "$2" -d "$VERIFY_DIR/ext"
  if ! "$ZXPSIGNCMD" -verify "$VERIFY_DIR/ext" > /dev/null; then
    rm -rf "$VERIFY_DIR"
    echo "Signature check FAILED on the unpacked $2 - do not ship it."
    exit 1
  fi
  if ! diff -rq -x META-INF -x mimetype "$1" "$VERIFY_DIR/ext" > /dev/null; then
    diff -rq -x META-INF -x mimetype "$1" "$VERIFY_DIR/ext" | head -20
    rm -rf "$VERIFY_DIR"
    echo "$2 differs from the staged files - do not ship it."
    exit 1
  fi
  rm -rf "$VERIFY_DIR"
  echo "  $(basename "$2"): signed, verified packed and unpacked, contents match the staged files"
}
sign_and_check "$STAGE_MAC" "$ZXP_MAC"
sign_and_check "$STAGE_WIN" "$ZXP_WIN"

echo ""
echo "Built and signed:"
echo "  $ZXP_MAC ($(du -m "$ZXP_MAC" | cut -f1) MB, macOS: Apple Silicon and Intel)"
echo "  $ZXP_WIN ($(du -m "$ZXP_WIN" | cut -f1) MB, Windows x64)"
echo "Install by dragging it onto a ZXP installer app (for example ZXP"
echo "Installer). No PlayerDebugMode needed - the signature was just"
echo "verified above."
