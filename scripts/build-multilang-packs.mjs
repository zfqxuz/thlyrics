#!/usr/bin/env node
/**
 * 多语言内容包（法语/德语/西语/葡语/俄语/韩语）。
 *
 * 输入（本机，不进 git；见 docs/CONTENT-PACKS.md）：
 *   data/freq/<lang>_50k.txt      hermitdave/FrequencyWords（MIT），OpenSubtitles 语料词频
 *   data/freq/zh-extract.jsonl.gz kaikki.org 导出的中文维基词典（CC BY-SA 3.0）
 *   data/ko-topik.tsv             NIKL + TOPIK 词汇表（julienshim/combined_korean_vocabulary_list，MIT）
 *
 * 输出：
 *   docs/data/<lang>/lexicon.json
 *   docs/data/<lang>/lists/<band>.json
 *   docs/data/<lang>/pairs/<lang>-zh.json
 *   docs/data/<lang>/manifest.json
 *   docs/data/content-report.json（合并 en/ja 的结果）
 *
 * 原则：
 *   - 释义只取词典里真实存在的中文释义，不做机器翻译填空；
 *   - 频率分档是“语料词频档”，不是官方 CEFR/TRKI 词表，manifest 里如实标注；
 *   - 韩语另有 NIKL(A/B/C) 与 TOPIK(초급/중급) 真实等级标签。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'data');
const FREQ = path.join(ROOT, 'data', 'freq');
const ZH_DUMP = path.join(FREQ, 'zh-extract.jsonl.gz');
const KO_TSV = path.join(ROOT, 'data', 'ko-topik.tsv');

const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };
const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
const clean = (s) => String(s || '')
  .replace(/\r/g, '').replace(/\n+/g, '；').replace(/\s+/g, ' ').replace(/；+/g, '；').trim()
  .replace(/^[；;、,，\s]+|[；;、,，\s]+$/g, '');

const LANGS = [
  { id: 'fr', name: 'Français', system: 'freq', src: 'zh-wiktionary' },
  { id: 'de', name: 'Deutsch', system: 'freq', src: 'zh-wiktionary' },
  { id: 'es', name: 'Español', system: 'freq', src: 'zh-wiktionary' },
  { id: 'pt', name: 'Português', system: 'freq', src: 'zh-wiktionary' },
  { id: 'ru', name: 'Русский', system: 'freq', src: 'zh-wiktionary' },
  { id: 'ko', name: '한국어', system: 'topik', src: 'zh-wiktionary' },
];

/** 语料词频分档：档位是覆盖率语义，不冒充 CEFR */
export const BANDS = [
  { id: 'core', max: 1000, label: '最高频 1000' },
  { id: 'basic', max: 3000, label: '高频 3000' },
  { id: 'common', max: 6000, label: '常用 6000' },
  { id: 'wide', max: 10000, label: '进阶 10000' },
  { id: 'extra', max: 20000, label: '扩展 20000' },
];
const bandOf = (rank) => (BANDS.find((b) => rank <= b.max) || BANDS[BANDS.length - 1]).id;

/** 词形变化条目（“xxx 的复数形式”）不进学习词条，交给运行时词干回退匹配 */
const FORM_GLOSS = /(的)?(复数|單數|单数|複數|过去式|過去式|现在时|現在時|将来时|將來時|分词|分詞|变形|變形|变格|變格|比较级|比較級|最高级|最高級|阴性|陰性|阳性|陽性|属格|屬格|与格|與格|宾格|賓格|呼格|工具格|前置格|第一人称|第一人稱|第二人称|第二人稱|第三人称|第三人稱|缩写|縮寫|简写|簡寫|拼写错误|拼寫錯誤|变体|變體|异体|異體|形式|形)$/;
const formLike = (pos, gloss) => /form|inflection/i.test(String(pos || '')) || FORM_GLOSS.test(gloss);

/** “der 的主格/賓格單數陰性”“машина 的複數”“너를” 这类活用形：记下原形，挂到原形词条的 forms 上 */
const FORM_OF = /^(.{1,24}?)\s*(?:\([^)]*\))?\s*的\s*(.{0,48})$/;
const INFLECT_TAIL = /(複數|复数|單數|单数|過去|过去|現在|现在|將來|将来|分詞|分词|變形|变形|變格|变格|變位|变位|比較級|比较级|最高級|最高级|陰性|阴性|陽性|阳性|屬格|属格|與格|与格|賓格|宾格|主格|呼格|工具格|前置格|屈折|形式|變體|变体|異體|异体|縮寫|缩写|拼寫|拼写)/;
function formOf(gloss, pos) {
  if (/form|inflection/i.test(String(pos || ''))) return { form: true, of: null };
  const m = FORM_OF.exec(gloss);
  if (m && INFLECT_TAIL.test(m[2])) {
    const of = m[1].trim().replace(/^[-–—]\s*/, '');
    return { form: true, of: of && of.length <= 24 ? of.toLowerCase() : null };
  }
  return null;
}

