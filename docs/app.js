/* 东方同人曲 学唱机 —— 前端 v2（词汇入手 · 迷你播放条 + 全屏跟唱页） */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'thlyrics.tool.v1';
  const IDB_NAME = 'thlyrics';
  const GD = 'https://music-api.gdstudio.xyz/api.php';
  const API_BASE = 'https://thlyrics-auth-bybvhpggbp.cn-hangzhou.fcapp.run/api';   // 账号 / 同步 API（阿里云函数计算）
  const ACC_KEY = 'thlyrics.account.v1';

  // ────────────── 工具 ──────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (s) => (!s || !isFinite(s)) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const norm = (s) => String(s || '').toLowerCase().replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const POSNAME = { n: '名词', v: '动词', a: '形容词', na: '形容动词', adv: '副词', prt: '助词', aux: '助动词', conj: '接续词', int: '感叹词', rent: '连体词', pref: '接头词', oth: '其他' };
  const posKind = (w) => ({ '名詞': 'n', '動詞': 'v', '形容詞': 'a', '副詞': 'adv' }[w.pos] || 'oth');
  const brLabel = (v) => (v && v.br) ? `标日${v.br.bk} 第${v.br.l}课` : '';
  function level(v) {                       // 难度 1..5（点阵）
    if (v.br) return v.br.c <= 24 ? 1 : v.br.c <= 48 ? 2 : 3;
    if (v.jl >= 4) return 3;
    if (v.jl === 3) return 4;
    return 5;
  }
  /** 空状态：说清发生了什么 + 给下一步按钮（不要只丢一句"没有内容"） */
  const emptyBox = (title, sub, acts) => `<div class="emptybox">
    <div class="et">${esc(title)}</div>
    ${sub ? `<div class="es">${esc(sub)}</div>` : ''}
    ${(acts && acts.length) ? `<div class="row" style="justify-content:center;margin-top:14px">${acts.map(([k, t]) => `<button class="toolbtn" id="${k}">${esc(t)}</button>`).join('')}</div>` : ''}
  </div>`;
  const dotsHtml = (v) => { const l = level(v); return `<span class="dots">${'<b>●</b>'.repeat(l)}${'●'.repeat(5 - l)}</span>`; };

  // ────────────── 本地状态 ──────────────
  let S = { known: {}, notes: {}, audio: {}, local: {}, rate: 1, ruby: true, gloss: false, zh: true, mode: 'all', del: {}, autoSync: true };
  let ACC = null;                                  // {token, name, uid, admin}
  const loadAcc = () => { try { ACC = JSON.parse(localStorage.getItem(ACC_KEY) || 'null'); } catch { ACC = null; } };
  const saveAcc = () => { try { localStorage.setItem(ACC_KEY, JSON.stringify(ACC)); } catch {} };
  function loadLS() { try { const r = localStorage.getItem(LS_KEY); if (r) S = Object.assign(S, JSON.parse(r)); } catch {} S.known = S.known || {}; S.notes = S.notes || {}; S.audio = S.audio || {}; S.local = S.local || {}; S.imp = S.imp || {}; S.del = S.del || {}; S.autoSync = S.autoSync !== false; }
  // 每次落盘都顺手排一次云端同步（改释义、标词、导入、删除都会走到这里）
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch {} queueSync(); };
  // 已掌握记的是时间戳：正数=标了，负数=明确取消（云端合并时按时间戳取胜，不会被旧数据顶回来）
  const isKnown = (w) => !!(w && Number(S.known[w.id]) > 0);
  const meaningOf = (w) => (w && ((S.notes[w.id] && S.notes[w.id].meaning) || w.meaning)) || '';
  const toggleKnown = (w) => { if (!w) return; if (isKnown(w)) S.known[w.id] = -Date.now(); else S.known[w.id] = Date.now(); save(); };

  // ────────────── 本地音频（IndexedDB） ──────────────
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open(IDB_NAME, 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('audio')) r.result.createObjectStore('audio'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('audio', 'readonly'); const q = tx.objectStore('audio').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function idbDel(k) { const db = await idb(); return new Promise((res) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').delete(k); tx.oncomplete = res; tx.onerror = res; }); }

  // ────────────── 语音朗读 ──────────────
  let jaVoice = null;
  const pick = () => { jaVoice = (speechSynthesis.getVoices() || []).find((v) => (v.lang || '').toLowerCase().startsWith('ja')) || null; };
  if ('speechSynthesis' in window) { pick(); speechSynthesis.onvoiceschanged = pick; }
  function speak(t) { if (!('speechSynthesis' in window) || !t) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice; u.rate = .9; speechSynthesis.speak(u); }

  // ────────────── 音频 ──────────────
  const audio = new Audio();
  audio.preload = 'auto'; audio.setAttribute('playsinline', ''); audio.id = 'audio';
  const mountAudio = () => { if (document.body && !audio.isConnected) document.body.appendChild(audio); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAudio); else mountAudio();

  const urlCache = new Map();
  const URL_TTL = 18 * 60 * 1000;
  const UC_KEY = 'thlyrics.urlcache.v1';
  (function loadUrlCache() { try { const o = JSON.parse(localStorage.getItem(UC_KEY) || '{}'); for (const k of Object.keys(o)) if (o[k] && o[k].url) urlCache.set(k, o[k]); } catch {} })();
  const saveUrlCache = () => { try { const o = {}; for (const [k, v] of urlCache) if (Date.now() - v.at < URL_TTL) o[k] = v; localStorage.setItem(UC_KEY, JSON.stringify(o)); } catch {} };

  let stationNid = null, seekTime = null, prepToken = 0, posSavedAt = 0;
  const setNow = (t) => { const el = $('p-now'); if (el) el.textContent = t; };
  const setState = (t) => { const el = $('p-state'); if (el) el.textContent = t || ''; };
  function setLoad(on, text) {
    document.body.classList.toggle('loading', !!on);
    const b = $('playbtn');
    if (on) { if (text) setState(text); if (b) b.textContent = '⋯'; }
    else if (b) b.textContent = audio.paused ? '▶' : '❚❚';
    const pb = $('p-play'); if (pb) pb.textContent = on ? '⋯' : (audio.paused ? '▶' : '❚❚');
  }
  function jump(t) { if (t == null || !isFinite(t)) return; if (audio.readyState >= 1) { try { audio.currentTime = t; } catch {} } else seekTime = t; }
  function applySeek() { if (seekTime == null || audio.readyState < 1) return; const t = seekTime; seekTime = null; try { audio.currentTime = t; } catch {} }
  function bufferedAhead(t) { try { for (let i = 0; i < audio.buffered.length; i++) if (t >= audio.buffered.start(i) - .2 && t <= audio.buffered.end(i) + .2) return audio.buffered.end(i) - t; } catch {} return 0; }

  async function urlFor(track) {
    if (track.audioOss) return track.audioOss;                       // 自建对象存储固定直链：不需要解析
    const st = S.audio[track.id] || track.audio;
    if (!st || !st.nid) return null;
    const hit = urlCache.get(String(st.nid));
    if (hit && Date.now() - hit.at < URL_TTL) return hit.url;
    const r = await fetch(`${GD}?types=url&source=netease&id=${encodeURIComponent(st.nid)}&br=320`);
    const j = await r.json().catch(() => null);
    if (!j || !j.url) throw new Error('取不到音频地址');
    urlCache.set(String(st.nid), { url: j.url, at: Date.now() }); saveUrlCache();
    return j.url;
  }

  /** 进单曲/跟唱页就把音频准备好：有直链的开始缓冲，没有的先解析地址 */
  async function prepAudio(track) {
    if (!track) return;
    const my = ++prepToken;
    if (audio.getAttribute('data-tid') === track.id && audio.src) return;
    const eager = !!S.used;
    let local = S.local[track.id];
    if (!local) { try { const b = await idbGet(track.id); if (b) local = URL.createObjectURL(b); } catch {} }
    if (my !== prepToken) return;
    const attach = (url) => {
      if (audio.getAttribute('data-tid') === track.id && audio.src) return;   // 已经挂上这首了
      stationNid = null; seekTime = null;
      audio.setAttribute('data-tid', track.id);
      audio.src = url; audio.load();
      setState(eager ? '缓冲中…' : '已就绪，点播放');
    };
    if (local) { attach(local); return; }
    const nid = (S.audio[track.id] && S.audio[track.id].nid) || (track.audio && track.audio.nid) || null;
    const hit = nid ? urlCache.get(String(nid)) : null;
    if (track.audioOss) { attach(track.audioOss); return; }
    if (hit && Date.now() - hit.at < URL_TTL) { stationNid = nid; if (eager) attach(hit.url); else setState('已就绪，点播放'); return; }
    if (!nid) { setState('还没有音频'); return; }
    setState('正在准备音频…');
    try {
      const url = await urlFor(track);
      if (my !== prepToken || !url) return;
      stationNid = nid;
      if (eager) attach(url); else setState('已就绪，点播放');
    } catch (e) { if (my === prepToken) setState('取音频地址失败：' + e.message); }
  }

  async function playTrack(track, opts = {}) {
    if (!track) return;
    if (audio.getAttribute('data-tid') !== track.id || !audio.src) {
      prepToken++;   // 让在飞的 prepAudio 作废，避免它随后 attach → load() 把刚起的播放重置
      audio.pause();
      setLoad(true, '正在准备音频…');
      try {
        let local = S.local[track.id];
        if (!local) { try { const b = await idbGet(track.id); if (b) local = URL.createObjectURL(b); } catch {} }
        const url = local || await urlFor(track);
        if (!url) { setLoad(false); setState(track.audioOss ? '音频地址不可用' : '没有音频'); return; }
        stationNid = local ? null : ((S.audio[track.id] && S.audio[track.id].nid) || (track.audio && track.audio.nid) || null);
        audio.setAttribute('data-tid', track.id);
        audio.src = url;
      } catch (e) { setLoad(false); setState('播放失败：' + e.message); return; }
    }
    audio.playbackRate = Number(S.rate || 1);
    S.used = 1; save();
    if (opts.at != null) jump(opts.at);
    try { await audio.play(); } catch {}
    $('minibar').classList.add('on');
  }

  function bindAudio() {
    audio.addEventListener('waiting', () => setLoad(true, '缓冲中…'));
    audio.addEventListener('stalled', () => setLoad(true, '缓冲中…'));
    audio.addEventListener('canplay', () => { applySeek(); setLoad(false); });
    audio.addEventListener('loadedmetadata', () => { applySeek(); if (audio.duration) { $('p-dur').textContent = fmt(audio.duration); $('p-seek').value = String(Math.round((audio.currentTime / audio.duration) * 1000)); } });
    audio.addEventListener('loadeddata', applySeek);
    audio.addEventListener('playing', () => { setLoad(false); $('minibar').classList.add('on'); });
    audio.addEventListener('play', () => { $('playbtn').textContent = '❚❚'; $('p-play').textContent = '❚❚'; });
    audio.addEventListener('pause', () => { $('playbtn').textContent = '▶'; $('p-play').textContent = '▶'; });
    audio.addEventListener('error', () => { if (stationNid) urlCache.delete(String(stationNid)); setLoad(false); setState('音频加载失败，点播放重试'); });
    // 记住听到哪：每 3 秒落一次，下次进这首歌从这儿继续
    audio.addEventListener('timeupdate', () => {
      if (!curTrack || !(audio.currentTime > 3)) return;
      const now = Date.now();
      if (now - posSavedAt < 3000) return;
      posSavedAt = now;
      S.pos = S.pos || {};
      S.pos[curTrack.id] = Math.round(audio.currentTime);
      save();
    });
  }

  // ────────────── 单句循环 / 播放帧 ──────────────
  let curTrack = null, curLines = [], loopLine = null, raf = null;
  let activeLine = -1;                               // 由播放进度推出的"当前句"
  let mode = (S.mode === 'loop') ? 'loop' : 'all';   // 整首 / 单句循环
  const lineEnd = (i) => (curLines[i + 1] && curLines[i + 1].t != null) ? curLines[i + 1].t : null;

  function setMode(m) {
    mode = m === 'loop' ? 'loop' : 'all';
    S.mode = mode; save();
    $('m-all').classList.toggle('on', mode === 'all');
    $('m-loop').classList.toggle('on', mode === 'loop');
    const mb = $('mb-loop'); if (mb) mb.hidden = mode !== 'loop';
    if (mode === 'loop') {
      if (loopLine == null || !curLines[loopLine]) {
        const i = activeLine >= 0 ? activeLine : curLines.findIndex((l) => l.text && l.t != null);
        loopLine = i >= 0 ? i : 0;
        const t = curLines[loopLine] && curLines[loopLine].t;
        if (t != null) { jump(t); if (audio.paused) audio.play().catch(() => {}); }
      }
    } else loopLine = null;
    highlight(true);
  }

  function setLoop(i, silent) {
    loopLine = i;
    if (i != null && mode !== 'loop') setMode('loop');
    const mb = $('mb-loop');
    if (mb) mb.hidden = i == null || mode !== 'loop';
    highlight(true);
    if (i == null || !curLines[i]) return;
    const t = curLines[i].t;
    if (t == null) { setState('这句没有时间轴'); return; }
    jump(t);
    if (audio.paused) audio.play().catch(() => {});
  }
  const lineAtTime = (t) => {
    let idx = -1;
    for (let i = 0; i < curLines.length; i++) {
      const st = curLines[i].t;
      if (st == null || !curLines[i].text.trim()) continue;
      if (st <= t + 0.08) idx = i; else break;
    }
    return idx;
  };
  function highlight(scroll) {
    const on = (mode === 'loop' && loopLine != null) ? loopLine : activeLine;
    document.querySelectorAll('.lblock[data-i]').forEach((el) => el.classList.toggle('playing', Number(el.dataset.i) === on));
    const pl = $('plyric'); if (pl) pl.classList.toggle('has-active', on >= 0);
    if (!scroll) return;
    const el = document.querySelector('#plyric .lblock.playing');
    const box = $('plyric');
    if (!el || !box) return;
    if (box.scrollHeight <= box.clientHeight + 4) return;
    const r = el.getBoundingClientRect(), br = box.getBoundingClientRect();
    const top = r.top - br.top, bottom = r.bottom - br.top, H = br.height;
    // 只在当前句跑出中间安全带时滚，而且只滚歌词容器本身（用 scrollIntoView 会把整页一起滚）
    if (top < H * .30 || bottom > H * .62) {
      box.scrollTo({ top: Math.max(0, box.scrollTop + top - H * .42), behavior: 'smooth' });
    }
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (audio.duration > 0) {
      const t = audio.currentTime;
      $('p-seek').value = String(Math.round((t / audio.duration) * 1000));
      $('p-time').textContent = fmt(t);
      $('p-dur').textContent = fmt(audio.duration);
      if (audio.paused) setLoad(false);
      else if (bufferedAhead(t) < .25 && !audio.seeking) setLoad(true, '缓冲中…');
      else setLoad(false);
      const at = lineAtTime(t);
      if (at !== activeLine) { activeLine = at; highlight(at >= 0); }
    }
    if (mode !== 'loop' || loopLine == null || !curLines[loopLine]) return;
    const start = curLines[loopLine].t;
    if (start == null) return;
    const end = lineEnd(loopLine), now = audio.currentTime;
    if (end != null) { if (now >= end - .06 || now < start - .4) audio.currentTime = start; }
    else if (now < start - .4) audio.currentTime = start;
  }
  function step(dir) {
    const lines = curLines.map((l, i) => ({ l, i })).filter((x) => x.l.text.trim() && x.l.t != null);
    if (!lines.length) return;
    let pos = lines.findIndex((x) => x.i === loopLine);
    if (pos < 0) pos = dir > 0 ? -1 : lines.length;
    let n = pos + dir;
    if (n < 0) n = lines.length - 1;
    if (n >= lines.length) n = 0;
    // 循环开着时，上一句/下一句是「换到那句继续循环」，不能悄悄退出循环
    playFrom(lines[n].i);
  }
  /** 点句子：从这句继续往下播（不循环）——只有双击/长按/循环键才开单句循环 */
  function playFrom(i) {
    if (!curLines[i]) return;
    const t = curLines[i].t;
    if (mode === 'loop') {                       // 循环模式：换到这句继续循环
      loopLine = i; activeLine = i;
      if (t != null) jump(t);
      if (audio.paused) audio.play().catch(() => {});
      highlight(true); return;
    }
    activeLine = i;
    if (t != null) jump(t);
    highlight(true);
    if (curTrack) playTrack(curTrack, { at: t });   // 整首模式：从这句继续往下播
    toast('双击＝单句循环');
  }
  let toastTimer = null;
  function toast(msg) {
    setState(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (!audio.paused) setState(''); }, 2600);
  }

  // ────────────── 数据 ──────────────
  let IDX = null, VOCAB = [], VBY = new Map(), VBYID = new Map(), SURF = new Map(), TRACK = new Map();
  let deckCount = 30, twFilter = 'all', filter = 'all', lastNonSearch = '#/learn';

  const levelName = (v) => (v.br ? `标日${v.br.bk} 第${v.br.l}课` : v.jl ? `JLPT N${v.jl}` : '标日未收录');

  function wordRow(v) {
    return `<div class="item word" data-id="${v.id}">
      <div class="col">
        <div class="l1">${esc(v.word)}<span class="rd">${esc(v.reading)}</span></div>
        <div class="l2">${esc(meaningOf(v) || '（还没释义）')}</div>
        <div class="l3">${POSNAME[posKind(v)]} · ${esc(levelName(v))} · ${v.tracks.length} 首歌 / ${v.count} 次</div>
      </div>
      ${dotsHtml(v)}
      <button class="tick ${isKnown(v) ? 'on' : ''}" data-known="${v.id}" title="标为已掌握">✓</button>
    </div>`;
  }
  function wireWords(root) {
    root.querySelectorAll('.word').forEach((el) => {
      const id = Number(el.dataset.id);
      el.onclick = (e) => {
        if (e.target.closest('[data-known]')) return;
        go('#/word/' + id);
      };
    });
    root.querySelectorAll('[data-known]').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation();
      const v = VBYID.get(Number(el.dataset.known));
      toggleKnown(v);
      el.classList.toggle('on', isKnown(v));
      el.closest('.word').classList.toggle('known', isKnown(v));
      if ($('view-learn').contains(el)) renderLearn();
    }));
  }
  const rangeOk = (v, r) => r === 'all' ? true
    : r === 'c1' ? (!!v.br && v.br.c <= 24)
    : r === 'c2' ? (!!v.br && v.br.c > 24 && v.br.c <= 48)
    : r === 'c3' ? (!!v.br && v.br.c > 48)
    : r === 'out' ? !v.br
    : r === 'n45' ? v.jl >= 4
    : r === 'n123' ? (!!v.jl && v.jl <= 3) : true;
  function deckList() {
    let list = VOCAB.filter((v) => rangeOk(v, S.dRange || 'all') && ((S.dPos || 'all') === 'all' || v.pos === S.dPos));
    if (S.hideKnown !== false) list = list.filter((v) => !isKnown(v));
    const by = S.dSort || 'easy';
    if (by === 'freq') return [...list].sort((a, b) => b.count - a.count || a.diff - b.diff);
    if (by === 'az') return [...list].sort((a, b) => String(a.reading).localeCompare(String(b.reading), 'ja'));
    return [...list].sort((a, b) => a.diff - b.diff || a.id - b.id);
  }

  /** 首页：只突出一条主路径——找歌 → 选歌 → 开始学唱；其他入口降级成小按钮 */
  function renderHome() {
    const last = (S.lastTrack && TRACK.get(S.lastTrack)) || null;
    const due = deckList().slice(0, 8);
    const knownN = VOCAB.filter(isKnown).length;
    const withAudio = IDX.tracks.filter((t) => t.audio || t.audioOss).length;
    $('view-home').innerHTML = `
      <div class="herohead">
        <div class="ht">东方同人曲 学唱机</div>
        <div class="hs">把喜欢的东方同人曲，变成日语教材。</div>
        <div class="homesearch">
          <input id="h-q" placeholder="搜曲名、社团、原曲、词…" autocomplete="off">
          <button id="h-go">搜索</button>
        </div>
        <div class="hln">
          <button id="h-songs">曲库 ${IDX.tracks.length} 首</button>
          <button id="h-words">学词</button>
          <button id="h-mine">生词本 ${knownN}</button>
        </div>
      </div>
      ${last ? `<div class="nowcard">
        <div class="k">NOW LEARNING · 正在学习</div>
        <div class="t">${esc(last.title)}</div>
        <div class="a">${esc(last.artist)}${last.base ? ' · 原曲：' + esc(last.base) : ''}${(S.pos || {})[last.id] > 5 ? ` · 上次听到 ${fmt(S.pos[last.id])}` : ''}</div>
        <div class="acts"><button class="btn-main" id="h-continue">继续学唱</button><button class="btn-ghost" id="h-pick">换一首</button></div>
      </div>` : `<div class="nowcard">
        <div class="k">开始</div>
        <div class="t">先挑一首你想听的</div>
        <div class="a">曲库里有 ${withAudio} 首能直接出声；也可以粘自己的网易云歌单进来。</div>
        <div class="acts"><button class="btn-main" id="h-pick">去曲库挑一首</button><button class="btn-ghost" id="h-imp">导入歌单</button></div>
      </div>`}
      <div class="hair"></div>
      <div class="sec-sub">今天可以从这几个词开始</div>
      <div class="wordstrip">${due.map((v) => `<button data-w="${v.id}">${esc(v.word)}<span style="color:var(--ink3)"> ${esc(v.reading || '')}</span></button>`).join('') || '<span class="meta">词表还没准备好</span>'}</div>`;
    const goHome = (h) => { location.hash = h; };
    $('h-go').onclick = () => { const q = ($('h-q').value || '').trim(); if (q) goHome('#/search/' + encodeURIComponent(q)); };
    $('h-q').onkeydown = (e) => { if (e.key === 'Enter') $('h-go').click(); };
    $('h-q').oninput = (e) => { const v = e.target.value.trim(); if (v) { clearTimeout(homeQt); homeQt = setTimeout(() => goHome('#/search/' + encodeURIComponent(v)), 320); } };
    $('h-songs').onclick = () => goHome('#/songs');
    $('h-words').onclick = () => goHome('#/learn');
    $('h-mine').onclick = () => goHome('#/mine');
    if ($('h-continue')) $('h-continue').onclick = () => goHome('#/track/' + last.id);
    if ($('h-pick')) $('h-pick').onclick = () => goHome('#/songs');
    if ($('h-imp')) $('h-imp').onclick = () => { impState.open = true; goHome('#/songs'); };
    $('view-home').querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => goHome('#/word/' + el.dataset.w)));
  }
  let homeQt = null;

  // ────────────── 复习（生词本的学习闭环：看词 → 回忆 → 看释义 → 标记） ──────────────
  let revDeck = [], revI = 0, revShown = false, revStat = { ok: 0, again: 0 };
  function startReview(n) {
    const pool = VOCAB.filter((v) => !isKnown(v) && v.examples && v.examples.length);
    const pick = [];
    const step = Math.max(1, Math.floor(pool.length / (n || 20)));
    for (let i = 0; i < pool.length && pick.length < (n || 20); i += step) pick.push(pool[i]);
    revDeck = pick.length ? pick : VOCAB.slice(0, 10);
    revI = 0; revShown = false; revStat = { ok: 0, again: 0 };
  }
  function renderReview() {
    if (!revDeck.length) startReview(20);
    const v = revDeck[revI];
    if (!v) {
      $('view-review').innerHTML = `<div class="revwrap">
        <div class="sec-head"><div><div class="sec-title">复习完成</div><div class="sec-sub">这轮 ${revDeck.length} 个词 · 记住了 ${revStat.ok} · 还要再看 ${revStat.again}</div></div></div>
        ${emptyBox('这一轮过完了', '记住的已经进了生词本；"还要再看"的下一轮还会出现。', [])}
        <div class="row" style="justify-content:center;gap:8px">
          <button class="toolbtn" id="rev-again">再来一轮</button>
          <button class="toolbtn" id="rev-mine">回生词本</button>
        </div></div>`;
      if ($('rev-again')) $('rev-again').onclick = () => { startReview(20); renderReview(); };
      if ($('rev-mine')) $('rev-mine').onclick = () => go('#/mine');
      return;
    }
    const ex = (v.examples || [])[0];
    $('view-review').innerHTML = `<div class="revwrap">
      <div class="sec-head"><div><div class="sec-title">复习</div><div class="sec-sub">第 ${revI + 1} / ${revDeck.length} 个 · 记住 ${revStat.ok} · 还要再看 ${revStat.again}</div></div></div>
      <div class="revbar"><i style="width:${Math.round(((revI) / revDeck.length) * 100)}%"></i></div>
      <div class="revcard">
        <div class="rw">${esc(v.word)}</div>
        ${revShown ? `<div class="rr">${esc(v.reading || '')} ${esc(v.romaji || '')}</div>
          <div class="rm">${esc(meaningOf(v) || '（没有释义）')}</div>
          ${ex ? `<div class="rx">${esc(ex.track || '')}<br>${esc(ex.jp)}${ex.zh ? '<br>' + esc(ex.zh) : ''}</div>` : ''}`
        : '<div class="rr">先自己想一下意思，再点下面的按钮</div>'}
      </div>
      <div class="revacts">
        ${revShown ? `<button id="rev-again2">还不熟</button><button class="k" id="rev-ok">记住了</button>`
        : `<button class="k" id="rev-show">看释义</button>`}
      </div>
      <div class="row" style="justify-content:center;margin-top:12px;gap:8px">
        ${ex && ex.tid ? `<button class="toolbtn" id="rev-cue">去这句</button>` : ''}
        <button class="toolbtn" id="rev-detail">词条详情</button>
        <button class="toolbtn" id="rev-stop">结束</button>
      </div></div>`;
    if ($('rev-show')) $('rev-show').onclick = () => { revShown = true; renderReview(); };
    if ($('rev-ok')) $('rev-ok').onclick = () => { toggleKnown(v); revStat.ok++; revI++; revShown = false; renderReview(); };
    if ($('rev-again2')) $('rev-again2').onclick = () => { if (isKnown(v)) toggleKnown(v); revStat.again++; revDeck.push(v); revI++; revShown = false; renderReview(); };
    if ($('rev-cue')) $('rev-cue').onclick = () => go('#/track/' + ex.tid + '@' + ex.li);
    if ($('rev-detail')) $('rev-detail').onclick = () => go('#/word/' + v.id);
    if ($('rev-stop')) $('rev-stop').onclick = () => go('#/mine');
  }

  function renderLearn() {
    const known = VOCAB.filter(isKnown).length;
    const list = deckList();
    const pct = Math.round((known / VOCAB.length) * 100);
    $('view-learn').innerHTML = `
      <div class="sec-head">
        <div>
          <div class="sec-title">今天学哪些词</div>
          <div class="sec-sub">已掌握 ${known} / ${VOCAB.length} 词 · 这一批还有 ${list.length} 个</div>
        </div>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="filtrow">
        <select class="sel" id="d-range">
          <option value="all">全部范围</option><option value="c1">标日初级上（1-24课）</option>
          <option value="c2">标日初级下（25-48课）</option><option value="c3">标日中级</option>
          <option value="out">标日未收录</option><option value="n45">JLPT N5-N4</option><option value="n123">JLPT N3-N1</option>
        </select>
        <select class="sel" id="d-pos">
          <option value="all">全部词性</option><option value="名詞">名词</option><option value="動詞">动词</option>
          <option value="形容詞">形容词</option><option value="副詞">副词</option>
        </select>
        <select class="sel" id="d-sort">
          <option value="easy">从易到难</option><option value="freq">最常见</option><option value="az">五十音</option>
        </select>
        <button class="toolbtn ${S.hideKnown !== false ? 'on' : ''}" id="d-hideknown">隐藏已掌握</button>
      </div>
      <div class="list" id="deck">${list.slice(0, deckCount).map(wordRow).join('')}</div>
      ${list.length === 0 ? '<div class="empty">这个范围里的词都掌握了</div>' : ''}
      ${list.length > deckCount ? `<div class="row" style="justify-content:center;margin-top:16px"><button class="toolbtn" id="d-more">再看 30 个</button></div>` : ''}
      <div class="hint">点词看读音释义，右侧 ✓ 标已掌握。</div>`;
    $('d-range').value = S.dRange || 'all';
    $('d-pos').value = S.dPos || 'all';
    $('d-sort').value = S.dSort || 'easy';
    $('d-range').onchange = (e) => { S.dRange = e.target.value; save(); deckCount = 30; renderLearn(); };
    $('d-pos').onchange = (e) => { S.dPos = e.target.value; save(); deckCount = 30; renderLearn(); };
    $('d-sort').onchange = (e) => { S.dSort = e.target.value; save(); renderLearn(); };
    $('d-hideknown').onclick = (e) => { S.hideKnown = S.hideKnown === false; save(); e.target.classList.toggle('on', S.hideKnown !== false); renderLearn(); };
    if ($('d-more')) $('d-more').onclick = () => { deckCount += 30; renderLearn(); };
    wireWords($('view-learn'));
  }

  function trackRow(t) {
    const tags = [];
    if (t.imp) tags.push('导入');
    if (t.audio || t.audioOss || S.audio[t.id] || S.local[t.id]) tags.push('有声'); else tags.push('无音源');
    if (t.lines.some((l) => l.zh)) tags.push('中文');
    const brN = (t.vocabIds || []).filter((i) => VBYID.get(i) && VBYID.get(i).br).length;
    if (brN) tags.push(`标日 ${brN}`);
    // 只有真有封面素材才放图；没有就不放空占位框（不为了填满空间做装饰卡片）
    const cover = t.coverFile ? `<img class="cover" loading="lazy" src="data/${t.coverFile}" alt="">`
      : (t.coverUrl ? `<img class="cover" loading="lazy" src="${esc(t.coverUrl)}" alt="">` : '');
    return `<div class="item track" data-id="${t.id}">
      ${cover}
      <div class="col">
        <div class="l1">${esc(t.title)}</div>
        <div class="l2">${esc(t.artist)}${t.base ? ' · ' + esc(t.base) : (t.album ? ' · ' + esc(t.album) : '')}</div>
        <div class="l3">${t.lineCount} 行歌词${tags.length ? ' · ' + tags.join(' · ') : ''}</div>
      </div>
      ${t.imp ? `<button class="tick del" data-del="${esc(t.id)}" title="删除这首">✕</button>` : '<span class="mini">›</span>'}
    </div>`;
  }
  // ────────────── 网易云歌单导入（纯前端，失败逐首报错） ──────────────
  // 歌单详情 / 歌词 / 音频地址都走 music-api.gdstudio.xyz（它带 CORS 头，浏览器能直连）。
  // 收进来的歌存在本机 localStorage：歌词只有「时间轴 + 原文 + 译文」，
  // 分词用现有词表（1358 词 + 活用形）做最长匹配，所以导入的曲目同样有
  // 词性配色 / 逐词罗马音 / 释义 / 点词弹层 / 单句循环，和内置曲目一致。
  // 假名 → 罗马音（scripts/kana-romaji.mjs 的精简移植；导入曲目里没进词表的部分靠它给读音）
  const DIGRAPHS = {
    'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo', 'きぇ': 'kye',
    'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
    'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho', 'しぇ': 'she',
    'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo', 'じぇ': 'je',
    'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho', 'ちぇ': 'che',
    'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
    'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
    'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
    'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
    'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
    'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
    'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo', 'ふゅ': 'fyu',
    'てぃ': 'ti', 'てゅ': 'tyu', 'でぃ': 'di', 'でゅ': 'dyu',
    'とぅ': 'tu', 'どぅ': 'du',
    'うぃ': 'wi', 'うぇ': 'we', 'うぉ': 'wo',
    'ゔぁ': 'va', 'ゔぃ': 'vi', 'ゔぇ': 've', 'ゔぉ': 'vo', 'ゔ': 'vu',
    'きぇ': 'kye', 'くぁ': 'kwa', 'くぃ': 'kwi', 'くぇ': 'kwe', 'くぉ': 'kwo',
    'ぐぁ': 'gwa', 'すぃ': 'si', 'ずぃ': 'zi', 'つぁ': 'tsa', 'つぃ': 'tsi',
    'つぇ': 'tse', 'つぉ': 'tso', 'しぃ': 'syi', 'じぃ': 'jyi', 'ちぃ': 'cyi',
    'いぇ': 'ye',
  };
  const MONO = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
    か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
    が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
    ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
    た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
    な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
    は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
    ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
    ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
    や: 'ya', ゆ: 'yu', よ: 'yo',
    ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
    わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o',
    ん: 'n',
    ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
    ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
    ゔ: 'vu',
    '　': ' ', ' ': ' ', '・': ' ',
  };
  const KANA_RE = /[\u3041-\u309f\u30a0-\u30ff]/;
  function kanaRomaji(input) {
    const s = norm(String(input == null ? '' : input));
    let out = '', i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === 'っ') {
        const nxt = DIGRAPHS[s.slice(i + 1, i + 3)] || MONO[s[i + 1]] || '';
        if (nxt) out += nxt[0] === 'c' ? 't' : nxt[0];
        i++; continue;
      }
      if (c === 'ー') {
        const last = out.match(/[aeiou](?!.*[aeiou])/);
        if (last) out += last[0];
        i++; continue;
      }
      const pair = s.slice(i, i + 2);
      if (DIGRAPHS[pair]) { out += DIGRAPHS[pair]; i += 2; continue; }
      if (MONO[c] !== undefined) { out += MONO[c]; i++; continue; }
      out += c; i++;
    }
    return out;
  }
  let DICT = null, DICT_MAX = 1, importing = false;
  let RDL = new Map(), RDL_MAX = 1;   // 读音兜底表（内置曲目里出现过的词 → 罗马音/读音/词性）
  const SEG = ('Segmenter' in Intl) ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
  function buildDict() {
    DICT = new Map();
    const put = (k, v, form) => { if (k && !DICT.has(k)) DICT.set(k, { v, form }); };
    for (const v of VOCAB) {
      put(v.word, v, v.word);
      for (const f of Object.keys(v.forms || {})) put(f, v, f);
    }
    DICT_MAX = 1;
    for (const k of DICT.keys()) if (k.length > DICT_MAX) DICT_MAX = k.length;
    DICT_MAX = Math.min(DICT_MAX, 8);
  }
  const jpText = (s) => /[\u3041-\u30ff\u4e00-\u9fff]/.test(String(s || ''));
  let readingsReady = null;
  /** 读音兜底表（~400KB）只拉一次；导入前必须确保它已经就绪，否则新歌的第一个字就查不到读音 */
  function ensureReadings() {
    if (!readingsReady) {
      readingsReady = fetch('data/readings.json').then((r) => r.json()).then(buildReadings).catch(() => {});
    }
    return readingsReady;
  }
  function buildReadings(map) {
    RDL = new Map();
    for (const [k, v] of Object.entries(map || {})) RDL.set(k, v);
    RDL_MAX = 1;
    for (const k of RDL.keys()) if (k.length > RDL_MAX) RDL_MAX = k.length;
    RDL_MAX = Math.min(RDL_MAX, 10);
  }
  /** 用词表给一句话分词（最长匹配）；命中的词带上词性/罗马音，没命中的按普通文本 */
  function segsFor(text) {
    const out = [];
    if (!text) return out;
    let plain = '';
    // 没进词表的片段：先用浏览器自带的分词器切词（ICU，认得日语），
    // 假名串补上罗马音（跟唱要看），汉字串单独成块，标点/英文按纯文本。
    const flush = () => {
      if (!plain) return;
      const buf = plain; plain = '';
      const parts = [];
      if (SEG) for (const x of SEG.segment(buf)) parts.push(x.segment);
      else parts.push(...buf.split(/([\u3041-\u309f\u30a0-\u30ff]+)/));
      for (const part of parts) {
        if (!part) continue;
        const kanaOnly = /^[\u3041-\u309f\u30a0-\u30ff]+$/.test(part);
        if (kanaOnly) { out.push({ s: part, k: 'oth', y: kanaRomaji(part) }); continue; }
        if (/[\u4e00-\u9fff]/.test(part)) {
          for (const piece of part.split(/([\u3041-\u309f\u30a0-\u30ff]+)/)) {
            if (!piece) continue;
            if (/^[\u3041-\u309f\u30a0-\u30ff]+$/.test(piece)) out.push({ s: piece, k: 'oth', y: kanaRomaji(piece) });
            else out.push({ s: piece, k: 'oth' });
          }
          continue;
        }
        out.push({ s: part });
      }
    };
    for (let i = 0; i < text.length;) {
      let hit = null, len = 0;
      for (let n = Math.min(DICT_MAX, text.length - i); n >= 1; n--) {
        const e = DICT.get(text.substr(i, n));
        if (e) { hit = e; len = n; break; }
      }
      if (!hit && RDL.size) {                       // 词表没有 → 读音兜底表（带词性/罗马音，但没有释义）
        for (let n = Math.min(RDL_MAX, text.length - i); n >= 1; n--) {
          const v = RDL.get(text.substr(i, n));
          if (v) { hit = { rd: v }; len = n; break; }
        }
      }
      if (!hit) { plain += text[i]; i++; continue; }
      flush();
      const surf = text.substr(i, len);
      if (hit.rd) {
        out.push({ s: surf, k: hit.rd[2] || 'oth', y: hit.rd[0], r: hit.rd[1] || '' });
        i += len;
        continue;
      }
      const f = hit.v.forms && hit.v.forms[hit.form];
      // 活用形的罗马音一律按它的「表面形读音」推（続け→tsuzuke、咲い→sai），
      // 不能用 forms[].romaji —— 那个字段历史上存的是词条形读音
      const rd = (f && f.reading) || hit.v.reading || '';
      out.push({
        s: surf, k: posKind(hit.v), w: true, b: hit.v.word,
        y: rd ? kanaRomaji(rd) : (f && f.romaji) || hit.v.romaji || '', r: rd,
      });
      i += len;
    }
    flush();
    return out;
  }
  /** 本机存的导入记录 → 和内置曲目同构的 track */
  function impTrack(rec) {
    const lines = (rec.lines || []).map((l) => {
      const segs = segsFor(l.text);
      return {
        t: l.t, text: l.text, zh: l.zh || '', jp: jpText(l.text), segs,
        romaji: segs.map((s) => s.y || s.s).join(' ').replace(/\s+/g, ' ').trim(),
      };
    });
    const ids = new Set();
    for (const l of lines) for (const sg of l.segs) if (sg.w && sg.b) ids.add(sg.b);
    return {
      id: rec.id, imp: true, title: rec.title, artist: rec.artist, album: rec.album,
      base: '', coverUrl: rec.cover || '', plName: rec.plName || '', plId: rec.plId || '',
      audio: { type: 'netease', nid: rec.nid }, timing: 'netease',
      lineCount: lines.filter((l) => l.text.trim()).length,
      vocabIds: [...ids].map((w) => VBY.get(w)).filter(Boolean).map((v) => v.id), lines,
    };
  }
  const LRC_META = /^\s*(作词|作詞|作曲|编曲|編曲|制作人|製作人|混音|母带|母帶|吉他|贝斯|鼓|录音|和声|和聲|歌词来源|歌詞來源|校对|翻譯|翻译|调校|調教|曲绘|曲繪|PV|原曲|原作曲|原作|社团|社團|专辑|專輯|演唱|歌手|来自|來自|出典|收录|收錄|封面|插图|插圖|LRC|歌词|歌詞|Vocals|Lyrics|Composer|Arranger|Album|Producer|Mixing|Mastering)\s*[:：]/i;
  // 歌词里常见的装饰性符号（跟唱时没用、还会把行搞得乱七八糟）
  const LRC_DECO = /[♪♫♬♩►◄★☆✦✧✩✪✫✬✭✮❀✿❁❃❋◇◆◈○●◎■□▲△▼▽※→←↑↓⇔⇒⌒〓۩۞๑๑۩〄〆々]+/g;
  /** LRC → 行数组（只保留唱出来的行；翻译按时间就近配对） */
  function parseLrc(lyric, tlyric) {
    // 注意：[\d] 后面只能用 [ \t]*，用 \s* 会把换行也吃进去 —— 空时间戳行（[00:26.000]）
    // 会把下一行的内容连时间戳一起吸上来（时间轴也跟着错）
    const rows = (txt) => [...String(txt || '').matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\][ \t]*(.*)/g)]
      .map((m) => ({
        t: Number(m[1]) * 60 + Number(String(m[2]).replace(':', '.')),
        text: m[3].replace(/^(\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+\s*/, '').trim(),
      }));
    const trs = rows(tlyric)
      .map((r) => ({ t: r.t, text: r.text.replace(LRC_DECO, '').trim(), used: false }))
      .filter((r) => r.text);
    const out = [];
    for (const r of rows(lyric)) {
      // 装饰符号去掉；去掉之后没有语言字符（假名/汉字/英数）的整行不要
      const clean = r.text.replace(LRC_DECO, '').replace(/\s+/g, ' ').trim();
      if (!clean || !/[\u3041-\u309f\u30a0-\u30ff\u4e00-\u9fffA-Za-z0-9]/.test(clean)) continue;
      if (LRC_META.test(clean) || /歌词来源|THB\s?WIKI|纯音乐/i.test(clean)) continue;
      const hit = trs.find((x) => !x.used && Math.abs(x.t - r.t) < .35);
      if (hit) hit.used = true;
      out.push({ t: Math.round(r.t * 100) / 100, text: clean, zh: hit ? hit.text.replace(LRC_DECO, '').trim() : '' });
    }
    out.sort((a, b) => a.t - b.t);
    const seen = new Set();
    const uniq = out.filter((l) => (seen.has(l.t) ? false : (seen.add(l.t), true)));
    return mergeShortLines(uniq);
  }
  /** 有的 LRC 是逐字/逐拍一行一行的（唱到哪标到哪），跟唱时一行一个字很碎。
   *  把「连续几个都很短、且间隔很近」的行并回一句。 */
  function mergeShortLines(lines) {
    const vis = (s) => s.replace(/\s/g, '').length;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      let cur = Object.assign({}, lines[i]);
      while (i + 1 < lines.length && vis(lines[i].text) <= 2 && vis(lines[i + 1].text) <= 2 && (lines[i + 1].t - lines[i].t) <= 1.3) {
        const nx = lines[i + 1];
        cur.text += nx.text;
        if (nx.zh && (!cur.zh || cur.zh !== nx.zh)) cur.zh = cur.zh ? cur.zh + ' ' + nx.zh : nx.zh;
        i++;
      }
      out.push(cur);
    }
    return out;
  }

  // 这个中转站偶尔会抽风（限流 / 少 CORS 头），所以网络层失败重试两次
  async function gdJson(q, tries = 3) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      try {
        const r = await fetch(`${GD}?${q}`, { signal: ac.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) {
        lastErr = (e && e.name === 'AbortError') ? new Error('接口超时') : new Error('接口暂时不可用（可能被限流）');
        if (i < tries - 1) await new Promise((r2) => setTimeout(r2, 600 * (i + 1)));
      } finally { clearTimeout(timer); }
    }
    throw lastErr;
  }
  /** 从链接/分享文案里抠歌单 ID */
  function plIdOf(input) {
    const s = String(input || '').trim();
    const m = s.match(/[?&#]id=(\d{3,})/) || s.match(/playlist\/?[^\d]{0,8}(\d{3,})/) || s.match(/^(\d{3,})$/);
    return m ? m[1] : '';
  }
  /** 把用户粘的东西（数字 / 链接 / 短链 / 整段分享文案）解析成歌单 ID */
  async function resolvePlaylistId(input) {
    const s = String(input || '').trim();
    const direct = plIdOf(s);
    if (direct) return { id: direct };
    const url = (s.match(/https?:\/\/[^\s，,、）)]+/) || [])[0];
    if (!url) return { error: '没识别出歌单 ID' };
    // 浏览器直连短链/网易云一定会被跨域挡（还会在控制台留红字），所以直接走公共中转
    // （r.jina.ai）把重定向跟到底，再从页面内容里捞 id
    try {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 30000);
      const r = await fetch('https://r.jina.ai/' + url, { signal: ac.signal });
      clearTimeout(timer);
      const t = (await r.text()).slice(0, 200000);
      const m = t.match(/playlist\?id=(\d{5,})/) || t.match(/"playlistId"\s*:\s*"(\d{5,})"/) || t.match(/playlist\/(\d{5,})/);
      if (m) return { id: m[1], short: url };
    } catch {}
    return { error: `短链里没有歌单 ID。点开链接，把地址栏里 id= 后面的数字填进来` };
  }
  /** 导入一张歌单：逐首拉歌词+音频，失败的记原因，不阻塞其它 */
  /** 逐首导入（首次导入和「重试失败」都走这里） */
  async function importTracks(list, plName, pid, onStep) {
    const ok = [], fail = [], skip = [];
    let done = 0, quota = false;
    const report = (title, mark, kind) => { done++; if (onStep) onStep(done, list.length, title, mark, kind); };
    const one = async (tr) => {
      const nid = String(tr.id);
      const title = String(tr.name || '').trim() || ('歌曲 ' + nid);
      const artist = ((tr.ar || tr.artists || []).map((a) => a && a.name).filter(Boolean)).join(' / ');
      const album = (tr.al && tr.al.name) || '';
      const cover = (tr.al && tr.al.picUrl) || '';
      if (S.imp['i' + nid]) { skip.push({ nid, title }); report(title, '已在库里', 'skip'); return; }
      const builtin = IDX.tracks.find((t) => !t.imp && ((t.audio && String(t.audio.nid) === nid) || norm(t.title) === norm(title)));
      if (builtin) { skip.push({ nid, title }); report(title, '曲库已有', 'skip'); return; }
      let lines = [], why = '';
      try {
        // 歌词和音频地址并行取，快一点
        const [ly, u] = await Promise.all([
          gdJson(`types=lyric&source=netease&id=${nid}`),
          gdJson(`types=url&source=netease&id=${nid}&br=320`).catch(() => null),
        ]);
        lines = parseLrc(ly && ly.lyric, ly && ly.tlyric);
        if (lines.length < 3 || lines[lines.length - 1].t <= 0) {   // 纯音乐 / 没有时间轴歌词：跳过，不算失败
          skip.push({ nid, title });
          report(title, '跳过（纯音乐／没有歌词）', 'skip');
          return;
        }
        if (!u || !u.url) why = '取不到音频';
      } catch (e) {
        why = (e && e.message) || '接口不可用';
      }
      if (why) { fail.push({ nid, title, why, tr }); report(title, why, 'fail'); return; }
      S.imp['i' + nid] = { id: 'i' + nid, nid, title, artist, album, cover, lines, plId: pid, plName: plName || '', at: Date.now() };
      try { save(); } catch { delete S.imp['i' + nid]; quota = true; return; }
      ok.push({ nid, title });
      report(title, '', 'ok');
    };
    const queue = [...list];
    await Promise.all([0, 1, 2, 3].map(async () => {
      while (queue.length && !quota) { const tr = queue.shift(); await one(tr); }
    }));
    return { ok, fail, skip, quota };
  }
  async function importPlaylist(input, limit, onStep) {
    const rid = await resolvePlaylistId(input);
    if (rid.error) return { error: rid.error };
    const pid = rid.id;
    let pl = null;
    try { const j = await gdJson(`types=playlist&source=netease&id=${pid}`); pl = j && j.playlist; }
    catch { return { error: '拉取歌单失败（接口超时或暂时不可用）' }; }
    if (!pl) return { error: '歌单不存在或读不到' };
    const all = (pl.tracks || []).filter((x) => x && x.id);
    if (!all.length) return { error: '这张歌单里没有歌' };
    const list = Number(limit) > 0 ? all.slice(0, Number(limit)) : all;   // 默认整张歌单
    const res = await importTracks(list, pl.name || '', pid, onStep);
    return Object.assign(res, { plName: pl.name || '', total: all.length, done: list.length, pid });
  }
  /** 导入 + 把新歌并进内存（供 UI 与测试用） */
  async function importInto(input, limit, onStep) {
    const res = await importPlaylist(input, limit, onStep);
    if (!res.error) for (const [id, rec] of Object.entries(S.imp)) if (!TRACK.has(id)) { const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(id, t); }
    return res;
  }
  window.__tlImport = (input, limit) => importInto(input, limit);
  window.__tlSegs = (t) => segsFor(t);   // 测试用
  window.__tlVid = (w) => (VBY.get(w) || {}).id;   // 测试用：词 → 词条 id
  // ────────────── 云端持久化（预签名 URL，无后端） ──────────────
  // 进度 / 自定义释义 / 导入的歌 会整份自动同步到自己 OSS 上的一个对象里。
  // 清掉浏览器数据、换设备，打开页面自动拉回来；合并是逐条按时间戳取胜，
  // 所以两台设备各改各的也不会互相抹掉。
  const SYNC_DEBOUNCE = 1800;
  const DEV_KEY = 'thlyrics.dev.v1';
  var syncCfg = null, syncTimer = null, syncBusy = false, syncQueued = false, syncErr = '', applying = false;
  const devId = (() => { try { let d = localStorage.getItem(DEV_KEY); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem(DEV_KEY, d); } return d; } catch { return 'x'; } })();
  const n0 = (v) => (Number(v) || 0);
  const knownCount = () => (VOCAB || []).filter((v) => n0(S.known[v.id]) > 0).length;
  const hashStr = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return String(h); };

  /** 账号 API（函数计算）：带 token 的 JSON 调用 */
  async function apiCall(path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    if (ACC && ACC.token) headers.authorization = 'Bearer ' + ACC.token;
    const r = await fetch(API_BASE + path, {
      method: opts.method || 'GET', headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j || {};
  }

  /** 两份状态合并成一份：逐条按时间戳取胜，谁写过的都不丢 */
  function mergeStates(a, b) {
    const A = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, clearedAt: 0 }, a);
    const B = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, clearedAt: 0 }, b);
    const out = { clearedAt: Math.max(n0(A.clearedAt), n0(B.clearedAt)) };
    out.known = {};
    for (const k of new Set([...Object.keys(A.known), ...Object.keys(B.known)])) {
      const x = n0(A.known[k]), y = n0(B.known[k]);
      const v = Math.abs(y) > Math.abs(x) ? y : x;              // 正=标了，负=取消
      if (v && Math.abs(v) > out.clearedAt) out.known[k] = v;    // 比“清空进度”更早的一律丢掉
    }
    out.notes = {};
    for (const k of new Set([...Object.keys(A.notes), ...Object.keys(B.notes)])) {
      const x = A.notes[k] || {}, y = B.notes[k] || {};
      const v = n0(y.u) > n0(x.u) ? y : x;
      if (v && v.meaning && (n0(v.u) > out.clearedAt || !out.clearedAt)) out.notes[k] = v;
    }
    out.audio = Object.assign({}, B.audio, A.audio);             // 手册绑定的音频地址：本机优先
    out.del = Object.assign({}, B.del);
    for (const [k, v] of Object.entries(A.del)) out.del[k] = Math.max(n0(out.del[k]), n0(v));
    out.imp = {};
    for (const k of new Set([...Object.keys(A.imp), ...Object.keys(B.imp)])) {
      const x = A.imp[k] || {}, y = B.imp[k] || {};
      const v = n0(y.at) > n0(x.at) ? y : x;
      if (n0(out.del[k]) > n0(v.at)) continue;                   // 删掉的不会被拉回来
      out.imp[k] = v;
    }
    return out;
  }
  const userState = (o) => ({ known: o.known || {}, notes: o.notes || {}, audio: o.audio || {}, imp: o.imp || {}, del: o.del || {}, clearedAt: n0(o.clearedAt) });

  /** 合并后多出来的导入曲目，挂进内存里的曲库 */
  function registerImpTracks() {
    if (!TRACK || !IDX) return false;
    let added = false;
    for (const rec of Object.values(S.imp || {})) {
      if (!rec || !rec.id || TRACK.has(rec.id)) continue;
      const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(t.id, t); added = true;
    }
    if (added) { if (location.hash.startsWith('#/songs')) renderSongs(); if (location.hash.startsWith('#/mine')) renderMine(); }
    return added;
  }

  function queueSync() {
    if (applying || S.autoSync === false || !ACC || !ACC.token) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow({ auto: true }); }, SYNC_DEBOUNCE);
  }

  /** 读云端 → 逐条合并 → 有变化就写回；云端多的也会并回本机 */
  async function syncNow(opts = {}) {
    if (importing || syncBusy) { syncQueued = true; return false; }
    syncBusy = true;
    try {
      if (!ACC || !ACC.token) { syncBusy = false; return false; }   // 没登录就不动云
      const res = await apiCall('/data', { method: 'PUT', body: { data: userState(S) } });   // 一次 PUT：服务端合并后返回全量
      const mergedAcc = mergeStates(userState(S), res.data || {});
      const gained = Object.keys(mergedAcc.imp).length - Object.keys(userState(S).imp).length;
      if (JSON.stringify(mergedAcc) !== JSON.stringify(userState(S))) {
        await ensureReadings().catch(() => {});
        applying = true;
        S.known = mergedAcc.known; S.notes = mergedAcc.notes; S.audio = mergedAcc.audio;
        S.imp = mergedAcc.imp; S.del = mergedAcc.del; S.clearedAt = mergedAcc.clearedAt;
        save(); applying = false;
        registerImpTracks();
      }
      applying = true; S.syncAt = res.at || new Date().toISOString(); S.syncErr = ''; S.syncHash = ''; save(); applying = false;
      syncErr = '';
      if (opts.auto && gained > 0) toast(`已从账号取回 ${gained} 首导入的歌`);
      return true;
    } catch (e) {
      syncErr = e.message || '同步失败';
      applying = true; S.syncErr = syncErr; save(); applying = false;
      return false;
    } finally {
      syncBusy = false;
      refreshSyncMsg();
      if (syncQueued) { syncQueued = false; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow({ auto: true }), 1200); }
    }
  }

  function refreshSyncMsg() { const el = $('syncmsg'); if (el) el.textContent = syncMsgHtml(); }
  function syncMsgHtml() {
    const logged = !!(ACC && ACC.token);
    const who = logged ? '账号 ' + esc(ACC.name) : '未登录';
    if (!logged) return '未登录：登录后记录才会跟着账号走';
    if (S.autoSync === false) return '云端：自动同步已关（点「自动同步：关」可打开）· ' + who;
    if (syncBusy) return '云端：同步中… · ' + who;
    if (syncErr) return '云端：上次同步失败（' + esc(syncErr) + '），有改动会自动重试 · ' + who;
    const tail = logged
      ? '　·　换设备登录同一个账号就全回来了（清掉浏览器数据也不怕）'
      : '　·　未登录：记录只在这台浏览器和你自己的 OSS 里，登录后跟着账号走';
    if (S.syncAt) return '云端：已自动同步 ' + new Date(S.syncAt).toLocaleString('zh-CN', { hour12: false }).slice(5) + ' · ' + who + tail;
    return '云端：等着第一次同步… · ' + who;
  }

  // ────────────── 账号（注册 / 登录 / 退出 / 改密码） ──────────────
  function accHtml() {
    if (ACC && ACC.token) {
      return `<div class="accbox on"><div class="col"><div class="l1">已登录：${esc(ACC.name)}</div>
        <div class="l2">标词 / 改释义 / 导入都会存到你的账号，换设备登录同一个账号就有</div></div>
        <div class="row"><button class="toolbtn" id="acc-out">退出</button></div></div>
        <div class="row" id="acc-pwrow" style="display:none;margin-top:8px">
          <input class="sel" id="acc-old" type="password" placeholder="原密码" style="flex:1;min-width:110px;height:38px">
          <input class="sel" id="acc-new" type="password" placeholder="新密码（≥6 位）" style="flex:1;min-width:110px;height:38px">
          <button class="toolbtn" id="acc-pwdo">改密码</button>
        </div>
        <div class="row" style="margin-top:8px"><button class="toolbtn" id="acc-pw">改密码</button></div>`;
    }
    return `<div class="accbox"><div class="col"><div class="l1">登录后记录跟着账号走</div>
      <div class="l2">登录后记录跟着账号走：换手机、清掉浏览器数据，登录一下全回来。</div></div>
      <div class="row" style="margin-top:8px">
        <input class="sel" id="acc-name" placeholder="用户名" style="flex:1;min-width:100px;height:38px" autocomplete="username">
        <input class="sel" id="acc-pass" type="password" placeholder="密码（≥6 位）" style="flex:1;min-width:100px;height:38px" autocomplete="current-password">
      </div>
      <div class="row" style="margin-top:8px">
        <button class="toolbtn on" id="acc-reg">注册并登录</button>
        <button class="toolbtn" id="acc-login">登录</button>
      </div></div>`;
  }

  // ────────────── 管理员模式：看/删 OSS 上的文件 ──────────────
  let adminFiles = null, adminPrefix = 'sync/';
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + 'MB' : (n / 1024).toFixed(1) + 'KB');
  function adminHtml() {
    if (!ACC || !ACC.admin) return '';
    const total = adminFiles ? adminFiles.reduce((n, f) => n + f.size, 0) : null;
    return `<div class="accbox on" id="adminbox">
      <div class="col"><div class="l1">管理员模式</div>
      <div class="l2">你能直接看和删 OSS 上存的文件。账号数据在 sync/users/…（一个人一个目录）；音频若有会放在 audio/（按歌曲 id 命名，同一首歌只会有一份）${total != null ? `。<br>当前 ${esc(adminPrefix)}：${adminFiles.length} 个文件 · ${fmtSize(total)}` : ''}</div></div>
      <div class="row" style="margin-top:8px">
        <button class="toolbtn" id="adm-list">${adminFiles ? '刷新列表' : '查看 OSS 文件'}</button>
        <button class="toolbtn ${adminPrefix === 'sync/' ? 'on' : ''}" id="adm-sync">账号数据</button>
        <button class="toolbtn ${adminPrefix === 'audio/' ? 'on' : ''}" id="adm-audio">音频</button>
      </div>
      ${adminFiles ? (adminFiles.length ? `<div class="list" style="margin-top:8px">${adminFiles.map((f) => `<div class="item"><div class="col"><div class="l1" style="font-size:12px;word-break:break-all;font-weight:400">${esc(f.key)}</div><div class="l2">${fmtSize(f.size)} · ${esc(String(f.at || '').slice(0, 16).replace('T', ' '))}</div></div><button class="toolbtn" data-admdel="${esc(f.key)}">删除</button></div>`).join('')}</div>` : '<div class="meta" style="margin-top:8px">这个前缀下没有文件</div>') : ''}
      <div class="meta" style="margin-top:8px">⚠️ 删掉某个账号的 account.json，那个人下次登录会提示「用户名或密码不对」；删 data.json 只是清空他的记录。</div>
    </div>`;
  }
  async function loadAdminFiles(prefix) {
    if (prefix) adminPrefix = prefix;
    try {
      setLoad(true, '读取 OSS 文件…');
      const r = await apiCall('/admin/files?prefix=' + encodeURIComponent(adminPrefix));
      adminFiles = r.files || [];
      setLoad(false);
      renderMine();
    } catch (e) { setLoad(false); toast('读取失败：' + e.message); }
  }
  async function adminDelete(key) {
    if (!confirm('删除 ' + key + ' ？删了就找不回来了')) return;
    try {
      await apiCall('/admin/delete', { method: 'POST', body: { key } });
      toast('已删除 ' + key);
      await loadAdminFiles();
    } catch (e) { toast('删除失败：' + e.message); }
  }

  // ────────────── 登录闸门（没登录不让用） ──────────────
  function gateMsg(t) { const el = $('g-msg'); if (el) el.textContent = t || ''; }
  function afterLogin() {
    const g = $('gate'); if (g) g.hidden = true;
    document.body.classList.remove('gated');
    route();
    if (location.hash.startsWith('#/mine')) renderMine();
  }
  function showGate(msg) {
    const g = $('gate'); if (!g) return;
    g.hidden = false;
    document.body.classList.add('gated');
    g.innerHTML = `<div class="gatecard">
      <div class="gtitle">东方同人曲 学唱机</div>
      <div class="gsub">登录后开始：进度 / 自定义释义 / 导入的歌单都跟着账号走，换设备登录一下也在。</div>
      <input class="sel" id="g-name" placeholder="用户名（2~20 位）" autocomplete="username">
      <input class="sel" id="g-pass" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password">
      <div class="row"><button class="btn-primary" id="g-login">登录</button><button class="toolbtn" id="g-reg">注册新账号</button></div>
      <div class="gmsg" id="g-msg">${esc(msg || '')}</div>
      <div class="gsub">没有账号就点「注册新账号」，起个名字设个密码就行（只存用户名和密码哈希）。</div>
    </div>`;
    $('g-login').onclick = () => authFrom('login', 'g-name', 'g-pass', afterLogin);
    $('g-reg').onclick = () => authFrom('reg', 'g-name', 'g-pass', afterLogin);
    const onKey = (e) => { if (e.key === 'Enter') authFrom('login', 'g-name', 'g-pass', afterLogin); };
    $('g-name').onkeydown = onKey; $('g-pass').onkeydown = onKey;
  }

  async function authFrom(kind, nSel, pSel, after) {
    const name = (($(nSel) && $(nSel).value) || '').trim();
    const pass = (($(pSel) && $(pSel).value) || '');
    if (!name || !pass) { toast('用户名和密码都要填'); gateMsg('用户名和密码都要填'); return; }
    setLoad(true, kind === 'reg' ? '注册中…' : '登录中…');
    try {
      const body = { name, pass };
      if (kind === 'reg') body.data = userState(S);         // 注册时把本机已有记录一起带上去
      const res = await apiCall('/' + (kind === 'reg' ? 'register' : 'login'), { method: 'POST', body });
      ACC = { token: res.token, name: res.user.name, uid: res.user.uid, admin: !!res.user.admin };
      saveAcc();
      setLoad(false);
      toast(kind === 'reg' ? `注册好了，欢迎 ${res.user.name}` : `已登录：${res.user.name}`);
      if (after) { await syncNow({ auto: true }); after(); }   // 闸门里登录：拉一次再放行
      else { await syncNow({ auto: true }); renderMine(); }
    } catch (e) {
      setLoad(false);
      const msg = (kind === 'reg' ? '注册失败：' : '登录失败：') + e.message;
      toast(msg); gateMsg(msg);
    }
  }
  const doAuth = (kind) => authFrom(kind, 'acc-name', 'acc-pass', null);

  async function changePass() {
    const oldp = ($('acc-old') && $('acc-old').value) || '', newp = ($('acc-new') && $('acc-new').value) || '';
    if (!oldp || newp.length < 6) { toast('原密码填一下，新密码至少 6 位'); return; }
    try {
      const res = await apiCall('/password', { method: 'POST', body: { old: oldp, new: newp } });
      ACC.token = res.token; saveAcc();
      toast('密码改好了（其它设备需要重新登录）');
      renderMine();
    } catch (e) { toast('改密码失败：' + e.message); }
  }

  async function pushCloud() {
    if (importing) return;
    if (!ACC || !ACC.token) { toast('先登录才能同步'); return; }
    if (syncBusy) { toast('正在同步中，稍等一下'); return; }
    setLoad(true, '同步到云端…');
    const ok = await syncNow({ manual: true, force: true });
    setLoad(false);
    if (ok) toast(`已同步：导入的歌 ${Object.keys(S.imp || {}).length} 首 · 已掌握 ${knownCount()} 词`);
    else toast('同步失败：' + syncErr);
    renderMine();
  }
  async function pullCloud() {
    if (importing) return;
    if (!ACC || !ACC.token) { toast('先登录才能同步'); return; }
    if (syncBusy) { toast('正在同步中，稍等一下'); return; }
    const impB = Object.keys(S.imp || {}).length, kB = knownCount();
    setLoad(true, '从云端拉取…');
    const ok = await syncNow({ manual: true });
    setLoad(false);
    if (!ok) { toast('拉取失败：' + syncErr); renderMine(); return; }
    const d1 = Object.keys(S.imp || {}).length - impB, d2 = knownCount() - kB;
    toast(d1 || d2 ? `已拉回：导入的歌 +${d1} 首 · 已掌握 +${d2} 词` : '云端和本机一样');
    renderMine();
  }

  // ── 歌单定期体检：一天查一次有没有新歌；也可以手动点 ──
  const PL_CHECK_EVERY = 24 * 3600 * 1000;
  let plChecking = false;
  async function checkPlaylists(opts = {}) {
    if (plChecking) { if (!opts.silent) toast('正在检查中…'); return; }
    const pls = impPlaylists().filter((p) => /^\d+$/.test(String(p.id)));
    if (!pls.length) { if (!opts.silent) toast('还没有导入过歌单'); return; }
    plChecking = true;
    const lines = [];
    let added = 0, missingTotal = 0, bad = 0;
    const stat = $('plstat');
    if (stat && !opts.silent) stat.textContent = '检查歌单更新…';
    if ($('plchk')) $('plchk').disabled = true;
    try {
      await ensureReadings().catch(() => {});
      for (const pl of pls) {
        let data = null;
        try { data = await gdJson('?types=playlist&id=' + pl.id); } catch { bad++; lines.push(`《${pl.name}》：接口没读到，跳过`); continue; }
        const tracks = (data && data.playlist && data.playlist.tracks) || [];
        if (!tracks.length) { bad++; lines.push(`《${pl.name}》：读不到曲目，跳过`); continue; }
        const haveNid = new Set(Object.values(S.imp || {}).map((r) => String(r.nid)));
        const builtin = new Set(IDX.tracks.filter((t) => !t.imp && t.audio && t.audio.nid).map((t) => String(t.audio.nid)));
        const mine = Object.values(S.imp || {}).filter((r) => String(r.plId) === String(pl.id));
        const missing = tracks.filter((tr) => {
          const nid = String(tr.id);
          return !haveNid.has(nid) && !builtin.has(nid) && !S.del['i' + nid];
        });
        // 已经被原作者从歌单里拿掉的：只报数，不自动删（那是你的数据）
        const upNid = new Set(tracks.map((tr) => String(tr.id)));
        const gone = mine.filter((r) => !upNid.has(String(r.nid))).length;
        lines.push(`《${pl.name}》：线上 ${tracks.length} 首 · 库里 ${mine.length} 首 · 新增 ${missing.length} 首${gone ? ` · 歌单已移除 ${gone} 首（库里保留）` : ''}`);
        missingTotal += missing.length;
        if (missing.length) {
          const res = await importTracks(missing, pl.name, pl.id, null);
          added += res.ok.length;
          if (res.fail.length) lines.push(`　其中 ${res.fail.length} 首没进来（没歌词／取不到音频）`);
        }
      }
      S.plCheckAt = Date.now();
      save();
      impState.msg = lines.join('\n');
      const sum = `检查完：新增 ${added} 首${bad ? ` · ${bad} 个歌单读取失败` : ''}`;
      if (!opts.silent) toast(sum);
      else if (added) toast('歌单里有 ' + added + ' 首新歌，已经加进曲库');
    } catch (e) {
      if (!opts.silent) toast('检查失败：' + ((e && e.message) || e));
    } finally {
      plChecking = false;
      if ($('plchk')) $('plchk').disabled = false;
      if (location.hash.startsWith('#/songs')) renderSongs();
    }
  }

  /** 只重试上次失败的那几首（比如当时接口抽风） */
  async function retryFailed() {
    const ctx = impState.ctx;
    if (!ctx || !ctx.list.length || importing) return;
    importing = true;
    impState.fails = []; impState.failsRaw = [];
    const stat = $('plstat');
    if ($('plgo')) $('plgo').disabled = true;
    if ($('pllist')) $('pllist').innerHTML = '';
    if (stat) stat.textContent = `重试 ${ctx.list.length} 首…`;
    const res = await importTracks(ctx.list, ctx.plName, ctx.pid, (n, total, title, mark, kind) => {
      if (kind === 'fail') { impState.fails.push({ title, mark }); if ($('pllist')) $('pllist').innerHTML = impRowsHtml(); }
      if (stat) stat.textContent = `重试 ${n}/${total}…`;
    });
    importing = false;
    if ($('plgo')) $('plgo').disabled = false;
    for (const [id, rec] of Object.entries(S.imp)) if (!TRACK.has(id)) { const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(id, t); }
    impState.ctx = res.fail.length ? { list: res.fail.map((f) => f.tr).filter(Boolean), plName: ctx.plName, pid: ctx.pid } : null;
    const bits = [`这次补上 ${res.ok.length} 首`];
    if (res.drop || res.skip.length) bits.push(`跳过 ${res.skip.length} 首`);
    if (res.fail.length) bits.push(`还差 ${res.fail.length} 首`);
    renderSongs();
    if ($('plstat')) $('plstat').textContent = bits.join(' · ');
    if ($('pllist')) $('pllist').innerHTML = impRowsHtml();
    toast(res.ok.length ? `补上 ${res.ok.length} 首` : '还是没成功');
  }
  function impPlaylists() {
    const m = new Map();
    for (const rec of Object.values(S.imp || {})) {
      const k = rec.plId || 'unknown';
      if (!m.has(k)) m.set(k, { id: k, name: rec.plName || '未命名歌单', n: 0 });
      m.get(k).n++;
    }
    return [...m.values()];
  }
  function delImpTrack(id) {
    const rec = S.imp[id];
    if (!rec) return;
    if (!confirm(`删除《${rec.title}》？`)) return;
    delete S.imp[id]; S.del[id] = Date.now(); save();
    const i = IDX.tracks.findIndex((t) => t.id === id);
    if (i >= 0) IDX.tracks.splice(i, 1);
    TRACK.delete(id);
    if (curTrack && curTrack.id === id) { audio.pause(); audio.removeAttribute('src'); curTrack = null; }
    renderSongs();
  }
  function impRowsHtml() {
    if (!impState.fails.length) return '';
    return `<div class="implog">${impState.fails.map((x) => `<div class="improw bad">✗ <b>${esc(x.title)}</b> <span>${esc(x.mark)}</span></div>`).join('')}</div>`
      + `<div class="row" style="margin-top:8px"><button class="toolbtn" id="plretry">重试失败的 ${impState.fails.length} 首</button></div>`;
  }
  const impState = { fails: [], failsRaw: [], ctx: null, msg: '', open: false };
  async function startImport() {
    if (importing) return;
    const input = $('plinput') ? $('plinput').value : '';
    const stat = $('plstat');
    impState.fails = []; impState.msg = '';
    importing = true;
    if ($('plgo')) $('plgo').disabled = true;      // 先锁住按钮：中间还有可能要等读音表
    if ($('pllist')) $('pllist').innerHTML = '';
    if (stat) stat.textContent = '正在读取歌单…';
    await ensureReadings();
    const res = await importInto(input, 0, (n, total, title, mark, kind) => {
      if (kind === 'fail') { impState.fails.push({ title, mark }); if ($('pllist')) $('pllist').innerHTML = impRowsHtml(); }
      if (stat) stat.textContent = `正在导入 ${n}/${total}…`;
    });
    importing = false;
    if ($('plgo')) $('plgo').disabled = false;
    if (res.error) { impState.msg = res.error; if (stat) stat.textContent = res.error; return; }
    const bits = [`可用 ${res.ok.length} 首`];
    if (res.skip.length) bits.push(`跳过 ${res.skip.length} 首（纯音乐／没有歌词／曲库已有）`);
    if (res.fail.length) bits.push(`失败 ${res.fail.length} 首`);
    impState.msg = `${res.plName} · 共 ${res.total} 首 · ` + bits.join(' · ') + (res.quota ? '（本机存储满了，先导到这里）' : '');
    impState.ctx = res.fail && res.fail.length ? { list: res.fail.map((f) => f.tr).filter(Boolean), plName: res.plName, pid: res.pid } : null;
    renderSongs();
    if ($('plstat')) $('plstat').textContent = impState.msg;
    if ($('pllist')) $('pllist').innerHTML = impRowsHtml();
    if (res.ok.length) toast(`导入完成：${res.ok.length} 首`);
    else toast('没有可导入的歌');
  }

  let songQ = '', songView = 'list';
  /** 按社团/专辑分组（原生 details 折叠，不用额外状态） */
  function groupsHtml(list) {
    const key = songView === 'artist' ? 'artist' : 'album';
    const m = new Map();
    for (const t of list) {
      const k = (t[key] || (key === 'artist' ? '未知社团' : '未知专辑')).trim() || '未知';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'))
      .map(([k, arr]) => `<details class="grp"><summary>${esc(k)}<span class="meta">${arr.length} 首</span></summary>
        <div class="list">${arr.map(trackRow).join('')}</div></details>`).join('');
  }
  function renderSongs() {
    const nq = norm(songQ.trim());
    const list = IDX.tracks.filter((t) => {
      if (filter === 'audio' && !(t.audioOss || t.audio || S.audio[t.id] || S.local[t.id])) return false;
      if (filter === 'imp' && !t.imp) return false;
      if (filter === 'zh' && !t.lines.some((l) => l.zh)) return false;
      if (filter === 'known') {
        const k = (t.vocabIds || []).filter((i) => Number(S.known[i]) > 0).length;
        if (t.vocabIds && t.vocabIds.length && k / t.vocabIds.length > .8) return false;
      }
      if (nq && !norm(`${t.title} ${t.artist} ${t.album} ${t.plName || ''}`).includes(nq)) return false;
      return true;
    });
    $('view-songs').innerHTML = `
      <div class="sec-head">
        <div><div class="sec-title">曲库</div><div class="sec-sub">${IDX.tracks.length} 首 · 显示 ${list.length} 首</div></div>
        <div class="segtext">
          <button class="${songView === 'list' ? 'on' : ''}" data-v="list">列表</button>
          <button class="${songView === 'artist' ? 'on' : ''}" data-v="artist">社团</button>
          <button class="${songView === 'album' ? 'on' : ''}" data-v="album">专辑</button>
        </div>
      </div>
      <div class="row" style="margin:2px 0 0">
        <input id="qs" class="sel" style="flex:1;min-width:150px;height:34px" placeholder="搜曲名 / 社团 / 专辑" value="${esc(songQ)}">
      </div>
      <div class="chips">
        <button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">全部</button>
        <button class="chip ${filter === 'audio' ? 'on' : ''}" data-f="audio">有音频</button>
        <button class="chip ${filter === 'zh' ? 'on' : ''}" data-f="zh">有中文</button>
        <button class="chip ${filter === 'imp' ? 'on' : ''}" data-f="imp">我导入的</button>
        <button class="chip ${filter === 'known' ? 'on' : ''}" data-f="known">跳过已掌握</button>
      </div>
      <details class="impbox" ${impState.fails.length || impState.msg || impState.open ? 'open' : ''}>
        <summary>导入网易云歌单</summary>
        <div class="row" style="margin-top:10px">
          <input id="plinput" class="sel" style="flex:1;min-width:180px;height:36px" placeholder="歌单链接 / 数字 ID / 分享文案">
          <button class="toolbtn on" id="plgo">${importing ? '导入中…' : '导入'}</button>
        </div>
        <div class="meta" id="plstat" style="margin-top:8px">${esc(impState.msg || '粘歌单链接或数字 ID')}</div>
        <div id="pllist">${impRowsHtml()}</div>
        ${impPlaylists().length ? `<div class="meta" style="margin-top:10px">已导入：${impPlaylists().map((p) => `${esc(p.name)}（${p.n} 首）`).join('、')}</div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="toolbtn" id="plchk" ${plChecking ? 'disabled' : ''}>检查歌单更新${plChecking ? '（进行中）' : ''}</button>
          <span class="meta" style="align-self:center">上次检查：${S.plCheckAt ? new Date(S.plCheckAt).toLocaleString('zh-CN', { hour12: false }).slice(5) : '还没检查过'}（每 24 小时自动查一次）</span>
        </div>
      </details>
      ${songView === 'list'
        ? `<div class="list" id="list">${list.map(trackRow).join('') || emptyBox(songQ ? `没有匹配「${songQ}」的曲目` : '这个筛选下没有曲目', '换个关键词，或者把筛选清掉；也可以把自己的网易云歌单导进来。', [['e-pick', '清空搜索与筛选'], ['e-imp', '导入歌单']])}</div>`
        : (groupsHtml(list) || emptyBox('这个筛选下没有曲目', '把筛选清掉试试。', [['e-pick', '清空搜索与筛选']]))}`;
    impState.open = false;
    $('view-songs').querySelectorAll('.chip[data-f]').forEach((el) => (el.onclick = () => { filter = el.dataset.f; renderSongs(); }));
    $('view-songs').querySelectorAll('.segtext button').forEach((el) => (el.onclick = () => { songView = el.dataset.v; renderSongs(); }));
    if ($('qs')) $('qs').oninput = (e) => {
      songQ = e.target.value;
      const pos = e.target.selectionStart;
      renderSongs();
      const n = $('qs');
      if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} }
    };
    $('view-songs').querySelectorAll('.track').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('[data-del]')) return;
      go('#/track/' + el.dataset.id);
    }));
    $('view-songs').querySelectorAll('[data-del]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); delImpTrack(el.dataset.del); }));
    if ($('plgo')) $('plgo').onclick = () => startImport();
    if ($('plchk')) $('plchk').onclick = () => checkPlaylists({ manual: true });
    if ($('e-pick')) $('e-pick').onclick = () => { songQ = ''; filter = 'all'; renderSongs(); };
    if ($('e-imp')) $('e-imp').onclick = () => { impState.open = true; renderSongs(); };
    if ($('plretry')) $('plretry').onclick = () => retryFailed();
    if ($('plinput')) $('plinput').onkeydown = (e) => { if (e.key === 'Enter') startImport(); };
    if (importing) setTimeout(() => { if (!importing) renderSongs(); }, 800);
  }

  function renderMine() {
    const knownList = VOCAB.filter(isKnown);
    const noted = VOCAB.filter((v) => S.notes[v.id] && S.notes[v.id].meaning);
    $('view-mine').innerHTML = `
      <div class="sec-head"><div><div class="sec-title">生词本</div><div class="sec-sub">已掌握 ${knownList.length} 词 · 改过释义 ${noted.length} 词 · 导入的歌 ${Object.keys(S.imp || {}).length} 首</div></div></div>
      ${accHtml()}
      <div class="meta" id="syncmsg" style="color:var(--ink2);margin-top:10px">${syncMsgHtml()}</div>
      ${adminHtml()}
      <div class="chips">${knownList.length ? knownList.slice(0, 200).map((v) => `<span class="chip" data-w="${v.id}">${esc(v.word)}</span>`).join('') : ''}</div>
      ${knownList.length ? '' : emptyBox('还没有标过词', '去学词页，每张词卡右上角的 ✓ 就是"已掌握"；在跟唱页点词也能标。', [['e-mlearn', '去学词'], ['e-mreview', '随便练几个']])}
      <div class="hair"></div>
      ${noted.length ? noted.map((v) => `<div class="item" data-w="${v.id}"><div class="col"><div class="l1">${esc(v.word)}</div><div class="l2">${esc(S.notes[v.id].meaning)}</div></div></div>`).join('') : '<div class="meta">还没有改过释义。点词卡或跟唱页里的词，就能改。</div>'}
      <div class="row" style="margin-top:18px">
        <button class="toolbtn" id="m-export">导出到文件</button>
        <button class="toolbtn" id="m-import">从文件导入</button>
        <button class="toolbtn" id="m-push">立即同步</button>
        <button class="toolbtn" id="m-pull">从云端拉回</button>
        <button class="toolbtn ${S.autoSync !== false ? 'on' : ''}" id="m-auto">自动同步：${S.autoSync !== false ? '开' : '关'}</button>
        <button class="toolbtn" id="m-review">开始复习</button>
        <button class="toolbtn" id="m-clear">清空进度</button>
      </div>
      <div class="meta" style="margin-top:10px;color:var(--ink2)">云端存的是你自己的记录（进度 / 自定义释义 / 导入的歌单），放在你自己的 OSS 里，不经过第三方。本机绑定的音频文件（大）不同步。</div>`;
    $('view-mine').querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => go('#/word/' + el.dataset.w)));
    const accReg = $('acc-reg'), accLogin = $('acc-login'), accOut = $('acc-out');
    if (accReg) accReg.onclick = () => doAuth('reg');
    if (accLogin) accLogin.onclick = () => doAuth('login');
    if (accOut) accOut.onclick = () => { ACC = null; saveAcc(); toast('已退出登录（本机记录还在，再登回来即可）'); showGate('已退出登录。本机记录还在，登录即可继续。'); };
    if ($('e-mlearn')) $('e-mlearn').onclick = () => go('#/learn');
    if ($('e-mreview')) $('e-mreview').onclick = () => go('#/review');
    if ($('adm-list')) $('adm-list').onclick = () => loadAdminFiles();
    if ($('adm-sync')) $('adm-sync').onclick = () => loadAdminFiles('sync/');
    if ($('adm-audio')) $('adm-audio').onclick = () => loadAdminFiles('audio/');
    $('view-mine').querySelectorAll('[data-admdel]').forEach((el) => (el.onclick = () => adminDelete(el.dataset.admdel)));
    const accPw = $('acc-pw'), accPwDo = $('acc-pwdo');
    if (accPw) accPw.onclick = () => { const r = $('acc-pwrow'); r.style.display = r.style.display === 'none' ? 'flex' : 'none'; };
    if (accPwDo) accPwDo.onclick = () => changePass();
    $('m-push').onclick = () => pushCloud();
    $('m-pull').onclick = () => pullCloud();
    $('m-auto').onclick = () => {
      S.autoSync = S.autoSync === false;
      applying = true; save(); applying = false;
      renderMine();
      if (S.autoSync === false) toast('自动同步已关（改动只留在本机，可随时手动同步）');
      else { toast('自动同步已开'); syncNow({ auto: true }); }
    };
    $('m-export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
      a.download = 'thlyrics-progress.json'; document.body.appendChild(a); a.click(); a.remove();
    };
    $('m-import').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { try { S = Object.assign({ known: {}, notes: {}, audio: {}, local: {}, imp: {}, rate: 1 }, JSON.parse(String(fr.result))); save(); location.reload(); } catch { alert('读不了这个文件'); } }; fr.readAsText(f); };
      inp.click();
    };
    if ($('m-review')) $('m-review').onclick = () => { startReview(20); go('#/review'); };
    $('m-clear').onclick = () => { if (!confirm('清空进度？云端也会一起清（导入的歌保留）')) return; S.known = {}; S.notes = {}; S.clearedAt = Date.now(); save(); renderMine(); };
  }

  // ────────────── 词条详情 ──────────────
  function showWord(id) {
    const v = VBYID.get(Number(id));
    if (!v) { go('#/learn'); return; }
    const order = deckList();
    const at = order.findIndex((x) => x.id === v.id);
    const prev = at > 0 ? order[at - 1] : null, next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
    const forms = Object.entries(v.forms || {}).filter(([f]) => f !== v.word).slice(0, 8);
    // 当前正在听的这首（一般是导入的歌）里如果也有这个词，把那一句排到最前面 ——
    // 内置曲库里只有 10 来首有音频，光看内置例句的话「去这句」经常点过去没声音
    const localEx = (() => {
      if (!curTrack) return null;
      const i = curTrack.lines.findIndex((l) => (l.segs || []).some((sg) => sg.w && sg.b === v.word));
      if (i < 0) return null;
      const l = curTrack.lines[i];
      return { jp: l.text, zh: l.zh || '', track: curTrack.title, tid: curTrack.id, li: i, now: true };
    })();
    const exs = [localEx, ...(v.examples || [])].filter(Boolean).slice(0, 6);
    $('view-word').innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <button class="toolbtn" id="w-back">← 返回</button>
        ${prev ? `<button class="toolbtn" data-go-word="${prev.id}">← ${esc(prev.word)}</button>` : ''}
        ${next ? `<button class="toolbtn" data-go-word="${next.id}">${esc(next.word)} →</button>` : ''}
      </div>
      <div class="sec-title" style="font-size:30px">${esc(v.word)}</div>
      <div class="sec-sub" style="font-size:13px;color:var(--ink2)">${esc(v.reading)} · ${esc(v.romaji)} · ${POSNAME[posKind(v)]} · ${esc(levelName(v))}${v.brZh ? ' · 教材释义：' + esc(v.brZh) : ''}</div>
      <div class="bar" style="margin:14px 0 0"><i style="width:${level(v) * 20}%"></i></div>
      <div style="font-size:17px;margin-top:14px;color:#ffe9df" id="w-mean">${esc(meaningOf(v) || '（还没有释义）')}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn-primary" id="w-play">🔊 读这个词</button>
        <button class="toolbtn ${isKnown(v) ? 'on' : ''}" id="w-known">${isKnown(v) ? '已掌握' : '标为已掌握'}</button>
        <button class="toolbtn" id="w-edit">改释义</button>
      </div>
      <div class="row" id="w-editrow" style="display:none;margin-top:10px">
        <input class="sel" id="w-editinput" style="flex:1;min-width:160px;height:38px" value="${esc(meaningOf(v))}" placeholder="释义（回车保存）">
        <button class="toolbtn" id="w-save">保存</button>
      </div>
      ${forms.length ? `<div class="hair"></div><div class="sec-sub" style="margin-bottom:6px">词形</div><div class="chips">${forms.map(([f, o]) => `<span class="chip">${esc(f)}${o.readingHira ? '（' + esc(o.readingHira) + '）' : ''}</span>`).join('')}</div>` : ''}
      <div class="hair"></div>
      <div class="sec-sub" style="margin-bottom:6px">它出现在这些句子里</div>
      <div class="list">${exs.length ? exs.map((ex) => `<div class="item" style="align-items:flex-start">
        <div class="col"><div class="l1" style="font-weight:400;font-size:14.5px;white-space:normal">${esc(ex.jp)}</div>
        ${ex.zh ? `<div class="l2" style="color:var(--p-a);white-space:normal">${esc(ex.zh)}</div>` : ''}
        <div class="l3">${ex.now ? '正在听：' : ''}${esc(ex.track || '')}${(() => { const t = TRACK.get(ex.tid); return (t && (t.audioOss || t.audio || S.audio[t.id] || S.local[t.id])) ? '' : ' · 无音频'; })()}</div></div>
        ${ex.tid ? `<button class="toolbtn" data-goto="${ex.tid}@${ex.li}">去这句</button>` : ''}</div>`).join('') : '<div class="meta">词表里没给这个词配例句</div>'}</div>`;
    $('w-back').onclick = () => history.length > 1 ? history.back() : go('#/learn');
    $('view-word').querySelectorAll('[data-go-word]').forEach((el) => (el.onclick = () => go('#/word/' + el.dataset.goWord)));
    $('w-play').onclick = () => speak(v.word);
    $('w-known').onclick = () => { toggleKnown(v); showWord(v.id); };
    $('w-edit').onclick = () => { const r = $('w-editrow'); r.style.display = r.style.display === 'none' ? 'flex' : 'none'; $('w-editinput').focus(); };
    const saveMean = () => { S.notes[v.id] = Object.assign({}, S.notes[v.id], { meaning: $('w-editinput').value.trim(), u: Date.now() }); save(); showWord(v.id); };
    $('w-save').onclick = saveMean;
    $('w-editinput').onkeydown = (e) => { if (e.key === 'Enter') saveMean(); };
    $('view-word').querySelectorAll('[data-goto]').forEach((el) => (el.onclick = () => {
      const [tid, li] = el.dataset.goto.split('@');
      go('#/track/' + tid + '@' + li);
    }));
  }

  // ────────────── 检索 ──────────────
  function searchAll(q) {
    const nq = norm(q);
    const words = VOCAB.map((v) => {
      const forms = Object.keys(v.forms || {});
      let sc = 99;
      if (v.word === q) sc = 0; else if (v.reading === q) sc = 1; else if (forms.includes(q)) sc = 2;
      else if (norm(v.word).startsWith(nq)) sc = 3;
      else if (meaningOf(v).startsWith(q)) sc = 4;
      else if (norm(v.word + ' ' + v.reading + ' ' + v.romaji + ' ' + meaningOf(v) + ' ' + forms.join(' ')).includes(nq)) sc = 5;
      return sc < 99 ? { v, sc } : null;
    }).filter(Boolean).sort((a, b) => a.sc - b.sc || a.v.diff - b.v.diff).slice(0, 40).map((x) => x.v);
    const tracks = IDX.tracks.filter((t) => norm(t.title + ' ' + t.artist + ' ' + t.album + ' ' + t.base).includes(nq));
    const originals = IDX.originals.filter((o) => norm(o.name).includes(nq)).slice(0, 12);
    return { words, tracks, originals };
  }
  function showSearch(q) {
    if (!q.trim()) { go(lastNonSearch); return; }
    const r = searchAll(q.trim());
    $('view-search').innerHTML = `
      <div class="sec-head"><div><div class="sec-title">搜索「${esc(q)}」</div><div class="sec-sub">词 ${r.words.length} · 曲目 ${r.tracks.length} · 原曲 ${r.originals.length}</div></div></div>
      ${r.words.length ? `<div class="hair"></div><div class="list">${r.words.map(wordRow).join('')}</div>` : ''}
      ${r.tracks.length ? `<div class="hair"></div><div class="sec-sub" style="margin-bottom:4px">曲目</div><div class="list">${r.tracks.map(trackRow).join('')}</div>` : ''}
      ${r.originals.length ? `<div class="hair"></div><div class="sec-sub" style="margin-bottom:6px">原曲</div><div class="chips">${r.originals.map((o) => `<span class="chip" data-base="${esc(o.name)}">${esc(o.name)} · ${o.tracks.length}</span>`).join('')}</div>` : ''}
      ${!r.words.length && !r.tracks.length && !r.originals.length ? (() => {
        const hot = [...new Set(IDX.tracks.map((t) => t.artist).filter(Boolean))].slice(0, 6);
        return emptyBox(`没找到「${q.trim()}」`, '可以试试：社团名、原曲名、假名写法、或者中文释义。搜「东方」「幽閉」这类词也行。', [['e-sc', '清空搜索'], ['e-ssongs', '去曲库翻']]) +
          `<div class="sec-sub" style="margin-top:18px">试试这些社团</div><div class="chips">${hot.map((a) => `<span class="chip" data-artist="${esc(a)}">${esc(a)}</span>`).join('')}</div>`;
      })() : ''}`;
    wireWords($('view-search'));
    $('view-search').querySelectorAll('.track').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('[data-del]')) return;
      go('#/track/' + el.dataset.id);
    }));
    $('view-search').querySelectorAll('[data-del]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); delImpTrack(el.dataset.del); if (!IDX.tracks.some((t) => t.id === el.dataset.del)) showSearch(q); }));
    $('view-search').querySelectorAll('[data-base]').forEach((el) => (el.onclick = () => { $('q').value = el.dataset.base; go('#/search/' + encodeURIComponent(el.dataset.base)); }));
    $('view-search').querySelectorAll('[data-artist]').forEach((el) => (el.onclick = () => { $('q').value = el.dataset.artist; go('#/search/' + encodeURIComponent(el.dataset.artist)); }));
    if ($('e-sc')) $('e-sc').onclick = () => { $('q').value = ''; go('#/home'); };
    if ($('e-ssongs')) $('e-ssongs').onclick = () => go('#/songs');
  }

  // ────────────── 单曲页 ──────────────
  function trackWords(t) {
    const cnt = new Map();
    for (const l of t.lines) for (const sg of l.segs || []) if (sg.w && sg.b) cnt.set(sg.b, (cnt.get(sg.b) || 0) + 1);
    return [...cnt.entries()].map(([w, n]) => ({ v: VBY.get(w), n })).filter((x) => x.v)
      .sort((a, b) => (a.v.br ? a.v.br.c : 999) - (b.v.br ? b.v.br.c : 999) || a.v.diff - b.v.diff);
  }
  function renderTrackWords() {
    const host = $('twlist');
    if (!host || !curTrack) return;
    const all = trackWords(curTrack);
    let list = all;
    if (twFilter === 'br') list = all.filter((x) => x.v.br);
    else if (twFilter === 'out') list = all.filter((x) => !x.v.br);
    else if (twFilter !== 'all') list = all.filter((x) => x.v.pos === twFilter);
    $('twhead').textContent = `本曲词汇 ${list.length} 个`;
    const firstLine = (v) => curTrack.lines.findIndex((l) => (l.segs || []).some((sg) => sg.w && sg.b === v.word));
    host.innerHTML = list.length ? list.map(({ v, n }) => {
      const li = firstLine(v);
      return `<div class="item word" data-id="${v.id}">
        <div class="col">
          <div class="l1">${esc(v.word)}<span class="rd">${esc(v.reading)}</span></div>
          <div class="l2">${esc(meaningOf(v) || '（还没释义）')}</div>
          <div class="l3">${POSNAME[posKind(v)]} · ${esc(levelName(v))} · 本曲 ${n} 次</div>
        </div>
        ${dotsHtml(v)}
        ${li >= 0 ? `<button class="tick" data-line="${li}" title="跳到这句">↦</button>` : ''}
      </div>`;
    }).join('') : '<div class="empty">这个筛选下没有词</div>';
    host.querySelectorAll('[data-line]').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation();
      const i = Number(el.dataset.line);
      setLoop(i);
      $('player').classList.add('on');
    }));
    host.querySelectorAll('.word').forEach((el) => (el.onclick = (e) => { if (!e.target.closest('[data-line]')) go('#/word/' + el.dataset.id); }));
  }
  function renderLyrics(host, t) {
    if (!t || !t.lines || !t.lines.length) {
      host.innerHTML = emptyBox('这首歌还没有歌词', '换一首，或者去曲库粘一个带时间轴歌词的网易云歌单。', [['e-noly', '去曲库']]);
      const b = host.querySelector('#e-noly');
      if (b) b.onclick = () => { $('player').classList.remove('on'); go('#/songs'); };
      return;
    }
    host.innerHTML = '';
    t.lines.forEach((l, i) => {
      if (!l.text.trim()) { const sp = document.createElement('div'); sp.className = 'space'; host.appendChild(sp); return; }
      const block = document.createElement('div');
      block.className = 'lblock';
      const line = document.createElement('div');
      line.className = 'line' + (l.jp ? '' : ' en');
      const ruby = S.ruby !== false;
      let flat = [];
      if (l.segs && l.segs.length) {
        for (const sg of l.segs) {
          if (!sg.s) continue;
          if (!sg.k) {
            // 标点/英文这类纯文本也要占住「罗马音那一行」，否则它们会浮在词的上面
            const sp = document.createElement('span');
            sp.className = 'w k-plain';
            sp.dataset.plain = '1';
            sp.dataset.s = sg.s;
            if (ruby) { const ri = document.createElement('i'); ri.className = 'r'; sp.appendChild(ri); }
            sp.appendChild(document.createTextNode(sg.s));
            line.appendChild(sp);
            if (sg.s.trim()) flat.push(sg.s);
            continue;
          }
          const sym = sg.k === 'sym';
          const w = sym ? null : ((sg.w && VBY.get(sg.b)) || SURF.get(sg.s) || null);
          const span = document.createElement('span');
          span.className = 'w k-' + sg.k + (w && isKnown(w) ? ' known' : '');
          const y = sg.y || '';
          span.dataset.s = sg.s;
          if (sg.r) span.dataset.r = sg.r;
          if (y) span.dataset.y = y;
          if (sym) span.dataset.plain = '1';
          if (sg.w && sg.b) span.dataset.w = sg.b;
          // 罗马音那一行必须每块都占位（没有读音也留空行），否则同一句里
          // 有读音的词会被顶下去、没读音的浮在上面 —— 看起来就是「歌词一上一下」
          if (ruby) { const ri = document.createElement('i'); ri.className = 'r'; ri.textContent = y; span.appendChild(ri); }
          span.appendChild(document.createTextNode(sg.s));
          const g = meaningOf(w);
          if (g && g.length <= 14) { const gi = document.createElement('i'); gi.className = 'g'; gi.textContent = g; span.appendChild(gi); }
          line.appendChild(span);
          flat.push(y || sg.s);
        }
      } else { line.textContent = l.text; flat = [l.romaji || l.text]; }
      block.appendChild(line);
      // 关掉逐词罗马音时，退回整行罗马音（按词断开，不再糊成一串）
      if (!ruby && S.romaji !== false && l.jp) {
        const txt = flat.join(' ').replace(/\s+/g, ' ').trim();
        if (txt) { const r = document.createElement('div'); r.className = 'romaji'; r.textContent = txt; block.appendChild(r); }
      }
      if (l.zh && S.zh !== false) { const z = document.createElement('div'); z.className = 'zh'; z.textContent = l.zh; block.appendChild(z); }
      block.dataset.i = String(i);
      host.appendChild(block);
    });
  }
  let pressTimer = null, lastTap = 0, lastTapIdx = -1;
  function bindLyrics(host) {
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.addEventListener('click', (e) => {
      const wEl = e.target.closest('.w');
      if (wEl && !wEl.dataset.plain) {
        const w = (wEl.dataset.w && VBY.get(wEl.dataset.w)) || SURF.get(wEl.dataset.s) || null;
        showPop(w, wEl.dataset.s, { r: wEl.dataset.r || '', y: wEl.dataset.y || '' });
        return;
      }
      const b = e.target.closest('.lblock[data-i]');
      if (!b) return;
      const i = Number(b.dataset.i);
      const now = Date.now();
      if (now - lastTap < 360 && lastTapIdx === i) { lastTap = 0; setLoop(i); toast('单句循环'); return; }   // 双击 → 切到单句循环
      lastTap = now; lastTapIdx = i;
      playFrom(i);
    });
    host.addEventListener('dblclick', (e) => {           // 桌面端双击
      const b = e.target.closest('.lblock[data-i]');
      if (b && !e.target.closest('.w')) setLoop(Number(b.dataset.i));
    });
    host.addEventListener('contextmenu', (e) => { const b = e.target.closest('.lblock[data-i]'); if (b) { e.preventDefault(); setLoop(Number(b.dataset.i)); } });
    host.addEventListener('touchstart', (e) => {
      const b = e.target.closest('.lblock[data-i]');
      if (!b || e.target.closest('.w')) return;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => setLoop(Number(b.dataset.i)), 520);      // 长按 = 单句循环
    }, { passive: true });
    host.addEventListener('touchend', () => clearTimeout(pressTimer));
    host.addEventListener('touchmove', () => clearTimeout(pressTimer));
  }
  function showTrack(id, atIdx) {
    const t = TRACK.get(id);
    if (!t) { go('#/learn'); return; }
    curTrack = t; curLines = t.lines; loopLine = null;
    S.lastTrack = t.id; save();
    audio.pause();
    const zhN = t.lines.filter((l) => l.zh).length;
    const knownN = (t.vocabIds || []).filter((i) => Number(S.known[i]) > 0).length;
    $('view-track').innerHTML = `
      <div class="row" style="margin-bottom:12px"><button class="toolbtn" id="b-back">← 返回</button></div>
      <div class="item" style="border:0;padding:0 0 12px;cursor:default">
        ${t.coverFile ? `<img class="cover big" src="data/${t.coverFile}" alt="">`
          : (t.coverUrl ? `<img class="cover big" src="${esc(t.coverUrl)}" alt="">` : '<div class="cover big"></div>')}
        <div class="col">
          <div class="l1" style="font-size:17px">${esc(t.title)}</div>
          <div class="l2">${esc(t.artist)} · ${esc(t.album)}</div>
          <div class="l3">${t.imp ? `来自歌单：${esc(t.plName || '导入')}` : `原曲：${esc(t.base)}`} · ${t.lineCount} 行${zhN ? ` · 中文 ${zhN}` : ''}</div>
        </div>
      </div>
      <div class="row" style="margin:2px 0 10px">
        <button class="btn-primary" id="t-sing">▶ 进入跟唱</button>
      </div>
      <div id="t-vocab-pane">
        <div class="chips" id="twchips">
          <button class="chip on" data-f="all">全部</button><button class="chip" data-f="br">标日收录</button>
          <button class="chip" data-f="out">标日未收录</button><button class="chip" data-f="名詞">名词</button>
          <button class="chip" data-f="動詞">动词</button><button class="chip" data-f="形容詞">形容词</button><button class="chip" data-f="副詞">副词</button>
        </div>
        <div class="sec-sub" id="twhead" style="margin:6px 0 2px"></div>
        <div class="list" id="twlist"></div>
      </div>`;
    twFilter = 'all';
    $('t-sing').onclick = () => { openPlayer(); if (!audio.src || audio.getAttribute('data-tid') !== t.id) playTrack(t); };
    renderTrackWords();
    $('twchips').querySelectorAll('.chip').forEach((el) => (el.onclick = () => { twFilter = el.dataset.f; $('twchips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === el)); renderTrackWords(); }));
    $('b-back').onclick = () => history.length > 1 ? history.back() : go('#/songs');
    $('p-title').textContent = t.title; $('p-artist').textContent = t.artist + ' · ' + t.album;
    if (t.coverFile) $('mb-cover').src = 'data/' + t.coverFile; else $('mb-cover').removeAttribute('src');
    setNow(t.title + ' — ' + t.artist);
    $('minibar').classList.add('on');
    $('srcinfo').textContent = describeSource(t);
    $('nidinput').value = (S.audio[t.id] && S.audio[t.id].nid) || (t.audio && t.audio.nid) || '';
    if ($('p-nosrc')) $('p-nosrc').hidden = !!(t.audioOss || t.audio || S.audio[t.id] || S.local[t.id]);
    activeLine = -1; loopLine = null;
    $('m-all').classList.toggle('on', mode === 'all');
    $('m-loop').classList.toggle('on', mode === 'loop');
    if (!raf) raf = requestAnimationFrame(frame);
    prepAudio(t);
    if (atIdx != null && Number.isFinite(atIdx)) { $('player').classList.add('on'); renderLyrics($('plyric'), t); bindLyrics($('plyric')); playTrack(t).then(() => setLoop(atIdx)); }
    else {
      const p0 = (S.pos || {})[t.id];
      if (p0 > 5) { jump(p0); toast(`接着上次听：${fmt(p0)}`); }
    }
  }
  function describeSource(t) {
    if (S.local[t.id]) return '音频：本地文件';
    if (t.audioOss) return `音频：阿里云 OSS`;
    const s = S.audio[t.id] || t.audio;
    if (s && s.nid) return `音频：网易云${t.netease && t.netease.agreeRate != null ? ` · 歌词一致 ${Math.round(t.netease.agreeRate * 100)}%` : ''}`;
    return '没有音频';
  }
  function applyDisplay() {
    document.body.classList.toggle('gloss', S.gloss !== false);
    document.body.classList.toggle('ruby', S.ruby !== false);
    // 三个开关现在收在「显示」抽屉里：状态用文字写明（开/关），不要让人猜
    const set = (id, on) => { const el = $(id); if (!el) return; el.classList.toggle('on', !!on); el.textContent = on ? '开' : '关'; };
    set('b-gloss', S.gloss !== false);
    set('b-zh', S.zh !== false);
    set('b-ruby', S.ruby !== false);
  }
  function openPlayer() {
    if (!curTrack) return;
    renderLyrics($('plyric'), curTrack); bindLyrics($('plyric'));
    applyDisplay();
    $('player').classList.add('on');
    requestAnimationFrame(() => highlight(true));
  }

  // ────────────── 词条弹层 ──────────────
  let popWord = null, popFallback = null;
  function showPop(w, fallback, seg) {
    popFallback = fallback || null;
    const on = (id) => { const el = $(id); if (el) el.style.display = ''; };
    if (!w) {
      const rd = (seg && seg.r) ? norm(seg.r) : '';
      $('p-word').textContent = fallback || '';
      $('p-reading').textContent = rd ? '（' + rd + '）' : '';
      $('p-romaji').textContent = (seg && seg.y) || '';
      $('p-meaning').textContent = rd ? '词表里没有这个词（读音在上面）' : '词表里没有这个词，也没查到读音';
      $('p-ex').textContent = ''; $('p-meta').textContent = '';
      $('p-known').style.display = 'none'; $('p-goto').style.display = 'none';
      $('p-detail').style.display = 'none'; $('p-lines').style.display = 'none'; $('p-edit').style.display = 'none';
      if ($('p-morebox')) $('p-morebox').hidden = true;
      $('pop').classList.add('on'); return;
    }
    popWord = w;
    ['p-known', 'p-goto', 'p-detail', 'p-lines', 'p-edit'].forEach(on);
    if ($('p-morebox')) $('p-morebox').hidden = true;
    const exG = (w.examples || [])[0];
    if ($('p-goto')) $('p-goto').style.display = exG && exG.tid ? '' : 'none';
    $('p-word').textContent = w.word;
    $('p-reading').textContent = w.reading ? '（' + w.reading + '）' : '';
    $('p-romaji').textContent = w.romaji || '';
    $('p-meaning').textContent = meaningOf(w) || '没有释义';
    const ex = (w.examples || [])[0];
    $('p-ex').textContent = ex ? `例句（${ex.track}）：${ex.jp}${ex.zh ? ' → ' + ex.zh : ''}` : '';
    $('p-meta').textContent = [POSNAME[posKind(w)], levelName(w), `全库 ${w.tracks.length} 首 / ${w.count} 次`].join(' · ');
    $('p-known').textContent = isKnown(w) ? '取消已掌握' : '标为已掌握';
    $('p-editrow').style.display = 'none';
    $('pop').classList.add('on');
  }
  const hidePop = () => $('pop').classList.remove('on');

  // ────────────── 路由 ──────────────
  const VIEWS = ['view-home', 'view-learn', 'view-songs', 'view-mine', 'view-word', 'view-track', 'view-search', 'view-review'];
  function show(which) {
    // 首页已经自带次级入口了，全局 tab 行在首页收起来（别让两排入口抢注意力）
    if ($('tabs')) $('tabs').hidden = (which === 'view-home');
    // 音频配置不再挂在每个页面底部：只在生词本（设置）和单曲页出现
    const slot = $('srcslot');
    if (slot) slot.hidden = !(which === 'view-mine' || which === 'view-track');   // ⚠️ 别挪进 view：render* 会用 innerHTML 把它冲掉
    VIEWS.forEach((v) => { const el = $(v); if (el) el.hidden = v !== which; });
    const map = { 'view-learn': 'tab-learn', 'view-songs': 'tab-songs', 'view-mine': 'tab-mine' };
    ['tab-learn', 'tab-songs', 'tab-mine'].forEach((t) => $(t).classList.toggle('on', map[which] === t));
    window.scrollTo(0, 0);
  }
  const go = (h) => { location.hash = h; };
  function route() {
    const raw = decodeURIComponent(String(location.hash || '').replace(/^#\/?/, ''));
    const [path, at] = raw.split('@');
    const parts = path.split('/');
    const v = parts[0] || 'home';
    if (v !== 'search') lastNonSearch = '#/' + path;
    if (v === 'word') { show('view-word'); return showWord(parts[1]); }
    if (v === 'track') { show('view-track'); return showTrack(parts[1], at != null && at !== '' ? Number(at) : null); }
    if (v === 'search') { show('view-search'); $('searchwrap').classList.add('on'); $('q').value = parts.slice(1).join('/'); return showSearch(parts.slice(1).join('/')); }
    if (v === 'home') { show('view-home'); return renderHome(); }
    if (v === 'review') { show('view-review'); return renderReview(); }
    if (v === 'songs') { show('view-songs'); return renderSongs(); }
    if (v === 'mine') { show('view-mine'); return renderMine(); }
    show('view-learn'); renderLearn();
  }

  // ────────────── 启动 ──────────────
  async function boot() {
    loadAcc();
    loadLS();
    document.body.classList.toggle('gloss', S.gloss !== false);
    document.body.classList.toggle('ruby', S.ruby !== false);
    let data;
    try { data = await (await fetch('data/index.json')).json(); }
    catch {
      $('view-learn').innerHTML = emptyBox('曲库数据没加载出来', '可能是网络问题，也可能是本地没起服务（node scripts/serve.mjs 8848）。点下面重试一次。', [['e-retry', '重试']]);
      show('view-learn');
      if ($('tabs')) $('tabs').hidden = false;
      if ($('e-retry')) $('e-retry').onclick = () => location.reload();
      return;
    }
    IDX = data; VOCAB = data.vocab;
    // 读音兜底表只在有导入曲目时才拉（没有导入的用不上），而且要等它就绪，
    // 否则导入的歌会用不完整的表分词 → 一堆本该有读音的汉字词没罗马音
    if (Object.keys(S.imp || {}).length) await ensureReadings();
    VBY = new Map(VOCAB.map((w) => [w.word, w]));
    VBYID = new Map(VOCAB.map((w) => [w.id, w]));
    for (const w of VOCAB) { SURF.set(w.word, w); for (const f of Object.keys(w.forms || {})) if (!SURF.has(f)) SURF.set(f, w); }
    TRACK = new Map(data.tracks.map((t) => [t.id, t]));
    buildDict();
    for (const rec of Object.values(S.imp || {})) {
      if (!rec || !rec.id || TRACK.has(rec.id)) continue;
      const t = impTrack(rec); data.tracks.push(t); TRACK.set(t.id, t);
    }
    const s = data.stats || {};
    const hs = $('headstat'); if (hs) hs.textContent = `${IDX.tracks.length} 首 · ${s.vocab} 词`;
    $('genat').textContent = '数据生成于 ' + new Date(data.generatedAt).toLocaleString('zh-CN');

    if ($('brand')) $('brand').onclick = () => go('#/home');
    $('tab-learn').onclick = () => go('#/learn');
    $('tab-songs').onclick = () => go('#/songs');
    $('tab-mine').onclick = () => go('#/mine');
    $('btn-search').onclick = () => { const w = $('searchwrap'); w.classList.toggle('on'); if (w.classList.contains('on')) $('q').focus(); else if (location.hash.startsWith('#/search')) go(lastNonSearch); };
    let qt = null;
    $('q').oninput = (e) => {
      clearTimeout(qt);
      const v = e.target.value;
      qt = setTimeout(() => {
        if (v.trim()) { history.replaceState(null, '', '#/search/' + encodeURIComponent(v.trim())); show('view-search'); showSearch(v.trim()); }
        else if (location.hash.startsWith('#/search')) go(lastNonSearch);
      }, 180);
    };
    $('q-clear').onclick = () => { $('q').value = ''; if (location.hash.startsWith('#/search')) go(lastNonSearch); };

    bindAudio();
    $('playbtn').onclick = (e) => { e.stopPropagation(); togglePlay(); };
    $('mb-meta').onclick = () => openPlayer();
    $('mb-loop').onclick = (e) => { e.stopPropagation(); setMode('all'); toast('整首播放'); };
    $('p-close').onclick = () => $('player').classList.remove('on');
    $('p-play').onclick = () => togglePlay();
    $('p-prev').onclick = () => step(-1);
    $('p-next').onclick = () => step(1);
    $('m-all').onclick = () => setMode('all');
    $('m-loop').onclick = () => setMode('loop');
    $('b-display').onclick = (e) => { e.stopPropagation(); const b = $('displaybox'); b.classList.toggle('on'); };
    $('b-gloss').onclick = () => { S.gloss = S.gloss === false; save(); applyDisplay(); };
    $('b-zh').onclick = () => { S.zh = S.zh === false; save(); applyDisplay(); renderLyrics($('plyric'), curTrack); bindLyrics($('plyric')); highlight(true); };
    $('b-ruby').onclick = () => { S.ruby = S.ruby === false; save(); applyDisplay(); renderLyrics($('plyric'), curTrack); bindLyrics($('plyric')); highlight(true); };
    $('p-seek').oninput = (e) => { if (audio.duration) jump((Number(e.target.value) / 1000) * audio.duration); };
    $('p-rate').onclick = () => {
      const rates = [1, .9, .8, .7, .6, 1.1];
      const i = rates.indexOf(Number(S.rate || 1));
      const r = rates[(i + 1) % rates.length];
      S.rate = r; save(); audio.playbackRate = r; $('p-rate').textContent = r.toFixed(1) + 'x';
      toast('语速 ' + r.toFixed(1) + 'x');
    };
    $('p-rate').textContent = Number(S.rate || 1).toFixed(1) + 'x';

    $('p-speak').onclick = () => speak(popWord ? popWord.word : popFallback);
    $('p-close2').onclick = hidePop;
    $('p-detail').onclick = () => { if (popWord) { const id = popWord.id; hidePop(); go('#/word/' + id); } };
    $('p-edit').onclick = () => {
      if (!popWord) return;
      const r = $('p-editrow'); r.style.display = r.style.display === 'none' ? 'flex' : 'none';
      $('p-editinput').value = meaningOf(popWord); $('p-editinput').focus();
    };
    $('p-editinput').onkeydown = (e) => { if (e.key !== 'Enter' || !popWord) return; S.notes[popWord.id] = Object.assign({}, S.notes[popWord.id], { meaning: e.target.value.trim(), u: Date.now() }); save(); showPop(popWord); };
    $('p-known').onclick = () => { if (!popWord) return; toggleKnown(popWord); showPop(popWord); if (curTrack) renderLyrics($('plyric'), curTrack); };
    $('p-more').onclick = () => { const b = $('p-morebox'); if (b) b.hidden = !b.hidden; };
    $('p-goto').onclick = () => {
      if (!popWord) return;
      const ex = (popWord.examples || [])[0];
      if (!ex || !ex.tid) { toast('这个词还没配例句'); return; }
      $('pop').classList.remove('on');
      go('#/track/' + ex.tid + '@' + ex.li);
    };
    $('p-lines').onclick = () => {
      if (!popWord || !curTrack) return;
      const ls = curTrack.lines.filter((l) => (l.segs || []).some((s) => s.w && s.b === popWord.word));
      $('p-meta').textContent = ls.length ? ls.slice(0, 4).map((l) => l.text).join(' ／ ') : '这首歌里没找到它';
    };
    document.addEventListener('click', (e) => { if (!e.target.closest('#pop') && !e.target.closest('.w') && !e.target.closest('[data-known]')) hidePop(); });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowDown') step(1);
      if (e.key === 'ArrowUp') step(-1);
      if (e.key === 'l' || e.key === 'L') setMode(mode === 'loop' ? 'all' : 'loop');
      if (e.key === 'Escape') { $('player').classList.remove('on'); hidePop(); }
    });
    $('p-nosrc').onclick = () => {
      $('player').classList.remove('on');
      const box = $('srcbox');
      if (box) { box.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if ($('nidinput')) $('nidinput').focus();
    };
    $('nidsave').onclick = () => {
      if (!curTrack) return;
      const m = $('nidinput').value.trim().match(/(\d{3,})/);
      if (!m) { alert('没识别出歌曲 ID'); return; }
      S.audio[curTrack.id] = { nid: m[1] }; if (S.local) delete S.local[curTrack.id];
      save(); $('srcinfo').textContent = describeSource(curTrack); toast('已绑定');
    };
    $('audiofile').onchange = (e) => {
      const f = e.target.files[0]; if (!f || !curTrack) return;
      if (f.size > 60 * 1024 * 1024) { alert('文件太大（≤60MB）'); return; }
      idbSet(curTrack.id, f).then(() => { delete S.local[curTrack.id]; save(); $('srcinfo').textContent = describeSource(curTrack); toast('本地音频已绑到这首，下次点开就出声'); }).catch(() => toast('保存失败：浏览器没让存，换个文件再试'));
    };
    $('audioclear').onclick = async () => { if (!curTrack) return; delete S.local[curTrack.id]; save(); try { await idbDel(curTrack.id); } catch {} $('srcinfo').textContent = describeSource(curTrack); };

    function togglePlay() {
      if (!curTrack) return;
      if (audio.getAttribute('data-tid') !== curTrack.id || !audio.src) { playTrack(curTrack); return; }
      if (audio.paused) { if (audio.error || audio.readyState === 0) playTrack(curTrack); else audio.play().catch(() => {}); }
      else audio.pause();
    }
    if (!location.hash) history.replaceState(null, '', '#/home');   // 用 replaceState：别触发 hashchange（否则闸门后面的页面会被渲染出来）
    window.addEventListener('hashchange', route);                     // 闸门也要挂：登录后靠它路由
    if (!ACC || !ACC.token) { showGate(); return; }   // 必须登录才能用
    route();
    // 打开页面先跟账号对一次：本机空的就恢复，本机有的就并上去
    if (S.autoSync !== false) setTimeout(() => syncNow({ auto: true }), 600);
    apiCall('/me').then((r) => { if (r && r.user) { ACC.name = r.user.name; ACC.admin = !!r.user.admin; saveAcc(); if (location.hash.startsWith('#/mine')) renderMine(); } }).catch(() => {});
    // 歌单体检：一天一次（静默，别打扰）；测试里用 window.__NO_PLCHECK 关掉
    if (!window.__NO_PLCHECK && impPlaylists().length && Date.now() - (S.plCheckAt || 0) > PL_CHECK_EVERY) {
      setTimeout(() => checkPlaylists({ silent: true }), 9000);
    }
  }
  boot();
})();
