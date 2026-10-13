#!/usr/bin/env node
/**
 * fetch-netease.mjs —— 用网易云补三样东西：音频（按需取 URL）、带时间轴的歌词、中文翻译
 *
 * 走的接口：
 *   搜索   https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=<关键词>
 *   歌词   https://music-api.gdstudio.xyz/api.php?types=lyric&source=netease&id=<歌曲id>
 *   音频   https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=<歌曲id>&br=320
 * 说明：这是社区维护的公开中转（源码是 Meting 系），不是网易官方 API。
 *      网易官方 /api/song/lyric 也能用，但没有 CORS 头，浏览器里读不了，所以前端走这个中转。
 *      音频 URL 是「临时签名」的，几小时后失效，所以前端每次播放前重新取一次。
 *
 * 匹配策略：按「曲名 + 社团名」搜，用专辑名/社团名/标题相似度打分挑最像的那条，并记录分数，
 *          低于阈值的标 low 让你人工确认（宁可漏，不要错配到别的歌）。
 *
 * 用法：
 *   node scripts/fetch-netease.mjs                # 匹配全部曲目（增量，已匹配的跳过）
 *   node scripts/fetch-netease.mjs --force        # 全部重新匹配
 *   node scripts/fetch-netease.mjs --limit 10     # 只处理前 10 首
 *   node scripts/fetch-netease.mjs --track t1     # 只处理某首
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'data', 'index.json');
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'netease.json');
const API = 'https://music-api.gdstudio.xyz/api.php';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const LIMIT = Number(argOf('--limit') || Infinity);
const ONLY = argOf('--track') || null;
const LYRICS_ONLY = argv.includes('--lyrics');
const DELAY = Number(argOf('--delay') || 1500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, retries = 3) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url.href, { headers: { 'User-Agent': 'thlyrics-learning-tool/0.1' } });
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return JSON.parse(text);
    } catch (e) { lastErr = e; await sleep(700 * i); }
  }
  throw lastErr;
}

/** 归一化：去掉括号补充、大小写、符号、空格的差异，方便比标题/社团 */
const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[\s　]+/g, '')
  .replace(/[（(【\[].*?[)）】\]]/g, '')
  .replace(/[!！?？~～・、,，.。'’"“”\-ー–—&＆]/g, '');

/** 编辑距离相似度 */
function sim(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - dp[m][n] / Math.max(m, n);
}

/** 给搜索结果打分：专辑名 > 社团名 > 曲名 */
function score(track, hit) {
  const album = sim(track.album, hit.album);
  const artistHit = (hit.artist || []).some((a) => sim(track.artist, a) > 0.55 || norm(a).includes(norm(track.artist).slice(0, 6)));
  const title = sim(track.title, hit.name);
  let s = 0;
  if (album > 0.9) s += 45; else if (album > 0.6) s += 28; else if (album > 0.35) s += 12;
  if (artistHit) s += 30;
  s += Math.round(title * 30);
  // 只有曲名像、社团和专辑都对不上：几乎肯定是别人的版本，强力压低
  if (!artistHit && album < 0.35) s = Math.min(s, 20);
  return s;
}

async function main() {
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const store = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { matches: {}, fetchedAt: null };
  let done = 0, low = 0, fail = 0;

  // ---- 第一阶段：批量补歌词（缓存到 data/netease-lyrics/<trackId>.json）----
  const LY = path.join(DATA_DIR, 'netease-lyrics');
  fs.mkdirSync(LY, { recursive: true });
  let lyOk = 0;
  for (const t of idx.tracks) {
    const m = store.matches[t.id];
    if (!m || !m.nid) continue;
    const f = path.join(LY, t.id + '.json');
    if (!FORCE && fs.existsSync(f)) continue;
    try {
      const r = await api({ types: 'lyric', source: 'netease', id: m.nid });
      fs.writeFileSync(f, JSON.stringify({ nid: m.nid, lyric: r.lyric || '', tlyric: r.tlyric || '', at: new Date().toISOString() }), 'utf8');
      const nLines = (String(r.lyric || '').match(/^\[\d{2}:/gm) || []).length;
      const nTrans = (String(r.tlyric || '').match(/^\[\d{2}:/gm) || []).length;
      if (nLines) lyOk++;
      console.log(`  ♪ ${t.title} 歌词 ${nLines} 行 / 译文 ${nTrans} 行`);
    } catch (e) {
      console.log(`  ✗ ${t.title} 歌词失败: ${e.message}`);
    }
    await sleep(700);
  }
  console.log(`歌词缓存：本次补齐 ${lyOk} 首\n`);
  if (LYRICS_ONLY) { store.fetchedAt = new Date().toISOString(); fs.writeFileSync(OUT, JSON.stringify(store, null, 1), 'utf8'); return; }

  const targets = idx.tracks.filter((t) => (!ONLY || t.id === ONLY)).slice(0, LIMIT === Infinity ? undefined : LIMIT);

  for (const t of targets) {
    const prev = store.matches[t.id];
    if (!FORCE && prev && (prev.status === 'ok' || prev.status === 'low')) continue;   // 只重跑没匹配上的

    let best = null;
    try {
      // 两轮搜索：① 曲名 ② 曲名 + 社团（社团名是关键，光搜曲名很容易配到别人的翻唱）
      let hits = await api({ types: 'search', source: 'netease', name: t.title, count: 10 });
      const hits2 = await api({ types: 'search', source: 'netease', name: `${t.title} ${t.artist}`.trim(), count: 10 });
      hits = [...(Array.isArray(hits) ? hits : []), ...(Array.isArray(hits2) ? hits2 : [])];
      if (Array.isArray(hits)) {
        for (const h of hits) {
          const s = score(t, h);
          if (!best || s > best.score) best = { score: s, hit: h };
        }
      }
    } catch (e) {
      console.log(`  ✗ ${t.title} 搜索失败: ${e.message}`);
      fail++;
      await sleep(DELAY);
      continue;
    }

    if (!best || !best.hit) {
      store.matches[t.id] = { nid: null, status: 'not-found', title: t.title, artist: t.artist };
      console.log(`  ✗ ${t.title}（${t.artist}）没搜到`);
      fail++;
      await sleep(DELAY);
      continue;
    }

    const h = best.hit;
    const status = best.score >= 55 ? 'ok' : 'low';
    store.matches[t.id] = {
      nid: String(h.id),
      status,
      score: best.score,
      nTitle: h.name,
      nArtist: (h.artist || []).join('/'),
      nAlbum: h.album,
      picId: h.pic_id || '',
      title: t.title,
      artist: t.artist,
      album: t.album,
    };
    if (status === 'low') low++;
    // 顺手取封面地址（只取一次，存起来给 build-web 用）
    try {
      const pic = await api({ types: 'pic', source: 'netease', id: h.pic_id || h.id, size: '300' });
      if (pic && pic.url) store.matches[t.id].picUrl = pic.url;
      await sleep(300);
    } catch { /* 封面拿不到不影响 */ }
    done++;
    console.log(`  ${status === 'ok' ? '✓' : '?'} ${t.title}  ->  ${h.name} / ${(h.artist || []).join('/')} / ${h.album}  (分 ${best.score})`);
    await sleep(DELAY);
  }

  store.fetchedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(store, null, 1), 'utf8');
  const all = Object.values(store.matches);
  console.log(`\n本次匹配 ${done}，低置信 ${low}，失败 ${fail}`);
  console.log(`累计：${all.filter((m) => m.status === 'ok').length} 条高置信 / ${all.filter((m) => m.status === 'low').length} 条待确认 / ${all.filter((m) => m.status === 'not-found').length} 条没搜到`);
  console.log(`写入 ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
