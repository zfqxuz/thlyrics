#!/usr/bin/env bash
# 真机操作助手（WSL 调 Windows adb.exe）
#   ./scripts/phone.sh shot <名字>     截图并拷到 .shots-phone/
#   ./scripts/phone.sh ui              打印当前界面 UI 树
#   ./scripts/phone.sh tap X Y         点屏幕坐标
#   ./scripts/phone.sh swipe X1 Y1 X2 Y2
#   ./scripts/phone.sh install <apk>   安装 apk
#   ./scripts/phone.sh start           启动 App
#   ./scripts/phone.sh cdp             开 CDP 转发（9222）
set -euo pipefail
ADB=/mnt/c/Users/zfq/AppData/Local/Android/Sdk/platform-tools/adb.exe
WIN_TMP='C:\Users\zfq\AppData\Local\Temp\thlyrics'
WSL_TMP=/mnt/c/Users/zfq/AppData/Local/Temp/thlyrics
SHOTS="$(cd "$(dirname "$0")/.." && pwd)/.shots-phone"
mkdir -p "$SHOTS" "$WSL_TMP"

case "${1:-}" in
  shot)
    name="${2:-shot}"
    $ADB shell screencap -p /sdcard/_s.png
    $ADB pull /sdcard/_s.png "$WIN_TMP\\_s.png" >/dev/null
    cp "$WSL_TMP/_s.png" "$SHOTS/$name.png"
    echo "$SHOTS/$name.png"
    ;;
  ui)
    $ADB shell uiautomator dump /sdcard/_ui.xml >/dev/null
    $ADB pull /sdcard/_ui.xml "$WIN_TMP\\_ui.xml" >/dev/null
    cat "$WSL_TMP/_ui.xml"
    ;;
  tap)  $ADB shell input tap "$2" "$3" ;;
  swipe) $ADB shell input swipe "$2" "$3" "$4" "$5" "${6:-300}" ;;
  key)  $ADB shell input keyevent "$2" ;;
  install)
    cp "$2" "$WSL_TMP/install.apk"
    $ADB install -r "$WIN_TMP\\install.apk"
    ;;
  start) $ADB shell am start -n com.zfqxuz.thlyrics/.MainActivity ;;
  stop)  $ADB shell am force-stop com.zfqxuz.thlyrics ;;
  cdp)
    sock=$($ADB shell cat /proc/net/unix | grep -o 'webview_devtools_remote[0-9]*' | head -1 | tr -d '\r')
    [ -z "$sock" ] && { echo "没找到 webview socket（App 得先起来）"; exit 1; }
    $ADB forward tcp:9222 localabstract:"$sock"
    echo "CDP: $sock → http://127.0.0.1:9222"
    ;;
  *) sed -n '2,10p' "$0" ;;
esac
