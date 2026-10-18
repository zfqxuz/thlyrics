/**
 * 小数据持久化（Web Storage）。
 * 网页、Android/iOS 壳里都是同一套 API（WebView 自带 localStorage），所以这里不需要分实现；
 * 将来要换成原生的偏好设置，只改这一个文件。
 */
export function kvGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function kvSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }
export function kvDel(key) { try { localStorage.removeItem(key); } catch { /* 隐私模式 / 配额满，忽略 */ } }
/** 列出所有键（迁移/清理旧数据用） */
export function kvKeys() { try { return Object.keys(localStorage); } catch { return []; } }
export function kvGetJson(key, fallback = null) {
  const s = kvGet(key);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
export function kvSetJson(key, val) { return kvSet(key, JSON.stringify(val)); }

/** 清掉旧版本遗留的 IndexedDB（"本机音频绑定"功能已下线，别把垃圾留在用户机器上） */
export function dropLegacyDB(name) { try { indexedDB.deleteDatabase(name); } catch { /* 无 IndexedDB 时忽略 */ } }
