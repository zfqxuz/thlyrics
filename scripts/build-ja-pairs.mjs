#!/usr/bin/env node
/**
 * 日语 → 英语/中文 释义层：从 kaikki.org 的英文维基词典日语导出里取英文释义。
 *
 * 输入：data/freq/ja-extract.jsonl（kaikki.org/dictionary/Japanese，约 385MB）
 * 输出：docs/data/ja/pairs/ja-en.json（词 → 英文释义）
 *      docs/data/ja/pairs/ja-zh.json 若不存在则从 index.json 的 meaning 生成
 *
 * 只收 docs/data/index.json 里已有的日语词，保证「学词页出现的词」有释义。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = process.env.JA_DUMP || path.join(ROOT, 'data', 'freq', 'ja-extract.jsonl');
const OUT = path.join(ROOT, 'docs', 'data', 'ja');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'index.json'), 'utf8'));
const vocab = index.vocab || [];

const want = new Map();          // 词形 → 词条
for (const v of vocab) {
  if (v.word) want.set(v.word, v);
  if (v.reading && !want.has(v.reading)) want.set(v.reading, v);
}

const POS_OK = /^(noun|verb|adj|adv|name|phrase|intj|conj|particle|pron|num|pref|suf|exp)$/;
const best = new Map();          // 词 → { gloss, pos, score }

/** 兜底：没有 kaikki 导出时，用 OMW 的日文/英文 wordnet 走 synset 对齐（覆盖约三分之一常用词） */
function fromOmw() {
  const load = (f) => {
    const p = path.join(ROOT, 'data', 'omw', f);
    const map = new Map();
    if (!fs.existsSync(p)) return map;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line || line[0] === '#') continue;
      const parts = line.split('\t');
      if (parts.length < 3 || !parts[1].endsWith('lemma')) continue;
      let set = map.get(parts[0]);
      if (!set) map.set(parts[0], set = new Set());
      set.add(parts[2].replace(/_/g, ' ').trim());
    }
    return map;
  };
  const jpn = load('wn-jpn.tab'), eng = load('wn-eng.tab');
  const out = {};
  for (const [syn, lemmas] of jpn) {
    const e = eng.get(syn);
    if (!e) continue;
    const gloss = [...e].slice(0, 2).join('; ');
    for (const w of lemmas) if (want.has(w) && !out[w]) out[w] = gloss;
  }
  return out;
}

if (!fs.existsSync(DUMP)) {
  const glosses = fromOmw();
  fs.mkdirSync(path.join(OUT, 'pairs'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pairs', 'ja-en.json'), JSON.stringify({
    id: 'ja-en', learnLang: 'ja', explainLang: 'en',
    source: 'Open Multilingual WordNet (WordNet license)',
    count: Object.keys(glosses).length, glosses,
  }));
  const zh = {};
  for (const v of vocab) if (v.word && v.meaning) zh[v.word] = v.meaning;
  fs.writeFileSync(path.join(OUT, 'pairs', 'ja-zh.json'), JSON.stringify({
    id: 'ja-zh', learnLang: 'ja', explainLang: 'zh', count: Object.keys(zh).length, glosses: zh,
  }));
  const mf = path.join(OUT, 'manifest.json');
  if (fs.existsSync(mf)) {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.pairs = ['ja-zh', 'ja-en'];
    fs.writeFileSync(mf, JSON.stringify(m));
  }
  console.log('✓ ja-en（OMW 兜底）', Object.keys(glosses).length, '/', vocab.length, '· ja-zh', Object.keys(zh).length);
  process.exit(0);
}
const rl = readline.createInterface({ input: fs.createReadStream(DUMP), crlfDelay: Infinity });
let n = 0, hit = 0;
for await (const line of rl) {
  n++;
  if (n % 100000 === 0) console.log('·', n, '条，命中', hit);
  if (line.length < 30) continue;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  if (o.lang_code && o.lang_code !== 'ja') continue;
  const w = String(o.word || '').trim();
  if (!w || !want.has(w)) continue;
  const pos = String(o.pos || '');
  if (!POS_OK.test(pos)) continue;
  const glosses = [];
  for (const s of (o.senses || []).slice(0, 3)) {
    for (const g of (s.glosses || []).slice(0, 1)) {
      const t = String(g || '').replace(/\s+/g, ' ').trim();
      if (t && !glosses.includes(t)) glosses.push(t);
    }
  }
  if (!glosses.length) continue;
  hit++;
  const scoreBase = glosses[0].length;
  const cur = best.get(w);
  if (!cur || scoreBase < cur.score) best.set(w, { gloss: glosses.slice(0, 2).join('; '), pos, score: scoreBase });
}

const glosses = {};
for (const [w, rec] of best) glosses[w] = rec.gloss;
fs.mkdirSync(path.join(OUT, 'pairs'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'pairs', 'ja-en.json'), JSON.stringify({
  id: 'ja-en', learnLang: 'ja', explainLang: 'en',
  source: 'English Wiktionary (kaikki.org), CC BY-SA 3.0',
  count: Object.keys(glosses).length, glosses,
}));
// 中文释义层（从 index.json 的词条释义生成，保持和词卡一致）
const zh = {};
for (const v of vocab) if (v.word && v.meaning) zh[v.word] = v.meaning;
fs.writeFileSync(path.join(OUT, 'pairs', 'ja-zh.json'), JSON.stringify({
  id: 'ja-zh', learnLang: 'ja', explainLang: 'zh', count: Object.keys(zh).length, glosses: zh,
}));
console.log('✓ ja-en', Object.keys(glosses).length, '/', vocab.length, '· ja-zh', Object.keys(zh).length);

// manifest 登记
const mf = path.join(OUT, 'manifest.json');
if (fs.existsSync(mf)) {
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.pairs = ['ja-zh', 'ja-en'];
  fs.writeFileSync(mf, JSON.stringify(m));
}
