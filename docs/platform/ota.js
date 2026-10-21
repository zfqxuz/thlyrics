/**
 * 内容热更新（Capgo Updater，手动流程）。
 *
 * 只做一件事：把 `docs/` 打成的 zip 换进去，**不用装 APK**。
 * 不碰原生层，也不走 Capgo 云：清单是我们自己的 `update.json`，包在 OSS。
 *
 * 流程：
 *   ① 启动时 notifyAppReady()（不调会被判失败并自动回滚）
 *   ② 静默拉清单 → 版本不同 → download() → next()（下次启动生效，不打断当前）
 *   ③ 手动「检查内容更新」→ download() + set()（立刻重载）
 */
import { resolveDownloadUrl } from './net.js?v=20261022a';

const plugin = () => {
  if (typeof window === 'undefined') return null;
  const C = window.Capacitor;
  return (C && C.Plugins && C.Plugins.CapacitorUpdater) || null;
};

export const otaAvailable = () => !!plugin();

/** 每次启动都要调，否则原生层超时后回滚到上一个包 */
export async function otaReady() {
  const p = plugin();
  if (!p) return false;
  try { await p.notifyAppReady(); return true; } catch { return false; }
}

/** 当前正在跑的内容包（builtin = APK 里自带的那份） */
export async function otaCurrent() {
  const p = plugin();
  if (!p) return null;
  try {
    const r = await p.current();
    const b = (r && r.bundle) || {};
    return { id: b.id || 'builtin', version: b.version || '', builtin: b.id === 'builtin' };
  } catch { return null; }
}

/** 只升不降：我们的版本号是同长度日期串，可以直接比字符串 */
const newer = (next, cur) => !!next && (!cur || String(next) > String(cur));

/**
 * 检查并下载新包。
 * @param manifestUrl 清单地址（形如 https://…/update.json）
 * @param {object} opts  { current: 当前版本, apply: 'next'|'now', timeout }
 * @returns {Promise<null|{id,version}>}  null = 没有更新 / 不适用
 */
export async function otaCheck(manifestUrl, { current = '', apply = 'next', timeout = 120000 } = {}) {
  const p = plugin();
  if (!p) return null;
  let m = null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const r = await fetch(manifestUrl + (manifestUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: ac.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (r.ok) m = await r.json();
  } catch { return null; }
  if (!m || !m.version || !m.url) return null;
  if (!newer(m.version, current)) return null;
  let zipUrl = '';
  try { zipUrl = await resolveDownloadUrl(m.url); } catch { zipUrl = ''; }   // 兜底整包的地址
  const t0 = Date.now();
  // 有 manifest 就走增量：本地已有同 hash 的文件不会再下（词典 18MB 只在第一次出现）
  const opts = m.manifest && m.manifest.length
    ? { url: zipUrl || m.url, version: String(m.version), manifest: m.manifest }
    : { url: zipUrl, version: String(m.version), checksum: m.sha256 };
  let b = null;
  try {
    b = await Promise.race([
      p.download(opts),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
    ]);
  } catch (e) {
    if (!opts.manifest) throw e;
    // 增量失败就退回整包（别把更新卡死）
    b = await Promise.race([
      p.download({ url: zipUrl, version: String(m.version), checksum: m.sha256 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
    ]);
  }
  const spent = Date.now() - t0;
  if (!b || !b.id) return null;
  // 网络太慢、或者用户已经关掉 App：这次先不切，留着下次再说
  if (apply === 'now') { try { await p.set({ id: b.id }); } catch { /* set 会重载，通常走不到这 */ } }
  else { try { await p.next({ id: b.id }); } catch { return null; } }
  return { id: b.id, version: String(m.version), ms: spent, bytes: Number(m.size) || 0 };
}
