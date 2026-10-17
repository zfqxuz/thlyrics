/**
 * 多语言基础层：用户区域、学习语言、歌曲语言检测。
 *
 * 这里只放“语言/地区”的元数据和轻量启发式检测；不在这里做 UI 翻译，
 * UI 文案统一走 locales/<locale>.json（后续接入）。
 */

export const UI_LOCALES = [
  { id: 'zh-CN', lang: 'zh', native: '简体中文' },
  { id: 'en', lang: 'en', native: 'English' },
  { id: 'ja', lang: 'ja', native: '日本語' },
  { id: 'fr', lang: 'fr', native: 'Français' },
  { id: 'ru', lang: 'ru', native: 'Русский' },
  { id: 'es', lang: 'es', native: 'Español' },
  { id: 'pt', lang: 'pt', native: 'Português' },
  { id: 'ko', lang: 'ko', native: '한국어' },
  { id: 'de', lang: 'de', native: 'Deutsch' },
];

/** 可学习语言；zh 也在这里，是否显示由 userLocale 决定 */
export const LEARN_LANGS = [
  { id: 'ja', native: '日本語', tts: 'ja-JP', level: 'JLPT' },
  { id: 'en', native: 'English', tts: 'en-US', level: 'CEFR' },
  { id: 'zh', native: '中文', tts: 'zh-CN', level: 'HSK' },
  { id: 'fr', native: 'Français', tts: 'fr-FR', level: 'CEFR' },
  { id: 'ru', native: 'Русский', tts: 'ru-RU', level: 'TRKI' },
  { id: 'es', native: 'Español', tts: 'es-ES', level: 'CEFR' },
  { id: 'pt', native: 'Português', tts: 'pt-BR', level: 'CEFR' },
  { id: 'ko', native: '한국어', tts: 'ko-KR', level: 'TOPIK' },
  { id: 'de', native: 'Deutsch', tts: 'de-DE', level: 'CEFR' },
];

/** 歌曲语言标签；除学习语言外还有“其它/未识别” */
export const SONG_LANGS = [
  ...LEARN_LANGS.map((x) => ({ id: x.id, native: x.native })),
  { id: 'other', native: '其它' },
  { id: 'unknown', native: '未识别' },
];

const LOCALE_BY_LANG = new Map(UI_LOCALES.map((x) => [x.lang, x]));

/** 系统语言 → 支持的界面 locale */
export function systemLocale() {
  const list = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || ['en'];
  for (const raw of list) {
    const tag = String(raw || '').toLowerCase();
    const exact = UI_LOCALES.find((x) => x.id.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0];
    if (LOCALE_BY_LANG.has(base)) return LOCALE_BY_LANG.get(base);
  }
  return UI_LOCALES[0];
}

export function resolveLocale(pref) {
  const all = [pref].concat((typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []);
  for (const raw of all) {
    if (!raw || raw === 'auto') continue;
    const tag = String(raw).toLowerCase();
    const exact = UI_LOCALES.find((x) => x.id.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0];
    if (LOCALE_BY_LANG.has(base)) return LOCALE_BY_LANG.get(base);
  }
  return systemLocale();
}

/** 本地化语言名；Intl 不可用时退回 native 名称 */
export function langLabel(id, localeTag = 'zh-CN') {
  if (!id) return '';
  if (id === 'other') return '其它';
  if (id === 'unknown') return '未识别';
  try {
    const dn = new Intl.DisplayNames([localeTag], { type: 'language' });
    return dn.of(id) || id;
  } catch {
    const hit = LEARN_LANGS.find((x) => x.id === id);
    return hit ? hit.native : id;
  }
}

/** 很轻的脚本/停用词判别：用于歌曲逐行打标，不替代服务端语言识别 */
const STOP = {
  en: ['the', 'and', 'you', 'to', 'of', 'in', 'is', 'that', 'it', 'for', 'on', 'with', 'as', 'was', 'i'],
  fr: ['le', 'la', 'les', 'des', 'et', 'est', 'un', 'une', 'du', 'que', 'qui', 'dans', 'pour', 'pas', 'je'],
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'por', 'para', 'con', 'no', 'es'],
  pt: ['o', 'a', 'os', 'as', 'de', 'que', 'e', 'em', 'um', 'uma', 'para', 'com', 'não', 'é', 'do'],
  de: ['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'zu', 'von', 'mit', 'nicht', 'ich', 'du', 'wir'],
};
const WORD_RE = /[\p{L}]+/gu;
const HANGUL = /[\uac00-\ud7af]/;
const KANA = /[\u3041-\u309f\u30a0-\u30ff]/;
const CYRILLIC = /[\u0400-\u04ff]/;
const CJK = /[\u4e00-\u9fff]/;

export function detectTextLang(text) {
  const s = String(text || '');
  if (!s.trim()) return 'unknown';
  if (KANA.test(s)) return 'ja';
  if (HANGUL.test(s)) return 'ko';
  if (CYRILLIC.test(s)) return 'ru';
  if (CJK.test(s)) return 'zh';
  const words = (s.toLowerCase().match(WORD_RE) || []);
  if (!words.length) return 'unknown';
  let best = 'other', bestScore = 0;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    let score = 0;
    for (const w of words) if (set.has(w)) score++;
    // 特殊字母给一点权重
    if (lang === 'fr' && /[àâçéèêëîïôùûüÿœ]/.test(s)) score += 1.2;
    if (lang === 'de' && /[äöüß]/.test(s)) score += 1.2;
    if (lang === 'es' && /[ñ¿¡]/.test(s)) score += 1.2;
    if (lang === 'pt' && /[ãõç]/.test(s)) score += 1.2;
    if (score > bestScore) { bestScore = score; best = lang; }
  }
  return bestScore > 0 ? best : 'unknown';
}

