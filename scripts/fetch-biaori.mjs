#!/usr/bin/env node
/**
 * fetch-biaori.mjs —— 抓《新版 标准日本语》初级/中级 单词表，生成「词 -> 第几课」的对照表
 *
 * 数据源：https://github.com/L-hikari/japanese （MIT License，作者 L）
 *   json/word.json   初级上（第 1-24 课）
 *   json/word1.json  初级下（第 25-48 课）
 *   json/word2.json  中级上（第 1-16 课）
 *   json/word3.json  中级下（第 17-32 课）
 * 条目形如 ["ちゅうごくじん(中国人)", "中国人", "2,4"]：读音(汉字形) / 中文 / 声调
 *
 * 产物：data/biaori.json
 *   { source, fetchedAt, courses: {...}, words: { "世界": {kana, zh, book, lesson, course} } }
 *   course 是全局课序号（1-80），方便「从易到难」直接排序。
 *
 * 用法：node scripts/fetch-biaori.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'biaori.json');
const RAW = 'https://raw.githubusercontent.com/L-hikari/japanese/main/json/';

// 文件 -> 书 / 全局课属起始偏移（course = lesson + offset）
const FILES = [
  ['word.json', '初级上', 0],
  ['word1.json', '初级下', 0],
  ['word2.json', '中级上', 48],
  ['word3.json', '中级下', 48],
];

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const cnToNum = (s) => {
  const m = /^第(.+)课$/.exec(s);
  if (!m) return null;
  const t = m[1];
  let n = 0;
  if (/^十[一二三四五六七八九]?$/.test(t)) n = 10 + (t.length > 1 ? CN_NUM.indexOf(t[1]) : 0);
  else if (/^[一二三四五六七八九]十[一二三四五六七八九]?$/.test(t)) n = CN_NUM.indexOf(t[0]) * 10 + (t.length > 2 ? CN_NUM.indexOf(t[2]) : 0);
  else if (/^[一二三四五六七八九]$/.test(t)) n = CN_NUM.indexOf(t);
  return n || null;
};

const words = {};       // 词形 -> 记录（同一词取最早出现的课）

// 标日词表里动词是「ます形」（おわります），我们的词表是辞书形（終わる），
// 所以要能把 ます形 还原成辞书形候选，靠它对齐。
const GODAN = { 'い': 'う', 'き': 'く', 'ぎ': 'ぐ', 'し': 'す', 'ち': 'つ', 'に': 'ぬ', 'び': 'ぶ', 'み': 'む', 'り': 'る' };
const ICHIDAN = 'えけせてねべめれ';
const IRREGULAR = {
  'きます': 'くる', '来ます': '来る', 'します': 'する', 'います': 'いる', '居ます': 'いる',
  'みます': 'みる', '見ます': '見る', 'でます': 'でる', '出ます': '出る',
};
function masuToDict(kana, kanji) {
  const cands = [];
  const push = (k, c) => { if (k) cands.push([k, c || '']); };
  if (IRREGULAR[kanji]) push(IRREGULAR[kanji], IRREGULAR[kanji]);
  if (!/ます$/.test(kana) && !/ます$/.test(kanji)) return cands;
  const k = /ます$/.test(kana) ? kana.replace(/します$/, 'する').replace(/ます$/, 'る') : '';
  // サ変：します -> する
  if (/します$/.test(kana)) push(kana.replace(/します$/, 'する'), kanji ? kanji.replace(/します$/, 'する') : '');
  else if (/ます$/.test(kana)) {
    const sk = kana.slice(0, -2), sc = kanji && /ます$/.test(kanji) ? kanji.slice(0, -2) : '';
    const last = sk.slice(-1);
    // ます形的词干是有歧义的（いきます 可能是 行く 也可能是 生きる），
    // 两种还原都登记，反正只在命中我们的词表时才有用。
    if (GODAN[last]) push(sk.slice(0, -1) + GODAN[last], sc ? sc.slice(0, -1) + GODAN[last] : '');
    // 一段动词的词干可能落在 い 段（生きる -> 生きます），所以 词干+る 一律登记
    if (sk) push(sk + 'る', sc ? sc + 'る' : '');
  }
  return cands;
}
const courses = {};     // course -> {book, lesson}
let entries = 0;

function put(w, rec) {
  if (!w) return;
  const seen = words[w];
  if (seen && seen.course <= rec.course) { if (!seen.zh && rec.zh) seen.zh = rec.zh; return; }
  words[w] = rec;
}

for (const [file, book, offset] of FILES) {
  const res = await fetch(RAW + file);
  if (!res.ok) throw new Error(`下载失败 ${file}: ${res.status}`);
  const json = await res.json();
  for (const section of json) {
    const lesson = cnToNum(section.title || '');
    if (!lesson) continue;
    const course = lesson + offset;
    courses[course] = { book, lesson };
    for (const row of section.data || []) {
      const first = String(row[0] || '');
      const zh = String(row[1] || '');
      const m = /^(.*?)\((.*)\)\s*$/.exec(first);
      const kana = (m ? m[1] : first).trim();
      const kanji = (m ? m[2] : '').trim();
      const rec = { kana, kn: kanji || '', zh, book, lesson, course };
      entries++;
      // 汉字形与假名形都登记（优先汉字形：歌词里多半写汉字）
      put(kanji, rec);
      put(kana, rec);
      // ます形动词：额外登记辞书形，方便和我们的词表对齐
      for (const [dk, dc] of masuToDict(kana, kanji)) {
        put(dk, rec);
        if (dc) put(dc, rec);
      }
    }
  }
  console.log(`${book}：${file} 已并入（累计条目 ${entries}）`);
}

const out = {
  source: 'https://github.com/L-hikari/japanese （MIT License）·《新版 标准日本语》初级/中级 单词表',
  fetchedAt: new Date().toISOString(),
  courses,
  words,
};
fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
console.log(`词形 ${Object.keys(words).length} 个 / 课次 ${Object.keys(courses).length} 课 -> ${path.relative(ROOT, OUT)}`);
