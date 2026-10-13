#!/usr/bin/env node
/**
 * align-meanings.mjs —— 用「已有译文」的词对齐给词表补中文释义
 *
 * 思路：网易云给的一整句日文 + 对应中文翻译，本身就是一份对齐语料。
 *   对每个日语词，统计「有它的那些句子对应的中文里，哪些字显著更常出现」，
 *   把这些连续的汉字抽出来（含少量虚词）当作释义，并附上 1~2 条例句。
 * 优点：译义来自真人译文，语境 맞；缺点：只覆盖歌词里出现过的词，且是「语境义」不是词典义。
 *
 * 产物：data/meanings.auto.json —— { "夢": { meaning:"梦想", examples:[{jp,zh}], score } }
 *       build-web.mjs 会把它和手工的 data/meanings.json 合并（手工优先）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'data', 'index.json');
const OUT = path.join(ROOT, 'data', 'meanings.auto.json');

const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));

// 1) 收集「日文词 -> 中文句子」共现；同时收集全语料的中文字频（当基线）
const cooc = new Map();     // word -> [{jp, zh}]
const baseFreq = new Map(); // 字 -> 出现该字的句子数
let sentenceCount = 0;
for (const tr of idx.tracks) {
  for (const line of tr.lines) {
    if (!line.zh || !line.text) continue;
    sentenceCount++;
    const zhChars = new Set([...line.zh].filter((c) => /[\u4e00-\u9fff]/.test(c)));
    for (const c of zhChars) baseFreq.set(c, (baseFreq.get(c) || 0) + 1);
    const words = new Set((line.segs || []).filter((s) => s.w && s.b).map((s) => s.b));
    for (const w of words) {
      if (!cooc.has(w)) cooc.set(w, []);
      const arr = cooc.get(w);
      if (arr.length < 40) arr.push({ jp: line.text, zh: line.zh, chars: zhChars });
    }
  }
}

// 2) 对每个词算「字显著度」= 该字在这个词的句子里出现的比例 / 全语料比例
const out = {};
for (const [word, rows] of cooc) {
  if (rows.length < 2) continue;
  const n = rows.length;
  const hit = new Map();
  for (const r of rows) for (const c of r.chars) hit.set(c, (hit.get(c) || 0) + 1);
  const scored = [...hit.entries()]
    .map(([c, k]) => {
      const p = k / n;
      const base = Math.max((baseFreq.get(c) || 0) / Math.max(sentenceCount, 1), 0.002);
      return { c, p, base, lift: p / base };
    })
    .filter((x) => x.p >= 0.35 && x.lift >= 1.8)          // 至少 35% 的句子有它，且显著高于基线
    .sort((a, b) => b.lift - a.lift);

  // 3) 把得分高的字挑出来拼成释义（限长，避免拼出整句）
  const picked = [];
  for (const s of scored) {
    if (picked.length >= 4) break;
    if (picked.some((p) => Math.abs(p.lift - s.lift) < 0.5 && p.c !== s.c)) { /* 同分不重复塞 */ }
    picked.push(s);
  }
  if (!picked.length) continue;
  // 按「在句子里是否挨着」把字分组成词：用例句里出现过的连续片段当候选
  const cand = new Map();
  for (const r of rows) {
    for (const p of picked) {
      const i = r.zh.indexOf(p.c);
      if (i < 0) continue;
      // 取这个字周围的 2~4 字窗口，窗口里必须全是汉字
      for (const L of [4, 3, 2]) {
        for (let s = Math.max(0, i - L + 1); s + L <= r.zh.length && s <= i; s++) {
          const seg = r.zh.slice(s, s + L);
          if (!/^[\u4e00-\u9fff]+$/.test(seg)) continue;
          const key = seg;
          const e = cand.get(key) || { seg, n: 0, score: 0 };
          e.n++;
          e.score += picked.filter((x) => key.includes(x.c)).reduce((a, x) => a + x.lift, 0);
          cand.set(key, e);
        }
      }
    }
  }
  const best = [...cand.values()]
    .map((e) => ({ ...e, rank: e.score * Math.log(1 + e.n) / Math.max(2, e.seg.length) }))
    .filter((e) => e.n >= Math.max(2, Math.round(rows.length * 0.2)))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3);
  if (!best.length) continue;

  const wordEntry = idx.vocab.find((v) => v.word === word);
  out[word] = {
    meaning: best[0].seg,
    alts: best.slice(1).map((b) => b.seg),
    pos: wordEntry ? wordEntry.pos : '',
    reading: wordEntry ? wordEntry.reading : '',
    examples: rows.slice(0, 3).map((r) => ({ jp: r.jp, zh: r.zh })),
    support: rows.length,
    src: 'align',
  };
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`对齐语料 ${sentenceCount} 句 · 覆盖词 ${Object.keys(out).length} 个 -> ${path.relative(ROOT, OUT)}`);
