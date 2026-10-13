/* 东方同人曲 学唱机 —— 前端（纯工具向：歌词 + 播放 + 单句循环 + 查词） */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'thlyrics.tool.v1';
  const IDB_NAME = 'thlyrics';

  // 本地音频文件用 IndexedDB 存（localStorage 只有 ~5MB，放不下音频）
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

  let IDX = null, VOCAB = [], VBY = new Map(), trackById = new Map();
  let S = { known: {}, notes: {}, audio: {}, local: {} };   // known 词id->1；audio 曲id->{nid}
  let curTrack = null;        // 当前曲目
  let curLines = [];          // 当前曲目的歌词行（带上 t/segments）
  let loopLine = null;        // 单句循环的行下标，null=不循环
  let raf = null;
  const audio = new Audio();
  audio.preload = 'auto';                       // 提前缓冲，点播放不用等
  audio.setAttribute('playsinline', '');
  audio.id = 'audio';
  const mountAudio = () => { if (document.body && !audio.isConnected) document.body.appendChild(audio); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAudio); else mountAudio();

  // ---------- 本地状态 ----------
  function load() {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch {}
    S.known = S.known || {}; S.notes = S.notes || {}; S.audio = S.audio || {}; S.local = S.local || {};
  }
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch {} };
  const isKnown = (w) => !!S.known[w.id];
  const fmtTime = (s) => (!s || !isFinite(s)) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- 语音朗读（词/句兜底） ----------
  let jaVoice = null;
  const pickVoice = () => { jaVoice = (speechSynthesis.getVoices() || []).find((v) => (v.lang || '').toLowerCase().startsWith('ja')) || null; };
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice; u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  // ---------- 音频：一次取地址、可复用、带状态 ----------
  // 事实（实测）：
  //   ① music-api 每次给的签名地址都不同，且会过期 -> 每首歌解析一次，缓存到播放结束/换歌为止，不要每点一次就重取
  //   ② 真正的音频源（m*.music.126.net）支持 Range（206），所以中途 seek 不会重下整首
  //   ③ 首字节很快、整首 10MB 需要几秒 -> 必须有「缓冲中」状态，否则用户以为卡死
  const urlCache = new Map();          // nid -> {url, at}
  const URL_TTL = 18 * 60 * 1000;      // 签名地址约 20 分钟过期，留点余量
  async function stationUrlFor(track) {
    const st = S.audio[track.id] || track.audio;
    if (!st || !st.nid) return null;
    const hit = urlCache.get(String(st.nid));
    if (hit && Date.now() - hit.at < URL_TTL) return hit.url;
    const res = await fetch(`${GD}?types=url&source=netease&id=${encodeURIComponent(st.nid)}&br=320`);
    const j = await res.json().catch(() => null);
    if (!j || !j.url) throw new Error('取不到音频地址');
    urlCache.set(String(st.nid), { url: j.url, at: Date.now() });
    return j.url;
  }

  let stationNid = null, stationLocal = null;
  let seekTime = null, wantPlay = false, lastErr = null, hideTimer = null;

  function setNow(t) { const el = $('p-now'); if (el) el.textContent = t; }
  function setLoad(on, text) {
    const b = $('p-play');
    if (on) {
      $('player').classList.add('loading');
      if (text) setNow(text);
      if (b) b.textContent = '⋯';
    } else {
      $('player').classList.remove('loading');
      if (b) b.textContent = audio.paused ? '▶' : '❚❚';
    }
  }
  function jump(t) {
    if (t == null || !isFinite(t)) return;
    if (audio.readyState >= 1) { try { audio.currentTime = t; } catch {} }
    else seekTime = t;                  // 还没就绪先记着
  }
  // 就绪后把待跳转的时间落地（之前这里漏了，导致"点了句子不动"）
  function applySeek() {
    if (seekTime == null || audio.readyState < 1) return;
    const t = seekTime;
    seekTime = null;
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
    audio.addEventListener('seeked', () => { setLoad(false); });
    audio.addEventListener('playing', () => { setLoad(false); $('player').classList.add('on'); });
    audio.addEventListener('play', () => { $('p-play').textContent = '❚❚'; });
    audio.addEventListener('pause', () => { $('p-play').textContent = '▶'; });
    audio.addEventListener('error', () => {
      // 地址过期/网络断：清掉缓存，下次重取
      if (stationNid) urlCache.delete(String(stationNid));
      setLoad(false);
      setNow('音频加载失败，点播放重试（会自动换新地址）');
    });
  }
  // 换歌：本地优先，其次网易云；同曲目重复调用直接跳位置，不再重取地址
  async function playTrack(track, opts = {}) {
    const localId = 'local:' + track.id;
    const nid = (S.audio[track.id] && S.audio[track.id].nid) || (track.audio && track.audio.nid) || null;
    const idNow = localId in S.local || await idbGet(track.id).catch(() => null) ? localId : nid;
    if (audio.getAttribute('data-tid') !== track.id || (idNow && idNow !== stationLocal && idNow !== stationNid)) {
      // 需要换源
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
          if (!url) { setLoad(false); setNow('这首还没绑定音频，展开页面下方「音频来源与设置」粘个网易云链接'); return; }
          stationNid = nid; audio.src = url;
        }
        wantPlay = true;
      } catch (e) { lastErr = e; setLoad(false); setNow('取地址失败：' + e.message); return; }
    }
    audio.playbackRate = Number(S.rate || 1);
    if (opts.at != null) jump(opts.at);
    // 让 UI 先响应，真正的播放交给事件驱动，避免点击卡住
    try { await audio.play(); } catch { /* 用户没交互/还在缓冲，等 canplay 自己播 */ }
    $('player').classList.add('on');
  }

  // ---------- 单句循环 ----------
  function lineEndTime(i) {
    const next = curLines[i + 1];
    return next && next.t != null ? next.t : null;
  }
  function setLoop(i) {
    loopLine = i;
    $('p-loop').textContent = i == null ? '单句循环 关' : '单句循环 开';
    $('p-loop').classList.toggle('on', i != null);
    highlight(true);
    if (i == null) return;
    const t = curLines[i].t;
    if (t == null) { setNow('这句没有时间轴，只能手动拖进度条'); return; }
    jump(t);
    if (audio.paused) audio.play().catch(() => {});
  }
  function highlight(doScroll) {
    // 行号用元素上的 data-i 判断（中文行也是 .line，DOM 序号会错位）
    document.querySelectorAll('#lyric .line').forEach((el) => {
      el.classList.toggle('playing', el.dataset.i != null && Number(el.dataset.i) === loopLine);
    });
    const el = document.querySelector('#lyric .line.playing');
    if (!el || !doScroll) return;                  // 只有用户主动切行才滚，循环回跳/播放不滚，页面才不晃
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < 80 || r.bottom > vh - 90) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // 时间驱动的进度/循环：读 audio.currentTime（不做插值，避免和真实播放错位）
  function frame() {
    raf = requestAnimationFrame(frame);
    const el = audio;
    if (el && typeof el.currentTime === 'number' && el.duration > 0) {
      const t = el.currentTime;
      $('p-seek').value = String(Math.round((t / el.duration) * 1000));
      $('p-time').textContent = fmtTime(t);
      if (audio.paused) setLoad(false);
      else if (bufferedAhead(t) < 0.25 && !audio.seeking) setLoad(true, '缓冲中…');
      else setLoad(false);
    }
    if (loopLine == null || !curLines[loopLine]) return;
    const start = curLines[loopLine].t;
    if (start == null) return;
    const end = lineEndTime(loopLine);
    const now = el ? el.currentTime : 0;
    if (end != null) {
      if (now >= end - 0.06 || now < start - 0.4) el.currentTime = start;
    } else if (now < start - 0.4) el.currentTime = start;
  }

  // ---------- 列表 ----------
  let filter = 'all';
  function renderList() {
    const f = $('q').value.trim().toLowerCase();
    let list = IDX.tracks.filter((t) => {
      if (filter === 'audio' && !(t.audio || S.audio[t.id] || S.local[t.id])) return false;
      if (filter === 'zh' && !t.lines.some((l) => l.zh)) return false;
      if (filter === 'known') {
        const known = (t.vocabIds || []).filter((id) => S.known[id]).length;
        if (t.vocabIds && t.vocabIds.length && known / t.vocabIds.length > 0.8) return false;
      }
      if (!f) return true;
      return (t.title + t.artist + t.album + t.base).toLowerCase().includes(f);
    });

    const groups = new Map();
    for (const t of list) { const k = f ? '' : t.base; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    const keys = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length);

    let html = '';
    if (!list.length) html = '<div class="empty">没有匹配的曲目</div>';
    for (const k of keys) {
      const arr = groups.get(k);
      if (k) html += `<div class="grouphead">原曲：${esc(k)} · ${arr.length} 个版本</div>`;
      for (const t of arr) {
        const tags = [];
        if (t.audio || S.audio[t.id] || S.local[t.id]) tags.push('<span class="tag a">音频</span>');
        if (t.timing) tags.push('<span class="tag t">时间轴</span>');
        if (t.lines.some((l) => l.zh)) tags.push('<span class="tag z">中文</span>');
        html += `<div class="card track" data-id="${t.id}">
          ${t.coverFile ? `<img loading="lazy" src="data/${t.coverFile}" alt="">` : '<img alt="">'}
          <div class="tm"><div class="tt">${esc(t.title)}${tags.join('')}</div>
          <div class="ts">${esc(t.artist)} · ${esc(t.album)} · ${t.lineCount} 行 · ${(t.vocabIds || []).length} 词</div></div>
        </div>`;
      }
    }
    $('list').innerHTML = html;
    $('list').querySelectorAll('.track').forEach((el) => (el.onclick = () => openTrack(el.dataset.id)));
  }

  // ---------- 单曲页 ----------
  function openTrack(id) {
    const t = trackById.get(id);
    if (!t) return;
    curTrack = t; curLines = t.lines; loopLine = null;
    audio.pause();
    $('view-list').style.display = 'none';
    $('view-track').style.display = 'block';
    const zhCount = t.lines.filter((l) => l.zh).length;
    const knownCount = (t.vocabIds || []).filter((i) => S.known[i]).length;
    $('view-track').innerHTML = `
      <div class="toolbar">
        <button class="btn" id="b-back">← 返回列表</button>
        <button class="btn primary" id="b-play">▶ 播放</button>
        <button class="btn" id="b-loop0">从这句开始循环</button>
        <button class="btn" id="b-romaji">${S.romaji === false ? '显示罗马音' : '隐藏罗马音'}</button>
        <button class="btn" id="b-zh">${S.zh === false ? '显示中文' : '隐藏中文'}</button>
      </div>
      <div class="card lyrtop">
        ${t.coverFile ? `<img src="data/${t.coverFile}" alt="">` : ''}
        <div><h2>${esc(t.title)}</h2>
        <div class="m">${esc(t.artist)} · ${esc(t.album)}</div>
        <div class="m">原曲：${esc(t.base)} · ${t.lineCount} 行${zhCount ? ` · 中文 ${zhCount} 行` : ''} · 已掌握词 ${knownCount}/${(t.vocabIds || []).length}</div>
        ${t.source ? `<div class="m"><a href="${t.source}" target="_blank" rel="noreferrer">THBWiki 词条</a></div>` : ''}</div>
      </div>
      <div class="hint">点句子 = 从这句开始单句循环 · 点词 = 看读音和释义 · 再点一次「单句循环」可关掉</div>
      <div class="card" id="lyric"></div>
    `;
    bindLyricClicks();
    drawLyric(t);
    $('b-back').onclick = () => { audio.pause(); setLoop(null); $('player').classList.remove('on'); $('view-track').style.display = 'none'; $('view-list').style.display = 'block'; renderList(); };
    $('b-play').onclick = () => playTrack(t);
    $('b-loop0').onclick = () => setLoop(0);
    $('b-romaji').onclick = () => { S.romaji = S.romaji === false; save(); openTrack(id); };
    $('b-zh').onclick = () => { S.zh = S.zh === false; save(); openTrack(id); };
    $('p-now').textContent = `${t.title} — ${t.artist}`;
    $('player').classList.add('on');
    $('srcinfo').textContent = describeSource(t);
    $('nidinput').value = (S.audio[t.id] && S.audio[t.id].nid) || (t.audio && t.audio.nid) || '';
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function describeSource(t) {
    if (S.local[t.id]) return '当前用本地音频文件（只存在这个浏览器里）';
    const s = S.audio[t.id] || t.audio;
    if (s && s.nid) return `当前音频：网易云 ${s.nid}${t.netease && t.netease.agreeRate != null ? `（歌词一致度 ${Math.round(t.netease.agreeRate * 100)}%）` : ''}`;
    return '这首还没有音频。可以在下面粘一个网易云链接。';
  }

  // 歌词点击：用事件委托，避免每行单独绑 onclick 在频繁重绘时丢事件
  function bindLyricClicks() {
    const host = $('lyric');
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.addEventListener('click', (e) => {
      const wEl = e.target.closest('.w[data-w]');
      if (wEl) {
        const w = VBY.get(wEl.dataset.w);
        try { if (w) showPop(w, curTrack); else speak(wEl.textContent); } catch (err) { /* 查词失败不能影响点行 */ }
        return;                                       // 点词=查词，绝不切循环行
      }
      const lineEl = e.target.closest('.line[data-i]');
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
      const div = document.createElement('div');
      div.className = 'line' + (l.jp ? '' : ' en');
      if (l.segs && l.segs.length) {
        for (const sg of l.segs) {
          if (!sg.w) { div.appendChild(document.createTextNode(sg.s)); continue; }
          const w = VBY.get(sg.b);
          const span = document.createElement('span');
          span.className = 'w' + (w ? (isKnown(w) ? ' known' : ' learning') : '');
          span.textContent = sg.s;
          span.dataset.w = sg.b || '';
          div.appendChild(span);
        }
      } else div.textContent = l.text;
      div.dataset.i = String(i);                                     // 行号挂元素上，点击用委托识别（见 bindLyricClicks）
      // 中文翻译挂在同一句下面（不单独占一行，避免行号错位、点击打到译文上）
      if (l.zh && S.zh !== false) {
        const z = document.createElement('div'); z.className = 'zh'; z.textContent = l.zh;
        z.style.pointerEvents = 'none';
        div.appendChild(z);
      }
      host.appendChild(div);
      if (S.romaji !== false && l.romaji && l.jp) {
        const r = document.createElement('div'); r.className = 'romaji'; r.textContent = l.romaji; host.appendChild(r);
      }
    });
  }

  // ---------- 词条弹层 ----------
  let popWord = null;
  function showPop(w, t) {
    if (!w) return;
    popWord = w;
    $('p-word').textContent = w.word;
    $('p-reading').textContent = w.reading ? '（' + w.reading + '）' : '';
    $('p-romaji').textContent = w.romaji || '';
    const myMean = (S.notes[w.id] && S.notes[w.id].meaning) || w.meaning;
    const mg = myMean
      ? (w.meaningCheck ? `${myMean}（机器译文，可能不准）` : myMean)
      : '（这个词还没有释义，点「改释义」自己写一个）';
    $('p-meaning').textContent = mg;
    const ex = (w.examples || [])[0];
    $('p-ex').textContent = ex ? `例句（${ex.track}）：${ex.jp}${ex.zh ? '　→　' + ex.zh : ''}` : '';
    const forms = Object.keys(w.forms || {}).filter((f) => f !== w.word).slice(0, 5);
    const bits = [w.pos, `全库 ${w.tracks.length} 首 / ${w.count} 次`];
    if (forms.length) bits.push('歌词里的形态：' + forms.join('、'));
    $('p-meta').textContent = bits.filter(Boolean).join(' · ');
    $('p-known').textContent = isKnown(w) ? '取消已掌握' : '标为已掌握';
    $('pop').classList.add('on');
  }
  const hidePop = () => $('pop').classList.remove('on');
  function linesOfWord(w) {
    if (!curTrack) return [];
    return curTrack.lines.filter((l) => (l.segs || []).some((s) => s.w && s.b === w.word));
  }

  // ---------- 启动 ----------
  async function boot() {
    load();
    let data;
    try { data = await (await fetch('data/index.json')).json(); }
    catch { $('list').innerHTML = '<div class="empty">载入 data/index.json 失败。本地打开请先起服务：<br>node scripts/serve.mjs 8848</div>'; return; }
    IDX = data; VOCAB = data.vocab; VBY = new Map(VOCAB.map((w) => [w.word, w])); trackById = new Map(data.tracks.map((t) => [t.id, t]));
    const s = data.stats || {};
    $('headstat').textContent = `${s.tracks} 首 · ${s.originals} 个原曲 · ${s.vocab} 词 · 有音频 ${data.tracks.filter((t) => t.audio).length} 首 · 有中文 ${data.tracks.filter((t) => t.lines.some((l) => l.zh)).length} 首`;
    $('genat').textContent = '数据生成于 ' + new Date(data.generatedAt).toLocaleString('zh-CN');
    renderList();

    $('q').oninput = renderList;
    [['f-all', 'all'], ['f-audio', 'audio'], ['f-zh', 'zh'], ['f-known', 'known']].forEach(([id, key]) => {
      $(id).onclick = () => {
        filter = filter === key && key !== 'all' ? 'all' : key;
        ['f-all', 'f-audio', 'f-zh', 'f-known'].forEach((x) => $(x).classList.remove('on'));
        (filter === 'all' ? $('f-all') : $({ all: 'f-all', audio: 'f-audio', zh: 'f-zh', known: 'f-known' }[filter])).classList.add('on');
        renderList();
      };
    });

    // —— 播放条 ——（所有状态都由 audio 事件驱动，点击只做最小动作，避免卡顿）
    bindAudioEvents();
    $('p-play').onclick = () => {
      if (!audio.getAttribute('data-tid')) { if (curTrack) playTrack(curTrack); return; }
      if (audio.paused) {
        wantPlay = true;
        if (audio.error || audio.readyState === 0) { if (stationNid) urlCache.delete(String(stationNid)); playTrack(curTrack); }
        else audio.play().catch(() => {});
      } else { wantPlay = false; audio.pause(); }
    };
    $('p-seek').oninput = (e) => {
      if (!audio.duration) return;
      jump((Number(e.target.value) / 1000) * audio.duration);
    };
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
      setNow('语速 ' + r.toFixed(1) + 'x');
    };
    $('p-rate').textContent = Number(S.rate || 1).toFixed(1) + 'x';
    $('p-close').onclick = () => { wantPlay = false; audio.pause(); $('player').classList.remove('on'); };
    // 词条弹层
    $('p-speak').onclick = () => popWord && speak(popWord.word);
    $('p-close2').onclick = hidePop;
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
      S.local && delete S.local[curTrack.id];
      save(); $('srcinfo').textContent = describeSource(curTrack);
      setNow('已绑定，点播放试试');
    };
    $('audiofile').onchange = (e) => {
      const f = e.target.files[0]; if (!f || !curTrack) return;
      if (f.size > 60 * 1024 * 1024) { alert('文件太大（建议 60MB 以内）'); return; }
      idbSet(curTrack.id, f).then(() => { delete S.local[curTrack.id]; save(); $('srcinfo').textContent = describeSource(curTrack); alert('本地音频已存在这个浏览器里'); })
        .catch(() => alert('保存失败（浏览器不允许存这么大的文件）'));
    };
    $('audioclear').onclick = async () => { if (!curTrack) return; delete S.local[curTrack.id]; save(); try { await idbDel(curTrack.id); } catch {} $('srcinfo').textContent = describeSource(curTrack); };
  }

  function step(dir) {
    if (!curLines.length) return;
    const textLines = curLines.map((l, i) => ({ l, i })).filter((x) => x.l.text.trim() && x.l.t != null);
    if (!textLines.length) return;
    const cur = loopLine == null ? -1 : loopLine;   // loopLine 就是行数组下标
    let pos = textLines.findIndex((x) => x.i === cur);
    if (pos < 0) pos = dir > 0 ? -1 : textLines.length;
    let next = pos + dir;
    if (next < 0) next = textLines.length - 1;
    if (next >= textLines.length) next = 0;
    setLoop(textLines[next].i);
  }

  boot();
})();
