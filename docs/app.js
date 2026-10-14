/* 东方同人曲 学唱机 —— 前端 v2（词汇入手 · 迷你播放条 + 全屏跟唱页） */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'thlyrics.tool.v1';
  const IDB_NAME = 'thlyrics';
  const GD = 'https://music-api.gdstudio.xyz/api.php';

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
  const dotsHtml = (v) => { const l = level(v); return `<span class="dots">${'<b>●</b>'.repeat(l)}${'●'.repeat(5 - l)}</span>`; };

  // ────────────── 本地状态 ──────────────
  let S = { known: {}, notes: {}, audio: {}, local: {}, rate: 1, ruby: true, gloss: true, zh: true, mode: 'all' };
  function loadLS() { try { const r = localStorage.getItem(LS_KEY); if (r) S = Object.assign(S, JSON.parse(r)); } catch {} S.known = S.known || {}; S.notes = S.notes || {}; S.audio = S.audio || {}; S.local = S.local || {}; S.imp = S.imp || {}; }
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch {} };
  const isKnown = (w) => !!(w && S.known[w.id]);
  const meaningOf = (w) => (w && ((S.notes[w.id] && S.notes[w.id].meaning) || w.meaning)) || '';
  const toggleKnown = (w) => { if (!w) return; if (S.known[w.id]) delete S.known[w.id]; else S.known[w.id] = 1; save(); };

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

  let stationNid = null, seekTime = null, prepToken = 0;
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
    if (!nid) { setState('还没绑定音频'); return; }
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
      audio.pause();
      setLoad(true, '正在准备音频…');
      try {
        let local = S.local[track.id];
        if (!local) { try { const b = await idbGet(track.id); if (b) local = URL.createObjectURL(b); } catch {} }
        const url = local || await urlFor(track);
        if (!url) { setLoad(false); setState(track.audioOss ? '音频地址不可用' : '还没绑定音频（页面下方「音频来源与设置」可粘网易云链接）'); return; }
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
    $('p-loop').classList.toggle('on', mode === 'loop');
    highlight(true);
  }

  function setLoop(i, silent) {
    loopLine = i;
    if (i != null && mode !== 'loop') setMode('loop');
    const btn = $('p-loop'), mb = $('mb-loop');
    if (btn) btn.classList.toggle('on', i != null);
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
    if (!el) return;
    const box = el.parentElement;
    if (!box) return;
    const r = el.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (r.top < br.top + 40 || r.bottom > br.bottom - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    toast('从这句继续播 · 双击 = 单句循环');
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
      <div class="row" style="margin-top:14px">
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
      ${list.length > deckCount ? `<div class="row" style="justify-content:center;margin-top:16px"><button class="toolbtn" id="d-more">再看 30 个（还有 ${list.length - deckCount}）</button></div>` : ''}
      <div class="hint">点词看读音释义，右侧 ✓ 标已掌握。练一句比背十个词有用：词条里点「去这句」直接进入那句循环。</div>`;
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
    if (t.imp) tags.push('导入' + (t.plName ? '·' + t.plName : ''));
    if (t.audioOss) tags.push('自建音频');
    else if (t.audio || S.audio[t.id] || S.local[t.id]) tags.push('音频');
    if (t.lines.some((l) => l.zh)) tags.push('中文');
    const brN = (t.vocabIds || []).filter((i) => VBYID.get(i) && VBYID.get(i).br).length;
    if (brN) tags.push(`标日词 ${brN}`);
    return `<div class="item track" data-id="${t.id}">
      ${t.coverFile ? `<img class="cover" loading="lazy" src="data/${t.coverFile}" alt="">`
        : (t.coverUrl ? `<img class="cover" loading="lazy" src="${esc(t.coverUrl)}" alt="">` : '<div class="cover"></div>')}
      <div class="col">
        <div class="l1">${esc(t.title)}</div>
        <div class="l2">${esc(t.artist)}</div>
        <div class="l3">${esc(t.album)} · ${t.lineCount} 行 · ${(t.vocabIds || []).length} 词${tags.length ? ' · ' + tags.join(' · ') : ''}</div>
      </div>
      ${t.imp ? `<button class="tick del" data-del="${esc(t.id)}" title="删除这首">✕</button>` : '<span class="mini">›</span>'}
    </div>`;
  }
  // ────────────── 网易云歌单导入（纯前端，失败逐首报错） ──────────────
  // 歌单详情 / 歌词 / 音频地址都走 music-api.gdstudio.xyz（它带 CORS 头，浏览器能直连）。
  // 收进来的歌存在本机 localStorage：歌词只有「时间轴 + 原文 + 译文」，
  // 分词用现有词表（1358 词 + 活用形）做最长匹配，所以导入的曲目同样有
  // 词性配色 / 逐词罗马音 / 释义 / 点词弹层 / 单句循环，和内置曲目一致。
  const IMP_LIMIT = 60;
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
      if (!hit) { plain += text[i]; i++; continue; }
      flush();
      const surf = text.substr(i, len);
      const f = hit.v.forms && hit.v.forms[hit.form];
      out.push({
        s: surf, k: posKind(hit.v), w: true, b: hit.v.word,
        y: (f && f.romaji) || hit.v.romaji || '', r: (f && f.reading) || hit.v.reading || '',
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
  const LRC_META = /^\s*(作词|作曲|编曲|制作人|混音|母带|吉他|贝斯|鼓|录音|和声|歌词来源|校对|翻译|调校|曲绘|PV|原曲|社团|专辑|演唱|Vocals|Lyrics|Composer|Arranger|Album|Producer)\s*[:：]/i;
  /** LRC → 行数组（只保留唱出来的行；翻译按时间就近配对） */
  function parseLrc(lyric, tlyric) {
    const rows = (txt) => [...String(txt || '').matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]\s*(.*)/g)]
      .map((m) => ({ t: Number(m[1]) * 60 + Number(String(m[2]).replace(':', '.')), text: m[3].trim() }));
    const trs = rows(tlyric).filter((r) => r.text).map((r) => ({ t: r.t, text: r.text, used: false }));
    const out = [];
    for (const r of rows(lyric)) {
      if (!r.text || LRC_META.test(r.text) || /歌词来源|THB\s?WIKI|纯音乐/i.test(r.text)) continue;
      const hit = trs.find((x) => !x.used && Math.abs(x.t - r.t) < .35);
      if (hit) hit.used = true;
      out.push({ t: Math.round(r.t * 100) / 100, text: r.text, zh: hit ? hit.text : '' });
    }
    out.sort((a, b) => a.t - b.t);
    const seen = new Set();
    return out.filter((l) => (seen.has(l.t) ? false : (seen.add(l.t), true)));
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
    if (!url) return { error: '没识别出歌单 ID：粘「歌单链接」或直接填数字 ID' };
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
    return { error: `这条短链里没有歌单 ID（${url.slice(0, 46)}…），自动解析也没成功。两个办法：① 点开它，在浏览器地址栏里找 id= 后面那串数字，直接填数字；② 把链接发我，我解析给你` };
  }
  /** 导入一张歌单：逐首拉歌词+音频，失败的记原因，不阻塞其它 */
  async function importPlaylist(input, limit, onStep) {
    const rid = await resolvePlaylistId(input);
    if (rid.error) return { error: rid.error };
    const pid = rid.id;
    if (rid.short && onStep) onStep(0, 0, '短链已解析', '歌单 ID ' + pid);
    let pl = null;
    try { const j = await gdJson(`types=playlist&source=netease&id=${pid}`); pl = j && j.playlist; }
    catch (e) { return { error: '拉取歌单失败：' + (e.name === 'AbortError' ? '超时' : e.message) }; }
    if (!pl) return { error: '歌单不存在或读不到（私密歌单不行）' };
    const all = (pl.tracks || []).filter((x) => x && x.id);
    if (!all.length) return { error: '这张歌单里没有歌' };
    const cap = Math.max(1, Math.min(Number(limit) || IMP_LIMIT, all.length));
    const list = all.slice(0, cap);
    const ok = [], fail = [];
    const report = (title, mark) => { if (onStep) onStep(ok.length + fail.length, list.length, title, mark); };
    const one = async (tr) => {
      const nid = String(tr.id);
      const title = String(tr.name || '').trim() || ('歌曲 ' + nid);
      const artist = ((tr.ar || tr.artists || []).map((a) => a && a.name).filter(Boolean)).join(' / ');
      const album = (tr.al && tr.al.name) || '';
      const cover = (tr.al && tr.al.picUrl) || '';
      if (S.imp['i' + nid]) { ok.push({ nid, title, skip: true }); report(title, '已在库里'); return; }
      const builtin = IDX.tracks.find((t) => !t.imp && ((t.audio && String(t.audio.nid) === nid) || norm(t.title) === norm(title)));
      if (builtin) { ok.push({ nid, title, skip: true }); report(title, `内置曲库已有《${builtin.title}》`); return; }
      try {
        const ly = await gdJson(`types=lyric&source=netease&id=${nid}`);
        const lines = parseLrc(ly && ly.lyric, ly && ly.tlyric);
        if (lines.length < 3 || lines[lines.length - 1].t <= 0) throw new Error('没有带时间轴的歌词');
        const u = await gdJson(`types=url&source=netease&id=${nid}&br=320`);
        if (!u || !u.url) throw new Error('取不到音频（可能下架／VIP／地区限定）');
        S.imp['i' + nid] = { id: 'i' + nid, nid, title, artist, album, cover, lines, plId: pid, plName: pl.name || '', at: Date.now() };
        save();
        ok.push({ nid, title });
        report(title, '导入成功');
      } catch (e) {
        const why = e.name === 'AbortError' ? '接口超时' : (e.message || '导入失败');
        fail.push({ nid, title, why });
        report(title, '导入失败：' + why);
      }
    };
    const queue = [...list];
    await Promise.all([0, 1, 2].map(async () => {
      while (queue.length) { const tr = queue.shift(); await one(tr); }
    }));
    return { ok, fail, plName: pl.name || '', total: all.length, done: list.length };
  }
  /** 导入 + 把新歌并进内存（供 UI 与测试用） */
  async function importInto(input, limit, onStep) {
    const res = await importPlaylist(input, limit, onStep);
    if (!res.error) for (const [id, rec] of Object.entries(S.imp)) if (!TRACK.has(id)) { const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(id, t); }
    return res;
  }
  window.__tlImport = (input, limit) => importInto(input, limit);
  window.__tlSegs = (t) => segsFor(t);   // 测试用
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
    if (!confirm(`删除导入的《${rec.title}》？`)) return;
    delete S.imp[id]; save();
    const i = IDX.tracks.findIndex((t) => t.id === id);
    if (i >= 0) IDX.tracks.splice(i, 1);
    TRACK.delete(id);
    if (curTrack && curTrack.id === id) { audio.pause(); audio.removeAttribute('src'); curTrack = null; }
    renderSongs();
  }
  function impRowsHtml() {
    const log = impState.log;
    if (!log.length) return '';
    const head = impState.done ? '' : `<div class="meta">正在导入 ${log.length}/${impState.total} …</div>`;
    return `<div class="implog">${head}${log.map((x) => `<div class="improw ${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✗'} <b>${esc(x.title)}</b> <span>${esc(x.mark)}</span></div>`).join('')}</div>`;
  }
  const impState = { log: [], total: 0, done: false, msg: '' };
  async function startImport(limit) {
    if (importing) return;
    const box = $('plinput');
    const input = box ? box.value : '';
    const stat = $('plstat');
    impState.log = []; impState.total = 0; impState.done = false;
    importing = true;
    if (stat) stat.textContent = '正在拉取歌单…';
    if ($('plgo')) $('plgo').disabled = true;
    const res = await importInto(input, limit, (n, total, title, mark) => {
      impState.total = total;
      impState.log.push({ title, mark, ok: /成功|已在库里/.test(mark) });
      if ($('pllist')) $('pllist').innerHTML = impRowsHtml();
      if (stat) stat.textContent = `正在导入 ${n}/${total} …`;
    });
    importing = false;
    if ($('plgo')) $('plgo').disabled = false;
    impState.done = true;
    if (res.error) { impState.msg = res.error; if (stat) stat.textContent = res.error; if ($('pllist')) $('pllist').innerHTML = ''; return; }
    // 新导入的进内存
    for (const [id, rec] of Object.entries(S.imp)) if (!TRACK.has(id)) { const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(id, t); }
    impState.msg = `歌单《${res.plName}》共 ${res.total} 首，本次处理 ${res.done} 首：成功 ${res.ok.length} 首，失败 ${res.fail.length} 首`;
    if (res.total > res.done) impState.msg += `（这张歌单还有 ${res.total - res.done} 首没导，一次最多 ${limit || IMP_LIMIT} 首）`;
    const head = `${impState.msg}`;
    renderSongs();
    if ($('plstat')) $('plstat').textContent = head;
    if ($('pllist')) $('pllist').innerHTML = impRowsHtml();
    if (res.ok.length) toast(`导入完成：${res.ok.length} 首成功${res.fail.length ? `，${res.fail.length} 首失败` : ''}`);
    else toast(`导入失败：${res.fail[0] ? res.fail[0].why : '没有可导入的歌'}`);
  }

  function renderSongs() {
    const list = IDX.tracks.filter((t) => {
      if (filter === 'audio' && !(t.audioOss || t.audio || S.audio[t.id] || S.local[t.id])) return false;
      if (filter === 'imp' && !t.imp) return false;
      if (filter === 'zh' && !t.lines.some((l) => l.zh)) return false;
      if (filter === 'known') {
        const k = (t.vocabIds || []).filter((i) => S.known[i]).length;
        if (t.vocabIds && t.vocabIds.length && k / t.vocabIds.length > .8) return false;
      }
      return true;
    });
    $('view-songs').innerHTML = `
      <div class="sec-head"><div><div class="sec-title">曲库</div><div class="sec-sub">共 ${IDX.tracks.length} 首 · 当前显示 ${list.length} 首</div></div></div>
      <div class="chips">
        <button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">全部</button>
        <button class="chip ${filter === 'audio' ? 'on' : ''}" data-f="audio">有音频</button>
        <button class="chip ${filter === 'zh' ? 'on' : ''}" data-f="zh">有中文</button>
        <button class="chip ${filter === 'imp' ? 'on' : ''}" data-f="imp">我导入的</button>
        <button class="chip ${filter === 'known' ? 'on' : ''}" data-f="known">隐藏已掌握词多的</button>
      </div>
      <details class="impbox" ${impState.log.length || impState.msg ? 'open' : ''}>
        <summary>导入网易云歌单</summary>
        <div class="row" style="margin-top:10px">
          <input id="plinput" class="sel" style="flex:1;min-width:180px;height:36px" placeholder="歌单链接 / 数字 ID / 分享文案">
          <button class="toolbtn on" id="plgo">${importing ? '导入中…' : '导入'}</button>
        </div>
        <div class="meta" id="plstat" style="margin-top:8px">${esc(impState.msg || `把歌单里的歌收进来：有带时间轴的歌词 + 能取到音频的才收，取不到的逐首报原因。一次最多 ${IMP_LIMIT} 首，词性/罗马音/释义会用现有词表自动对齐。短链（163cn.tv/…）会自动尝试解析。`)}</div>
        <div id="pllist">${impRowsHtml()}</div>
        ${impPlaylists().length ? `<div class="meta" style="margin-top:10px">已导入：${impPlaylists().map((p) => `${esc(p.name)}（${p.n} 首）`).join('、')}</div>` : ''}
      </details>
      <div class="list" id="list">${list.map(trackRow).join('') || '<div class="empty">没有匹配的曲目</div>'}</div>`;
    $('view-songs').querySelectorAll('.chip').forEach((el) => (el.onclick = () => { filter = el.dataset.f; renderSongs(); }));
    $('view-songs').querySelectorAll('.track').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('[data-del]')) return;
      go('#/track/' + el.dataset.id);
    }));
    $('view-songs').querySelectorAll('[data-del]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); delImpTrack(el.dataset.del); }));
    if ($('plgo')) $('plgo').onclick = () => startImport();
    if ($('plinput')) $('plinput').onkeydown = (e) => { if (e.key === 'Enter') startImport(); };
    if (importing) setTimeout(() => { if (!importing) renderSongs(); }, 800);
  }

  function renderMine() {
    const knownList = VOCAB.filter(isKnown);
    const noted = VOCAB.filter((v) => S.notes[v.id] && S.notes[v.id].meaning);
    $('view-mine').innerHTML = `
      <div class="sec-head"><div><div class="sec-title">生词本</div><div class="sec-sub">已掌握 ${knownList.length} 词 · 自己改过释义 ${noted.length} 词（都存在本机）</div></div></div>
      <div class="chips">${knownList.length ? knownList.slice(0, 200).map((v) => `<span class="chip" data-w="${v.id}">${esc(v.word)}</span>`).join('') : '<span class="meta">还没标过词</span>'}</div>
      <div class="hair"></div>
      ${noted.length ? noted.map((v) => `<div class="item" data-w="${v.id}"><div class="col"><div class="l1">${esc(v.word)}</div><div class="l2">${esc(S.notes[v.id].meaning)}</div></div></div>`).join('') : '<div class="meta">还没有自定义释义</div>'}
      <div class="row" style="margin-top:18px">
        <button class="toolbtn" id="m-export">导出进度</button>
        <button class="toolbtn" id="m-import">导入进度</button>
        <button class="toolbtn" id="m-clear">清空进度</button>
      </div>`;
    $('view-mine').querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => go('#/word/' + el.dataset.w)));
    $('m-export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
      a.download = 'thlyrics-progress.json'; document.body.appendChild(a); a.click(); a.remove();
    };
    $('m-import').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { try { S = Object.assign({ known: {}, notes: {}, audio: {}, local: {}, rate: 1 }, JSON.parse(String(fr.result))); save(); renderMine(); } catch { alert('读不了这个文件'); } }; fr.readAsText(f); };
      inp.click();
    };
    $('m-clear').onclick = () => { if (!confirm('清空本机的学习进度？')) return; S.known = {}; S.notes = {}; save(); renderMine(); };
  }

  // ────────────── 词条详情 ──────────────
  function showWord(id) {
    const v = VBYID.get(Number(id));
    if (!v) { go('#/learn'); return; }
    const order = deckList();
    const at = order.findIndex((x) => x.id === v.id);
    const prev = at > 0 ? order[at - 1] : null, next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
    const forms = Object.entries(v.forms || {}).filter(([f]) => f !== v.word).slice(0, 8);
    const exs = (v.examples || []).slice(0, 6);
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
        <input class="sel" id="w-editinput" style="flex:1;min-width:160px;height:38px" value="${esc(meaningOf(v))}" placeholder="写你自己的释义，回车保存">
        <button class="toolbtn" id="w-save">保存</button>
      </div>
      ${forms.length ? `<div class="hair"></div><div class="sec-sub" style="margin-bottom:6px">歌词里出现过的形态</div><div class="chips">${forms.map(([f, o]) => `<span class="chip">${esc(f)}${o.readingHira ? '（' + esc(o.readingHira) + '）' : ''}</span>`).join('')}</div>` : ''}
      <div class="hair"></div>
      <div class="sec-sub" style="margin-bottom:6px">它出现在这些句子里</div>
      <div class="list">${exs.length ? exs.map((ex) => `<div class="item" style="align-items:flex-start">
        <div class="col"><div class="l1" style="font-weight:400;font-size:14.5px;white-space:normal">${esc(ex.jp)}</div>
        ${ex.zh ? `<div class="l2" style="color:var(--p-a);white-space:normal">${esc(ex.zh)}</div>` : ''}
        <div class="l3">${esc(ex.track || '')}</div></div>
        ${ex.tid ? `<button class="toolbtn" data-goto="${ex.tid}@${ex.li}">去这句</button>` : ''}</div>`).join('') : '<div class="meta">词表里没给这个词配例句</div>'}</div>`;
    $('w-back').onclick = () => history.length > 1 ? history.back() : go('#/learn');
    $('view-word').querySelectorAll('[data-go-word]').forEach((el) => (el.onclick = () => go('#/word/' + el.dataset.goWord)));
    $('w-play').onclick = () => speak(v.word);
    $('w-known').onclick = () => { toggleKnown(v); showWord(v.id); };
    $('w-edit').onclick = () => { const r = $('w-editrow'); r.style.display = r.style.display === 'none' ? 'flex' : 'none'; $('w-editinput').focus(); };
    const saveMean = () => { S.notes[v.id] = Object.assign({}, S.notes[v.id], { meaning: $('w-editinput').value.trim() }); save(); showWord(v.id); };
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
      ${!r.words.length && !r.tracks.length && !r.originals.length ? '<div class="empty">没有匹配的内容</div>' : ''}`;
    wireWords($('view-search'));
    $('view-search').querySelectorAll('.track').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('[data-del]')) return;
      go('#/track/' + el.dataset.id);
    }));
    $('view-search').querySelectorAll('[data-del]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); delImpTrack(el.dataset.del); if (!IDX.tracks.some((t) => t.id === el.dataset.del)) showSearch(q); }));
    $('view-search').querySelectorAll('[data-base]').forEach((el) => (el.onclick = () => { $('q').value = el.dataset.base; go('#/search/' + encodeURIComponent(el.dataset.base)); }));
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
    $('twhead').textContent = `这首歌的词汇（${list.length}/${all.length} 个 · 按标日课次+难度排）`;
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
          if (!sg.k) { line.appendChild(document.createTextNode(sg.s)); if (sg.s.trim()) flat.push(sg.s); continue; }
          const sym = sg.k === 'sym';
          const w = sym ? null : ((sg.w && VBY.get(sg.b)) || SURF.get(sg.s) || null);
          const span = document.createElement('span');
          span.className = 'w k-' + sg.k + (w && isKnown(w) ? ' known' : '');
          span.dataset.s = sg.s;
          if (sym) span.dataset.plain = '1';
          if (sg.w && sg.b) span.dataset.w = sg.b;
          const y = sg.y || '';
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
      if (wEl && !wEl.dataset.plain) { const w = (wEl.dataset.w && VBY.get(wEl.dataset.w)) || SURF.get(wEl.dataset.s) || null; showPop(w, wEl.dataset.s); return; }
      const b = e.target.closest('.lblock[data-i]');
      if (!b) return;
      const i = Number(b.dataset.i);
      const now = Date.now();
      if (now - lastTap < 360 && lastTapIdx === i) { lastTap = 0; setLoop(i); toast('单句循环 开'); return; }   // 双击 → 切到单句循环
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
    audio.pause();
    const zhN = t.lines.filter((l) => l.zh).length;
    const knownN = (t.vocabIds || []).filter((i) => S.known[i]).length;
    $('view-track').innerHTML = `
      <div class="row" style="margin-bottom:12px"><button class="toolbtn" id="b-back">← 返回</button></div>
      <div class="item" style="border:0;padding:0 0 12px;cursor:default">
        ${t.coverFile ? `<img class="cover big" src="data/${t.coverFile}" alt="">`
          : (t.coverUrl ? `<img class="cover big" src="${esc(t.coverUrl)}" alt="">` : '<div class="cover big"></div>')}
        <div class="col">
          <div class="l1" style="font-size:17px">${esc(t.title)}</div>
          <div class="l2">${esc(t.artist)} · ${esc(t.album)}</div>
          <div class="l3">${t.imp ? `来自歌单：${esc(t.plName || '导入')} · 网易云 ${esc(String(t.audio.nid))}` : `原曲：${esc(t.base)}`} · ${t.lineCount} 行${zhN ? ` · 中文 ${zhN}` : ''}${t.imp ? '' : ` · 已掌握 ${knownN}/${(t.vocabIds || []).length}`}</div>
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
    activeLine = -1; loopLine = null;
    $('m-all').classList.toggle('on', mode === 'all');
    $('m-loop').classList.toggle('on', mode === 'loop');
    $('p-loop').classList.toggle('on', mode === 'loop');
    if (!raf) raf = requestAnimationFrame(frame);
    prepAudio(t);
    if (atIdx != null && Number.isFinite(atIdx)) { $('player').classList.add('on'); renderLyrics($('plyric'), t); bindLyrics($('plyric')); playTrack(t).then(() => setLoop(atIdx)); }
  }
  function describeSource(t) {
    if (S.local[t.id]) return '当前用本地音频文件（只存在这个浏览器里）';
    if (t.audioOss) return `当前音频：自建对象存储直链（进页面就预缓冲，不走第三方解析）`;
    const s = S.audio[t.id] || t.audio;
    if (s && s.nid) return `当前音频：网易云 ${s.nid}${t.netease && t.netease.agreeRate != null ? `（歌词一致度 ${Math.round(t.netease.agreeRate * 100)}%）` : ''}`;
    return '这首还没有音频。可以粘一个网易云链接，或换有音频的曲目。';
  }
  function applyDisplay() {
    document.body.classList.toggle('gloss', S.gloss !== false);
    document.body.classList.toggle('ruby', S.ruby !== false);
    $('b-gloss').classList.toggle('on', S.gloss !== false);
    $('b-zh').classList.toggle('on', S.zh !== false);
    $('b-ruby').classList.toggle('on', S.ruby !== false);
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
  function showPop(w, fallback) {
    popFallback = fallback || null;
    const on = (id) => { const el = $(id); if (el) el.style.display = ''; };
    if (!w) {
      $('p-word').textContent = fallback || ''; $('p-reading').textContent = ''; $('p-romaji').textContent = '';
      $('p-meaning').textContent = '这个词不在词表里（助词或活用碎片），先听个音吧';
      $('p-ex').textContent = ''; $('p-meta').textContent = '';
      $('p-known').style.display = 'none'; $('p-detail').style.display = 'none'; $('p-lines').style.display = 'none'; $('p-edit').style.display = 'none';
      $('pop').classList.add('on'); return;
    }
    popWord = w;
    ['p-known', 'p-detail', 'p-lines', 'p-edit'].forEach(on);
    $('p-word').textContent = w.word;
    $('p-reading').textContent = w.reading ? '（' + w.reading + '）' : '';
    $('p-romaji').textContent = w.romaji || '';
    $('p-meaning').textContent = meaningOf(w) || '（还没有释义，点「改释义」自己写一个）';
    const ex = (w.examples || [])[0];
    $('p-ex').textContent = ex ? `例句（${ex.track}）：${ex.jp}${ex.zh ? ' → ' + ex.zh : ''}` : '';
    $('p-meta').textContent = [POSNAME[posKind(w)], levelName(w), `全库 ${w.tracks.length} 首 / ${w.count} 次`].join(' · ');
    $('p-known').textContent = isKnown(w) ? '取消已掌握' : '标为已掌握';
    $('p-editrow').style.display = 'none';
    $('pop').classList.add('on');
  }
  const hidePop = () => $('pop').classList.remove('on');

  // ────────────── 路由 ──────────────
  const VIEWS = ['view-learn', 'view-songs', 'view-mine', 'view-word', 'view-track', 'view-search'];
  function show(which) {
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
    const v = parts[0] || 'learn';
    if (v !== 'search') lastNonSearch = '#/' + path;
    if (v === 'word') { show('view-word'); return showWord(parts[1]); }
    if (v === 'track') { show('view-track'); return showTrack(parts[1], at != null && at !== '' ? Number(at) : null); }
    if (v === 'search') { show('view-search'); $('searchwrap').classList.add('on'); $('q').value = parts.slice(1).join('/'); return showSearch(parts.slice(1).join('/')); }
    if (v === 'songs') { show('view-songs'); return renderSongs(); }
    if (v === 'mine') { show('view-mine'); return renderMine(); }
    show('view-learn'); renderLearn();
  }

  // ────────────── 启动 ──────────────
  async function boot() {
    loadLS();
    document.body.classList.toggle('gloss', S.gloss !== false);
    document.body.classList.toggle('ruby', S.ruby !== false);
    let data;
    try { data = await (await fetch('data/index.json')).json(); }
    catch { $('view-learn').innerHTML = '<div class="empty">载入 data/index.json 失败。本地请先起服务：node scripts/serve.mjs 8848</div>'; show('view-learn'); return; }
    IDX = data; VOCAB = data.vocab;
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
    $('headstat').textContent = `${IDX.tracks.length} 首 · ${s.vocab} 词 · 有音频 ${IDX.tracks.filter((t) => t.audioOss || t.audio).length} 首`;
    $('genat').textContent = '数据生成于 ' + new Date(data.generatedAt).toLocaleString('zh-CN');

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
    $('mb-loop').onclick = (e) => { e.stopPropagation(); setMode('all'); toast('已切回整首播放'); };
    $('p-close').onclick = () => $('player').classList.remove('on');
    $('p-play').onclick = () => togglePlay();
    $('p-prev').onclick = () => step(-1);
    $('p-next').onclick = () => step(1);
    $('p-loop').onclick = () => setMode(mode === 'loop' ? 'all' : 'loop');
    $('m-all').onclick = () => setMode('all');
    $('m-loop').onclick = () => setMode('loop');
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
    $('p-editinput').onkeydown = (e) => { if (e.key !== 'Enter' || !popWord) return; S.notes[popWord.id] = Object.assign({}, S.notes[popWord.id], { meaning: e.target.value.trim() }); save(); showPop(popWord); };
    $('p-known').onclick = () => { if (!popWord) return; toggleKnown(popWord); showPop(popWord); if (curTrack) renderLyrics($('plyric'), curTrack); };
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
      if (e.key === 'l' || e.key === 'L') $('p-loop').click();
      if (e.key === 'Escape') { $('player').classList.remove('on'); hidePop(); }
    });
    $('nidsave').onclick = () => {
      if (!curTrack) return;
      const m = $('nidinput').value.trim().match(/(\d{3,})/);
      if (!m) { alert('没识别出歌曲 ID'); return; }
      S.audio[curTrack.id] = { nid: m[1] }; if (S.local) delete S.local[curTrack.id];
      save(); $('srcinfo').textContent = describeSource(curTrack); toast('已绑定，点播放试试');
    };
    $('audiofile').onchange = (e) => {
      const f = e.target.files[0]; if (!f || !curTrack) return;
      if (f.size > 60 * 1024 * 1024) { alert('文件太大（建议 60MB 以内）'); return; }
      idbSet(curTrack.id, f).then(() => { delete S.local[curTrack.id]; save(); $('srcinfo').textContent = describeSource(curTrack); alert('已存进这个浏览器'); }).catch(() => alert('保存失败'));
    };
    $('audioclear').onclick = async () => { if (!curTrack) return; delete S.local[curTrack.id]; save(); try { await idbDel(curTrack.id); } catch {} $('srcinfo').textContent = describeSource(curTrack); };

    function togglePlay() {
      if (!curTrack) return;
      if (audio.getAttribute('data-tid') !== curTrack.id || !audio.src) { playTrack(curTrack); return; }
      if (audio.paused) { if (audio.error || audio.readyState === 0) playTrack(curTrack); else audio.play().catch(() => {}); }
      else audio.pause();
    }
    window.addEventListener('hashchange', route);
    if (!location.hash) location.replace('#/learn');
    route();
  }
  boot();
})();