const POS_MAP = new Map([
  ['noun', '名詞'], ['verb', '動詞'], ['adj', '形容詞'], ['adv', '副詞'], ['pron', '代詞'],
  ['prep', '介詞'], ['conj', '連詞'], ['det', '限定詞'], ['article', '冠詞'], ['num', '數詞'],
  ['intj', '感嘆詞'], ['particle', '助詞'], ['phrase', '短語'], ['name', '專名'], ['prefix', '前綴'],
  ['suffix', '後綴'], ['postp', '後置詞'], ['interj', '感嘆詞'], ['contraction', '縮約形'],
]);

const WORD_OK = /^[\p{L}][\p{L}'’\-]*$/u;

function loadFreq(lang) {
  const p = path.join(FREQ, lang + '_50k.txt');
  if (!fs.existsSync(p)) return null;
  const map = new Map();
  let i = 0;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const w = line.split(/\s+/)[0];
    i++;
    const k = w.toLowerCase();
    if (!map.has(k)) map.set(k, i);
  }
  return map;
}

function loadKoreanLevels() {
  if (!fs.existsSync(KO_TSV)) return null;
  const lines = fs.readFileSync(KO_TSV, 'utf8').split('\n').filter((l) => l.trim());
  const head = lines.shift().split('\t').map((x) => x.trim());
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = new Map();
  for (const line of lines) {
    const c = line.split('\t');
    let word = String(c[col.word] || '').trim();
    if (!word) continue;
    word = word.replace(/\d{2}$/, '');            // 가구03 → 가구
    const rec = out.get(word) || { nikl: '', topik: '' };
    const nikl = String(c[col.nikl_level] || '').trim();
    const topik = String(c[col.topik_level] || '').trim();
    if (nikl) rec.nikl = nikl;
    if (topik) rec.topik = topik;
    out.set(word, rec);
  }
  return out;
}

