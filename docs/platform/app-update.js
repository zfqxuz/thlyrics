/**
 * App 自更新（只有原生壳里有实现）。
 * 流程：docs/apk.json 里读远端版本 → 比前端版本号 V → 下载 APK（原生下载，进度回传）
 *      → FileProvider 交给系统安装器（用户点一次「安装」）。
 * 网页端 available=false：网页版不给自更新，走「我的 → 安卓 App → 下载 APK」。
 */
const cap = (typeof window !== 'undefined' && window.Capacitor) ? window.Capacitor : null;
const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
const plugin = (native && cap.Plugins) ? cap.Plugins.AppUpdater : null;
const SITE = 'https://zfqxuz.github.io/thlyrics/';        // 线上站点（版本清单从这里读）

export const appUpdater = {
  /** 有没有原生自更新能力 */
  available: !!plugin,

  /** 读远端版本清单：{ version, url, notes }。
   *  ⚠️ 必须用线上绝对地址：原生壳里相对路径读的是打进 APK 的那份 apk.json，
   *  永远等于当前版本，自更新就永远不会触发（Pages 有 CORS: *，跨域可取）。 */
  async check() {
    const r = await fetch(SITE + 'apk.json?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  },

  /** 下载并安装；onEvent(type, data)：type = progress（{pct}）/ done / error（{message}） */
  async install(url, version, onEvent) {
    if (!plugin) throw new Error('网页版不能自更新，请手动下载 APK 安装');
    const handles = [];
    if (onEvent) {
      for (const ev of ['progress', 'done', 'error']) {
        try { handles.push(await plugin.addListener(ev, (d) => onEvent(ev, d))); } catch { /* 忽略 */ }
      }
    }
    try {
      await plugin.install({ url: String(url || ''), version: String(version || '') });
    } finally {
      // 系统安装界面已经拉起，事件收尾（留几秒让 done/error 有机会回来）
      setTimeout(() => handles.forEach((h) => { try { h.remove(); } catch { /* 忽略 */ } }), 8000);
    }
  },
};
