#!/usr/bin/env node
/**
 * 多语言内容包：英语 + 日语的第一版词库/等级词表。
 *
 * 输入：
 *   data/ecdict/ecdict.csv   （ECDICT，MIT；英文词条 + 考试标签 + 中文释义）
 *   docs/data/index.json     （现有日语词库）
 *
 * 输出：
 *   docs/data/en/lexicon.json
 *   docs/data/en/lists/<exam>.json
 *   docs/data/en/pairs/en-zh.json
 *   docs/data/ja/lists/<biaori|jlpt>.json
 *   docs/data/ja/pairs/ja-zh.json
 *   docs/data/content-report.json
 *
 * 只生成“共享词库 + 等级词表 + 语言对释义层”，不是每个考试复制一本词典。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'data');
const ECDICT = path.join(ROOT, 'data', 'ecdict', 'ecdict.csv');
const JA_INDEX = path.join(OUT, 'index.json');

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };
const clean = (s) => String(s || '').replace(/\\r\\n/g, '；').replace(/\\n/g, '；').replace(/\\r/g, '；').replace(/\r/g, '').replace(/\n+/g, '；').replace(/\s+/g, ' ').trim();
const inferPos = (t) => { const x = String(t || ''); if (/^(vt|vi|v)\./i.test(x)) return '動詞'; if (/^(n)\./i.test(x)) return '名詞'; if (/^(a|adj)\./i.test(x)) return '形容詞'; if (/^(adv)\./i.test(x)) return '副詞'; return '名詞'; };

/** 流式 CSV 解析（ECDICT 带引号、逗号、换行，不能按行 split） */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const TAGS = [
  ['zk', '中考', 'zhongkao'],
  ['gk', '高考', 'gaokao'],
  ['cet4', 'CET-4', 'cet4'],
  ['cet6', 'CET-6', 'cet6'],
  ['ky', '考研', 'kaoyan'],
  ['ielts', 'IELTS', 'ielts'],
  ['toefl', 'TOEFL', 'toefl'],
  ['gre', 'GRE', 'gre'],
];
const TAG_BY_ID = new Map(TAGS.map(([id, label, key]) => [id, { id, label, key }]));

