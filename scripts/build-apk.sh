#!/usr/bin/env bash
# 构建 APK。
# ⚠️ Capacitor 会把整个 docs/ 同步进 assets/public —— 但 docs/dl/ 里放着 APK 自己、
#    docs/_screenshots/ 是预览图，同步进去会让 APK 指数级套娃（81MB→…）。
#    所以这里先把它们挪出去，同步/构建完再放回来。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
JAVA_HOME=${JAVA_HOME:-/home/zfq/tools/jdk-21.0.12.1+1}
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
OUT=${1:-docs/dl/thlyrics-beta.apk}

TMP=$(mktemp -d)
restore() {
  [ -d "$TMP/dl" ] && { rm -rf "$ROOT/docs/dl"; mv "$TMP/dl" "$ROOT/docs/dl"; }
  [ -d "$TMP/shots" ] && { rm -rf "$ROOT/docs/_screenshots"; mv "$TMP/shots" "$ROOT/docs/_screenshots"; }
  rmdir "$TMP" 2>/dev/null || true
}
trap restore EXIT

[ -d "$ROOT/docs/dl" ] && mv "$ROOT/docs/dl" "$TMP/dl"
[ -d "$ROOT/docs/_screenshots" ] && mv "$ROOT/docs/_screenshots" "$TMP/shots"

echo "▶ cap sync"
(cd app && npx cap sync android >/dev/null)

echo "▶ gradle assembleDebug"
./app/android/gradlew -p app/android clean assembleDebug ${GRADLE_ARGS:---offline -q}

restore
trap - EXIT

APK="$ROOT/app/android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "✗ 没打出 APK"; exit 1; }
mkdir -p "$(dirname "$ROOT/$OUT")"
cp "$APK" "$ROOT/$OUT"
echo "✓ $OUT  $(du -h "$ROOT/$OUT" | cut -f1)"
