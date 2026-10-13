/* 东方同人曲 学唱机 —— 前端
 * 结构：学词（词汇入手）/ 曲库 / 生词本 / 词条详情 / 单曲歌词 / 检索
 * 数据：docs/data/index.json（词表带 br=标日课次、jl=JLPT 等级、diff=从易到难排序键）
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'thlyrics.tool.v1';
  const IDB_NAME = 'thlyrics';

  // ---------- 本地音频（IndexedDB，localStorage 放不下音频） ----------
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('audio')) r.result.createObjectStore('audio'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(key, val) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('audio', 'readonly'); const q = tx.objectStore('audio').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function idbDel(key) { const db = await idb(); return new Promise((res) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').delete(key); tx.oncomplete = res; tx.onerror = res; }); }
  const GD = 'https://music-api.gdstudio.xyz/api.php';

  // ---------- 全局状态 ----------
  let IDX = null;
  let VOCAB = [], VBY = new Map(), VBYID = new Map(), SURF = new Map(), trackById = new Map();
  let S = { known: {}, notes: {}, audio: {}, local: {}, rate: 1 };   // 本地进度与偏好
  let curTrack = null, curLines = [], loopLine = null, raf = null;

  const POSNAME = { n: '名词', v: '动词', a: '形容词', na: '形容动词', adv: '副词', prt: '助词', aux: '助动词', conj: '接续词', int: '感叹词', rent: '连体词', pref: '接头词', oth: '其他' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtTime = (s) => (!s || !isFinite(s)) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const norm = (s) => String(s || '').toLowerCase().replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  // ---------- 本地状态 ----------
  function load() {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch {}
    S.known = S.known || {}; S.notes = S.notes || {}; S.audio = S.audio || {}; S.local = S.local || {};
  }
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch {} };
  const isKnown = (w) => !!(w && S.known[w.id]);
  const meaningOf = (w) => (w && ((S.notes[w.id] && S.notes[w.id].meaning) || w.meaning)) || '';

  // ---------- 语音朗读 ----------
  let jaVoice = null;
  const pickVoice = () => { jaVoice = (speechSynthesis.getVoices() || []).find((v) => (v.lang || '').toLowerCase().startsWith('ja')) || null; };
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice; u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  // ---------- 音频：一次取地址、可复用、带状态 ----------
  // 事实（实测）：① 中转接口每次给的签名地址都不同且会过期 -> 每首歌解析一次，在有效期内复用
  //              ② 真正的音频源支持 Range(206)，中途 seek 不重下整首
  //              ③ 首字节快、整首要几秒 -> 必须有「缓冲中」状态
  const urlCache = new Map();
  const URL_TTL = 18 * 60 * 1000;
  const UC_KEY = 'thlyrics.urlcache.v1';
  // 签名地址在有效期内可以复用：存到 localStorage，刷新/重进不用再等 API 往返
  function loadUrlCache() {
    try {
      const o = JSON.parse(localStorage.getItem(UC_KEY) || '{}');
      for (const k of Object.keys(o)) if (o[k] && o[k].url) urlCache.set(k, o[k]);
    } catch {}
  }
  function saveUrlCache() {
    try {
      const o = {};
      for (const [k, v] of urlCache) if (Date.now() - v.at < URL_TTL) o[k] = v;
      localStorage.setItem(UC_KEY, JSON.stringify(o));
    } catch {}
  }
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  audio.id = 'audio';
  const mountAudio = () => { if (document.body && !audio.isConnected) document.body.appendChild(audio); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAudio); else mountAudio();

  async function stationUrlFor(track) {
    // 阿里云 OSS 固定直链：不需要解析接口，省掉 600ms+ 的往返（音频字节完全一样）
    if (track.audioOss) return track.audioOss;
    const st = S.audio[track.id] || track.audio;
    if (!st || !st.nid) return null;
    const hit = urlCache.get(String(st.nid));
    if (hit && Date.now() - hit.at < URL_TTL) return hit.url;
    const res = await fetch(`${GD}?types=url&source=netease&id=${encodeURIComponent(st.nid)}&br=320`);
    const j = await res.json().catch(() => null);
    if (!j || !j.url) throw new Error('取不到音频地址');
    urlCache.set(String(st.nid), { url: j.url, at: Date.now() });
    saveUrlCache();
    return j.url;
  }

  let stationNid = null, stationLocal = null, seekTime = null, wantPlay = false, lastErr = null;
  let prepToken = 0;

  /** 进单曲页时预取音频地址 + 预缓冲（不播放）。这是「点了要等」的主要解法 */
  async function prepTrackAudio(track) {
    if (!track) return;
    const my = ++prepToken;
    if (audio.getAttribute('data-tid') === track.id && audio.src) return;   // 已经在准备/已就绪
    const nid = (S.audio[track.id] && S.audio[track.id].nid) || (track.audio && track.audio.nid) || null;
    let local = S.local[track.id];
    if (!local) { try { const blob = await idbGet(track.id); if (blob) local = URL.createObjectURL(blob); } catch {} }
    if (my !== prepToken) return;
    if (local) { stationLocal = local; stationNid = null; audio.setAttribute('data-tid', track.id); audio.src = local; audio.load(); setState('本地音频已就绪'); return; }
    // 本浏览器还没播过任何东西时，只把地址准备好（省流量）；播过一次之后进页面就真正开始缓冲
    const eager = !!S.used;
    if (track.audioOss) {
      stationLocal = null; stationNid = null;
      audio.setAttribute('data-tid', track.id);
      audio.src = track.audioOss;
      audio.load();
      setState(eager ? '音频缓冲中，点播放' : '音频已就绪，点播放');
      return;
    }
    if (!nid) { setState('还没绑定音频（可展开下方「音频来源与设置」）'); return; }
    const attach = (url) => {
      stationNid = nid; stationLocal = null;
      audio.setAttribute('data-tid', track.id);
      audio.src = url;
      audio.load();
      setState(eager ? '音频缓冲中，点播放' : '音频已就绪，点播放');
    };
    const hit = urlCache.get(String(nid));
    if (hit && Date.now() - hit.at < URL_TTL) {
      if (eager) attach(hit.url); else setState('音频已就绪，点播放');
      return;
    }
    setState('正在准备音频…');
    try {
      const url = await stationUrlFor(track);
      if (my !== prepToken || !url) return;
      if (eager) attach(url); else setState('音频已就绪，点播放');
    } catch (e) {
      if (my === prepToken) setState('取音频地址失败：' + e.message);
    }
  }

  function setNow(t) { const el = $('p-now'); if (el) el.textContent = t; }
  function setState(t) { const el = $('p-state'); if (el) el.textContent = t || ''; }
  function setLoad(on, text) {
    const b = $('p-play');
    if (on) {
      $('player').classList.add('loading');
      if (text) setState(text);
      if (b) b.textContent = '⋯';
    } else {
      $('player').classList.remove('loading');
      if (b) b.textContent = audio.paused ? '▶' : '❚❚';
    }
  }
  function jump(t) {
    if (t == null || !isFinite(t)) return;
    if (audio.readyState >= 1) { try { audio.currentTime = t; } catch {} }
    else seekTime = t;
  }
  function applySeek() {
    if (seekTime == null || audio.readyState < 1) return;
    const t = seekTime; seekTime = null;
    try { audio.currentTime = t; } catch {}
  }
  function bufferedAhead(t) {
    try {
      for (let i = 0; i < audio.buffered.length; i++) {
        if (t >= audio.buffered.start(i) - 0.2 && t <= audio.buffered.end(i) + 0.2) return audio.buffered.end(i) - t;
      }
    } catch {}
    return 0;
  }
  function bindAudioEvents() {
    audio.addEventListener('waiting', () => setLoad(true, '缓冲中…'));
    audio.addEventListener('stalled', () => setLoad(true, '缓冲中…'));
    audio.addEventListener('canplay', () => { applySeek(); setLoad(false); });
    audio.addEventListener('loadedmetadata', applySeek);
    audio.addEventListener('loadeddata', applySeek);
    audio.addEventListener('seeked', () => setLoad(false));
    audio.addEventListener('playing', () => { setLoad(false); $('player').classList.add('on'); });
    audio.addEventListener('play', () => { $('p-play').textContent = '❚❚'; });
    audio.addEventListener('pause', () => { $('p-play').textContent = '▶'; });
    audio.addEventListener('error', () => {
      if (stationNid) urlCache.delete(String(stationNid));
      setLoad(false);
      setState('音频加载失败，点播放重试（会自动换新地址）');
    });
  }
  async function playTrack(track, opts = {}) {
    if (!track) return;
    const nid = (S.audio[track.id] && S.audio[track.id].nid) || (track.audio && track.audio.nid) || null;
    const sameTrack = audio.getAttribute('data-tid') === track.id;
    if (!sameTrack) {
      let local = S.local[track.id];
      if (!local) { try { const blob = await idbGet(track.id); if (blob) local = URL.createObjectURL(blob); } catch {} }
      audio.pause();
      stationNid = null; stationLocal = null; seekTime = null; lastErr = null;
      audio.setAttribute('data-tid', track.id);
      setLoad(true, '正在取音频地址…');
      try {
        if (local) { stationLocal = local; audio.src = local; }
        else {
          const url = await stationUrlFor(track);
          if (!url) { setLoad(false); setState('这首还没绑定音频，页面下方「音频来源与设置」可以粘网易云链接'); return; }
          stationNid = nid; audio.src = url;
        }
        wantPlay = true;
      } catch (e) { lastErr = e; setLoad(false); setState('取地址失败：' + e.message); return; }
    }
    audio.playbackRate = Number(S.rate || 1);
    S.used = 1; save();
    if (opts.at != null) jump(opts.at);
    try { await audio.play(); } catch { /* 还没就绪，等 canplay */ }
    $('player').classList.add('on');
  }

  // ---------- 单句循环 ----------
  function lineEndTime(i) {
    const next = curLines[i + 1];
    return next && next.t != null ? next.t : null;
  }
  function setLoop(i) {
    loopLine = i;
    const btn = $('p-loop');
    if (btn) {
      btn.textContent = i == null ? '循环 关' : '循环 开';
      btn.classList.toggle('on', i != null);
    }
    highlight(true);
    if (i == null || !curLines[i]) return;
    const t = curLines[i].t;
    if (t == null) { setState('这句没有时间轴，只能手动拖进度条'); return; }
    jump(t);
    if (audio.paused) audio.play().catch(() => {});
  }
  function highlight(doScroll) {
    document.querySelectorAll('#lyric .lblock').forEach((el) => {
      el.classList.toggle('playing', el.dataset.i != null && Number(el.dataset.i) === loopLine);
    });
    const el = document.querySelector('#lyric .lblock.playing');
    if (!el || !doScroll) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < 80 || r.bottom > vh - 110) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    const el = audio;
    if (el && typeof el.currentTime === 'number' && el.duration > 0) {
      const t = el.currentTime;
      $('p-seek').value = String(Math.round((t / el.duration) * 1000));
      $('p-time').textContent = fmtTime(t);
      $('p-dur').textContent = fmtTime(el.duration);
      if (audio.paused) setLoad(false);
      else if (bufferedAhead(t) < 0.25 && !audio.seeking) setLoad(true, '缓冲中…');
      else setLoad(false);
    }
    if (loopLine == null || !curLines[loopLine]) return;
    const start = curLines[loopLine].t;
    if (start == null) return;
    const end = lineEndTime(loopLine);
    const now = el ? el.currentTime : 0;
    if (end != null) { if (now >= end - 0.06 || now < start - 0.4) el.currentTime = start; }
    else if (now < start - 0.4) el.currentTime = start;
  }
  function step(dir) {
    if (!curLines.length) return;
    const textLines = curLines.map((l, i) => ({ l, i })).filter((x) => x.l.text.trim() && x.l.t != null);
    if (!textLines.length) return;
    const cur = loopLine == null ? -1 : loopLine;
    let pos = textLines.findIndex((x) => x.i === cur);
    if (pos < 0) pos = dir > 0 ? -1 : textLines.length;
    let next = pos + dir;
    if (next < 0) next = textLines.length - 1;
    if (next >= textLines.length) next = 0;
    setLoop(textLines[next].i);
  }

  // ---------- 词条弹层 ----------
  let popWord = null, popFallback = null;
  function showPop(w, fallbackText) {
    popFallback = fallbackText || null;
    if (!w) {
      $('p-word').textContent = fallbackText || '';
      $('p-reading').textContent = ''; $('p-romaji').textContent = '';
      $('p-meaning').textContent = '这个词不在词表里（助词/活用碎片），先听个音吧';
      $('p-ex').textContent = ''; $('p-meta').textContent = '';
      $('p-known').style.display = 'none'; $('p-detail').style.display = 'none';
      $('pop').classList.add('on');
      return;
    }
    popWord = w;
    $('p-known').style.display = ''; $('p-detail').style.display = '';
    $('p-word').textContent = w.word;
    $('p-reading').textContent = w.reading ? '（' + w.reading + '）' : '';
    $('p-romaji').textContent = w.romaji || '';
    const myMean = (S.notes[w.id] && S.notes[w.id].meaning) || w.meaning;
    $('p-meaning').textContent = myMean ? myMean : '（这个词还没有释义，点「改释义」自己写一个）';
    const ex = (w.examples || [])[0];
    $('p-ex').textContent = ex ? `例句（${ex.track}）：${ex.jp}${ex.zh ? '　→　' + ex.zh : ''}` : '';
    const bits = [POSNAME[posKindOfWord(w)] || w.pos, brLabel(w) || (w.jl ? `JLPT N${w.jl}` : '标日未收录'), `全库 ${w.tracks.length} 首 / ${w.count} 次`];
    $('p-meta').textContent = bits.filter(Boolean).join(' · ');
    $('p-known').textContent = isKnown(w) ? '取消已掌握' : '标为已掌握';
    $('pop').classList.add('on');
  }
  const hidePop = () => $('pop').classList.remove('on');
  const posKindOfWord = (w) => ({ '名詞': 'n', '動詞': 'v', '形容詞': 'a', '副詞': 'adv' }[w.pos] || 'oth');
  function brLabel(v) { return v && v.br ? `标日${v.br.bk} 第${v.br.l}课` : ''; }
  function linesOfWord(w) {
    if (!curTrack || !w) return [];
    return curTrack.lines.filter((l) => (l.segs || []).some((s) => s.w && s.b === w.word));
  }

  // ---------- 难度与筛选 ----------
  function rangeOk(v, r) {
    if (!r || r === 'all') return true;
    if (r === 'c1') return !!v.br && v.br.c <= 24;
    if (r === 'c2') return !!v.br && v.br.c > 24 && v.br.c <= 48;
    if (r === 'c3') return !!v.br && v.br.c > 48;
    if (r === 'out') return !v.br;
    if (r === 'n45') return v.jl >= 4;
    if (r === 'n123') return !!v.jl && v.jl <= 3;
    return true;
  }
  function sortDeck(list) {
    const s = S.dSort || 'easy';
    if (s === 'freq') return [...list].sort((a, b) => b.count - a.count || b.tracks.length - a.tracks.length || a.diff - b.diff);
    if (s === 'az') return [...list].sort((a, b) => a.reading.localeCompare(b.reading, 'ja') || a.word.localeCompare(b.word, 'ja'));
    return [...list].sort((a, b) => a.diff - b.diff || a.id - b.id);
  }
  function deckList() {
    const r = S.dRange || 'all', p = S.dPos || 'all';
    let list = VOCAB.filter((v) => rangeOk(v, r) && (p === 'all' || v.pos === p));
    if (S.hideKnown !== false) list = list.filter((v) => !isKnown(v));
    return sortDeck(list);
  }
  function diffText(v) {
    if (v.br) return `难度：标日${v.br.bk}第${v.br.l}课（第${v.br.c}/80 课）`;
    if (v.jl) return `难度：JLPT N${v.jl}（标日未收录）`;
    return '难度：标日与 JLPT 均未收录，按曲库常见度排';
  }

  // ---------- 视图切换（hash 路由） ----------
  const VIEWS = ['view-learn', 'view-songs', 'view-mine', 'view-word', 'view-track', 'view-search'];
  let deckCount = 30, lastNonSearch = '#/learn';
  function show(which) {
    VIEWS.forEach((v) => { const el = $(v); if (el) el.style.display = v === which ? '' : 'none'; });
    const tabOf = { 'view-learn': 'tab-learn', 'view-songs': 'tab-songs', 'view-mine': 'tab-mine' };
    ['tab-learn', 'tab-songs', 'tab-mine'].forEach((t) => $(t).classList.toggle('on', tabOf[which] === t));
    window.scrollTo(0, 0);
  }
  const go = (hash) => { location.hash = hash; };
  function goBackView() {
    if (history.length > 1) history.back(); else go('#/learn');
  }
  function goWord(id) { go('#/word/' + id); }
  function goTrack(id, li) { go('#/track/' + id + (li != null ? '@' + li : '')); }
  function route() {
    const raw = decodeURIComponent(String(location.hash || '').replace(/^#\/?/, ''));
    const [pathPart, atPart] = raw.split('@');
    const parts = pathPart.split('/');
    const view = parts[0] || 'learn';
    if (view !== 'search') lastNonSearch = '#/' + pathPart;
    if (view === 'word' && parts[1]) return showWord(Number(parts[1]));
    if (view === 'track' && parts[1]) return openTrack(parts[1], atPart != null && atPart !== '' ? Number(atPart) : null);
    if (view === 'search') return showSearch(parts.slice(1).join('/'));
    if (view === 'songs') { show('view-songs'); return renderList(); }
    if (view === 'mine') { show('view-mine'); return renderMine(); }
    show('view-learn'); renderDeck();
  }

  // ---------- 学词（词汇入手） ----------
  function renderDeck() {
    const list = deckList();
    const knownN = VOCAB.filter(isKnown).length;
    $('deck-sub').textContent = `已掌握 ${knownN}/${VOCAB.length} 词 · 这一批还有 ${list.length} 个没掌握`;
    const showN = Math.min(deckCount, list.length);
    if (!list.length) {
      $('deck').innerHTML = '<div class="empty">这个范围里的词都掌握了。换个范围，或点「重置本页进度」。</div>';
      $('d-more').style.display = 'none';
      return;
    }
    $('deck').innerHTML = list.slice(0, showN).map(wordRow).join('');
    $('d-more').style.display = list.length > showN ? '' : 'none';
    $('d-more').textContent = `再看 30 个（还有 ${list.length - showN}）→`;
    $('deck').querySelectorAll('.word').forEach((el) => {
      const v = VBYID.get(Number(el.dataset.id));
      el.onclick = (e) => {
        if (e.target.closest('.kn')) return;
        if (e.target.closest('.spk')) { speak(v.word); return; }
        goWord(v.id);
      };
    });
    $('deck').querySelectorAll('.spk').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); speak(VBYID.get(Number(el.dataset.id)).word); }));
    $('deck').querySelectorAll('.kn').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation();
      const v = VBYID.get(Number(el.dataset.id));
      if (S.known[v.id]) delete S.known[v.id]; else S.known[v.id] = 1;
      save(); renderDeck();
    }));
  }
  function wordRow(v) {
    const mean = meaningOf(v) || '（还没有释义）';
    const badges = [`<span class="badge p${posKindOfWord(v)}">${POSNAME[posKindOfWord(v)]}</span>`];
    if (v.br) badges.push(`<span class="badge br">标日${v.br.bk} 第${v.br.l}课</span>`);
    else if (v.jl) badges.push(`<span class="badge jl">N${v.jl}</span>`);
    else badges.push('<span class="badge">标日未收录</span>');
    badges.push(`<span class="badge">${v.tracks.length} 首歌出现 ${v.count} 次</span>`);
    return `<div class="card word${isKnown(v) ? ' known' : ''}" data-id="${v.id}">
      <div class="wl">
        <div class="ww">${esc(v.word)}<span class="wr">${esc(v.reading)}</span><span class="wy">${esc(v.romaji)}</span></div>
        <div class="wm">${esc(mean)}</div>
        <div class="wb">${badges.join('')}</div>
      </div>
      <div class="acts">
        <button class="btn sm spk" data-id="${v.id}" title="读这个词">读</button>
        <button class="btn sm kn" data-id="${v.id}">${isKnown(v) ? '已掌握' : '掌握'}</button>
      </div>
    </div>`;
  }

  // ---------- 词条详情 ----------
  function showWord(id) {
    const v = VBYID.get(id);
    if (!v) { show('view-learn'); return; }
    show('view-word');
    const order = deckList();
    const idx = order.findIndex((x) => x.id === v.id);
    const prev = idx > 0 ? order[idx - 1] : null;
    const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    const forms = Object.entries(v.forms || {}).filter(([f]) => f !== v.word).slice(0, 8);
    const exs = (v.examples || []).slice(0, 6);
    const tracks = (v.tracks || []).map((tid) => trackById.get(tid)).filter(Boolean).slice(0, 12);
    $('view-word').innerHTML = `
      <div class="toolbar">
        <button class="btn" id="w-back">← 返回</button>
        ${prev ? `<button class="btn" id="w-prev">← ${esc(prev.word)}</button>` : ''}
        ${next ? `<button class="btn" id="w-next">${esc(next.word)} →</button>` : ''}
      </div>
      <div class="card" style="padding:14px">
        <div class="wbig">${esc(v.word)}</div>
        <div class="wmeta">${esc(v.reading)} · ${esc(v.romaji)} · ${POSNAME[posKindOfWord(v)]}</div>
        <div class="wmeta">${esc(diffText(v))} · 出现 ${v.tracks.length} 首歌 / ${v.count} 次${v.brZh ? ' · 教材释义：' + esc(v.brZh) : ''}</div>
        <div style="margin-top:10px;font-size:16px;color:#f0e6d8" id="w-mean">${esc(meaningOf(v) || '（还没有释义）')}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn sm" id="w-speak">读 读这个词</button>
          <button class="btn sm ${isKnown(v) ? 'on' : ''}" id="w-known">${isKnown(v) ? '已掌握' : '标为已掌握'}</button>
          <button class="btn sm" id="w-edit">改释义</button>
        </div>
        <div class="row" id="w-editrow" style="display:none">
          <input class="q" id="w-editinput" style="flex:1;min-width:160px;margin:0" value="${esc(meaningOf(v))}" placeholder="写你自己的释义，回车保存">
          <button class="btn sm" id="w-save">保存</button>
        </div>
      </div>
      ${forms.length ? `<div class="sec">歌词里出现过的形态</div><div class="card" style="padding:10px">${forms.map(([f, o]) => `<span class="chip">${esc(f)}${o.readingHira ? '（' + esc(o.readingHira) + '）' : ''}</span>`).join('')}</div>` : ''}
      <div class="sec">它出现在这些句子里（点「去这句」直接进歌里循环）</div>
      ${exs.length ? exs.map((ex, i) => `<div class="card ex">
          <div class="ej">${esc(ex.jp)}</div>
          ${ex.zh ? `<div class="ez">${esc(ex.zh)}</div>` : ''}
          <div class="et"><span>${esc(ex.track || '')}</span>
          ${ex.tid ? `<button class="btn sm" data-go="${ex.tid}@${ex.li}">去这句 ▶</button>` : ''}</div>
        </div>`).join('') : '<div class="empty">词表里没给这个词配例句</div>'}
      <div class="sec">出现在这些曲目</div>
      <div class="card" style="padding:10px">${tracks.map((t) => `<span class="chip" data-track="${t.id}">${esc(t.title)}</span>`).join('') || '<span class="hint">—</span>'}</div>
    `;
    $('w-back').onclick = goBackView;
    if (prev) $('w-prev').onclick = () => goWord(prev.id);
    if (next) $('w-next').onclick = () => goWord(next.id);
    $('w-speak').onclick = () => speak(v.word);
    $('w-known').onclick = () => { if (S.known[v.id]) delete S.known[v.id]; else S.known[v.id] = 1; save(); showWord(v.id); };
    $('w-edit').onclick = () => { const r = $('w-editrow'); r.style.display = r.style.display === 'none' ? 'flex' : 'none'; $('w-editinput').focus(); };
    const doSave = () => {
      const val = $('w-editinput').value.trim();
      S.notes[v.id] = Object.assign({}, S.notes[v.id], { meaning: val });
      save(); showWord(v.id);
    };
    $('w-save').onclick = doSave;
    $('w-editinput').onkeydown = (e) => { if (e.key === 'Enter') doSave(); };
    $('view-word').querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => {
      const [tid, li] = el.dataset.go.split('@');
      goTrack(tid, Number(li));
    }));
    $('view-word').querySelectorAll('[data-track]').forEach((el) => (el.onclick = () => goTrack(el.dataset.track, null)));
  }

  // ---------- 检索 ----------
  const hayOfTrack = new Map();
  function trackHay(t) { return t.title + ' ' + t.artist + ' ' + t.album + ' ' + t.base; }
  function searchAll(q) {
    const nq = norm(q);
    const words = VOCAB.filter((v) => {
      if (v.word === q || v.reading === q) return true;
      const forms = Object.keys(v.forms || {}).join(' ');
      return norm(v.word + ' ' + v.reading + ' ' + v.romaji + ' ' + (v.meaning || '') + ' ' + (S.notes[v.id] && S.notes[v.id].meaning || '') + ' ' + forms).includes(nq);
    }).map((v) => {
      const forms = Object.keys(v.forms || {});
      // 精确命中（词形/读音/释义开头）排前面
      const score = (v.word === q ? 0 : v.reading === q ? 1 : forms.includes(q) ? 2 : (norm(v.word).startsWith(nq) ? 3 : (v.meaning || '').startsWith(q) ? 4 : 5));
      return { v, score };
    }).sort((a, b) => a.score - b.score || a.v.diff - b.v.diff).slice(0, 40).map((x) => x.v);
    const tracks = IDX.tracks.filter((t) => norm(trackHay(t)).includes(nq));
    const originals = IDX.originals.filter((o) => norm(o.name).includes(nq)).slice(0, 12);
    return { words, tracks, originals };
  }
  function showSearch(q) {
    show('view-search');
    if ($('q').value !== q) $('q').value = q;
    if (!q.trim()) { show('view-learn'); renderDeck(); return; }
    const r = searchAll(q.trim());
    const parts = [];
    parts.push(`<div class="sec">词 ${r.words.length ? '· ' + r.words.length + ' 个' : '· 没有匹配'}</div>`);
    parts.push(r.words.length ? r.words.map(wordRow).join('') : '<div class="card empty">没有匹配的词</div>');
    parts.push(`<div class="sec">曲目 · ${r.tracks.length} 首</div>`);
    parts.push(r.tracks.length ? r.tracks.map(trackCard).join('') : '<div class="card empty">没有匹配的曲目</div>');
    if (r.originals.length) {
      parts.push('<div class="sec">原曲</div>');
      parts.push(`<div class="card" style="padding:10px">${r.originals.map((o) => `<span class="chip" data-base="${esc(o.name)}">${esc(o.name)} · ${o.tracks.length} 版</span>`).join('')}</div>`);
    }
    $('view-search').innerHTML = `<div class="row"><button class="btn sm" id="s-clear">× 清空搜索</button></div>` + parts.join('');
    $('s-clear').onclick = () => { $('q').value = ''; go(lastNonSearch); };
    wireWordRows($('view-search'));
    $('view-search').querySelectorAll('.track').forEach((el) => (el.onclick = () => goTrack(el.dataset.id, null)));
    $('view-search').querySelectorAll('[data-base]').forEach((el) => (el.onclick = () => { $('q').value = el.dataset.base; go('#/search/' + encodeURIComponent(el.dataset.base)); }));
  }
  function wireWordRows(root) {
    root.querySelectorAll('.word').forEach((el) => {
      const v = VBYID.get(Number(el.dataset.id));
      el.onclick = (e) => {
        if (e.target.closest('.kn')) return;
        if (e.target.closest('.spk')) { speak(v.word); return; }
        goWord(v.id);
      };
    });
    root.querySelectorAll('.spk').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); speak(VBYID.get(Number(el.dataset.id)).word); }));
    root.querySelectorAll('.kn').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation();
      const v = VBYID.get(Number(el.dataset.id));
      if (S.known[v.id]) delete S.known[v.id]; else S.known[v.id] = 1;
      save(); renderDeck(); renderMine();
      el.textContent = isKnown(v) ? '已掌握' : '掌握';
      el.closest('.word').classList.toggle('known', isKnown(v));
    }));
  }

  // ---------- 曲库列表 ----------
  let filter = 'all';
  function trackCard(t) {
    const tags = [];
    if (t.audio || S.audio[t.id] || S.local[t.id]) tags.push('<span class="tag a">音频</span>');
    if (t.timing) tags.push('<span class="tag t">时间轴</span>');
    if (t.lines.some((l) => l.zh)) tags.push('<span class="tag z">中文</span>');
    const brN = (t.vocabIds || []).filter((i) => VBYID.get(i) && VBYID.get(i).br).length;
    if (brN) tags.push(`<span class="tag z">标日词 ${brN}</span>`);
    return `<div class="card track" data-id="${t.id}">
      ${t.coverFile ? `<img loading="lazy" src="data/${t.coverFile}" alt="">` : '<img alt="">'}
      <div class="tm"><div class="tt">${esc(t.title)}${tags.join('')}</div>
      <div class="ts">${esc(t.artist)} · ${esc(t.album)} · ${t.lineCount} 行 · ${(t.vocabIds || []).length} 词</div></div>
    </div>`;
  }
  function renderList() {
    const list = IDX.tracks.filter((t) => {
      if (filter === 'audio' && !(t.audio || S.audio[t.id] || S.local[t.id])) return false;
      if (filter === 'zh' && !t.lines.some((l) => l.zh)) return false;
      if (filter === 'known') {
        const known = (t.vocabIds || []).filter((id) => S.known[id]).length;
        if (t.vocabIds && t.vocabIds.length && known / t.vocabIds.length > 0.8) return false;
      }
      return true;
    });
    const groups = new Map();
    for (const t of list) { if (!groups.has(t.base)) groups.set(t.base, []); groups.get(t.base).push(t); }
    const keys = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length);
    let html = '';
    if (!list.length) html = '<div class="empty">没有匹配的曲目</div>';
    for (const k of keys) {
      const arr = groups.get(k);
      if (k) html += `<div class="grouphead">原曲：${esc(k)} · ${arr.length} 个版本</div>`;
      for (const t of arr) html += trackCard(t);
    }
    $('list').innerHTML = html;
    $('list').querySelectorAll('.track').forEach((el) => (el.onclick = () => goTrack(el.dataset.id, null)));
  }

  // ---------- 生词本 ----------
  function renderMine() {
    show('view-mine');
    const knownList = VOCAB.filter(isKnown);
    const noted = VOCAB.filter((v) => S.notes[v.id] && S.notes[v.id].meaning);
    $('view-mine').innerHTML = `
      <div class="sec">已掌握 ${knownList.length} 词 · 自己改过释义 ${noted.length} 词（都存在本机浏览器里）</div>
      <div class="card" style="padding:10px">
        ${knownList.length ? knownList.map((v) => `<span class="chip" data-w="${v.id}">${esc(v.word)} · ${esc(v.reading)}</span>`).join('') : '<span class="hint">还没标过任何词。在学词页点「掌握」即可。</span>'}
      </div>
      <div class="sec">我的释义</div>
      <div class="card" style="padding:10px">
        ${noted.length ? noted.map((v) => `<div style="font-size:13px;margin:4px 0"><b>${esc(v.word)}</b>：${esc(S.notes[v.id].meaning)}</div>`).join('') : '<span class="hint">还没有改过释义。词条页点「改释义」。</span>'}
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn" id="m-export">导出进度</button>
        <button class="btn" id="m-import">导入进度</button>
        <button class="btn" id="m-clear">清空全部进度</button>
      </div>
      <div class="hint">导出的是 JSON（已掌握的词、你自己写的释义、音频绑定），换设备时导入即可。</div>
    `;
    $('view-mine').querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => goWord(Number(el.dataset.w))));
    $('m-export').onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'thlyrics-progress.json';
      document.body.appendChild(a); a.click(); a.remove();
    };
    $('m-import').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const o = JSON.parse(String(fr.result));
            S = Object.assign({ known: {}, notes: {}, audio: {}, local: {}, rate: 1 }, o);
            save(); renderMine(); renderDeck();
            alert('导入成功');
          } catch { alert('这个文件读不了'); }
        };
        fr.readAsText(f);
      };
      inp.click();
    };
    $('m-clear').onclick = () => {
      if (!confirm('清空本机保存的全部学习进度？（不可恢复）')) return;
      S.known = {}; S.notes = {};
      save(); renderMine(); renderDeck();
    };
  }

  // ---------- 单曲页 ----------
  let twFilter = 'all';                    // 单曲词汇列表的筛选状态
  function trackWordList(t) {
    const cnt = new Map();
    for (const l of t.lines) for (const sg of l.segs || []) if (sg.w && sg.b) cnt.set(sg.b, (cnt.get(sg.b) || 0) + 1);
    const list = [];
    for (const [w, n] of cnt) { const v = VBY.get(w); if (v) list.push({ v, n }); }
    // 排序：标日课次在前，其次难度/常见度；标日没收录的排后面
    list.sort((a, b) => (a.v.br ? a.v.br.c : 999) - (b.v.br ? b.v.br.c : 999) || a.v.diff - b.v.diff || a.v.id - b.v.id);
    return list;
  }
  function firstLineOf(v) {
    if (!curTrack) return -1;
    return curTrack.lines.findIndex((l) => (l.segs || []).some((sg) => sg.w && sg.b === v.word));
  }
  function renderTrackWords() {
    const host = $('twlist');
    if (!host || !curTrack) return;
    const all = trackWordList(curTrack);
    let list = all;
    if (twFilter === 'br') list = all.filter((x) => x.v.br);
    else if (twFilter === 'out') list = all.filter((x) => !x.v.br);
    else if (twFilter !== 'all') list = all.filter((x) => x.v.pos === twFilter);
    const head = $('twhead');
    if (head) head.textContent = `这首歌的词汇（${list.length}/${all.length} 个 · 按标日课次+难度排）`;
    host.innerHTML = list.length ? list.map(({ v, n }) => {
      const b = [`<span class="badge p${posKindOfWord(v)}">${POSNAME[posKindOfWord(v)]}</span>`];
      if (v.br) b.push(`<span class="badge br">标日${v.br.bk} 第${v.br.l}课</span>`);
      else if (v.jl) b.push(`<span class="badge jl">N${v.jl}</span>`);
      b.push(`<span class="badge">本曲 ${n} 次</span>`);
      const li = firstLineOf(v);
      return `<div class="card word${isKnown(v) ? ' known' : ''}" data-id="${v.id}">
        <div class="wl">
          <div class="ww">${esc(v.word)}<span class="wr">${esc(v.reading)}</span><span class="wy">${esc(v.romaji)}</span></div>
          <div class="wm">${esc(meaningOf(v) || '（还没释义）')}</div>
          <div class="wb">${b.join('')}</div>
        </div>
        <div class="acts">
          <button class="btn sm tw-spk" data-id="${v.id}">读</button>
          ${li >= 0 ? `<button class="btn sm tw-go" data-i="${li}">去这句</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<div class="empty">这个筛选下没有词</div>';
    host.querySelectorAll('.tw-spk').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); speak(VBYID.get(Number(el.dataset.id)).word); }));
    host.querySelectorAll('.tw-go').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation();
      const i = Number(el.dataset.i);
      if (!Number.isFinite(i) || i < 0) return;
      if (audio.paused) audio.play().catch(() => {});
      setLoop(i);
    }));
    host.querySelectorAll('.word').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('.tw-spk') || e.target.closest('.tw-go')) return;
      goWord(Number(el.dataset.id));
    }));
  }

  function openTrack(id, atIdx) {
    const t = trackById.get(id);
    if (!t) { show('view-learn'); return; }
    curTrack = t; curLines = t.lines; loopLine = null;
    audio.pause();
    show('view-track');
    const zhCount = t.lines.filter((l) => l.zh).length;
    const knownCount = (t.vocabIds || []).filter((i) => S.known[i]).length;
    const twAll = trackWordList(t);
    const twBr = twAll.filter((x) => x.v.br).length;
    $('view-track').innerHTML = `
      <div class="toolbar">
        <button class="btn" id="b-back">← 返回</button>
        <button class="btn ${S.romaji === false ? '' : 'on'}" id="b-romaji">罗马音</button>
        <button class="btn ${S.zh === false ? '' : 'on'}" id="b-zh">中文</button>
        <button class="btn ${S.gloss === false ? '' : 'on'}" id="b-gloss">词义</button>
      </div>
      <div class="card lyrtop">
        ${t.coverFile ? `<img src="data/${t.coverFile}" alt="">` : ''}
        <div><h2>${esc(t.title)}</h2>
        <div class="m">${esc(t.artist)} · ${esc(t.album)}</div>
        <div class="m">原曲：${esc(t.base)} · ${t.lineCount} 行${zhCount ? ` · 中文 ${zhCount} 行` : ''} · 已掌握词 ${knownCount}/${(t.vocabIds || []).length}</div>
        ${t.source ? `<div class="m"><a href="${t.source}" target="_blank" rel="noreferrer">THBWiki 词条</a></div>` : ''}</div>
      </div>

      <div class="card" style="padding:10px">
        <div class="row" style="justify-content:space-between;margin:0 0 6px">
          <b style="font-size:13.5px" id="twhead">这首歌的词汇</b>
          <span class="meta" style="font-size:11px;color:var(--muted)">${twBr ? `标日收录 ${twBr} 个` : '标日未收录'}</span>
        </div>
        <div class="row" style="margin:0 0 6px" id="twchips">
          <button class="chip on" data-f="all">全部</button>
          <button class="chip" data-f="br">标日收录</button>
          <button class="chip" data-f="out">标日未收录</button>
          <button class="chip" data-f="名詞">名词</button>
          <button class="chip" data-f="動詞">动词</button>
          <button class="chip" data-f="形容詞">形容词</button>
          <button class="chip" data-f="副詞">副词</button>
        </div>
        <div id="twlist" class="twscroll"></div>
      </div>

      <div class="hint">底部 ▶ 播放整首 · 点句子 = 从这句开始单句循环 · 点词 = 看读音释义 · 词条行点「去这句」跳到它出现的那句</div>
      <div class="legend">
        <span><i class="k-n">■</i>名词</span><span><i class="k-v">■</i>动词</span><span><i class="k-a">■</i>形容词</span>
        <span><i class="k-na">■</i>形容动词</span><span><i class="k-adv">■</i>副词</span><span><i class="k-prt">■</i>助词/助动词</span>
      </div>
      <div class="card" id="lyric"></div>
    `;
    twFilter = 'all';
    renderTrackWords();
    $('twchips').querySelectorAll('.chip').forEach((el) => (el.onclick = () => {
      twFilter = el.dataset.f;
      $('twchips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === el));
      renderTrackWords();
    }));
    bindLyricClicks();
    drawLyric(t);
    $('b-back').onclick = goBackView;
    $('b-romaji').onclick = () => { S.romaji = S.romaji === false; save(); openTrack(id, loopLine); };
    $('b-zh').onclick = () => { S.zh = S.zh === false; save(); openTrack(id, loopLine); };
    $('b-gloss').onclick = () => { S.gloss = S.gloss === false; save(); document.body.classList.toggle('gloss', S.gloss !== false); openTrack(id, loopLine); };
    document.body.classList.toggle('gloss', S.gloss !== false);
    $('p-now').textContent = `${t.title} — ${t.artist}`;
    $('player').classList.add('on');
    $('srcinfo').textContent = describeSource(t);
    $('nidinput').value = (S.audio[t.id] && S.audio[t.id].nid) || (t.audio && t.audio.nid) || '';
    if (!raf) raf = requestAnimationFrame(frame);
    // 进页面就把音频地址取好、开始缓冲：点播放才不用等
    prepTrackAudio(t);
    if (atIdx != null && Number.isFinite(atIdx)) {
      playTrack(t).then(() => setLoop(atIdx));
    }
  }
  function describeSource(t) {
    if (S.local[t.id]) return '当前用本地音频文件（只存在这个浏览器里）';
    if (t.audioOss) return `当前音频：自建对象存储（${t.audioOssKey || 'OSS'}，固定直链，进页面就预缓冲）`;
    const s = S.audio[t.id] || t.audio;
    if (s && s.nid) return `当前音频：网易云 ${s.nid}${t.netease && t.netease.agreeRate != null ? `（歌词一致度 ${Math.round(t.netease.agreeRate * 100)}%）` : ''}`;
    return '这首还没有音频。可以在下面粘一个网易云链接。';
  }

  // 歌词点击：事件委托（每帧都会重绘，单独绑 onclick 会丢事件）
  function bindLyricClicks() {
    const host = $('lyric');
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.addEventListener('click', (e) => {
      const wEl = e.target.closest('.w');
      if (wEl) {
        const w = (wEl.dataset.w && VBY.get(wEl.dataset.w)) || SURF.get(wEl.dataset.s) || null;
        try { showPop(w, wEl.dataset.s); } catch (err) { /* 查词失败不能影响点行 */ }
        return;                                   // 点词 = 查词，绝不切循环行
      }
      const lineEl = e.target.closest('.lblock[data-i]');
      if (!lineEl) return;
      const i = Number(lineEl.dataset.i);
      if (!Number.isFinite(i)) return;
      setLoop(loopLine === i ? null : i);
    });
  }

  function drawLyric(t) {
    const host = $('lyric');
    host.innerHTML = '';
    t.lines.forEach((l, i) => {
      if (!l.text.trim()) { const sp = document.createElement('div'); sp.className = 'space'; host.appendChild(sp); return; }
      // 一句 = 一个块：原文 / 罗马音 / 中文 都在块里，视觉上绑死，不会串到别的句子
      const block = document.createElement('div');
      block.className = 'lblock';
      const div = document.createElement('div');
      div.className = 'line' + (l.jp ? '' : ' en');
      if (l.segs && l.segs.length) {
        for (const sg of l.segs) {
          if (!sg.s) continue;
          if (!sg.k) { div.appendChild(document.createTextNode(sg.s)); continue; }   // 空白等非分词
          const w = (sg.w && VBY.get(sg.b)) || SURF.get(sg.s) || null;
          const span = document.createElement('span');
          span.className = 'w k-' + sg.k + (w && isKnown(w) ? ' known' : '');
          span.dataset.s = sg.s;
          if (sg.w && sg.b) span.dataset.w = sg.b;
          span.appendChild(document.createTextNode(sg.s));
          const g = meaningOf(w);
          if (g && g.length <= 14) {
            const gi = document.createElement('i');
            gi.className = 'g';
            gi.textContent = g;
            span.appendChild(gi);
          }
          div.appendChild(span);
        }
      } else div.textContent = l.text;
      block.appendChild(div);
      if (S.romaji !== false && l.romaji && l.jp) {
        const r = document.createElement('div'); r.className = 'romaji'; r.textContent = l.romaji; block.appendChild(r);
      }
      if (l.zh && S.zh !== false) {
        const z = document.createElement('div'); z.className = 'zh'; z.textContent = l.zh;
        z.style.pointerEvents = 'none';
        block.appendChild(z);
      }
      block.dataset.i = String(i);
      host.appendChild(block);
    });
  }

  // ---------- 启动 ----------
  async function boot() {
    load();
    loadUrlCache();
    let data;
    try { data = await (await fetch('data/index.json')).json(); }
    catch { $('deck').innerHTML = '<div class="empty">载入 data/index.json 失败。本地打开请先起服务：<br>node scripts/serve.mjs 8848</div>'; return; }
    IDX = data;
    VOCAB = data.vocab;
    VBY = new Map(VOCAB.map((w) => [w.word, w]));
    VBYID = new Map(VOCAB.map((w) => [w.id, w]));
    for (const w of VOCAB) {
      SURF.set(w.word, w);
      for (const f of Object.keys(w.forms || {})) if (!SURF.has(f)) SURF.set(f, w);
    }
    trackById = new Map(data.tracks.map((t) => [t.id, t]));
    const s = data.stats || {};
    $('headstat').textContent = `${s.tracks} 首 · ${s.originals} 个原曲 · ${s.vocab} 词（标日 ${s.withBiaori || 0} · JLPT ${s.withJlpt || 0}） · 有音频 ${data.tracks.filter((t) => t.audio).length} 首`;
    $('genat').textContent = '数据生成于 ' + new Date(data.generatedAt).toLocaleString('zh-CN');
    document.body.classList.toggle('gloss', S.gloss !== false);

    // 学词页控件
    $('d-sort').value = S.dSort || 'easy';
    $('d-range').value = S.dRange || 'all';
    $('d-pos').value = S.dPos || 'all';
    $('d-hideknown').classList.toggle('on', S.hideKnown !== false);
    $('d-sort').onchange = (e) => { S.dSort = e.target.value; save(); renderDeck(); };
    $('d-range').onchange = (e) => { S.dRange = e.target.value; save(); deckCount = 30; renderDeck(); };
    $('d-pos').onchange = (e) => { S.dPos = e.target.value; save(); deckCount = 30; renderDeck(); };
    $('d-hideknown').onclick = (e) => { S.hideKnown = S.hideKnown === false; save(); e.target.classList.toggle('on', S.hideKnown !== false); renderDeck(); };
    $('d-more').onclick = () => { deckCount += 30; renderDeck(); };
    $('d-reset').onclick = () => { if (!confirm('把这一批词都标回「没掌握」？')) return; for (const v of deckList()) delete S.known[v.id]; save(); renderDeck(); };

    // 曲库过滤
    [['f-all', 'all'], ['f-audio', 'audio'], ['f-zh', 'zh'], ['f-known', 'known']].forEach(([id, key]) => {
      $(id).onclick = () => {
        filter = filter === key && key !== 'all' ? 'all' : key;
        ['f-all', 'f-audio', 'f-zh', 'f-known'].forEach((x) => $(x).classList.remove('on'));
        $({ all: 'f-all', audio: 'f-audio', zh: 'f-zh', known: 'f-known' }[filter]).classList.add('on');
        renderList();
      };
    });

    // 导航
    $('tab-learn').onclick = () => go('#/learn');
    $('tab-songs').onclick = () => go('#/songs');
    $('tab-mine').onclick = () => go('#/mine');
    let qt = null;
    $('q').oninput = (e) => {
      clearTimeout(qt);
      const v = e.target.value;
      qt = setTimeout(() => {
        if (v.trim()) {
          history.replaceState(null, '', '#/search/' + encodeURIComponent(v.trim()));
          showSearch(v.trim());
        } else if (location.hash.startsWith('#/search')) go(lastNonSearch);
      }, 160);
    };
    $('q').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = $('q').value.trim(); if (v) go('#/search/' + encodeURIComponent(v)); } };

    // 播放条
    bindAudioEvents();
    $('p-play').onclick = () => {
      if (!audio.getAttribute('data-tid')) { if (curTrack) playTrack(curTrack); return; }
      if (audio.paused) {
        wantPlay = true;
        if (audio.error || audio.readyState === 0) { if (stationNid) urlCache.delete(String(stationNid)); playTrack(curTrack); }
        else audio.play().catch(() => {});
      } else { wantPlay = false; audio.pause(); }
    };
    $('p-seek').oninput = (e) => { if (!audio.duration) return; jump((Number(e.target.value) / 1000) * audio.duration); };
    $('p-loop').onclick = () => {
      if (loopLine != null) return setLoop(null);
      const first = curLines.findIndex((l) => l.text && l.t != null);
      setLoop(first >= 0 ? first : 0);
    };
    $('p-prev').onclick = () => step(-1);
    $('p-next').onclick = () => step(1);
    $('p-rate').onclick = () => {
      const rates = [1, 0.9, 0.8, 0.7, 0.6, 1.1];
      const i = rates.indexOf(Number(S.rate || 1));
      const r = rates[(i + 1) % rates.length];
      S.rate = r; save(); audio.playbackRate = r; $('p-rate').textContent = r.toFixed(1) + 'x';
      setState('语速 ' + r.toFixed(1) + 'x');
    };
    $('p-rate').textContent = Number(S.rate || 1).toFixed(1) + 'x';
    $('p-close').onclick = () => { wantPlay = false; audio.pause(); $('player').classList.remove('on'); };

    // 词条弹层
    $('p-speak').onclick = () => speak(popWord ? popWord.word : popFallback);
    $('p-close2').onclick = hidePop;
    $('p-detail').onclick = () => { if (popWord) { const id = popWord.id; hidePop(); goWord(id); } };
    $('p-edit').onclick = () => {
      if (!popWord) return;
      const row = $('p-editrow');
      row.style.display = row.style.display === 'none' ? 'flex' : 'none';
      $('p-editinput').value = (S.notes[popWord.id] && S.notes[popWord.id].meaning) || popWord.meaning || '';
      $('p-editinput').focus();
    };
    $('p-editinput').onkeydown = (e) => {
      if (e.key !== 'Enter' || !popWord) return;
      const val = e.target.value.trim();
      S.notes[popWord.id] = Object.assign({}, S.notes[popWord.id], { meaning: val });
      save(); showPop(popWord);
    };
    $('p-known').onclick = () => {
      if (!popWord) return;
      if (S.known[popWord.id]) delete S.known[popWord.id]; else S.known[popWord.id] = 1;
      save(); showPop(popWord); if (curTrack) drawLyric(curTrack);
    };
    $('p-lines').onclick = () => {
      if (!popWord) return;
      const ls = linesOfWord(popWord);
      $('p-meta').textContent = ls.length ? ls.slice(0, 4).map((l) => l.text).join(' ／ ') : '这首歌里没找到它';
    };
    document.addEventListener('click', (e) => { if (!e.target.closest('#pop') && !e.target.closest('.w')) hidePop(); });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); $('p-play').click(); }
      if (e.key === 'ArrowDown') step(1);
      if (e.key === 'ArrowUp') step(-1);
      if (e.key === 'l' || e.key === 'L') $('p-loop').click();
    });

    // 音频设置
    $('nidsave').onclick = () => {
      if (!curTrack) return;
      const raw = $('nidinput').value.trim();
      const m = raw.match(/(\d{3,})/);
      if (!m) { alert('没识别出歌曲 ID'); return; }
      S.audio[curTrack.id] = { nid: m[1] };
      if (S.local) delete S.local[curTrack.id];
      save(); $('srcinfo').textContent = describeSource(curTrack);
      setState('已绑定，点播放试试');
    };
    $('audiofile').onchange = (e) => {
      const f = e.target.files[0]; if (!f || !curTrack) return;
      if (f.size > 60 * 1024 * 1024) { alert('文件太大（建议 60MB 以内）'); return; }
      idbSet(curTrack.id, f).then(() => { delete S.local[curTrack.id]; save(); $('srcinfo').textContent = describeSource(curTrack); alert('本地音频已存在这个浏览器里'); })
        .catch(() => alert('保存失败（浏览器不允许存这么大的文件）'));
    };
    $('audioclear').onclick = async () => { if (!curTrack) return; delete S.local[curTrack.id]; save(); try { await idbDel(curTrack.id); } catch {} $('srcinfo').textContent = describeSource(curTrack); };

    window.addEventListener('hashchange', route);
    if (!location.hash) location.replace('#/learn');
    route();
  }

  boot();
})();
