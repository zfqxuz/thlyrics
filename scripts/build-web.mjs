#!/usr/bin/env node
/**
 * build-web.mjs —— 把 THBWiki 的歌词 / 词表和网易云的音频+时间轴+中文翻译合成前端数据
 *
 * 输入：data/index.json（build-index.mjs 产物）
 *       data/netease.json（fetch-netease.mjs 产物，可缺省）
 *       data/audio/<trackId>.<ext>（可选：本地音频，存在就优先用）
 *       data/meanings.json（可选：手工中文释义覆盖，按词条 word 覆盖）
 * 输出：docs/data/index.json + docs/data/covers/*
 *
 * 合并要点：
 *   1. 网易云有翻译的曲目，用网易云的时间轴 + 行级中文翻译（tlyric 按时间戳对齐）
 *   2. 没有的曲目保留 THBWiki 的歌词行，译文留空
 *   3. 词表里合并手工释义（meanings.json）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const WEB_DATA = path.join(ROOT, 'docs', 'data');
const AUDIO_DIR = path.join(DATA, 'audio');

const args = process.argv.slice(2);
const WANT_COVERS = args.includes('--covers');
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const FORCE_COVER = args.includes('--force-covers');

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);

/** 解析 NetEase 的 LRC：返回 [{t, text}] */
function parseLrc(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0);
    out.push({ t: Math.round(t * 100) / 100, text: (m[4] || '').trim() });
  }
  return out;
}