function buildEnglish() {
  if (!fs.existsSync(ECDICT)) {
    console.log('· 跳过英语：没有 data/ecdict/ecdict.csv');
    return null;
  }
  const text = fs.readFileSync(ECDICT, 'utf8');
  const rows = parseCsv(text);
  const head = rows.shift();
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const lexicon = [];
  const lists = Object.fromEntries(TAGS.map(([id]) => [id, []]));
  const pairs = {};
  const seen = new Set();
  for (const r of rows) {
    const raw = String(r[col.word] || '').trim();
    const word = raw.toLowerCase();
    if (!/^[a-z][a-z' -]*$/.test(word)) continue;
    const tag = String(r[col.tag] || '').split(/\s+/).filter((x) => TAG_BY_ID.has(x));
    if (!tag.length) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    const trans = clean(r[col.translation] || '');
    if (!trans) continue;
    const id = 'en:' + word;
    const phonetic = clean(r[col.phonetic] || '');
    const pos = clean(r[col.pos] || '') || inferPos(trans);
    const bnc = Number(r[col.bnc] || 0) || 0;
    const frq = Number(r[col.frq] || 0) || 0;
    const levels = tag.map((x) => ({ system: TAG_BY_ID.get(x).key, level: x === 'gk' ? 'core' : 'required', list: x }));
    lexicon.push({ id, lang: 'en', word, lemma: word, reading: phonetic || undefined, phonetic: phonetic || undefined, pos: pos || undefined, meaning: trans, meanings: { zh: trans }, levels, freq: frq || bnc || 999999, forms: r[col.exchange] ? { exchange: String(r[col.exchange]).split('/').filter((part) => {
        const at = part.indexOf(':');
        if (at < 0) return false;
        const code = part.slice(0, at).trim();
        const form = part.slice(at + 1).trim();
        return /^[pdi3srt]$/.test(code) && form.length >= 2;
      }).join('/') } : undefined });
    pairs[id] = trans;
    for (const x of tag) lists[x].push(id);
  }
  // 按考试内频率排序：先按 frq，再按字母，保证“梯度”不是随机顺序
  const byId = new Map(lexicon.map((x) => [x.id, x]));
  for (const [tag, ids] of Object.entries(lists)) {
    ids.sort((a, b) => (byId.get(a).freq - byId.get(b).freq) || a.localeCompare(b));
    const words = ids.map((id) => byId.get(id).word);
    writeJson(path.join(OUT, 'en', 'lists', tag + '.json'), {
      id: 'en-' + tag, lang: 'en', system: TAG_BY_ID.get(tag).key,
      label: TAG_BY_ID.get(tag).label, count: ids.length, wordIds: ids, words,
    });
  }
  writeJson(path.join(OUT, 'en', 'lexicon.json'), {
    id: 'en', lang: 'en', version: new Date().toISOString().slice(0, 10),
    source: 'ECDICT (MIT)', count: lexicon.length, entries: lexicon,
  });
  writeJson(path.join(OUT, 'en', 'pairs', 'en-zh.json'), { id: 'en-zh', learnLang: 'en', explainLang: 'zh', count: Object.keys(pairs).length, glosses: pairs });
  fs.mkdirSync(path.join(OUT, 'en'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'ecdict', 'LICENSE-ECDICT.txt'), path.join(OUT, 'en', 'LICENSE-ECDICT.txt'));
  writeJson(path.join(OUT, 'en', 'manifest.json'), {
    id: 'en', version: new Date().toISOString().slice(0, 10), lang: 'en',
    lexicon: 'en/lexicon.json', pairs: ['en-zh'], lists: TAGS.map(([id, label, key]) => ({ id: 'en-' + id, label, file: `en/lists/${id}.json`, count: lists[id].length })),
    source: 'ECDICT (MIT)', note: '考试标签来自 ECDICT；GRE/IELTS/TOEFL 是高频/考试参考标签，不是官方固定词表。',
  });
  return { entries: lexicon.length, lists: Object.fromEntries(TAGS.map(([id, label]) => [label, lists[id].length])) };
}

function biaoriScope(br) {
  if (!br || !br.bk) return null;
  const map = { '初级上': 'biaori-1a', '初级下': 'biaori-1b', '中级上': 'biaori-2a', '中级下': 'biaori-2b' };
  return map[br.bk] || null;
}

function buildJapanese() {
  const idx = readJson(JA_INDEX, null);
  if (!idx || !Array.isArray(idx.vocab) || !idx.vocab.length) {
    console.log('· 跳日语：docs/data/index.json 没有 vocab');
    return null;
  }
  const lists = {};
  const pairs = {};
  const put = (id, v) => { if (!lists[id]) lists[id] = []; lists[id].push(v.id); };
  for (const v of idx.vocab) {
    word(v);
    const b = biaoriScope(v.br);
    if (b) put(b, v);
    if (v.jl) put('jlpt-' + v.jl, v);
    if (v.meaning) pairs['ja:' + v.id] = v.meaning;
  }
  function word() {}
  const meta = {
    'biaori-1a': '标日初级上', 'biaori-1b': '标日初级下', 'biaori-2a': '标日中级上', 'biaori-2b': '标日中级下',
    'jlpt-5': 'N5', 'jlpt-4': 'N4', 'jlpt-3': 'N3', 'jlpt-2': 'N2', 'jlpt-1': 'N1',
  };
  for (const [id, b] of Object.entries(lists)) {
    writeJson(path.join(OUT, 'ja', 'lists', id + '.json'), {
      id: 'ja-' + id, lang: 'ja', system: id.indexOf('biaori') === 0 ? 'biaori' : 'jlpt',
      label: meta[id] || id, count: b.length, wordIds: b,
    });
  }
  writeJson(path.join(OUT, 'ja', 'pairs', 'ja-zh.json'), { id: 'ja-zh', learnLang: 'ja', explainLang: 'zh', count: Object.keys(pairs).length, glosses: pairs });
  writeJson(path.join(OUT, 'ja', 'manifest.json'), {
    id: 'ja', lang: 'ja', version: idx.generatedAt || new Date().toISOString().slice(0, 10),
    source: '现有 THBWiki/标日/JLPT 词库',
    lists: Object.entries(lists).map(([id, b]) => ({ id: 'ja-' + id, label: meta[id] || id, file: `ja/lists/${id}.json`, count: b.length })),
  });
  return { entries: idx.vocab.length, lists: Object.fromEntries(Object.entries(lists).map(([id, b]) => [meta[id] || id, b.length])) };
}

const en = buildEnglish();
const ja = buildJapanese();
writeJson(path.join(OUT, 'content-report.json'), { generatedAt: new Date().toISOString(), en, ja });
console.log('✓ 多语言内容包');
if (en) console.log('  英语:', en.entries, '词', en.lists);
if (ja) console.log('  日语:', ja.entries, '词', ja.lists);
