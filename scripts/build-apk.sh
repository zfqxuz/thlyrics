#!/usr/bin/env bash
# 出安卓包 → 同步到「网页下载镜像 docs/dl/thlyrics.apk」→ 更新 docs/apk.json 的 version。
#
# ⚠️ 坑（踩过）：docs/dl/thlyrics.apk 会被 cap sync 原样打进 APK 的 assets，
#    于是每一版都自带上一版的 APK，体积一代代翻倍（8MB → 15.6MB → …）。
#    所以同步前先把旧镜像挪出 docs/，构建完再放新的回去。
#
# 用法：bash scripts/build-apk.sh        （环境变量 JAVA_HOME / ANDROID_HOME 可覆盖）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk-21.0.12.1+1}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
APK="$ROOT/app/android/app/build/outputs/apk/debug/app-debug.apk"
MIRROR="$ROOT/docs/dl/thlyrics.apk"
BACKUP=""; ok=0

mkdir -p "$ROOT/docs/dl"
if [ -f "$MIRROR" ]; then BACKUP="$(mktemp)"; cp "$MIRROR" "$BACKUP"; rm -f "$MIRROR"; fi
finish() {
  if [ "$ok" != 1 ] && [ -n "$BACKUP" ]; then cp "$BACKUP" "$MIRROR"; echo "✗ 构建失败，已把旧镜像放回"; fi
  [ -n "$BACKUP" ] && rm -f "$BACKUP"
}
trap finish EXIT

cd "$ROOT/app"
npx cap sync android >/dev/null
cd "$ROOT/app/android"
./gradlew assembleDebug --no-daemon -q

cp "$APK" "$MIRROR"
V="$(grep -o "V = '[^']*'" "$ROOT/docs/version.js" | cut -d"'" -f2)"
python3 - "$ROOT/docs/apk.json" "$V" <<'PY'
import json, sys
p, v = sys.argv[1], sys.argv[2]
d = json.load(open(p))
d['version'] = v
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=2)
open(p, 'a').write('\n')
PY
ok=1
echo "✓ APK $(du -h "$APK" | cut -f1) → docs/dl/thlyrics.apk；apk.json version=$V"
