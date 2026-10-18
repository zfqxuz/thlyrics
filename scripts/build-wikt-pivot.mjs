#!/usr/bin/env node
/**
 * 用英文维基词典的「翻译表」补内容：
 *   英语词条 X 的 translations 里同时有 fr/de/es/pt/ru/ko/ja/zh 的对应词，
 *   于是可以顺着英文这个「轴」把两个语言对起来：maison ← house → 房子。
 *
 * 产出（都能被 build-multilang-packs.mjs 合并）：
 *   data/wikt/gloss-<lang>-zh.json   词 → 中文释义（只收词库里还没有的词）
 *   data/wikt/pairs-<lang>-en.json   词 → 英文对应词（L→en 释义层）
 *   data/wikt/pairs-<lang>-ja.json   词 → 日文对应词（L→ja 释义层）
 *
 * 输入：data/freq/en-extract.jsonl（kaikki.org 导出的英文维基词典，约 3.3GB）
 * 许可：Wiktionary 文本 CC BY-SA 3.0
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = process.env.WIKT_DUMP || path.join(ROOT, 'data', 'freq', 'en-extract.jsonl');
const OUT = path.join(ROOT, 'data', 'wikt');
const LANGS = ['fr', 'de', 'es', 'pt', 'ru', 'ko', 'ja'];
const TOP_N = 20000;

const readJson = (p, f) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : f);
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

const SCRIPT = {
  ru: /^[\u0400-\u04ff\-]+$/,
  ko: /^[\uac00-\ud7af]+$/,
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/,
  zh: /^[\u4e00-\u9fff]+$/,
  latin: /^[a-zA-ZÀ-ÿŒœŸÿßÇçÑñ'’\- ]+$/,
};
const okWord = (lang, w) => {
  const s = String(w || '').trim();
  if (!s || s.length > 40) return false;
  if (lang === 'ru') return SCRIPT.ru.test(s);
  if (lang === 'ko') return SCRIPT.ko.test(s);
  if (lang === 'ja') return SCRIPT.ja.test(s);
  if (lang === 'zh') return SCRIPT.zh.test(s);
  return SCRIPT.latin.test(s) && s.length > 1;
};
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** 目标词集合：词频前 2 万 ∪ 现有词库 */
function wanted(lang) {
  const set = new Set();
  const f = path.join(ROOT, 'data', 'freq', `${lang}_50k.txt`);
  if (fs.existsSync(f)) {
    const lines = fs.readFileSync(f, 'utf8').split('\n').slice(0, TOP_N);
    for (const line of lines) { const w = line.split(/\s+/)[0]; if (w) set.add(w.toLowerCase()); }
  }
  const lex = readJson(path.join(ROOT, 'docs', 'data', lang, 'lexicon.json'), null);
  for (const e of (lex && lex.entries) || []) set.add(String(e.word).toLowerCase());
  return set;
}

const WANT = new Map(LANGS.map((l) => [l, wanted(l)]));
const existing = new Map(LANGS.map((l) => {
  const lex = readJson(path.join(ROOT, 'docs', 'data', l, 'lexicon.json'), null);
  return [l, new Set(((lex && lex.entries) || []).map((e) => String(e.word).toLowerCase()))];
}));

const zhGloss = new Map(LANGS.map((l) => [l, new Map()]));   // lang → word → [zh...]
const enPair = new Map(LANGS.map((l) => [l, new Map()]));    // lang → word → [en lemma...]
const jaPair = new Map(LANGS.map((l) => [l, new Map()]));    // lang → word → [ja...]

const push = (map, key, val, cap = 3) => {
  const arr = map.get(key);
  if (!arr) { map.set(key, [val]); return; }
  if (arr.length < cap && !arr.includes(val)) arr.push(val);
};

if (!fs.existsSync(DUMP)) { console.error('没有 data/freq/en-extract.jsonl'); process.exit(1); }

const rl = readline.createInterface({ input: fs.createReadStream(DUMP), crlfDelay: Infinity });
let n = 0, withTr = 0, kept = 0;
for await (const line of rl) {
  n++;
  if (n % 200000 === 0) console.log('·', n, '条', 'kept', kept);
  if (line.length < 20) continue;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  if (o.lang_code && o.lang_code !== 'en') continue;
  const senses = o.senses || [];
  let byLang = null;
  for (const s of senses) {
    const ts = s.translations;
    if (!ts || !ts.length) continue;
    if (!byLang) byLang = {};
    for (const t of ts) {
      const code = String(t.lang_code || t.code || '').toLowerCase();
      const w = clean(t.word);
      if (!code || !w) continue;
      const lang = code === 'cmn' ? 'zh' : code;
      if (lang !== 'zh' && LANGS.indexOf(lang) < 0) continue;
      if (!okWord(lang, w)) continue;
      (byLang[lang] || (byLang[lang] = [])).push(w);
    }
  }
  if (!byLang) continue;
  withTr++;
  const zh = [...new Set(byLang.zh || [])].slice(0, 3);
  const enWord = clean(o.word).toLowerCase();
  const jaWords = [...new Set((byLang.ja || []).map((x) => x.toLowerCase()))].slice(0, 2);
  for (const lang of LANGS) {
    const words = [...new Set((byLang[lang] || []).map((w) => w.toLowerCase()))]
      .filter((w) => WANT.get(lang).has(w));
    if (!words.length) continue;
    kept += words.length;
    for (const w of words) {
      if (zh.length && !existing.get(lang).has(w)) for (const g of zh) push(zhGloss.get(lang), w, g);
      if (enWord) push(enPair.get(lang), w, enWord);
      if (lang !== 'ja') for (const j of jaWords) push(jaPair.get(lang), w, j, 2);
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
for (const lang of LANGS) {
  const g = zhGloss.get(lang);
  const glosses = {};
  for (const [w, arr] of g) glosses[w] = arr.join('；');
  writeJson(path.join(OUT, `gloss-${lang}-zh.json`), {
    id: `${lang}-zh-pivot`, learnLang: lang, explainLang: 'zh',
    source: 'en-wiktionary-translations', count: Object.keys(glosses).length, glosses,
  });
  const eu = {};
  for (const [w, arr] of enPair.get(lang)) eu[w] = arr;
  writeJson(path.join(OUT, `pairs-${lang}-en.json`), {
    id: `${lang}-en`, learnLang: lang, explainLang: 'en',
    source: 'en-wiktionary-translations', count: Object.keys(eu).length, glosses: eu,
  });
  const ju = {};
  for (const [w, arr] of jaPair.get(lang)) ju[w] = arr;
  if (Object.keys(ju).length) writeJson(path.join(OUT, `pairs-${lang}-ja.json`), {
    id: `${lang}-ja`, learnLang: lang, explainLang: 'ja',
    source: 'en-wiktionary-translations', count: Object.keys(ju).length, glosses: ju,
  });
  console.log(`✓ ${lang}: 补释义 ${Object.keys(glosses).length} · en 对 ${Object.keys(eu).length} · ja 对 ${Object.keys(ju).length}`);
}
console.log('✓ 扫完', n, '条，其中有翻译', withTr, '，命中目标词', kept);