async function scanZhDump(want, freq, koLevels) {
  const acc = new Map();                            // lang → Map(word → entry)
  for (const L of LANGS) acc.set(L.id, new Map());
  if (!fs.existsSync(ZH_DUMP)) return acc;
  const rl = readline.createInterface({ input: fs.createReadStream(ZH_DUMP).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const lang = o.lang_code;
    if (!want.has(lang)) continue;
    const raw = String(o.word || o.title || '').trim();
    if (!raw || !WORD_OK.test(raw)) continue;
    const key = raw.toLowerCase();
    const rank = freq.get(lang)?.get(key);
    const lv = lang === 'ko' && koLevels ? koLevels.get(raw) : null;
    if (!rank && !(lv && (lv.topik || lv.nikl))) continue;
    const glosses = [];
    for (const s of (o.senses || []).slice(0, 3)) {
      for (const g of (s.glosses || []).slice(0, 1)) {
        const t = clean(g);
        if (t && t.length <= 120 && !glosses.includes(t)) glosses.push(t);
      }
    }
    if (!glosses.length) continue;
    const store = acc.get(lang);
    const cur = store.get(key);
    const pos = POS_MAP.get(String(o.pos || '').toLowerCase()) || undefined;
    const disp = (pos === '專名' || String(o.pos || '') === 'name') ? raw : key;
    if (!cur) {
      const fo = formOf(glosses[0], o.pos);
      store.set(key, {
        word: disp, pos, glosses: glosses.slice(0, 3), rank: rank || 0,
        formLike: !!fo || formLike(o.pos, glosses.join('；')),
        formOf: fo && fo.of ? fo.of : '',
        topik: lv ? lv.topik : '', nikl: lv ? lv.nikl : '',
      });
    } else {
      if (!cur.pos && pos) cur.pos = pos;
      if (cur.word !== disp && disp === key) cur.word = disp;   // 优先用小写词形
      if (rank && (!cur.rank || rank < cur.rank)) cur.rank = rank;
      if (lv) { cur.topik = cur.topik || lv.topik; cur.nikl = cur.nikl || lv.nikl; }
      for (const g of glosses) if (cur.glosses.length < 3 && !cur.glosses.includes(g)) cur.glosses.push(g);
      if (!cur.formOf) { const fo2 = formOf(glosses[0], o.pos); if (fo2 && fo2.of) cur.formOf = fo2.of; }
    }
  }
  return acc;
}

const FREQ_MAP = new Map();
function freqGet(lang) { return FREQ_MAP.get(lang); }

function buildLang(L, store) {
  const entries = [];
  const pairs = {};
  const bandIds = new Map(BANDS.map((b) => [b.id, []]));
  const koLists = { 1: [], 2: [] };
  const koNikl = { A: [], B: [], C: [] };
  // 先确定哪些是词条本体（有词频/有等级注解、且不是活用形）
  const lemmas = new Map();
  for (const [key, v] of store) if (!v.formLike && (v.rank || v.topik || v.nikl)) lemmas.set(key, v);
  const aliases = new Map();                      // lemma key → [活用形]
  for (const [key, v] of store) {
    if (!v.formLike) continue;
    const of = (v.formOf || '').toLowerCase();
    if (!of || !lemmas.has(of) || of === key) continue;
    if (!aliases.has(of)) aliases.set(of, []);
    aliases.get(of).push(v.word);
  }
  for (const [key, v] of store) {
    if (v.formLike) continue;                        // 只留词条本体
    if (!v.rank && !v.topik && !v.nikl) continue;
    const id = `${L.id}:${v.word}`;
    const meaning = v.glosses[0];
    const levels = [];
    let band = null;
    if (v.rank) {
      band = bandOf(v.rank);
      levels.push({ system: 'freq', level: band, list: `${L.id}-${band}` });
    }
    if (L.id === 'ko') {
      if (v.topik) {
        const lv = v.topik === '초급' ? '1' : v.topik === '중급' ? '2' : '';
        if (lv) levels.push({ system: 'topik', level: lv, list: `ko-topik-${lv}` });
      }
      if (v.nikl) levels.push({ system: 'nikl', level: v.nikl.toLowerCase(), list: `ko-nikl-${v.nikl.toLowerCase()}` });
    }
    entries.push({
      id, lang: L.id, word: v.word, lemma: v.word, pos: v.pos,
      meaning, meanings: { zh: v.glosses.join('；') },
      levels, freq: v.rank || 999999,
      forms: aliases.has(key) ? { exchange: aliases.get(key).map((w) => 'f:' + w).join('/') } : {},
    });
    pairs[id] = v.glosses.join('；');
    if (band) bandIds.get(band).push(id);
    if (L.id === 'ko') {
      if (v.topik === '초급') koLists[1].push(id);
      else if (v.topik === '중급') koLists[2].push(id);
      if (v.nikl === 'A') koNikl.A.push(id);
      else if (v.nikl === 'B') koNikl.B.push(id);
      else if (v.nikl === 'C') koNikl.C.push(id);
    }
  }
  // 高频虚词补充：中文维基词典对 der / und / de / para 这类词常常只给活用描述甚至没有释义，
  // 而它们恰恰是歌词里出现最多的词。这里用人工核对过的虚词表补上，并单列一档。
  const funcIds = [];
  const seenWord = new Set(entries.map((e) => e.word.toLowerCase()));
  for (const c of loadCurated(L.id)) {
    const key = c.word.toLowerCase();
    if (seenWord.has(key)) continue;
    seenWord.add(key);
    const id = `${L.id}:${c.word}`;
    const rank = (freqGet(L.id) || new Map()).get(key) || 0;
    const levels = [{ system: 'func', level: 'core', list: `${L.id}-func` }];
    if (rank) levels.unshift({ system: 'freq', level: bandOf(rank), list: `${L.id}-${bandOf(rank)}` });
    entries.push({
      id, lang: L.id, word: c.word, lemma: c.word, pos: c.pos,
      meaning: c.zh, meanings: { zh: c.zh }, levels, freq: rank || 999998, forms: {},
    });
    pairs[id] = c.zh;
    funcIds.push(id);
    if (rank) bandIds.get(bandOf(rank)).push(id);
  }
  entries.sort((a, b) => (a.freq - b.freq) || a.word.localeCompare(b.word));
  const byId = new Map(entries.map((x) => [x.id, x]));
  const sortIds = (ids) => ids.sort((a, b) => (byId.get(a).freq - byId.get(b).freq) || a.localeCompare(b));
  const lists = [];
  for (const b of BANDS) {
    const ids = sortIds(bandIds.get(b.id));
    if (!ids.length) continue;
    const file = `${L.id}/lists/${b.id}.json`;
    writeJson(path.join(OUT, file), {
      id: `${L.id}-${b.id}`, lang: L.id, system: 'freq', label: b.label,
      count: ids.length, wordIds: ids, words: ids.map((id) => byId.get(id).word),
    });
    lists.push({ id: `${L.id}-${b.id}`, label: b.label, file, count: ids.length, system: 'freq' });
  }
  if (funcIds.length) {
    const ids = sortIds(funcIds);
    const file = `${L.id}/lists/func.json`;
    writeJson(path.join(OUT, file), { id: `${L.id}-func`, lang: L.id, system: 'func', label: '核心虚词', count: ids.length, wordIds: ids, words: ids.map((id) => byId.get(id).word) });
    lists.unshift({ id: `${L.id}-func`, label: '核心虚词', file, count: ids.length, system: 'func' });
  }
  if (L.id === 'ko') {
    const extra = [
      ['ko-topik-1', 'TOPIK I（초급）', sortIds(koLists[1])],
      ['ko-topik-2', 'TOPIK II（중급）', sortIds(koLists[2])],
      ['ko-nikl-a', 'NIKL A（初級）', sortIds(koNikl.A)],
      ['ko-nikl-b', 'NIKL B（中級）', sortIds(koNikl.B)],
      ['ko-nikl-c', 'NIKL C（高級）', sortIds(koNikl.C)],
    ];
    for (const [id, label, ids] of extra) {
      if (!ids.length) continue;
      const file = `ko/lists/${id}.json`;
      writeJson(path.join(OUT, file), { id, lang: 'ko', system: id.includes('topik') ? 'topik' : 'nikl', label, count: ids.length, wordIds: ids, words: ids.map((x) => byId.get(x).word) });
      lists.push({ id, label, file, count: ids.length, system: id.includes('topik') ? 'topik' : 'nikl' });
    }
  }
  writeJson(path.join(OUT, L.id, 'lexicon.json'), {
    id: L.id, lang: L.id, version: new Date().toISOString().slice(0, 10),
    source: '中文维基词典（CC BY-SA 3.0）+ FrequencyWords（MIT）',
    count: entries.length, entries,
  });
  writeJson(path.join(OUT, L.id, 'pairs', `${L.id}-zh.json`), {
    id: `${L.id}-zh`, learnLang: L.id, explainLang: 'zh',
    count: Object.keys(pairs).length, glosses: pairs,
  });
  const notes = ['释义来自中文维基词典，不是机器翻译。'];
  notes.push('分档用 OpenSubtitles 语料词频（最高频 1000 / 3000 / 6000 / 10000 / 20000），是覆盖率档位，不是官方 CEFR/TRKI 词表。');
  if (L.id === 'ko') notes.push('韩语另有 NIKL(A/B/C) 与 TOPIK(초급/중급) 官方等级标签。');
  writeJson(path.join(OUT, L.id, 'manifest.json'), {
    id: L.id, lang: L.id, version: new Date().toISOString().slice(0, 10),
    lexicon: `${L.id}/lexicon.json`, pairs: [`${L.id}-zh`],
    lists, source: '中文维基词典（CC BY-SA 3.0）+ FrequencyWords（MIT）', notes,
  });
  // 覆盖率：语料前 N 高频词里，多少能在词包里查到（含活用形别名）
  const freq = freqGet(L.id) || new Map();
  const known = new Set(entries.map((e) => e.word.toLowerCase()));
  for (const e of entries) for (const part of String((e.forms || {}).exchange || '').split('/')) {
    const at = part.indexOf(':');
    if (at >= 0) known.add(part.slice(at + 1).trim().toLowerCase());
  }
  const cover = {};
  for (const n of [1000, 3000, 10000]) {
    const words = [...freq.entries()].filter(([, r]) => r <= n).map(([w]) => w);
    const hit = words.filter((w) => known.has(w)).length;
    cover['top' + n] = words.length ? Math.round((hit / words.length) * 1000) / 10 : 0;
  }
  return { entries: entries.length, func: funcIds.length, coverage: cover, lists: Object.fromEntries(lists.map((x) => [x.label, x.count])), bands: Object.fromEntries(BANDS.map((b) => [b.id, bandIds.get(b.id).length])) };
}

function loadCurated(lang) {
  const f = path.join(ROOT, 'data', 'function-words', lang + '.json');
  if (!fs.existsSync(f)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    return (Array.isArray(arr) ? arr : []).filter((x) => Array.isArray(x) && x[0] && x[2])
      .map(([word, pos, zh]) => ({ word: String(word), pos: String(pos || ''), zh: String(zh) }));
  } catch { return []; }
}

const want = new Set(LANGS.map((x) => x.id));
const freqAll = new Map(LANGS.map((L) => [L.id, loadFreq(L.id) || new Map()]));
for (const [k, v] of freqAll) FREQ_MAP.set(k, v);
const koLevels = loadKoreanLevels();
const acc = await scanZhDump(want, freqAll, koLevels);
const report = readJson(path.join(OUT, 'content-report.json'), {});
let total = 0;
for (const L of LANGS) {
  const r = buildLang(L, acc.get(L.id));
  report[L.id] = r;
  total += r.entries;
  console.log(`✓ ${L.id}: ${r.entries} 词条 / ${r.entries} 释义`, r.bands || {});
}
report.generatedAt = new Date().toISOString();
writeJson(path.join(OUT, 'content-report.json'), report);
console.log('✓ 多语言内容包（fr/de/es/pt/ru/ko）：', total, '词条');