/** 标题归一化，用于把网易云歌词行和 THBWiki 行对齐 */
const norm = (s) => String(s || '').toLowerCase().replace(/[\s　]+/g, '').replace(/[!！?？~～・、,，.。'’"“”\-ー–—&＆()（）]/g, '');
function sim(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 6) return 0;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - dp[m][n] / Math.max(m, n);
}

async function main() {
  const idx = readJson(path.join(DATA, 'index.json'), null);
  if (!idx) throw new Error('缺 data/index.json，先跑 build-index.mjs');
  const ne = readJson(path.join(DATA, 'netease.json'), { matches: {} });
  const meanings = readJson(path.join(DATA, 'meanings.json'), {});          // 机器翻译/手工
  const autoMeanings = readJson(path.join(DATA, 'meanings.auto.json'), {});  // 词对齐推断
  const mineMeanings = readJson(path.join(DATA, 'meanings.mine.json'), {});  // 人工精译（我自己翻的，最高优先）


  let merged = 0, withTrans = 0, withTiming = 0;

  for (const tr of idx.tracks) {
    // 每轮重新判定，清掉可能从旧产物带过来的运行时字段
    delete tr.audio; delete tr.netease;
    // ---- 音频：本地优先，其次网易云按需取 ----
    if (fs.existsSync(AUDIO_DIR)) {
      const f = fs.readdirSync(AUDIO_DIR).find((x) => x.replace(/\.[^.]+$/, '') === tr.id);
      if (f) tr.audio = { type: 'local', file: `audio/${f}` };
    }
    const nm = ne.matches[tr.id];   // 音频在歌词校验通过后才挂上（见下面的 agreeRate 判定）

    // ---- 歌词：把网易云的时间轴+翻译并进来 ----
    if (nm && nm.nid) {
      let agreeRate = 0, jpLen = 0;         // 没缓存到网易云歌词时保持 0/0
      const cached = readJson(path.join(DATA, 'netease-lyrics', `${tr.id}.json`), null);
      if (cached && cached.lyric) {
        const jp = parseLrc(cached.lyric).filter((l) => l.text);
        const zh = parseLrc(cached.tlyric || '');
        // 译文按时间戳就近对齐（网易云的 tlyric 有时比日文行少）
        const zhByTime = new Map();
        for (const z of zh) zhByTime.set(z.t, z.text);
        const useTiming = jp.length >= 6 && new Set(jp.map((l) => l.t)).size > 3;
        if (useTiming) {
          // 用 THBWiki 的分词结果去匹配网易云的每一行，匹配上就换上时间戳+译文
          const thb = tr.lines.filter((l) => l.text);
          const used = new Set();
          for (const line of tr.lines) {
            if (!line.text) continue;
            let best = null;
            for (let i = 0; i < jp.length; i++) {
              if (used.has(i)) continue;
              const s = sim(line.text, jp[i].text);
              if (!best || s > best.s) best = { s, i };
            }
            if (best && best.s > 0.55) {
              used.add(best.i);
              line.t = jp[best.i].t;
              line.zh = zhByTime.get(jp[best.i].t) || '';
              if (line.zh) withTrans++;
            }
          }
          tr.timing = true;
          withTiming++;
        } else {
          // 时间轴不可用：只把译文按顺序贴到 THBWiki 行上（懒对齐，靠相似度）
          const zhLines = zh.filter((z) => z.text);
          tr.lines.forEach((line, i) => {
            if (!line.text) return;
            const z = zhLines[i];
            if (z && sim(line.text, (jp[i] || {}).text || '') > 0.3) line.zh = z.text;
          });
        }
        // 校验：网易云歌词和 THBWiki 歌词得对得上，否则多半配错版本了
        const thbText = tr.lines.map((l) => l.text).filter(Boolean).join('');
        const neText = jp.map((l) => l.text).join('');
        let agree = 0, checked = 0;
        for (const line of tr.lines) {
          if (!line.text || line.text.length < 4) continue;
          checked++;
          if (jp.some((j) => sim(line.text, j.text) > 0.6)) agree++;
        }
        agreeRate = checked ? agree / checked : 0;
        jpLen = jp.length;
      }
      // 挂音频的两个条件：
      //   a. 网易云歌词和 THBWiki 歌词对得上（最稳）
      //   b. 压根没缓存到网易云歌词，但**曲名+艺人核对得上** —— 以前这种一律不挂，
      //      结果 44 首里 34 首完全没声，「单词页 → 去这句」点过去什么都放不出来
      const titleHit = norm(tr.title) === norm(nm.nTitle) || sim(tr.title, nm.nTitle) >= 0.9;
      const artistHit = !tr.artist || !nm.nArtist || sim(tr.artist, nm.nArtist) >= 0.6;
      // 歌词级证据够多就信歌词；歌词太少（或压根没缓存到）时，退回曲名+艺人核对；
      // 歌词很多但完全对不上 = 配错版本，绝不放音频
      const good = (jpLen >= 6 && agreeRate >= 0.45) || (jpLen < 6 && titleHit && artistHit);
      if (good) tr.audio = { type: 'netease', nid: nm.nid };
      else if (tr.audio && tr.audio.type === 'netease') tr.audio = null;
      tr.netease = { nid: nm.nid, title: nm.nTitle, artist: nm.nArtist, album: nm.nAlbum, status: good ? (nm.status || 'ok') : 'mismatch', agreeRate: Math.round(agreeRate * 100) / 100 };
      if (good) merged++;
    }

    // THBWiki 自带的时间轴（部分曲目）
    if (tr.timing) withTiming += 0;
  }

  // ---- 词表：合并释义（手工优先 > 机器翻译）+ 挂例句 ----
  const linesByWord = new Map();
  for (const tr of idx.tracks) {
    const playable = !!(tr.audioOss || tr.audio);      // 有音频的曲目优先当例句，不然「去这句」点了放不出声
    for (const line of tr.lines) {
      if (!line.text) continue;
      for (const seg of line.segs || []) {
        if (!seg.w || !seg.b) continue;
        if (!linesByWord.has(seg.b)) linesByWord.set(seg.b, []);
        const arr = linesByWord.get(seg.b);
        if (arr.length < 12) arr.push({ jp: line.text, zh: line.zh || '', track: tr.title, tid: tr.id, li: tr.lines.indexOf(line), t: line.t, playable });
      }
    }
  }
  let machine = 0, manual = 0, flagged = 0;
  for (const v of idx.vocab) {
    const all = linesByWord.get(v.word);
    if (all) {
      const withAudio = all.filter((x) => x.playable);
      const rest = all.filter((x) => !x.playable);
      v.examples = (withAudio.length ? withAudio.concat(rest) : all)
        .slice(0, 3)
        .map(({ playable, ...x }) => x);
    }
    const auto = autoMeanings[v.word];
    const man = meanings[v.word];
    const mine = mineMeanings[v.word];
    const o = (mine ? { meaning: mine } : null) || man || auto;
    if (!o) continue;
    v.meaning = typeof o === 'string' ? o : o.meaning || '';
    if (!v.meaning) { v.meaning = ''; continue; }
    v.meaningSrc = mine ? 'mine' : man ? 'machine' : 'auto';
    if (mine) manual++; else machine++;
    // 质量闸门：读起来不可信的标 check，前端会提示
    const bad = !mine && (v.meaning.length > Math.max(6, v.word.length * 3) || /^[a-zA-Z0-9]+$/.test(v.meaning) ||
      (v.word.length === 1 && v.meaning.length > 4));
    if (bad) { v.meaningCheck = true; flagged++; }
    else v.hasMeaning = true;
  }

  // ---- 阿里云 OSS 音频直链（data/audio-oss.json）：有的话前端直接用它，跳过每次解析地址 ----
  const ossMap = readJson(path.join(DATA, 'audio-oss.json'), { tracks: {} });
  let withOss = 0;
  for (const tr of idx.tracks) {
    const o = ossMap.tracks && ossMap.tracks[tr.id];
    if (o && o.url) { tr.audioOss = o.url; if (o.key) tr.audioOssKey = o.key; withOss++; }
  }
  idx.stats.withOss = withOss;

  idx.stats.withNetease = merged;
  idx.stats.withTranslations = withTrans;
  idx.stats.tracksWithTiming = idx.tracks.filter((t) => t.timing).length;
  idx.stats.withMeaning = idx.vocab.filter((v) => v.hasMeaning).length;
  idx.generatedAt = new Date().toISOString();

  fs.mkdirSync(WEB_DATA, { recursive: true });
  fs.writeFileSync(path.join(WEB_DATA, 'index.json'), JSON.stringify(idx), 'utf8');

  // 封面：优先网易云的（版权图更准），否则用 THBWiki 的
  if (WANT_COVERS) {
    const dir = path.join(WEB_DATA, 'covers');
    fs.mkdirSync(dir, { recursive: true });
    let got = 0;
    for (const tr of idx.tracks) {
      const dest = path.join(dir, tr.id + '.jpg');
      if (!FORCE_COVER && fs.existsSync(dest) && fs.statSync(dest).size > 1000) { tr.coverFile = `covers/${tr.id}.jpg`; continue; }
      let url = null;
      const n = ne.matches[tr.id];
      if (n && n.picUrl) url = n.picUrl;   // fetch-netease 已把封面地址取好
      if (!url && tr.cover) url = tr.cover;
      if (!url) continue;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'thlyrics-learning-tool/0.1' } });
        if (res.ok) {
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
          tr.coverFile = `covers/${tr.id}.jpg`;
          got++;
        }
      } catch { /* 封面失败不影响主流程 */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    fs.writeFileSync(path.join(WEB_DATA, 'index.json'), JSON.stringify(idx), 'utf8');
    console.log(`封面：本次下载 ${got} 张`);
  } else {
    for (const tr of idx.tracks) {
      const p = path.join(WEB_DATA, 'covers', tr.id + '.jpg');
      if (fs.existsSync(p)) tr.coverFile = `covers/${tr.id}.jpg`;
    }
    fs.writeFileSync(path.join(WEB_DATA, 'index.json'), JSON.stringify(idx), 'utf8');
  }

  // 读音兜底表：把内置曲目里出现过的每个词（含助词/活用形）连同读音、词性导出成一个很小的表。
  // 前端给「导入的歌」补词表外的读音时用它 —— 比在浏览器里挂一套分词词典便宜得多。
  // 底表：scripts/build-readings.mjs 从大量日语歌词里抽出来的「表面形 → 读音/词性」
  // （连活用形，例如 咲き/揺ら/纏い），内置曲目里出现的 token 优先级更高、覆盖写一遍。
  const rd = readJson(path.join(DATA, 'readings-extra.json'), {});
  const extraN = Object.keys(rd).length;
  for (const tr of idx.tracks) {
    for (const l of tr.lines) {
      for (const sg of l.segs || []) {
        if (!sg.s || !sg.y || rd[sg.s]) continue;
        rd[sg.s] = [sg.y, sg.r || '', sg.k || ''];
      }
    }
  }
  fs.writeFileSync(path.join(WEB_DATA, 'readings.json'), JSON.stringify(rd), 'utf8');
  console.log(`读音兜底表：${Object.keys(rd).length} 条（语料 ${extraN} + 内置曲目）→ docs/data/readings.json`);

  const s = idx.stats;
  console.log(`曲目 ${s.tracks} · 并入网易云 ${s.withNetease} · 有时间轴 ${s.tracksWithTiming} · 行级译文 ${s.withTranslations} 行`);
  console.log(`释义：共 ${s.withMeaning} 词有释义（人工精译 ${manual} / 机器 ${machine}），另有 ${flagged} 词机器译文可疑已标记`);
  console.log('输出 docs/data/index.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
