#!/bin/sh
# One-command dev install: symlinks this folder into Premiere's extensions
# folder and turns PlayerDebugMode on for the CSXS versions this project
# targets (unsigned dev panels need it). Safe to re-run: idempotent.

set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
EXT_ID="com.downbeat.pro"
TARGET="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "Refusing to touch $TARGET"
  echo "It exists and is a real directory, not a symlink - could be a"
  echo "genuine .zxp install or unrelated data. Remove it by hand first if"
  echo "you're sure you want the dev symlink there instead."
  exit 1
fi

if [ -L "$TARGET" ]; then
  rm "$TARGET"
fi

mkdir -p "$(dirname "$TARGET")"
ln -s "$HERE" "$TARGET"
echo "Symlinked: $TARGET -> $HERE"

for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
killall cfprefsd >/dev/null 2>&1 || true
echo "PlayerDebugMode=1 set for CSXS 9-12."

echo ""
echo "Restart Premiere Pro if it's already running, then open it via:"
echo "  Window > Extensions > Downbeat"
