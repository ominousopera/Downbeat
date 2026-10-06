#!/bin/sh
# macOS only. Removes a real installed copy (a .zxp install, not the dev symlink). Since
# it deletes a directory, it makes its own safety checks first:
# 1. the target path is exact and hardcoded (no wildcards, nothing built from
#    user input);
# 2. the target is not a symlink;
# 3. the target holds CSXS/manifest.xml declaring this ExtensionBundleId.
# Anything else is left alone.

set -eu

EXT_ID="com.downbeat.pro"
TARGET="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

if [ ! -e "$TARGET" ]; then
  echo "Nothing installed at $TARGET - already clean."
  exit 0
fi

if [ -L "$TARGET" ]; then
  echo "$TARGET is a symlink (dev install), not a real ZXP install."
  echo "Use scripts/dev-uninstall.sh for that instead - this script only"
  echo "ever removes a real installed directory."
  exit 1
fi

MANIFEST="$TARGET/CSXS/manifest.xml"
if [ ! -f "$MANIFEST" ]; then
  echo "Refusing to remove $TARGET - no CSXS/manifest.xml found inside it."
  echo "This doesn't look like a CEP extension install; not touching it."
  exit 1
fi

if ! grep -q "ExtensionBundleId=\"$EXT_ID\"" "$MANIFEST"; then
  echo "Refusing to remove $TARGET - its manifest.xml does not declare"
  echo "ExtensionBundleId=\"$EXT_ID\". This isn't Downbeat -"
  echo "not touching it."
  exit 1
fi

echo "Confirmed: $TARGET is a real installed copy of $EXT_ID (manifest ID matches)."
rm -rf "$TARGET"
echo "Removed: $TARGET"
echo ""
echo "NOT touched: Downbeat's saved data in Documents/Downbeat (settings,"
echo "track library). To remove it, use Settings > Delete my data in the"
echo "panel before uninstalling, or delete that folder yourself. This script"
echo "never deletes anything in Documents."
echo ""
echo "Also not touched: this project's source folder, PlayerDebugMode (shared"
echo "by other unsigned/dev CEP extensions on this machine), every other"
echo "extension in the CEP extensions folder."
echo ""
echo "Restart Premiere Pro or After Effects for the removal to take effect."
