#!/bin/sh
# Removes the dev symlink created by dev-install.sh. It refuses to touch a
# real directory, which could be a genuine .zxp install.

set -eu

EXT_ID="com.downbeat.pro"
TARGET="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

if [ -L "$TARGET" ]; then
  rm "$TARGET"
  echo "Removed dev symlink: $TARGET"
elif [ -e "$TARGET" ]; then
  echo "Not removing $TARGET - it's a real directory, not the dev symlink."
  echo "Leaving it alone (could be a genuine .zxp install)."
else
  echo "Nothing at $TARGET - already clean."
fi
