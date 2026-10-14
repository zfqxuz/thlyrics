#!/usr/bin/env node
/**
 * build-readings.mjs —— 生成「读音兜底表」补充词条（data/readings-extra.json）
 *
 * 背景：导入的歌是在浏览器里现算分词的，可查的只有两张表（1358 词表 + 内置曲目抽出的读音表）。
 * 别的汉字词（揺・咲・纏・奥・温 这类活用形）就没读音了 —— 假名可以按规则转罗马音，但汉字词
 * 的读音必须查词典。这里用**后台的 kuromoji**（和建库同一个 IPADIC）把一大批日语歌词跑一遍，
 * 把出现过的「表面形 → 读音 + 词性」抽出来（连活用形一起收）。
 *
 * 语料：网易云几十张日语大歌单的歌词（只取文本，不要音频，不落盘原文）。
 *
 * 用法：node scripts/build-readings.mjs [--songs 1500] [--min-count 3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kuromoji from 'kuromoji';
import { kanaToRomaji } from './kana-romaji.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'readings-extra.json');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const WANT = argOf('--songs', 1500);
const MIN_COUNT = argOf('--min-count', 3);
const UA = { 'user-agent': 'Mozilla/5.0', referer: 'https://music.163.com/' };
const toHira = (s) => String(s || '').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hasKanji = (s) => /[\u4e00-\u9fff]/.test(s);
const kanaOnly = (s) => /^[\u3041-\u309f\u30a0-\u30ff\u30fc]+$/.test(s);
const posKind = (pos) => ({ 名詞: 'n', 動詞: 'v', 形容詞: 'a', 形容動詞: 'na', 副詞: 'adv', 助詞: 'prt', 助動詞: 'aux', 接続詞: 'conj', 連体詞: 'rent', 接頭詞: 'pref' }[pos] || 'oth');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };

// 取一批日语大歌单的歌曲 id
async function collectIds(queries) {
  const ids = new Set();
  for (const q of queries) {
    let r;
    try { r = await get(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(q)}&type=1000&limit=6&offset=0`); }
    catch (e) { console.error('搜索失败', q, e.message); continue; }
    for (const p of (r?.result?.playlists || []).slice(0, 4)) {
      try {
        const d = await get(`https://music.163.com/api/v6/playlist/detail?id=${p.id}`);
        const tids = d?.playlist?.trackIds || [];
        for (const t of tids) if (t && t.id) ids.add(String(t.id));
      } catch (e) { console.error('歌单失败', p.id, e.message); }
      await sleep(300);
    }
    process.stdout.write(`\r已收集 ${ids.size} 首`);
  }
  console.log();
  return [...ids];
}

async function fetchLyrics(ids, want) {
  const texts = [];
  const queue = ids.slice(0, want);
  let done = 0, failed = 0;
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const d = await get(`https://music.163.com/api/song/lyric?id=${id}&lv=1&tv=1&kv=0&_nm=0`);
        let text = d?.lrc?.lyric || '';
        text = text.replace(/^\[[^\]]*\]\s*/gm, '').replace(/\[\d+:\d+[.\d]*\]/g, '');
        if (text.replace(/\s/g, '').length > 40) texts.push(text);
      } catch { failed++; }
      done++;
      if (done % 50 === 0) process.stdout.write(`\r歌词 ${done}/${want}（失败 ${failed}）`);
    }
  };
  await Promise.all([0, 1, 2, 3, 4, 5].map(worker));
  console.log();
  return texts;
}

const main = async () => {
  const tokenizer = await new Promise((res, rej) => kuromoji.builder({ dicPath: path.join(ROOT, 'node_modules', 'kuromoji', 'dict') }).build((e, t) => (e ? rej(e) : res(t))));
  const ids = await collectIds(['アニソン', '東方', '東方Project', 'ボカロ', '同人音楽', 'J-POP', 'ゲーム音楽', '東方アレンジ', 'ボーカロイド', 'アニメ']);
  if (!ids.length) throw new Error('没收集到歌曲 id');
  const texts = await fetchLyrics(ids, WANT);

  const seen = new Map();
  for (const t of texts) {
    for (const sentence of String(t).split(/(?<=[。！？\n、])/)) {
      const s = sentence.trim();
      if (!s || s.length > 120) continue;
      for (const tk of tokenizer.tokenize(s)) {
        const surf = tk.surface_form, rd = tk.reading;
        if (!surf || !rd || rd === '*') continue;
        if (!hasKanji(surf) || kanaOnly(surf) || surf.length > 6) continue;
        if (!/^[\u3041-\u309f\u30a0-\u30ff\u30fc\u4e00-\u9fff]+$/.test(surf)) continue;
        const kind = posKind(tk.pos);
        const prev = seen.get(surf);
        if (!prev) seen.set(surf, [kanaToRomaji(toHira(rd)), toHira(rd), kind, 1]);
        else { prev[3]++; if (prev[2] === 'oth' && kind !== 'oth') prev[2] = kind; }
      }
    }
  }
  const out = {};
  let kept = 0;
  for (const [surf, v] of seen) {
    if (v[3] < MIN_COUNT) continue;
    out[surf] = [v[0], v[1], v[2]];
    kept++;
  }
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log(`语料：${texts.length} 首歌 · 唯一汉字词 ${seen.size} → 保留 ${kept} 条（出现 ≥${MIN_COUNT} 次）`);
  console.log(`输出 ${path.relative(ROOT, OUT)}（${Math.round(fs.statSync(OUT).size / 1024)} KB）`);
};

main().catch((e) => { console.error(e); process.exit(1); });
