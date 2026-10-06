#!/bin/sh
# Fetches the bundled Node.js runtime into runtime/node/. Re-running fetches
# the same hash-verified bytes; to move to a newer Node release, change
# NODE_VERSION and the three hashes below deliberately and update NOTICE.md.
#
# Only the bare `node` / `node.exe` executable is kept - not npm, corepack,
# docs or headers, none of which the subprocess architecture needs
# (worker/analyze-worker.js is a plain script; no npm install happens at
# runtime).

set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$HERE/runtime/node"

NODE_VERSION="24.18.0"
DIST_BASE="https://nodejs.org/dist/v${NODE_VERSION}"

# platform-arch:archive-suffix:sha256
TARGETS="
darwin-arm64:tar.gz:e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1
darwin-x64:tar.gz:dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080
win-x64:zip:0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821
"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

for entry in $TARGETS; do
  PLATFORM_ARCH="$(echo "$entry" | cut -d: -f1)"
  EXT="$(echo "$entry" | cut -d: -f2)"
  EXPECTED_SHA="$(echo "$entry" | cut -d: -f3)"
  ARCHIVE_NAME="node-v${NODE_VERSION}-${PLATFORM_ARCH}.${EXT}"
  DEST_DIR="$OUT_DIR/$PLATFORM_ARCH"

  if [ "$PLATFORM_ARCH" = "win-x64" ]; then
    DEST_BIN="$DEST_DIR/node.exe"
  else
    DEST_BIN="$DEST_DIR/node"
  fi

  if [ -f "$DEST_BIN" ]; then
    echo "Already present, skipping: $DEST_BIN"
    echo "  (delete it and re-run to force a re-fetch)"
    continue
  fi

  echo "Fetching $ARCHIVE_NAME..."
  ARCHIVE_PATH="$WORKDIR/$ARCHIVE_NAME"
  curl -sL "$DIST_BASE/$ARCHIVE_NAME" -o "$ARCHIVE_PATH"

  ACTUAL_SHA="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    echo "HASH MISMATCH for $ARCHIVE_NAME - refusing to use this file."
    echo "  expected: $EXPECTED_SHA"
    echo "  actual:   $ACTUAL_SHA"
    echo "Re-verify the hash against $DIST_BASE/SHASUMS256.txt yourself"
    echo "before updating the hardcoded value in this script."
    exit 1
  fi
  echo "  hash verified OK."

  mkdir -p "$DEST_DIR"
  EXTRACT_DIR="$WORKDIR/extract-$PLATFORM_ARCH"
  mkdir -p "$EXTRACT_DIR"

  if [ "$EXT" = "zip" ]; then
    unzip -q "$ARCHIVE_PATH" -d "$EXTRACT_DIR"
    FOUND_BIN="$(find "$EXTRACT_DIR" -name "node.exe" -type f | head -1)"
  else
    tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
    FOUND_BIN="$(find "$EXTRACT_DIR" -name "node" -type f -perm -u+x | head -1)"
  fi

  if [ -z "$FOUND_BIN" ]; then
    echo "Could not find the node executable inside $ARCHIVE_NAME - aborting."
    exit 1
  fi

  cp "$FOUND_BIN" "$DEST_BIN"
  # chmod may be a no-op for node.exe on some file systems.
  chmod +x "$DEST_BIN" 2>/dev/null || true

  # Never fails the fetch over this - codesign might not be available on a
  # non-macOS dev machine at all.
  case "$PLATFORM_ARCH" in
    darwin-*)
      if command -v codesign >/dev/null 2>&1; then
        if codesign -dv --verbose=4 "$DEST_BIN" 2>&1 | grep -q "Authority=Developer ID Application: Node.js Foundation"; then
          echo "  codesign OK: valid Node.js Foundation Developer ID signature."
        else
          echo "  WARNING: codesign did not report a Node.js Foundation signature - inspect before shipping:"
          codesign -dv --verbose=4 "$DEST_BIN" 2>&1 | sed 's/^/    /'
        fi
      fi
      ;;
  esac

  echo "  -> $DEST_BIN"
done

echo ""
echo "Done. Runtime binaries in: $OUT_DIR"
find "$OUT_DIR" -type f \( -name node -o -name node.exe \) -exec ls -lh {} \;
