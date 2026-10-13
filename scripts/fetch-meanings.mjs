#!/usr/bin/env node
/**
 * fetch-meanings.mjs —— 给词表补中文释义
 *
 * 走的接口：MyMemory（公开翻译记忆） https://api.mymemory.translated.net/get?q=...&langpair=ja|zh-CN
 *   - 免密钥，但有配额：单次 q 上限 500 字节，每天约 5000 词/匿名
 *   - 一次请求塞多个词，用「 | 」分隔，回来按同样顺序切分
 *   - 返回和原文一样的（没翻出来）会被标成 empty，让你后面人工补
 *
 * 产物：data/meanings.json —— { "夢": { meaning: "梦", src: "mymemory", at: "..." } }
 *       已存在的条目不覆盖（想重翻加 --force）
 *
 * 用法：
 *   node scripts/fetch-meanings.mjs --limit 60      # 先小批量试水
 *   node scripts/fetch-meanings.mjs                 # 全量（可随时 Ctrl-C，下次接着跑）
 *   node scripts/fetch-meanings.mjs --force         # 强制重翻已有机释义词
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'data', 'index.json');
const OUT = path.join(ROOT, 'data', 'meanings.json');
const API = 'https://api.mymemory.translated.net/get';

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const LIMIT = Number(argOf('--limit') || Infinity);
const FORCE = args.includes('--force');
const BATCH = Number(argOf('--batch') || 12);      // 一次请求塞几个词（多词靠 500 字节上限兜着）
const DELAY = Number(argOf('--delay') || 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translate(words) {
  const q = words.join(' | ');
  const url = `${API}?q=${encodeURIComponent(q)}&langpair=ja|zh-CN`;
  const res = await fetch(url, { headers: { 'User-Agent': 'thlyrics-learning-tool/0.1' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const text = (j && j.responseData && j.responseData.translatedText) || '';
  return text.split('|').map((s) => s.trim());
}

async function main() {
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const store = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  // 只翻「值得学」的词（词表本身就是），按出现曲数从多到少
  const todo = idx.vocab
    .filter((v) => FORCE || !(store[v.word] && store[v.word].meaning))
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  let done = 0, empty = 0, fail = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    try {
      const out = await translate(chunk.map((w) => w.word));
      chunk.forEach((w, k) => {
        const t = out[k] || '';
        const same = t === w.word || !t;
        store[w.word] = {
          meaning: same ? '' : t,
          pos: w.pos, reading: w.reading,
          src: 'mymemory', at: new Date().toISOString(),
        };
        if (same) empty++; else done++;
      });
    } catch (e) {
      fail += chunk.length;
      console.log(`  批 ${i / BATCH + 1} 失败: ${e.message}`);
    }
    if ((i / BATCH) % 5 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(store, null, 1), 'utf8');
      const pct = Math.round(((i + chunk.length) / todo.length) * 100);
      console.log(`进度 ${pct}%  已翻 ${done} 条 · 没翻出来 ${empty} 条 · 失败 ${fail} 条`);
    }
    await sleep(DELAY);
  }
  fs.writeFileSync(OUT, JSON.stringify(store, null, 1), 'utf8');
  console.log(`完成：译出 ${done}，空 ${empty}，失败 ${fail}，共写入 ${Object.keys(store).length} 条 -> ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
