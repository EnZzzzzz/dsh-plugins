#!/usr/bin/env bash
# Rebuild dsh-weixin-bridge and refresh the copy installed in a dsh profile.
#
# The web profile installs this bundle as a plain file: copy (its node_modules
# uses a hoisted layout, and `dsh plugin` may be blocked by a pnpm store-version
# mismatch), so "update" = rebuild + copy the built artifacts over the profile's
# copy + restart the app. This script automates the first two steps.
#
# Usage: ./update.sh [profile]     (default profile: web)
# Requires: pnpm + node on PATH (the same ones used to build the plugin).
set -euo pipefail

PROFILE="${1:-web}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
TARGET="$DSH_HOME_DIR/profiles/$PROFILE/node_modules/dsh-weixin-bridge"

cd "$(dirname "$0")"

echo "==> building dsh-weixin-bridge"
pnpm run build

if [ ! -d "$TARGET" ]; then
  echo "error: plugin not installed in profile '$PROFILE' ($TARGET missing)" >&2
  echo "hint: install it first, or check DSH_HOME ($DSH_HOME_DIR)" >&2
  exit 1
fi

echo "==> refreshing $TARGET"
cp -R lib/. "$TARGET/lib/"
cp package.json cordis.patch.yml "$TARGET/"

echo
echo "updated. Restart the app (⌘Q then reopen) to load the new code."
