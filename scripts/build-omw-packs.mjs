#!/usr/bin/env node
/**
 * 用 Open Multilingual WordNet（OMW）补「词条释义」和「语言对释义层」。
 *
 * 原理：所有 wordnet 共用同一套 synset id（PWN 3.0 offset），
 *   德语词 Haus 在 synset 03531546-n，中文在该 synset 有「房子/住宅」，
 *   于是 Haus → 房子 就出来了；同一个 synset 的英文/日文词也顺便得到 de→en、de→ja。
 *
 * 输入（data/omw/，构建脚本自己下）：
 *   wn-cmn.tab          Chinese Open Wordnet（权限宽松的 WordNet 许可）
 *   wn-eng.tab / wn-jpn.tab
 *   wn-deu.tab / wn-spa.tab / wn-spa-mcr.tab / wn-fra.tab / wn-rus.tab / wn-kor.tab / wn-por.tab
 *   wn-por-openwn.tab   OpenWN-PT（CC BY-SA）
 *
 * 输出：
 *   data/omw/gloss-<lang>-zh.json    词 → {zh:[…], en:[…], ja:[…]}
 *
 * 注意：WordNet 给的是「同义词集」，所以释义是一组近义词，不是词典定义句。
 *      它只用来补词库缺的词，不覆盖已有词典释义。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OMW = path.join(ROOT, 'data', 'omw');
const OUT = path.join(ROOT, 'docs', 'data');
const TOP_N = 20000;

const SOURCES = {
  de: ['wn-deu.tab'],
  es: ['wn-spa-mcr.tab', 'wn-spa.tab'],
  fr: ['wn-fra.tab'],
  pt: ['wn-por-openwn.tab', 'wn-por.tab'],
  ru: ['wn-rus.tab'],
  ko: ['wn-kor.tab'],
  ja: ['wn-jpn.tab'],
};
const ZH = 'wn-cmn.tab';
const EN = 'wn-eng.tab';
const JA = 'wn-jpn.tab';

const readJson = (p, f) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : f);
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

function load(f) {
  const p = path.join(OMW, f);
  const map = new Map();          // synset → Set(lemma)
  if (!fs.existsSync(p)) return map;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const parts = line.split('\t');
    if (parts.length < 3 || !parts[1].endsWith('lemma')) continue;
    const syn = parts[0];
    const lemma = parts[2].replace(/_/g, ' ').trim();
    if (!lemma) continue;
    let set = map.get(syn);
    if (!set) map.set(syn, set = new Set());
    set.add(lemma);
  }
  return map;
}

/** 目标词集合：词频前 2 万 ∪ 现有词库 */
function wanted(lang) {
  const set = new Set();
  const f = path.join(ROOT, 'data', 'freq', `${lang}_50k.txt`);
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n').slice(0, TOP_N)) {
      const w = line.split(/\s+/)[0];
      if (w) set.add(w.toLowerCase());
    }
  }
  const lex = readJson(path.join(OUT, lang, 'lexicon.json'), null);
  for (const e of (lex && lex.entries) || []) set.add(String(e.word).toLowerCase());
  return set;
}
const existing = (lang) => {
  const lex = readJson(path.join(OUT, lang, 'lexicon.json'), null);
  return new Set(((lex && lex.entries) || []).map((e) => String(e.word).toLowerCase()));
};

const zh = load(ZH);
const en = load(EN);
const ja = load(JA);
const cap = (set, n) => [...(set || [])].filter((x) => x && x.length <= 12).slice(0, n);

for (const lang of Object.keys(SOURCES)) {
  const words = wanted(lang);
  const have = existing(lang);
  const byWord = new Map();        // word → { syn:Set, zh:Set, en:Set, ja:Set }
  for (const f of SOURCES[lang]) {
    const wn = load(f);
    for (const [syn, lemmas] of wn) {
      const z = zh.get(syn), e = en.get(syn), j = ja.get(syn);
      if (!z && !e && !j) continue;
      for (const lemma of lemmas) {
        const key = lemma.toLowerCase();
        if (!words.has(key)) continue;
        let rec = byWord.get(key);
        if (!rec) byWord.set(key, rec = { zh: new Set(), en: new Set(), ja: new Set() });
        if (z) for (const x of cap(z, 4)) rec.zh.add(x);
        if (e) for (const x of cap(e, 3)) rec.en.add(x);
        if (j) for (const x of cap(j, 3)) rec.ja.add(x);
      }
    }
  }
  const glosses = {};
  let added = 0;
  for (const [word, rec] of byWord) {
    const zhList = [...rec.zh].slice(0, 3);
    const enList = [...rec.en].slice(0, 2);
    const jaList = [...rec.ja].slice(0, 2);
    if (!zhList.length && !enList.length && !jaList.length) continue;
    glosses[word] = { zh: zhList, en: enList, ja: jaList };
    if (zhList.length && !have.has(word)) added++;
  }
  writeJson(path.join(OMW, `gloss-${lang}.json`), {
    id: `omw-${lang}`, lang, source: 'Open Multilingual WordNet (WordNet / CC BY-SA)',
    count: Object.keys(glosses).length, added, glosses,
  });
  console.log(`✓ ${lang}: 命中 ${Object.keys(glosses).length} 词（其中新词 ${added}）`);
}
