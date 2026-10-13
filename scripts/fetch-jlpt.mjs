#!/usr/bin/env node
/**
 * fetch-jlpt.mjs —— 抓 JLPT N5-N1 词汇表，给词表补「考级等级」这个难度信号
 *
 * 数据源：https://github.com/Bluskyo/JLPT_Vocabulary （MIT License）
 *   data/vocab/results/JLPT_vocab_ALL.csv  —— 原始表来自 tanos.co.uk
 *   CSV 列：Kanji, Reading, Level ；Level 5=N5（最容易）… 1=N1（最难）
 *
 * 产物：data/jlpt.json —— { source, fetchedAt, words: { "世界": {level:4, reading:"せかい"} } }
 *
 * 用法：node scripts/fetch-jlpt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'jlpt.json');
const URL_CSV = 'https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/main/data/vocab/results/JLPT_vocab_ALL.csv';

const csv = await (await fetch(URL_CSV)).text();
const words = {};
let rows = 0;
for (const line of csv.split('\n').slice(1)) {
  const parts = line.split(',');
  if (parts.length < 3) continue;
  const [kanji, reading, level] = parts.map((s) => (s || '').trim());
  const lv = Number(level);
  if (!lv || lv < 1 || lv > 5) continue;
  rows++;
  const keys = [kanji, reading].filter(Boolean);
  for (const k of keys) {
    const cur = words[k];
    // 同一个词形在 N5/N4 都出现过时取「更简单」的那个等级（数字更大 = 更简单）
    if (!cur || lv > cur.level) words[k] = { level: lv, reading: reading || '', kanji: /[一-龯]/.test(k) };
  }
}
fs.writeFileSync(OUT, JSON.stringify({
  source: 'https://github.com/Bluskyo/JLPT_Vocabulary （MIT License，原始数据 tanos.co.uk）',
  fetchedAt: new Date().toISOString(),
  words,
}), 'utf8');
console.log(`JLPT 词形 ${Object.keys(words).length} 个（原始行 ${rows}）-> ${path.relative(ROOT, OUT)}`);
