/**
 * 发音朗读：原生壳走安卓自带 TTS（WebView 不支持 Web Speech API，网页端那套在壳里是哑的），
 * 网页端走浏览器自带的 speechSynthesis。对上层同一个接口：speak(text) → { ok, ja, error }
 */
const cap = (typeof window !== 'undefined' && window.Capacitor) ? window.Capacitor : null;
const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
const plugin = (native && cap.Plugins) ? cap.Plugins.Tts : null;
const web = (typeof window !== 'undefined' && 'speechSynthesis' in window) ? window.speechSynthesis : null;

let jaVoice = null;
let voicesReady = null;
const pickVoice = () => { if (web) jaVoice = (web.getVoices() || []).find((v) => (v.lang || '').toLowerCase().startsWith('ja')) || null; };
/** 浏览器第一次拿到的 voices 可能是空数组（异步加载）；等一小会儿再判断，避免把有日语包误判成没有 */
function ensureVoices() {
  if (!web) return Promise.resolve();
  pickVoice();
  if (jaVoice) return Promise.resolve();
  if (!voicesReady) {
    voicesReady = new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; pickVoice(); resolve(); };
      try { web.addEventListener('voiceschanged', finish, { once: true }); } catch { /* 忽略 */ }
      setTimeout(finish, 1200);
    });
  }
  return voicesReady.then(() => { pickVoice(); });
}
if (web) { pickVoice(); try { web.onvoiceschanged = pickVoice; } catch { /* 忽略 */ } }

export const tts = {
  /** 有没有朗读能力（网页端浏览器不一定有） */
  available: !!(plugin || web),

  /** 读一段日文。ja=false 表示系统没装日语语音包（前端提示去系统设置里装） */
  async speak(text, lang = 'ja-JP') {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { ok: false, error: '没有要读的内容' };
    if (plugin) {
      try {
        // 原生插件在等 TTS 引擎初始化；万一引擎起不来，别让上层一直等
        const r = (await Promise.race([
          plugin.speak({ text: t, lang }),
          new Promise((res) => setTimeout(() => res({ __timeout: 1 }), 4000)),
        ])) || {};
        if (r.__timeout) return { ok: false, error: '朗读超时' };
        return { ok: true, ja: !!r.ja };
      } catch (e) { return { ok: false, error: (e && e.message) || '朗读失败' }; }
    }
    if (web) {
      await ensureVoices();
      // 没装日语包时不要读：系统会用默认（中文）嗓子把日文汉字读成中文音，用户听到的就是"发音是中文"
      if (!jaVoice) return { ok: true, ja: false };
      try {
        web.cancel();
        const u = new SpeechSynthesisUtterance(t);
        u.lang = lang;
        u.voice = jaVoice;
        u.rate = 0.9;
        web.speak(u);
        return { ok: true, ja: true };
      } catch (e) { return { ok: false, error: (e && e.message) || '朗读失败' }; }
    }
    return { ok: false, error: '这个环境不支持朗读' };
  },
};