/** 一首歌的语言标签：至少 2 行且占非空行 10%，否则保留主语言 */
export function detectTrackLangs(lines, primary) {
  const count = new Map();
  let n = 0;
  for (const l of lines || []) {
    const text = String((l && l.text) || '');
    if (!text.trim()) continue;
    n++;
    const id = detectTextLang(text);
    count.set(id, (count.get(id) || 0) + 1);
  }
  const out = [];
  for (const [id, c] of count) {
    if (id === 'unknown') continue;
    if (c >= 2 && c / Math.max(n, 1) >= 0.1) out.push(id);
  }
  if (!out.length) {
    let best = primary || 'unknown', bestN = 0;
    for (const [id, c] of count) if (c > bestN) { best = id; bestN = c; }
    if (best && best !== 'unknown') out.push(best);
  }
  return [...new Set(out)];
}

// ────────────── UI 文案 ──────────────
// 词条以「中文原文」为 key：没翻译的字符串直接回落到中文，不会出现空标签。
const DICTS = new Map();      // localeId → { 中文: 译文 }
let curLocale = 'zh-CN';
const LOCALE_FILES = new Set(UI_LOCALES.map((x) => x.id));

function normalizeLocale(tag) {
  if (!tag) return 'zh-CN';
  if (LOCALE_FILES.has(tag)) return tag;
  const base = String(tag).toLowerCase().split('-')[0];
  const hit = UI_LOCALES.find((x) => x.lang === base);
  return hit ? hit.id : 'zh-CN';
}

/** 写入某语言的文案表（拉取由调用方走 platform/net.js 完成） */
export function setDict(localeTag, obj) {
  const id = normalizeLocale(localeTag);
  DICTS.set(id, obj || {});
  if (curLocale === id) PATTERNS.delete(id);
  return id;
}

/** 切到某语言（没载入文案表时先按中文显示，等 setDict 补上） */
export function useLocale(localeTag) {
  curLocale = normalizeLocale(localeTag);
  return curLocale;
}

/** 是否已经有这门语言的文案表 */
export const hasDict = (localeTag) => DICTS.has(normalizeLocale(localeTag));

export const currentLocale = () => curLocale;

/** 翻译一条 UI 文案：有译文用译文，没有就原样返回中文 */
export function t(text) {
  if (curLocale === 'zh-CN') return text;
  const d = DICTS.get(curLocale);
  return (d && d[text]) || text;
}

/** 带占位符的文案：{n} 匹配数字，{x} 匹配任意文字；整句不匹配时按“片段”逐条替换 */
const PATTERNS = new Map();     // localeId → [[regex, 模板]]
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function buildPatterns(id, d) {
  const out = [];
  for (const [key, val] of Object.entries(d)) {
    if (!key.includes('{n}') && !key.includes('{x}')) continue;
    const src = key.split(/(\{n\}|\{x\})/).map((part) => (
      part === '{n}' ? '(\\d+)' : part === '{x}' ? '(.+?)' : escRe(part)
    )).join('');
    out.push([key, new RegExp(src, 'g'), val]);
  }
  out.sort((a, b) => b[0].length - a[0].length);     // 长的先换，避免被短片段抢先
  PATTERNS.set(id, out);
  return out;
}
function applyPatterns(id, text) {
  let list = PATTERNS.get(id);
  if (!list) list = buildPatterns(id, DICTS.get(id) || {});
  let out = text;
  for (const [, rx, val] of list) {
    out = out.replace(rx, (...args) => {
      const caps = args.slice(1, args.length - 2);
      let i = 0;
      return val.replace(/\{(?:n|x)\}/g, () => caps[i++] != null ? caps[i - 1] : '');
    });
  }
  return out === text ? null : out;
}

/** 需要换语言的静态节点：data-i18n 里的值就是中文原文 */
export function translateNode(root) {
  if (!root || curLocale === 'zh-CN') return;
  const d = DICTS.get(curLocale);
  if (!d) return;
  const walk = (node) => {
    if (node.nodeType === 3) {
      const raw = node.nodeValue;
      const key = raw && raw.trim();
      if (key && d[key]) { node.nodeValue = raw.replace(key, d[key]); return; }
      if (key) {
        const hit = applyPatterns(curLocale, key);
        if (hit) node.nodeValue = raw.replace(key, hit);
      }
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.hasAttribute && node.hasAttribute('data-no-i18n')) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const val = node.getAttribute && node.getAttribute(attr);
      if (val && d[val]) node.setAttribute(attr, d[val]);
    }
    for (const child of [...node.childNodes]) walk(child);
  };
  walk(root);
}
