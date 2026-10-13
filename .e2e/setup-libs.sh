#!/bin/bash
# 给 Chromium 补系统库：容器里没有 root，装不了 apt，所以直接从 Debian 镜像拉 .deb 解包到本目录，
# 再用 LD_LIBRARY_PATH 喂给 Chromium。幂等：已解出的库会跳过。
set -e
BASE=$(cd "$(dirname "$0")" && pwd)
ROOT="$BASE/root"
DEBS="$BASE/debs"
mkdir -p "$ROOT" "$DEBS"
IDX="$DEBS/Packages.txt"
UA="thlyrics-e2e/0.1"
if [ ! -s "$IDX" ]; then
  echo "[1/3] 下载 Debian 包索引…"
  curl -sL -A "$UA" -o "$DEBS/Packages.gz" "http://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.gz"
  gunzip -c "$DEBS/Packages.gz" > "$IDX"
fi
echo "[2/3] 解析依赖（迭代到不缺库为止）"
CH=$(ls -d /home/*/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | tail -1)
[ -z "$CH" ] && { echo "找不到 chromium_headless_shell，先跑 npx playwright install chromium"; exit 1; }
export LD_LIBRARY_PATH="$ROOT/usr/lib/x86_64-linux-gnu:$ROOT/lib/x86_64-linux-gnu:$ROOT/usr/lib:$ROOT/lib"
for round in 1 2 3 4 5 6 7 8 9 10; do
  miss=$(ldd "$CH" 2>/dev/null | grep "not found" | awk '{print $1}' | sort -u | tr '\n' ' ')
  [ -z "$miss" ] && { echo "  第 $round 轮：不再缺库 ✓"; break; }
  echo "  第 $round 轮: $miss"
  for lib in $miss; do
    # 库名 -> 包名：优先 lib<name><N> 系列，再用索引模糊匹配
    base=$(echo "$lib" | sed -E 's/\.so.*//; s/^lib//' | tr 'A-Z' 'a-z')
    pkg=""
    for cand in "lib${base}1" "lib${base}0" "lib${base}2" "lib${base}-1-0" "lib${base}3" "lib${base}-0-0"; do
      grep -q "^Package: ${cand}$" "$IDX" && { pkg=$cand; break; }
    done
    [ -z "$pkg" ] && pkg=$(grep -oE "^Package: .*${base}.*$" "$IDX" | head -1 | sed 's/Package: //')
    [ -z "$pkg" ] && { echo "    ? 找不到 $lib"; continue; }
    line=$(grep -n "^Package: ${pkg}$" "$IDX" | head -1 | cut -d: -f1)
    fn=$(sed -n "${line},$((line+30))p" "$IDX" | grep "^Filename:" | head -1 | sed 's/^Filename: //')
    f="$DEBS/$(basename "$fn")"
    if [ ! -s "$f" ] || ! dpkg-deb -x "$f" "$ROOT" 2>/dev/null; then
      curl -sL -A "$UA" -o "$f" "http://deb.debian.org/debian/$fn" && dpkg-deb -x "$f" "$ROOT" 2>/dev/null && echo "    + $lib <- $pkg" || echo "    ! 失败 $lib ($pkg)"
    fi
  done
done
echo "[3/3] 校验：$("$CH" --version 2>&1 | tail -1)"
