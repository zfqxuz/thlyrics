/**
 * App 内离线日语语音包（只原生壳有）。
 * 数据从我们 OSS 下到 App 私有目录，解压即用；不装 APK、不走系统 TTS。
 * 网页端 available=false，发音直接走在线。
 */
const cap = (typeof window !== 'undefined' && window.Capacitor) ? window.Capacitor : null;
const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
const plugin = (native && cap.Plugins) ? cap.Plugins.VoicePack : null;

export const voicePack = {
  available: !!plugin,

  /** 某个包的状态：{ installed, version, path, dicDir, voiceFile, size } */
  async status(id) {
    if (!plugin) return { installed: false };
    try { return await plugin.status({ id: String(id || '') }); } catch { return { installed: false }; }
  },

  /** 已装列表 */
  async list() {
    if (!plugin) return [];
    try { const r = await plugin.list(); return (r && r.packs) || []; } catch { return []; }
  },

  /** 删除本地数据（只删 App 里的目录） */
  async remove(id) {
    if (!plugin) throw new Error('仅 App 内可用');
    await plugin.remove({ id: String(id || '') });
  },

  /** 合成一段文字到本地 WAV：{ path }（同文本会命中缓存；Open JTalk 兜底包用） */
  async synth(id, text) {
    if (!plugin) throw new Error('仅 App 内可用');
    return await plugin.synth({ id: String(id || ''), text: String(text == null ? '' : text) });
  },

  /** 音频语音包：按文本查表 → { found, path }（词音频包用，不走合成） */
  async resolve(id, text) {
    if (!plugin) return { found: false };
    try { return await plugin.resolve({ id: String(id || ''), text: String(text == null ? '' : text) }) || { found: false }; }
    catch { return { found: false }; }
  },

  /** 引擎版本（自检用） */
  async engineVersion() {
    if (!plugin) return '';
    try { const r = await plugin.engine(); return (r && r.version) || ''; } catch { return ''; }
  },

  /**
   * 下载并解压一个数据包；onEvent(type, data)：progress({pct}) / done(状态) / error({message})。
   * 返回 Promise：done 时 resolve，error 时 reject。
   */
  async install(opts, onEvent) {
    if (!plugin) throw new Error('仅 App 内可用');
    const { id, url, sha256, version } = opts || {};
    const handles = [];
    const done = new Promise((resolve, reject) => {
      const bind = (ev) => {
        const ret = plugin.addListener(ev, (d) => {
          if (onEvent) onEvent(ev, d || {});
          if (ev === 'done') resolve(d || {});
          else if (ev === 'error') reject(new Error((d && d.message) || '下载失败'));
        });
        if (ret && typeof ret.then === 'function') ret.then((h) => handles.push(h)).catch(() => {});
        else if (ret) handles.push(ret);
      };
      bind('progress');
      bind('done');
      bind('error');
      plugin.install({ id, url, sha256, version, kind: (opts && opts.kind) || 'ojt' }).catch((e) => reject(e));
    });
    try {
      return await done;
    } finally {
      setTimeout(() => handles.forEach((h) => { try { h.remove(); } catch { /* 忽略 */ } }), 1500);
    }
  },
};
