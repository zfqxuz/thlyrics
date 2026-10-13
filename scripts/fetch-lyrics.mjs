#!/usr/bin/env node
/**
 * fetch-lyrics.mjs —— 从 THBWiki 的歌词服务抓取东方同人曲歌词（LRC，自带时间轴）
 *
 * 数据来源（两个公开接口，都是明文无鉴权）：
 *   1. 搜索：https://thbwiki.cc/api.php?action=opensearch&namespace=512&search=歌词:<关键词>
 *      namespace 512 = 歌词命名空间，返回 "歌词:曲名（社团）" 形式的标题
 *   2. 取词：https://lyrics.thwiki.cc/<标题>.lrc         （<标题>.all.lrc 可指定语言）
 *      LRC 头部带 ti/al/ar/cv/re 元数据，正文带 [mm:ss.xx] 时间轴
 *
 * 用法：
 *   node scripts/fetch-lyrics.mjs --query "月まで届け"        # 搜索并抓取全部命中
 *   node scripts/fetch-lyrics.mjs --title "幽雅に咲かせ、墨染の桜（トマト組）"
 *   node scripts/fetch-lyrics.mjs --query "少女綺想曲" --limit 5
 *   node scripts/fetch-lyrics.mjs --from data/queries.txt     # 每行一个关键词
 *
 * 产物：data/raw/<安全文件名>.lrc  ，以及 data/fetch-log.json 记录抓取结果
 * 幂等：已存在且非空的 .lrc 默认跳过（--force 覆盖）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const LOG_PATH = path.join(ROOT, 'data', 'fetch-log.json');

const SEARCH_API = 'https://thbwiki.cc/api.php';
const LYRICS_BASE = 'https://lyrics.thwiki.cc';
const UA = 'thlyrics-learning-tool/0.1 (personal study; contact: local)';

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const out = { query: [], title: [], from: null, limit: Infinity, force: false, lang: 'all', delay: 1200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--query' || a === '-q') out.query.push(next());
    else if (a === '--title' || a === '-t') out.title.push(next());
    else if (a === '--from' || a === '-f') out.from = next();
    else if (a === '--limit' || a === '-n') out.limit = Number(next());
    else if (a === '--lang') out.lang = next();
    else if (a === '--delay') out.delay = Number(next());
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      console.warn('忽略未知参数:', a);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 标题 -> 安全文件名（保留中日文，替换路径危险字符） */
function safeName(title) {
  return title.replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 120) + '.lrc';
}

/** 带重试的抓取 */
async function getText(url, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,zh;q=0.8' } });
      const text = await res.text();
      if (!res.ok) {
        // 歌词服务用 404 + "Error: [[歌词:xxx]]" 表示不存在
        if (res.status === 404) return { ok: false, status: 404, text };
        throw new Error(`HTTP ${res.status}`);
      }
      return { ok: true, status: res.status, text };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(800 * attempt);
    }
  }
  throw lastErr;
}

/** 站内搜索：返回标题数组（不含 "歌词:" 前缀） */
async function search(keyword, limit) {
  const url = new URL(SEARCH_API);
  url.searchParams.set('action', 'opensearch');
  url.searchParams.set('format', 'json');
  url.searchParams.set('namespace', '512');
  url.searchParams.set('limit', String(Math.min(limit, 20)));
  url.searchParams.set('search', '歌词:' + keyword);

  const { ok, text } = await getText(url.href);
  if (!ok) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  // thwiki 的 opensearch 这里返回的是对象数组 [{text, link}, ...]
  // 兼容标准 MediaWiki 格式 ["歌词:xx", ["歌词:xx", ...], ...]
  let titles = [];
  if (Array.isArray(data) && data.length && typeof data[0] === 'object' && data[0] !== null) {
    titles = data.map((d) => d?.text ?? '');
  } else if (Array.isArray(data?.[1])) {
    titles = data[1];
  }
  return titles.map((t) => String(t).replace(/^歌词:/, '')).filter(Boolean);
}

/** 抓一个标题的 LRC 原文 */
async function fetchLrc(title, lang) {
  const suffix = lang === 'all' ? '.all.lrc' : `.${lang}.lrc`;
  const url = `${LYRICS_BASE}/${encodeURIComponent(title)}${suffix}`;
  const { ok, status, text } = await getText(url);
  if (!ok) return { ok: false, url, reason: 'not-found', detail: text.slice(0, 120) };
  if (!/\[\d{2}:\d{2}/.test(text) && !/\[ti:/.test(text)) {
    return { ok: false, url, reason: 'not-lrc', detail: text.slice(0, 120) };
  }
  return { ok: true, url, text };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(RAW_DIR, { recursive: true });

  // 1) 汇总待抓标题
  const wanted = new Set(args.title);
  const keywords = [...args.query];
  if (args.from) {
    const lines = fs.readFileSync(path.resolve(args.from), 'utf8').split('\n');
    for (const l of lines) if (l.trim() && !l.startsWith('#')) keywords.push(l.trim());
  }

  for (const kw of keywords) {
    const hits = await search(kw, 20);
    console.log(`[搜索] ${kw} -> ${hits.length} 条`);
    for (const h of hits) wanted.add(h);
    await sleep(args.delay);
  }

  if (wanted.size === 0) {
    console.log('没有待抓取标题。用 --query / --title / --from 指定。');
    return;
  }

  const titles = [...wanted].slice(0, args.limit === Infinity ? undefined : args.limit);
  console.log(`\n共 ${titles.length} 个标题待抓取 -> ${RAW_DIR}\n`);

  const log = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) : { entries: [] };
  const known = new Map(log.entries.map((e) => [e.title, e]));

  let ok = 0, skip = 0, fail = 0;
  for (const title of titles) {
    const file = path.join(RAW_DIR, safeName(title));
    if (!args.force && fs.existsSync(file) && fs.statSync(file).size > 50) {
      skip++;
      continue;
    }
    const r = await fetchLrc(title, args.lang);
    if (r.ok) {
      fs.writeFileSync(file, r.text, 'utf8');
      known.set(title, { title, file: path.relative(ROOT, file), url: r.url, bytes: r.text.length, at: new Date().toISOString() });
      ok++;
      const meta = r.text.match(/\[ti:(.*?)\]/)?.[1] ?? '';
      const ar = r.text.match(/\[ar:(.*?)\]/)?.[1] ?? '';
      const al = r.text.match(/\[al:(.*?)\]/)?.[1] ?? '';
      const lines = (r.text.match(/^\[\d{2}:\d{2}/gm) || []).length;
      console.log(`  ✓ ${title}\n      ti=${meta} ar=${ar} al=${al} 行数=${lines}`);
    } else {
      known.set(title, { title, url: r.url, error: r.reason, detail: r.detail, at: new Date().toISOString() });
      fail++;
      console.log(`  ✗ ${title}  (${r.reason})`);
    }
    await sleep(args.delay);
  }

  log.entries = [...known.values()];
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  console.log(`\n完成：新增 ${ok}，跳过 ${skip}，失败 ${fail}。日志：${path.relative(ROOT, LOG_PATH)}`);
}

main().catch((e) => {
  console.error('抓取失败:', e);
  process.exit(1);
});
