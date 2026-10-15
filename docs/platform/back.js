/**
 * 原生返回键/侧滑返回的出口。
 * 原生侧：MainActivity 把 BACK 交给网页的 window.__tlOnBackPressed()，网页判断该退桌面时调 Back.exit()。
 * 网页侧：没有这个插件，exit() 是空操作（浏览器自己管后退）。
 */
const cap = (typeof window !== 'undefined' && window.Capacitor) ? window.Capacitor : null;
const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
const plugin = (native && cap.Plugins) ? cap.Plugins.Back : null;

export const nativeBack = {
  available: !!plugin,
  /** 退到桌面（moveTaskToBack，进程保留） */
  exit() {
    if (!plugin) return;
    try { plugin.exit().catch(() => {}); } catch { /* 忽略 */ }
  },
};
