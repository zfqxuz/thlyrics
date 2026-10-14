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
  let S = { known: {}, notes: {}, audio: {}, local: {}, rate: 1, ruby: true, gloss: false, zh: true, mode: 'all', del: {}, autoSync: true };
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
    if (t.audioOss) tags.push('阿里云');
    else if (t.audio || S.audio[t.id] || S.local[t.id]) tags.push('音频');
    if (t.lines.some((l) => l.zh)) tags.push('中文');
    const brN = (t.vocabIds || []).filter((i) => VBYID.get(i) && VBYID.get(i).br).length;
    if (brN) tags.push(`标日 ${brN}`);
    return `<div class="item track" data-id="${t.id}">
      ${t.coverFile ? `<img class="cover" loading="lazy" src="data/${t.coverFile}" alt="">`
        : (t.coverUrl ? `<img class="cover" loading="lazy" src="${esc(t.coverUrl)}" alt="">` : '<div class="cover"></div>')}
      <div class="col">
        <div class="l1">${esc(t.title)}</div>
        <div class="l2">${esc(t.artist)}</div>
        <div class="l3">${esc(t.album)} · ${t.lineCount} 行${tags.length ? ' · ' + tags.join(' · ') : ''}</div>
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

  async function syncUrls() {
    if (!syncCfg) {
      const cfg = await (await fetch('data/oss-sync.json', { cache: 'no-store' })).json();
      // 兼容老格式（只有一对 get/put，指向 sync/imports.json）
      if (!cfg.imports) cfg.imports = { get: cfg.get, put: cfg.put };
      if (!cfg.progress) cfg.progress = cfg.imports;
      syncCfg = cfg;
    }
    return syncCfg;
  }
  async function readJson(url) {
    if (!url) return null;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return r.json().catch(() => null);
  }
  async function putJson(url, obj) {
    const body = JSON.stringify(obj);
    const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return body;
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
    if (applying || S.autoSync === false) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow({ auto: true }); }, SYNC_DEBOUNCE);
  }

  /** 读云端 → 逐条合并 → 有变化就写回；云端多的也会并回本机 */
  async function syncNow(opts = {}) {
    if (importing || syncBusy) { syncQueued = true; return false; }
    syncBusy = true;
    try {
      const cfg = await syncUrls();
      const [cProg, cImp] = await Promise.all([readJson(cfg.progress.get), readJson(cfg.imports.get)]);
      const cState = Object.assign({}, cProg && cProg.data ? cProg.data : (cProg || {}));
      cState.imp = (cImp && (cImp.imp || (cImp.data && cImp.data.imp))) || {};
      const before = userState(S);
      const merged = mergeStates(before, cState);
      const gained = Object.keys(merged.imp).length - Object.keys(before.imp).length;
      if (JSON.stringify(merged) !== JSON.stringify(before)) {
        await ensureReadings().catch(() => {});
        applying = true;
        S.known = merged.known; S.notes = merged.notes; S.audio = merged.audio;
        S.imp = merged.imp; S.del = merged.del; S.clearedAt = merged.clearedAt;
        save(); applying = false;
        registerImpTracks();
      }
      const at = new Date().toISOString();
      // 进度/释义这份很小，改一点就传；导入的歌那份大，只有歌单真变了才传
      const progJson = JSON.stringify({ v: 1, at, dev: devId, known: merged.known, notes: merged.notes,
        audio: merged.audio, del: merged.del, clearedAt: merged.clearedAt });
      const impJson = JSON.stringify({ v: 1, at, dev: devId, count: Object.keys(merged.imp).length, imp: merged.imp });
      const hP = hashStr(progJson), hI = hashStr(impJson);
      let wrote = false;
      if (hP !== S.syncHashP || opts.force) { await putJson(cfg.progress.put, JSON.parse(progJson)); applying = true; S.syncHashP = hP; wrote = true; applying = false; }
      if (hI !== S.syncHashI || opts.force) { await putJson(cfg.imports.put, JSON.parse(impJson)); applying = true; S.syncHashI = hI; wrote = true; applying = false; }
      applying = true; S.syncAt = at; if (wrote) S.syncErr = ''; save(); applying = false;
      syncErr = '';
      if (opts.auto && gained > 0) toast(`已从云端恢复 ${gained} 首导入的歌`);
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
    if (S.autoSync === false) return '云端：自动同步已关（点「自动同步：关」可打开）';
    if (syncBusy) return '云端：同步中…';
    if (syncErr) return '云端：上次同步失败（' + esc(syncErr) + '），有改动会自动重试';
    if (S.syncAt) return '云端：已自动同步 ' + new Date(S.syncAt).toLocaleString('zh-CN', { hour12: false }).slice(5) + '　·　标词 / 改释义 / 导入都会自己存上去，换设备或清掉浏览器数据后打开就自动恢复';
    return '云端：等着第一次同步…';
  }

  async function pushCloud() {
    if (importing) return;
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
  const impState = { fails: [], failsRaw: [], ctx: null, msg: '' };
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
      <details class="impbox" ${impState.fails.length || impState.msg ? 'open' : ''}>
        <summary>导入网易云歌单</summary>
        <div class="row" style="margin-top:10px">
          <input id="plinput" class="sel" style="flex:1;min-width:180px;height:36px" placeholder="歌单链接 / 数字 ID / 分享文案">
          <button class="toolbtn on" id="plgo">${importing ? '导入中…' : '导入'}</button>
        </div>
        <div class="meta" id="plstat" style="margin-top:8px">${esc(impState.msg || '粘歌单链接或数字 ID')}</div>
        <div id="pllist">${impRowsHtml()}</div>
        ${impPlaylists().length ? `<div class="meta" style="margin-top:10px">已导入：${impPlaylists().map((p) => `${esc(p.name)}（${p.n} 首）`).join('、')}</div>` : ''}
      </details>
      ${songView === 'list'
        ? `<div class="list" id="list">${list.map(trackRow).join('') || '<div class="empty">没有匹配的曲目</div>'}</div>`
        : (groupsHtml(list) || '<div class="empty">没有匹配的曲目</div>')}`;
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
    if ($('plretry')) $('plretry').onclick = () => retryFailed();
    if ($('plinput')) $('plinput').onkeydown = (e) => { if (e.key === 'Enter') startImport(); };
    if (importing) setTimeout(() => { if (!importing) renderSongs(); }, 800);
  }

  function renderMine() {
    const knownList = VOCAB.filter(isKnown);
    const noted = VOCAB.filter((v) => S.notes[v.id] && S.notes[v.id].meaning);
    $('view-mine').innerHTML = `
      <div class="sec-head"><div><div class="sec-title">生词本</div><div class="sec-sub">已掌握 ${knownList.length} 词 · 改过释义 ${noted.length} 词 · 导入的歌 ${Object.keys(S.imp || {}).length} 首</div></div></div>
      <div class="meta" id="syncmsg" style="color:var(--ink2)">${syncMsgHtml()}</div>
      <div class="chips">${knownList.length ? knownList.slice(0, 200).map((v) => `<span class="chip" data-w="${v.id}">${esc(v.word)}</span>`).join('') : '<span class="meta">还没标过词</span>'}</div>
      <div class="hair"></div>
      ${noted.length ? noted.map((v) => `<div class="item" data-w="${v.id}"><div class="col"><div class="l1">${esc(v.word)}</div><div class="l2">${esc(S.notes[v.id].meaning)}</div></div></div>`).join('') : '<div class="meta">还没有自定义释义</div>'}
      <div class="row" style="margin-top:18px">
        <button class="toolbtn" id="m-export">导出到文件</button>
        <button class="toolbtn" id="m-import">从文件导入</button>
        <button class="toolbtn" id="m-push">立即同步</button>
        <button class="toolbtn" id="m-pull">从云端拉回</button>
        <button class="toolbtn ${S.autoSync !== false ? 'on' : ''}" id="m-auto">自动同步：${S.autoSync !== false ? '开' : '关'}</button>
        <button class="toolbtn" id="m-clear">清空进度</button>
      </div>
      <div class="meta" style="margin-top:10px;color:var(--ink2)">云端存的是你自己的记录（进度 / 自定义释义 / 导入的歌单），放在你自己的 OSS 里，不经过第三方。本机绑定的音频文件（大）不同步。</div>`;
    $('view-mine').querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => go('#/word/' + el.dataset.w)));
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
    $('p-loop').classList.toggle('on', mode === 'loop');
    if (!raf) raf = requestAnimationFrame(frame);
    prepAudio(t);
    if (atIdx != null && Number.isFinite(atIdx)) { $('player').classList.add('on'); renderLyrics($('plyric'), t); bindLyrics($('plyric')); playTrack(t).then(() => setLoop(atIdx)); }
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
      $('p-known').style.display = 'none'; $('p-detail').style.display = 'none'; $('p-lines').style.display = 'none'; $('p-edit').style.display = 'none';
      $('pop').classList.add('on'); return;
    }
    popWord = w;
    ['p-known', 'p-detail', 'p-lines', 'p-edit'].forEach(on);
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
    $('p-editinput').onkeydown = (e) => { if (e.key !== 'Enter' || !popWord) return; S.notes[popWord.id] = Object.assign({}, S.notes[popWord.id], { meaning: e.target.value.trim(), u: Date.now() }); save(); showPop(popWord); };
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
      idbSet(curTrack.id, f).then(() => { delete S.local[curTrack.id]; save(); $('srcinfo').textContent = describeSource(curTrack); alert('已保存'); }).catch(() => alert('保存失败'));
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
    // 打开页面先跟云端对一次：本机空的就自动恢复，本机有的就把新增的并上去
    if (S.autoSync !== false) setTimeout(() => syncNow({ auto: true }), 600);
  }
  boot();
})();
