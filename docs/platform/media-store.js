/**
 * 本机音频仓库：用户自己带的音频文件存哪儿、怎么变成一个能播的地址。
 *
 * - 原生壳（Android/iOS）：系统文件选择器（SAF）选完即复制进 App 私有沙盒（零权限），
 *   播放走 Capacitor 的 convertFileSrc（本地服务器把沙盒文件映射成 https 地址）。
 *   → 断开网络、原文件被删都还能听。
 * - 网页端：退化成 <input type=file> + IndexedDB 存 Blob，播放走 createObjectURL。
 *
 * 对上层只有四个动作：pick() 选文件、url(ref) 要可播地址、remove(ref) 删掉、available 判断能不能用。
 * 注意：网易云/QQ 客户端下载的加密容器（ncm、uc!、qmc 系列、mflac）用户选进来也放不了——
 * 这里不做任何解密，只当普通文件搬运。
 */
const cap = (typeof window !== 'undefined' && window.Capacitor) ? window.Capacitor : null;
const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
const plugin = (native && cap.Plugins) ? cap.Plugins.LocalAudio : null;
const DB_NAME = 'thlyrics-media', STORE = 'files';
const objUrls = new Map();          // key → objectURL（网页端），避免重复创建

/* ────────────── 网页端：IndexedDB ────────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打不开本地库'));
  });
}
async function idbRun(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out && out.result); };
    t.onerror = () => { db.close(); reject(t.error || new Error('本地库操作失败')); };
  });
}
function pickWeb() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { input.remove(); } catch { /* 忽略 */ } resolve(v); };
    input.onchange = async () => {
      const f = (input.files || [])[0];
      if (!f) return finish(null);
      try {
        const key = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await idbRun('readwrite', (s) => s.put(f, key));
        finish({ key, name: f.name, size: f.size });
      } catch (e) { finish({ error: String(e && e.message || e) }); }
    };
    // 取消时多数浏览器不给事件：回到页面且没选到东西就当取消
    window.addEventListener('focus', () => setTimeout(() => { if (!input.files || !input.files.length) finish(null); }, 600), { once: true });
    input.click();
  });
}

export const mediaStore = {
  /** 能不能选本机音频：原生壳一定能；网页端要浏览器支持 IndexedDB */
  available: native ? !!plugin : (typeof indexedDB !== 'undefined'),

  /** 选一个音频文件；返回 { key, name, size, path? }，用户取消返回 null */
  async pick() {
    if (plugin) {
      const r = await plugin.pick();
      return { key: r.key, name: r.name, size: r.size, path: r.path };
    }
    if (typeof indexedDB === 'undefined') throw new Error('这个浏览器不支持本地存储');
    return pickWeb();
  },

  /** 把绑定信息变成一个能播的地址（异步） */
  async url(ref) {
    if (!ref) return null;
    if (native) return ref.path ? cap.convertFileSrc(ref.path) : null;
    if (!ref.key) return null;
    if (objUrls.has(ref.key)) return objUrls.get(ref.key);
    const blob = await idbRun('readonly', (s) => s.get(ref.key));
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    objUrls.set(ref.key, u);
    return u;
  },

  /** 删掉本机那份（网页端顺手回收 objectURL） */
  async remove(ref) {
    if (!ref || !ref.key) return;
    if (plugin) { try { await plugin.remove({ key: ref.key }); } catch { /* 文件可能已经没了 */ } return; }
    if (objUrls.has(ref.key)) { try { URL.revokeObjectURL(objUrls.get(ref.key)); } catch { /* 忽略 */ } objUrls.delete(ref.key); }
    await idbRun('readwrite', (s) => s.delete(ref.key));
  },

  /** 按文件名删（孤儿清理用） */
  async removeByKey(key) { return mediaStore.remove({ key }); },

  /** 列出本机已存的音频（孤儿清理用） */
  async list() {
    if (plugin) { const r = await plugin.list(); return (r && r.files) || []; }
    const keys = await idbRun('readonly', (s) => s.getAllKeys());
    return (keys || []).map((k) => ({ key: String(k) }));
  },

  /** 是不是原生壳（决定要不要做沙盒清理：网页端 IndexedDB 也一样） */
  native,
};
