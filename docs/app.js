/* 东方同人曲 学唱机 —— 前端 v2（词汇入手 · 迷你播放条 + 全屏跟唱页） */
import { V } from './version.js?v=20261017n';   // 前端版本号（自更新比对用）
import { kvGet, kvSet, kvGetJson, kvSetJson, dropLegacyDB, fcJson, apiCall as netApiCall, apiJson, gdJson, getJson, dataUrl, createAudioEl, mediaSession, mediaStore, batteryExempt, appUpdater, voicePack, nativeBack } from './platform/index.js?v=20261017n';
import { icon } from './icons.js?v=20261017n';

(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'thlyrics.tool.v1';
  const ACC_KEY = 'thlyrics.account.v1';

  // ────────────── 工具 ──────────────
  /** 图片地址统一转 https：页面跑在 https 下，http 图会被当混合内容直接拦掉
   *  （真机踩过：网易云封面就是 http://p3.music.126.net/...，全都裂） */
  const httpsImg = (u) => { const t = String(u == null ? '' : u); return t.startsWith('http://') ? 'https://' + t.slice(7) : t; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (s) => (!s || !isFinite(s)) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const norm = (s) => String(s || '').toLowerCase().replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const POSNAME = { n: '名词', v: '动词', a: '形容词', na: '形容动词', adv: '副词', prt: '助词', aux: '助动词', conj: '接续词', int: '感叹词', rent: '连体词', pref: '接头词', oth: '其他' };
  // 原生壳（Capacitor）里不显示「下载 App」；网页版才显示
  const IS_NATIVE = !!(typeof window !== 'undefined' && window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  // 主下载：和本站同域名（能打开网页就一定下得动；GitHub Releases 的 objects.githubusercontent.com 在国内常被墙）
  const APK_URL = 'https://zfqxuz.github.io/thlyrics/dl/thlyrics.apk';
  const APK_URL_BACKUP = 'https://github.com/zfqxuz/thlyrics/releases/latest/download/thlyrics.apk';
  const POS_KIND = { '名詞': 'n', '動詞': 'v', '形容詞': 'a', '形容動詞': 'na', '副詞': 'adv',
    '助詞': 'prt', '助動詞': 'aux', '接続詞': 'conj', '連体詞': 'rent', '感動詞': 'int', '接頭詞': 'pref', '記号': 'sym' };
  const posKind = (w) => {
    if (!w) return 'oth';
    if (w.pos === '名詞' && w.detail === '形容動詞語幹') return 'na';
    return POS_KIND[w.pos] || 'oth';
  };
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
  let S = { known: {}, notes: {}, audio: {}, fav: {}, sing: {}, roma: {}, words: {}, rate: 1, ruby: true, gloss: false, zh: true,
    mode: 'all', del: {}, autoSync: true, theme: 'dark', tSort: 'new' };
  let ACC = null;                                  // {token, name, uid, admin}
  const loadAcc = () => { ACC = kvGetJson(ACC_KEY, null); };
  const saveAcc = () => { kvSetJson(ACC_KEY, ACC); };
  function loadLS() { const v = kvGetJson(LS_KEY, null); if (v) S = Object.assign(S, v); S.known = S.known || {}; S.notes = S.notes || {}; S.audio = S.audio || {}; S.imp = S.imp || {}; S.del = S.del || {}; S.fav = S.fav || {}; S.sing = S.sing || {}; S.roma = S.roma || {}; S.words = S.words || {};
    S.autoSync = S.autoSync !== false; if (!S.theme) S.theme = 'dark'; if (!S.tSort) S.tSort = 'new';
    }
  // 每次落盘都顺手排一次云端同步（改释义、标词、导入、删除都会走到这里）
  let saveN = 0;
  const save = () => { saveN++; if (!kvSetJson(LS_KEY, S)) toast('本机存储写不进去了'); queueSync(); };
  // 真机排错用的小钩子（不改状态，只读）：浏览器控制台里 __th() 看当前关键状态
  if (typeof window !== 'undefined') window.__th = () => ({ v: V, saves: saveN, words: Object.keys(S.words || {}).length, wordKeys: Object.keys(S.words || {}).slice(0, 5), notes: Object.keys(S.notes || {}).length, imp: Object.keys(S.imp || {}).length, lsBytes: (kvGet(LS_KEY) || '').length });

  // ── 主题：深色 / 暖白（白天）/ 跟随系统 ──
  const THEMES = [['dark', '深色'], ['warm', '暖白'], ['auto', '跟随系统']];
  const prefersLight = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  function applyTheme() {
    const t = S.theme || 'dark';
    document.body.classList.toggle('warm', t === 'warm' || (t === 'auto' && prefersLight()));
  }
  if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if ((S.theme || 'dark') === 'auto') applyTheme(); }); } catch {} }

  // ── 曲目排序：默认按入库时间（新→旧） ──
  const TRACK_SORTS = [['new', '入库 新→旧'], ['old', '入库 旧→新'], ['az', '标题 升序'], ['azd', '标题 降序']];
  const trackTime = (t) => Number((t && t.addedAt) || 0);
  const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja');
  function sortTracks(list) {
    const arr = [...list];
    const by = S.tSort || 'new';
    if (by === 'old') return arr.sort((a, b) => trackTime(a) - trackTime(b) || byTitle(a, b));
    if (by === 'az') return arr.sort(byTitle);
    if (by === 'azd') return arr.sort((a, b) => byTitle(b, a));
    return arr.sort((a, b) => trackTime(b) - trackTime(a) || byTitle(a, b));
  }
  // ── 罗马音纠正：只认「哪首歌 · 哪一行 · 第几个词」这一处（不扩散到同词、更不跨曲）──
  //    S.roma = { '<trackId>|<行号>|<词位>': { y: 用户写的罗马音, u: 时间戳 } }，跟着账号同步
  const romaKey = (tid, li, ti) => String(tid) + '|' + Number(li) + '|' + Number(ti);
  const romaOf = (tid, li, ti) => {
    if (tid == null || li == null || ti == null) return '';
    const o = S.roma && S.roma[romaKey(tid, li, ti)];
    return (o && (typeof o === 'object' ? o.y : o)) || '';
  };
  function setRoma(tid, li, ti, y, drop) {
    const k = romaKey(tid, li, ti);
    S.roma = S.roma || {};
    if (drop || !String(y || '').trim()) delete S.roma[k];
    else S.roma[k] = { y: String(y).trim(), u: Date.now() };
    save();
  }
  /** 备选：赫本（当前）/ 训令式 / 长音不标 等，外加用户已经改过的值 */
  function romaVariants(reading) {
    const base = String(kanaRomaji(reading || '') || '').trim();
    const kana = String(reading || '');
    const out = [];
    const push = (v) => { const t = String(v || '').trim(); if (t && !out.includes(t)) out.push(t); };
    push(base);
    push(base.replace(/shi/g, 'si').replace(/chi/g, 'ti').replace(/tsu/g, 'tu').replace(/fu/g, 'hu')
      .replace(/ji/g, 'zi').replace(/sha/g, 'sya').replace(/shu/g, 'syu').replace(/sho/g, 'syo')
      .replace(/cha/g, 'tya').replace(/chu/g, 'tyu').replace(/cho/g, 'tyo')
      .replace(/ja/g, 'zya').replace(/ju/g, 'zyu').replace(/jo/g, 'zyo'));
    push(base.replace(/ou/g, 'o').replace(/uu/g, 'u'));                    // 长音不标
    push(base.replace(/ou/g, 'ō').replace(/uu/g, 'ū'));                    // 用长音符
    push(base.replace(/n([bmp])/g, 'm$1'));                                // ん 的听感写法（shimbun）
    // 促音（っ）不双写、长音分写等手写习惯
    push(base.replace(/([bcdfghjklmpqrstvwxyz])\1/g, '$1'));
    const kanaRoma = { 'し': 'shi', 'ち': 'chi', 'つ': 'tsu', 'ふ': 'fu', 'じ': 'ji' };
    if (kana && kanaRoma[kana]) push(kanaRoma[kana]);
    return out.filter(Boolean).slice(0, 6);
  }

  // ── 头像：只存 128×128 的小图（data URL），注册时可传，之后可换 ──
  const avatarHtml = (who, cls) => {
    const a = (who && who.avatar) || '';
    const name = (who && who.name) || '?';
    return a ? `<img class="av ${cls || ''}" src="${esc(a)}" alt="">`
      : `<span class="av ${cls || ''}">${esc(String(name).slice(0, 1).toUpperCase())}</span>`;
  };
  /** 选图 → 压到 128×128 jpeg（约 6~12KB）再回调 */
  function pickAvatar(file, cb) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('选一张图片'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('图片太大了（8MB 以内）'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const SZ = 128, c = document.createElement('canvas'); c.width = SZ; c.height = SZ;
          const g = c.getContext('2d');
          const side = Math.min(img.width, img.height) || 1;
          g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SZ, SZ);
          cb(c.toDataURL('image/jpeg', 0.82));
        } catch { toast('这张图处理不了'); }
      };
      img.onerror = () => toast('这张图读不了');
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  }

  /** 顶栏头像 + 下拉菜单（我的 / 管理员 / 主题开关都收在这里） */
  function renderAv() {
    const btn = $('btn-av');
    if (btn) btn.innerHTML = avatarHtml(ACC, '');
    const d = $('avdrop');
    if (!d) return;
    const light = document.body.classList.contains('warm');
    d.innerHTML = `
      <div class="mi">${avatarHtml(ACC, 'av24')}<span style="flex:1">${ACC ? esc(ACC.name) : '未登录'}</span></div>
      <div class="sep"></div>
      <button class="mi" id="av-theme"><span style="flex:1">${light ? '暖白（白天）' : '深色'}</span><span class="sw ${light ? 'on' : ''}"><i></i></span></button>
      <div class="sep"></div>
      <button class="mi" id="av-home">${icon('home','in')}首页</button>
      <button class="mi" id="av-songs">${icon('library','in')}曲库</button>
      <button class="mi" id="av-search">${icon('search','in')}搜索</button>
      <button class="mi" id="av-me">${icon('user','in')}我的</button>
      ${ACC && ACC.admin ? `<button class="mi" id="av-admin">${icon('settings','in')}管理员</button>` : ''}
      <div class="sep"></div>
      <button class="mi" id="av-out">退出登录</button>`;
    const close = () => { d.hidden = true; };
    if ($('av-theme')) $('av-theme').onclick = () => { S.theme = light ? 'dark' : 'warm'; save(); applyTheme(); renderAv(); };
    if ($('av-home')) $('av-home').onclick = () => { close(); go('#/home'); };
    if ($('av-songs')) $('av-songs').onclick = () => { close(); go('#/songs'); };
    if ($('av-search')) $('av-search').onclick = () => { close(); $('searchwrap').classList.add('on'); $('q').focus(); };
    if ($('av-me')) $('av-me').onclick = () => { close(); go('#/me'); };
    if ($('av-admin')) $('av-admin').onclick = () => { close(); go('#/admin'); };
    if ($('av-out')) $('av-out').onclick = () => { ACC = null; saveAcc(); close(); renderAv(); showGate(''); };
  }

  // ── 收藏 / 会唱（存时间戳，取消标记存负数：同步时按时间戳合并） ──
  const isFav = (id) => Number((S.fav || {})[id]) > 0;
  const isSing = (id) => Number((S.sing || {})[id]) > 0;
  const toggleMark = (kind, id) => {
    const m = S[kind] || (S[kind] = {});
    m[id] = (Number(m[id]) > 0) ? -Date.now() : Date.now();
    save();
  };
  // 已掌握记的是时间戳：正数=标了，负数=明确取消（云端合并时按时间戳取胜，不会被旧数据顶回来）
  const isKnown = (w) => !!(w && Number(S.known[w.id]) > 0);
  const meaningOf = (w) => (w && ((S.notes[w.id] && S.notes[w.id].meaning) || w.meaning)) || '';

  // ── 逐词中文（词级对照）──
  // 踩过的坑：助词/助动词不能用词表兜底。词表里为「汉字词」都建了假名活用形索引，
  // 纯假名的「は/から/た/し/な」于是被认成「歯/空/田/詩/名」——用户看到的逐词中文全错。
  // 现在：实词查词表（只认含汉字的活用形 + 词典形），功能词（助词/助动词/接续词/形式名词）一律不显示。
  const CONTENT_KIND = { n: 1, v: 1, a: 1, na: 1, adv: 1, int: 1, conj: 1, rent: 1, pref: 1 };
  // 逐词中文只翻「实词」。助词/助动词/接续词/连体词/词缀/形式名词都不翻：
  // 中文里没有一一对应的词，硬翻只会得到「提示主题」这种噪音（用户明确反馈看着不舒服）。
  const GLOSS_KIND = { n: 1, v: 1, a: 1, na: 1, adv: 1 };
  const KANA_ONLY = /^[\u3041-\u309f\u30a0-\u30ff]+$/;
  // 形式名词 / 补助动词：写假名的是语法零件（てみる・ている・こと・もの…），写汉字的算实词照翻（見る・居る）
  const GLOSS_SKIP = { 'こと': 1, 'もの': 1, 'ため': 1, 'わけ': 1, 'はず': 1, 'つもり': 1, 'ほう': 1, 'ところ': 1, 'とおり': 1, 'よう': 1, 'そう': 1,
    'いる': 1, 'ある': 1, 'くる': 1, 'いく': 1, 'おく': 1, 'しまう': 1, 'みる': 1, 'くれる': 1, 'もらう': 1, 'あげる': 1, 'やる': 1, 'いただく': 1, 'くださる': 1 };
  /** 这个词位配哪个词条：先按词典形查（最准），查不到再按表面形兜底（只认实词） */
  function wordForSeg(sg) {
    if (!sg || !sg.s || sg.k === 'sym') return null;
    if (sg.w && sg.b) { const v = VBY.get(sg.b); if (v) return v; }
    if (!CONTENT_KIND[sg.k]) return null;          // 助词/助动词不查词表：假名撞车全在这
    const v = SURF.get(sg.s) || null;
    if (!v) return null;
    // 表面形兜底还要「读得通」：同形不同词的（一个「名」可能是 な/めい）宁可少显示也不张冠李戴
    const r = norm(sg.r || '');
    const f = (v.forms || {})[sg.s];
    const want = norm((f && (f.readingHira || f.reading)) || v.reading || '');
    if (r && want && want !== r && !want.startsWith(r) && !r.startsWith(want)) return null;
    return v;
  }
  // 用户自己补的词义：S.words = { 词典形: { m: 释义, r: 读音, y: 罗马音, k: 词性码, u: 时间戳 } }
  // 为什么要有它：切词是分词器干的（任何词都能切出来），词表是人工整理的（6423 条，覆盖不到所有歌）。
  // 「切出来了但词表没有」不该是死路 —— 用户自己写一条，就存在这里，跟着账号同步。
  const userWordKey = (sg, fallback) => 'w:' + (((sg && (sg.b || sg.s)) || fallback) || '');
  const userWord = (sg, fallback) => {
    const k = userWordKey(sg, fallback);
    return Object.prototype.hasOwnProperty.call(S.words || {}, k) ? S.words[k] : null;
  };
  function setUserWord(sg, fallback, m) {
    const k = userWordKey(sg, fallback); if (k === 'w:' || !m) return;
    S.words = S.words || {};
    S.words[k] = Object.assign({}, S.words[k], { m, r: (sg && sg.r) || '', y: (sg && sg.y) || '', k: (sg && sg.k) || '', u: Date.now() });
    save();
  }

  /** 词下那一行中文：只有「实词」才有。助词、助动词、接续词、形式名词一律留白（见 GLOSS_KIND / GLOSS_SKIP） */
  const glossOf = (sg, w) => {
    if (!sg) return '';
    if (!w) { const mine = userWord(sg); return (mine && mine.m && mine.m.length <= 14) ? mine.m : '';   // 词表没有 → 看用户自己补的（不看词性）
    }
    if (!GLOSS_KIND[sg.k]) return '';
    const base = sg.b || w.word || '';
    if (GLOSS_SKIP[base] && KANA_ONLY.test(sg.s || '')) return '';
    const g = meaningOf(w) || '';
    if (!g || g.length > 14 || w.meaningCheck) return '';
    return g;
  };
  const toggleKnown = (w) => { if (!w) return; if (isKnown(w)) S.known[w.id] = -Date.now(); else S.known[w.id] = Date.now(); save(); };

  // 旧版本往 IndexedDB 绑过本机音频文件，功能已下线：开机清一次，别留垃圾
  dropLegacyDB('thlyrics');

  // ────────────── 发音朗读 ──────────────
  // 原生壳：词音频包（Kokoro，自然）→ 在线 → Open JTalk 兜底包；全程不弹窗。网页版直接在线。
  const VP_ID = 'openjtalk-ja';        // Open JTalk 兜底包（任意文本可合成）
  const VP_AUDIO = 'kokoro-ja';        // 词音频包（自然发音，按文本查表）
  let speakAudio = null;
  const getSpeakAudio = () => {                       // 懒加载：别插在主 audio 前面（很多逻辑取第一个 audio）
    if (speakAudio && speakAudio.isConnected) return speakAudio;
    speakAudio = createAudioEl();
    speakAudio.id = 'speak-audio';
    speakAudio.preload = 'auto';
    if (document.body) document.body.appendChild(speakAudio);
    return speakAudio;
  };
  const speakCache = new Map();
  async function speakOnline(text) {
    let url = speakCache.get(text);
    if (!url) {
      const j = await fcJson('/tts?text=' + encodeURIComponent(text.slice(0, 60)));
      if (!j || !j.url) throw new Error('没有音频');
      url = j.url;
      if (speakCache.size >= 200) speakCache.delete(speakCache.keys().next().value);
      speakCache.set(text, url);
    }
    await playSpeakSrc(url);
  }
  const capFileSrc = (p) => (window.Capacitor && window.Capacitor.convertFileSrc ? window.Capacitor.convertFileSrc(p) : p);
  async function playSpeakSrc(src) {
    const el = getSpeakAudio();
    try { el.pause(); } catch { /* 没播过 */ }
    el.src = src;
    el.currentTime = 0;
    await el.play();
  }
  let vpAudio = null, vpOjt = null, vpCheckedAt = 0;
  async function activePacks() {
    if (!IS_NATIVE || !voicePack.available) return { audio: null, ojt: null };
    if (Date.now() - vpCheckedAt < 15000) return { audio: vpAudio, ojt: vpOjt };
    vpCheckedAt = Date.now();
    try { const r = await voicePack.status(VP_AUDIO); vpAudio = (r && r.installed) ? r : null; } catch { vpAudio = null; }
    try { const r = await voicePack.status(VP_ID); vpOjt = (r && r.installed) ? r : null; } catch { vpOjt = null; }
    return { audio: vpAudio, ojt: vpOjt };
  }
  async function speak(t) {
    const text = String(t == null ? '' : t).trim();
    if (!text) return;
    if (!IS_NATIVE) { try { await speakOnline(text); } catch { toast('发音失败'); } return; }
    const packs = await activePacks();
    if (packs.audio) {
      try {
        const r = await voicePack.resolve(packs.audio.id, text);
        if (r && r.found && r.path) { await playSpeakSrc(capFileSrc(r.path)); return; }
      } catch { /* 查表失败就往下走 */ }
    }
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try { await speakOnline(text); return; } catch { /* 联网失败：继续兜底 */ }
    }
    if (packs.ojt) {
      try {
        const r = await voicePack.synth(packs.ojt.id, text.slice(0, 300));
        if (r && r.path) { await playSpeakSrc(capFileSrc(r.path)); return; }
      } catch { /* 兜底也不行 */ }
    }
    toast('发音失败');
  }
  if (typeof window !== 'undefined') { window.__tlSpeak = (t) => speak(t); window.__tlVpPrompt = () => voicePackPrompt(); }   // 真机/CDP 测试钩子
  /** 首次打开：没装语音包就问一次「要不要装」，可「不再提醒」 */
  function voicePackPrompt() {
    if (!IS_NATIVE || !voicePack.available || S.vpNoAsk) return;
    voicePack.status(VP_AUDIO).then((r) => {
      if (r && r.installed) return;
      showDialog({
        title: '安装离线语音包？',
        actions: [
          { label: '去安装', kind: 'main', onClick: () => go('#/voicepack') },
          { label: '不再提醒', onClick: () => { S.vpNoAsk = 1; save(); } },
        ],
      });
    }).catch(() => {});
  }

  // ────────────── 音频 ──────────────
  const audio = createAudioEl();
  const mountAudio = () => { if (document.body && !audio.isConnected) document.body.appendChild(audio); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAudio); else mountAudio();

  // ── 例句行内试听：单独一个 audio，不碰主播放器 ──
  // 点一行 = 只播这一句，播完就停；再点同一行 = 停；停后再点 = 重播。不跳页、不唤出播放器。
  const pvAudio = createAudioEl();
  pvAudio.id = 'pv-audio';
  pvAudio.preload = 'auto';
  if (document.body) document.body.appendChild(pvAudio);
  else document.addEventListener('DOMContentLoaded', () => { try { document.body.appendChild(pvAudio); } catch {} });
  const pvCache = new Map();                         // tid -> { url, at }
  let pvKey = '', pvSeq = 0, pvStopAt = 0, pvMainWasPlaying = false, pvTimer = null, pvOn = false;
  function refreshPvUI() {
    const on = pvOn && !!pvKey;
    document.querySelectorAll('.exrow[data-pv]').forEach((el) => el.classList.toggle('on', on && el.dataset.pv === pvKey));
  }
  function pvStop(resume) {
    pvSeq++;
    clearTimeout(pvTimer); pvTimer = null; pvStopAt = 0; pvOn = false;
    try { pvAudio.pause(); } catch {}
    pvKey = '';
    refreshPvUI();
    if (resume === false) return;
    if (pvMainWasPlaying && curTrack && !audio.ended && !($('pop') && $('pop').classList.contains('on'))) playTrack(curTrack).catch(() => {});
    pvMainWasPlaying = false;
  }
  pvAudio.addEventListener('ended', () => pvStop());                       // 自然播完：主播放器接着放
  pvAudio.addEventListener('timeupdate', () => { if (pvKey && pvStopAt && pvAudio.currentTime >= pvStopAt) pvStop(); });
  pvAudio.addEventListener('error', () => { if (pvKey) pvStop(); });
  function pvPlay(tid, li) {
    const t = TRACK.get(String(tid));
    const line = t && (t.lines || [])[li];
    if (!t || !line) { toast('这一句试听不了'); return; }
    if (line.t == null) { toast('这一句没有时间轴'); return; }
    const key = t.id + '|' + li;
    if (pvKey === key) { pvStop(); return; }          // 同一行再点 = 停
    pvStop(false);
    if (!audio.paused && audio.src) { pvMainWasPlaying = true; try { audio.pause(); } catch {} }   // 主播放器让位，但不换歌
    pvKey = key; refreshPvUI();
    const my = ++pvSeq;
    const start = (url) => {
      if (my !== pvSeq || pvKey !== key) return;
      if (pvAudio.getAttribute('data-pv') !== t.id) { pvAudio.setAttribute('data-pv', t.id); pvAudio.src = url; pvAudio.load(); }
      else if (pvAudio.src !== url) { pvAudio.src = url; pvAudio.load(); }
      const seekToLine = () => { if (my !== pvSeq || pvKey !== key) return; try { pvAudio.currentTime = line.t; } catch {} };
      const nxt = t.lines[li + 1];
      pvStopAt = (nxt && nxt.t != null && nxt.t > line.t) ? nxt.t - 0.06 : line.t + 8;
      if (pvAudio.readyState >= 1) seekToLine(); else pvAudio.addEventListener('loadedmetadata', seekToLine, { once: true });
      let pr = null;
      try { pr = pvAudio.play(); } catch (e) { pr = Promise.reject(e); }
      if (pr && pr.then) pr.then(() => {
        if (my !== pvSeq || pvKey !== key) return;
        pvOn = true; refreshPvUI();
        pvTimer = setTimeout(() => { if (pvKey === key) pvStop(); }, Math.max(2000, (pvStopAt - line.t + 0.8) * 1000));
      }).catch(() => { if (my === pvSeq && pvKey === key) { pvStop(); toast('这一句没有音频'); } });
      else { pvOn = true; refreshPvUI(); }
    };
    const hit = pvCache.get(t.id);
    if (hit && Date.now() - hit.at < 18 * 60 * 1000) { start(hit.url); return; }
    urlFor(t).then((url) => { if (!url) throw new Error('取不到音频地址'); pvCache.set(t.id, { url, at: Date.now() }); start(url); })
      .catch((e) => { if (my === pvSeq && pvKey === key) { pvKey = ''; refreshPvUI(); toast('试听失败：' + ((e && e.message) || '取不到音频')); } });
  }
  if (typeof window !== 'undefined') window.__tlPv = () => ({ key: pvKey, on: pvOn, seq: pvSeq, paused: pvAudio.paused, src: pvAudio.src, ready: pvAudio.readyState });
  function bindPreviewRows(root) {
    if (!root) return;
    root.querySelectorAll('.exrow[data-pv]').forEach((el) => {
      el.onclick = () => {
        const [tid, li] = String(el.dataset.pv || '').split('|');
        const t = TRACK.get(String(tid));
        if (!t || !(t.audioOss || t.audio || (S.audio || {})[t.id])) { toast('这首还没有音频'); return; }
        pvPlay(tid, Number(li));
      };
    });
    refreshPvUI();
  }
  function exRowHtml(ex) {
    const t = TRACK.get(String(ex.tid));
    const hasA = !!(t && (t.audioOss || t.audio || (S.audio || {})[t.id]));
    return `<div class="item exrow${hasA ? '' : ' noaudio'}" data-pv="${esc(ex.tid)}|${Number(ex.li) || 0}">
      <span class="exico"><span class="tri">▶</span><span class="eqbars"><i></i><i></i><i></i></span></span>
      <div class="col"><div class="l1" style="font-weight:400;font-size:14.5px;white-space:normal">${esc(ex.jp)}</div>
      ${ex.zh ? `<div class="l2" style="color:var(--p-a);white-space:normal">${esc(ex.zh)}</div>` : ''}
      <div class="l3">${ex.now ? '正在听 · ' : ''}${esc(ex.track || '')}${hasA ? '' : ' · 无音频'}</div></div>
    </div>`;
  }

  // ── 媒体会话：通知栏/锁屏/耳机线控；原生壳里顺带把前台服务起起来（后台播放靠它保命）──
  let mediaPushedAt = 0;
  function pushMediaState(force) {
    if (!mediaSession.available) return;
    const now = Date.now();
    if (!force && now - mediaPushedAt < 3000) return;      // timeupdate 很密，3 秒推一次就够
    mediaPushedAt = now;
    mediaSession.update({
      title: (curTrack && curTrack.title) || '',
      artist: (curTrack && curTrack.artist) || '',
      playing: !!audio.src && !audio.paused,
      position: audio.currentTime || 0,
      duration: isFinite(audio.duration) ? audio.duration : 0,
    });
  }
  ['play', 'pause', 'loadedmetadata', 'seeked', 'ended'].forEach((ev) => audio.addEventListener(ev, () => pushMediaState(true)));
  audio.addEventListener('timeupdate', () => pushMediaState(false));
  mediaSession.onAction((a) => {
    const act = (a && a.action) || '';
    if (act === 'play') audio.play().catch(() => {});
    else if (act === 'pause') audio.pause();
    else if (act === 'next') stepTrack(1);
    else if (act === 'prev') stepTrack(-1);
    else if (act === 'seek') jump(Number(a.position) || 0);
    else if (act === 'stop') { audio.pause(); mediaSession.stop(); }
  });

  const urlCache = new Map();
  const URL_TTL = 18 * 60 * 1000;
  const UC_KEY = 'thlyrics.urlcache.v1';
  (function loadUrlCache() { const o = kvGetJson(UC_KEY, {}); for (const k of Object.keys(o)) if (o[k] && o[k].url) urlCache.set(k, o[k]); })();
  const saveUrlCache = () => { const o = {}; for (const [k, v] of urlCache) if (Date.now() - v.at < URL_TTL) o[k] = v; kvSetJson(UC_KEY, o); };

  let stationNid = null, seekTime = null, prepToken = 0, posSavedAt = 0, healing = false;
  const setNow = (t) => { const el = $('p-now'); if (el) el.textContent = t; };
  const setState = (t) => {
    const el = $('p-state'); if (el) el.textContent = t || '';
    const p2 = $('p-state2');                  // 迷你条那条状态在跟唱页看不见，这里再显示一份（占位固定，不顶歌词）
    if (p2) p2.textContent = t || '';
  };
  function setLoad(on, text) {
    document.body.classList.toggle('loading', !!on);
    const b = $('playbtn');
    if (on) { if (text) setState(text); if (b) b.innerHTML = icon('loader', 'spin'); }
    else if (b) b.innerHTML = audio.paused ? icon('play') : icon('pause');
    const pb = $('p-play'); if (pb) pb.innerHTML = on ? icon('loader', 'spin') : (audio.paused ? icon('play') : icon('pause'));
  }
  function jump(t) { if (t == null || !isFinite(t)) return; if (audio.readyState >= 1) { try { audio.currentTime = t; } catch {} } else seekTime = t; }
  function applySeek() { if (seekTime == null || audio.readyState < 1) return; const t = seekTime; seekTime = null; try { audio.currentTime = t; } catch {} }
  function bufferedAhead(t) { try { for (let i = 0; i < audio.buffered.length; i++) if (t >= audio.buffered.start(i) - .2 && t <= audio.buffered.end(i) + .2) return audio.buffered.end(i) - t; } catch {} return 0; }

  // fcJson / gdJson / apiCall 等网络调用已搬到 platform/net.js
  /** 可播地址：netease 走后端再回落公共接口；tencent(QQ音乐) 只走后端（公共中继没有 QQ 源）*/
  let lastAudioMeta = null;            // 最近一次解析拿到的 {size,br}：用来判断"是不是 30 秒试听片段"
  async function resolveAudioUrl(nid, br, src) {
    const source = src || 'netease';
    const extra = source === 'tencent' ? '&source=tencent' : '';
    lastAudioMeta = null;
    try { const j = await fcJson(`/audio?id=${encodeURIComponent(nid)}&br=${br || 320}${extra}`); if (j && j.url) { lastAudioMeta = { size: Number(j.size) || 0, br: Number(j.br) || 0 }; return j.url; } } catch {}
    if (source !== 'netease') return null;
    try { const j = await gdJson(`types=url&source=netease&id=${encodeURIComponent(nid)}&br=${br || 320}`); if (j && j.url) return j.url; } catch {}
    return null;
  }
  /** 歌词 + 翻译：同上；接口通了但没歌词（纯音乐）会返回空 lyric，不算失败 */
  async function resolveLyric(nid, src) {
    const source = src || 'netease';
    const extra = source === 'tencent' ? '&source=tencent' : '';
    try { const j = await fcJson(`/lyric?id=${encodeURIComponent(nid)}${extra}`); if (j) return { lyric: j.lyric || '', tlyric: j.tlyric || '' }; } catch {}
    if (source !== 'netease') return null;
    try { const j = await gdJson(`types=lyric&source=netease&id=${encodeURIComponent(nid)}`); if (j) return j; } catch {}
    return null;
  }
  async function urlFor(track) {
    if (track.audioOss) return track.audioOss;                       // 自建对象存储固定直链：不需要解析
    const st = S.audio[track.id] || track.audio;
    if (!st) return null;
    if (st.type === 'local') {                                       // 本机文件：没有直链要解析，也没有过期一说
      const u = await mediaStore.url(st);
      if (!u) throw new Error('本机音频不可用');
      return u;
    }
    if (!st.nid) return null;
    const cacheKey = (st.type || 'netease') + ':' + st.nid;
    const hit = urlCache.get(cacheKey);
    if (hit && Date.now() - hit.at < URL_TTL) return hit.url;
    const url = await resolveAudioUrl(st.nid, 320, st.type);
    if (!url) throw new Error('取不到音频地址');
    urlCache.set(cacheKey, { url, at: Date.now() }); saveUrlCache();
    markTrial(track, st);
    return url;
  }

  /** 有没有可播的音源（自动切歌时跳过「无音源」的曲目，别停在一首放不响的歌上） */
  const hasAudio = (t) => !!(t && (t.audioOss || t.audio || (S.audio || {})[t.id]));

  /** 上一首/下一首：按「播放顺序」走 —— 顺序=不回头（到头停）、循环=绕圈、随机=乱跳
   *  顺序与筛选无关，跟曲库当前排序一致（用户要的是"整张列表顺序播放"） */
  function stepTrack(dir, opts = {}) {
    let list = sortTracks(IDX.tracks.slice());
    if (opts.skipUnplayable) list = list.filter(hasAudio);
    if (!list.length) return null;
    const i = curTrack ? list.findIndex((t) => t.id === curTrack.id) : -1;
    let t = null;
    if (playOrder === 'shuffle' && list.length > 1) {
      for (let k = 0; k < 24 && !t; k++) { const n = Math.floor(Math.random() * list.length); if (n !== i) t = list[n]; }
    } else {
      let n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
      const wrap = opts.wrap !== false;                   // 手动切歌永远绕圈；自动播完由调用方决定
      if (n < 0 || n >= list.length) { if (!wrap) return null; n = (n + list.length) % list.length; }
      t = list[n];
    }
    if (!t || (curTrack && t.id === curTrack.id)) return null;
    pendingPlayId = t.id;                        // 播放器里切歌：直接播
    go('#/track/' + t.id);
    if (!opts.silent) toast((dir > 0 ? '下一首：' : '上一首：') + t.title);
    return t;
  }

  /** 沙盒里没人认领的本机音频：解绑/删曲目后留下的副本，开机清一次 */
  async function gcLocalAudio() {
    if (!mediaStore.native) return;
    try {
      const files = await mediaStore.list();
      if (!files || !files.length) return;
      const keep = new Set(Object.values(S.audio || {}).filter((x) => x && x.type === 'local' && x.key).map((x) => x.key));
      let n = 0;
      for (const f of files) if (f && f.key && !keep.has(f.key)) { await mediaStore.removeByKey(f.key); n++; }
      if (n) console.info('[thlyrics] 清理了 ' + n + ' 个没人认领的本机音频');
    } catch { /* 清理失败不影响使用 */ }
  }

  /** 网易云对会员曲只给 30 秒试听：用 size/码率估时长，标出来免得以为播放器坏了 */
  function markTrial(track, st) {
    const m = lastAudioMeta;
    if (!track || !m || !m.size || !m.br) return;
    const secs = m.size / (m.br / 8);
    const trial = secs > 0 && secs < 60;
    const cur = S.audio[track.id] || track.audio || {};
    if (!!cur.trial === trial) return;
    S.audio[track.id] = Object.assign({}, cur, { trial });
    save();
    scheduleTrialRender();          // 徽章/来源行要跟着刷（解析是异步的，渲染早于它）
  }

  /** 试听标记是解析完才知道的：合并几次变化，晚一点统一刷一次界面 */
  let trialRenderTimer = null;
  function scheduleTrialRender() {
    if (trialRenderTimer) return;
    trialRenderTimer = setTimeout(() => {
      trialRenderTimer = null;
      if (location.hash.startsWith('#/songs')) renderSongs();
      if (curTrack && $('srcinfo')) $('srcinfo').textContent = describeSource(curTrack);
    }, 500);
  }

  /** 进单曲/跟唱页就把音频准备好：有直链的开始缓冲，没有的先解析地址 */
  async function prepAudio(track) {
    if (!track) return;
    const my = ++prepToken;
    if (audio.getAttribute('data-tid') === track.id && audio.src) return;
    const eager = !!S.used;
    if (my !== prepToken) return;
    const attach = (url) => {
      if (audio.getAttribute('data-tid') === track.id && audio.src) return;   // 已经挂上这首了
      stationNid = null; seekTime = null;
      audio.setAttribute('data-tid', track.id);
      audio.src = url; audio.load();
      setState(eager ? '缓冲中…' : '已就绪，点播放');
    };
    const st0 = S.audio[track.id] || track.audio;
    if (st0 && st0.type === 'local') {                               // 本机音频：取到地址直接挂上
      try {
        const u = await mediaStore.url(st0);
        if (my !== prepToken) return;
        if (u) attach(u); else setState('本机音频不可用');
      } catch { if (my === prepToken) setState('本机音频不可用'); }
      return;
    }
    const nid = (st0 && st0.nid) || (track.audio && track.audio.nid) || null;
    const srcType = (st0 && st0.type) || (track.audio && track.audio.type) || 'netease';
    const hit = nid ? urlCache.get(srcType + ':' + nid) : null;
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
        const url = await urlFor(track);
        if (!url) { setLoad(false); setState(track.audioOss ? '音频地址不可用' : '没有音频'); return; }
        stationNid = (S.audio[track.id] && S.audio[track.id].nid) || (track.audio && track.audio.nid) || null;
        audio.setAttribute('data-tid', track.id);
        audio.src = url;
      } catch (e) { setLoad(false); setState('播放失败：' + e.message); return; }
    }
    audio.playbackRate = Number(S.rate || 1);
    S.used = 1; save();
    if (opts.at != null) jump(opts.at);
    try { await audio.play(); } catch {}
    $('minibar').classList.add('on');
    markCurRows();
  }

  function bindAudio() {
    audio.addEventListener('waiting', () => setLoad(true, '缓冲中…'));
    audio.addEventListener('stalled', () => setLoad(true, '缓冲中…'));
    audio.addEventListener('canplay', () => { applySeek(); setLoad(false); });
    audio.addEventListener('loadedmetadata', () => { applySeek(); if (audio.duration) { $('p-dur').textContent = fmt(audio.duration); $('p-seek').value = String(Math.round((audio.currentTime / audio.duration) * 1000)); } });
    audio.addEventListener('loadeddata', applySeek);
    audio.addEventListener('playing', () => { setLoad(false); $('minibar').classList.add('on'); markCurRows(); });
    audio.addEventListener('play', () => { $('playbtn').innerHTML = icon('pause'); $('p-play').innerHTML = icon('pause'); markCurRows(); });
    audio.addEventListener('pause', () => { $('playbtn').innerHTML = icon('play'); $('p-play').innerHTML = icon('play'); markCurRows(); });
    audio.addEventListener('error', () => {
      if (stationNid) urlCache.delete(String(stationNid));
      setLoad(false);
      // 自愈：地址可能是被删掉/过期的（例如浏览器缓存里的旧 index.json 还指着已经清空的 OSS 音频），
      // 只要这首歌有网易云 id，就丢掉坏地址、走解析接口重来一次
      const nid = curTrack && ((S.audio[curTrack.id] && S.audio[curTrack.id].nid) || (curTrack.audio && curTrack.audio.nid));
      if (curTrack && nid && !healing) {
        healing = true;
        // 记住听到哪：重解析之后要从这儿接着播。
        // 踩过的坑：以前这里直接 playTrack(curTrack) 从头开始，后台回来进度会从 100 多秒跳回 0。
        const at = (audio.currentTime > 3) ? audio.currentTime : ((S.pos || {})[curTrack.id] || 0);
        if (curTrack.audioOss) delete curTrack.audioOss;      // 旧地址作废
        urlCache.delete(String(nid));                          // 解析缓存也作废
        audio.removeAttribute('src');
        setState('地址失效，正在重新取…');
        setTimeout(() => { playTrack(curTrack, at > 5 ? { at } : {}).finally(() => { healing = false; }); }, 300);
        return;
      }
      setState('音频加载失败，点播放重试');
    });
    // 第一次出声时问一次：让系统别在息屏/后台把播放掐掉（只问一次）
    if (batteryExempt.available && !S.bgAsked) {
      S.bgAsked = 1; save();
      batteryExempt.check().then((ok) => {
        if (ok) return;
        toast('后台播放：请在弹窗里点「允许」');
        setTimeout(() => batteryExempt.request(), 900);
      }).catch(() => {});
    }
    // 整首听完了：把进度清掉，下次点开从头开始
    // （踩过：不清的话「续播」会把 20 秒的曲子直接跳到结尾，看起来像坏了）
    audio.addEventListener('ended', () => {
      if (curTrack && S.pos && S.pos[curTrack.id] != null) { delete S.pos[curTrack.id]; save(); }
      if (mode === 'loop') return;              // 单句循环：frame() 会自己回卷，不会走到这
      advanceTrack();                           // 全曲：按「顺序/循环/随机」接着放
    });
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
  let mode = (S.mode === 'loop') ? 'loop' : 'all';   // 全曲 / 单句循环
  const lineEnd = (i) => (curLines[i + 1] && curLines[i + 1].t != null) ? curLines[i + 1].t : null;

  // ── 播放顺序：顺序 / 循环 / 随机（用户要求补的三档；跟「单句/全曲」是两个维度）──
  const ORDERS = ['seq', 'loop', 'shuffle'];
  const ORDER_NAME = { seq: '顺序', loop: '循环', shuffle: '随机' };
  const ORDER_ICON = { seq: 'order', loop: 'repeat', shuffle: 'shuffle' };
  let playOrder = ORDERS.includes(S.order) ? S.order : 'seq';
  function applyOrder(quiet) {
    if (S.order !== playOrder) { S.order = playOrder; save(); }
    const t = $('p-order-t'); if (t) t.textContent = ORDER_NAME[playOrder];
    const ic = $('p-order-ic'); if (ic) ic.innerHTML = icon(ORDER_ICON[playOrder]);
    const b = $('p-order'); if (b) { b.classList.toggle('on', playOrder !== 'seq'); b.title = '播放顺序：' + ORDER_NAME[playOrder] + '（点一下换下一档）'; }
    if (!quiet) setState('播放顺序：' + ORDER_NAME[playOrder]);
  }
  function setOrder(o, quiet) { playOrder = ORDERS.includes(o) ? o : 'seq'; applyOrder(quiet); }
  const cycleOrder = () => { setOrder(ORDERS[(ORDERS.indexOf(playOrder) + 1) % ORDERS.length]); };

  /** 一首放完 → 按播放顺序接着放（顺序：到头就停；循环：回到第一首；随机：随便挑一首） */
  function advanceTrack() {
    const t = stepTrack(1, { wrap: playOrder === 'loop', skipUnplayable: true, silent: true });
    if (!t) setState('播放完了 · 点下一首或换一首继续');
  }

  function applyControls() {
    const a = $('m-all'), l = $('m-loop'), sc = $('p-scope');
    if (a) a.classList.toggle('on', mode !== 'loop');
    if (l) l.classList.toggle('on', mode === 'loop');
    if (sc) sc.setAttribute('aria-checked', mode === 'loop' ? 'true' : 'false');
    applyOrder(true);
  }

  function setMode(m) {
    mode = m === 'loop' ? 'loop' : 'all';
    S.mode = mode; save();
    applyControls();
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
    let t = curLines[i].t, note = '';
    if (t == null) {                                   // 这一句没时间轴：退到最近的有时间轴的一句，别点了没反应
      for (let k = i - 1; k >= 0; k--) if (curLines[k] && curLines[k].t != null) { t = curLines[k].t; note = '这句没有时间轴，从上一句开始放'; break; }
      if (t == null) for (let k = i + 1; k < curLines.length; k++) if (curLines[k] && curLines[k].t != null) { t = curLines[k].t; note = '这句没有时间轴，从下一句开始放'; break; }
    }
    if (t == null) { setState('这首歌没有时间轴'); return; }
    jump(t);
    if (audio.paused) audio.play().catch(() => {});
    if (note) setState(note);
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
  /** 当前句：单句模式下是循环那句，否则是播放进度推出来的那句（和 highlight 同一口径） */
  const curLineIdx = () => (mode === 'loop' && loopLine != null) ? loopLine : activeLine;
  function highlight(scroll) {
    const on = curLineIdx();
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
    // 循环开着时，上一句/下一句是「换到那句继续循环」；没循环时就只是挪一句，不能偷偷切进单句
    playFrom(lines[n].i, false);
  }
  /**
   * 点句子 = 把单句循环切到这一句（README：「点句子从那句开始循环」/ 约束①：单句重复是硬需求）。
   * 以前这里只在 mode==='loop' 时才循环，其它情况只是「从那句往下播」——
   * 结果用户在「全曲」模式下点句子，看起来就是「点击播放单句失效了」。
   * 现在无论当前什么模式，点句子一律切到单句循环（模式也跟着切过去，状态在控件上看得见）；
   * 想整首连着放就别点句子，用播放键 / 「全曲」开关。
   */
  function playFrom(i, forceLoop = true) {
    if (!curLines[i]) return;
    const t = curLines[i].t;
    // forceLoop=false 用于「上一句 / 下一句」：只挪位置，别偷偷把模式切进单句
    const toLoop = forceLoop || mode === 'loop';
    const wasAll = mode !== 'loop';
    if (toLoop) {
      if (wasAll && forceLoop) setMode('loop');    // 点句子才切模式；上下句不切
      loopLine = i;
    } else {
      loopLine = null;
    }
    activeLine = i;
    if (t != null) jump(t);
    // 全曲模式挪一句时，音频可能还没挂上（jump 只存了 seekTime，没人消费）→ 交给 playTrack 带上 at
    const needLoad = audio.getAttribute('data-tid') !== (curTrack && curTrack.id) || !audio.src;
    if (!toLoop && needLoad) { if (curTrack) playTrack(curTrack, { at: t }); }
    else if (audio.paused || (wasAll && forceLoop)) audio.play().catch(() => {});
    highlight(false);
    armTapScroll();                               // 滚动推迟：否则第一下就把歌词滚走，第二下落不到同一行
    if (wasAll && forceLoop) toast('单句循环 · 点「全曲」恢复整首');
  }
  // 单击后不马上滚动，等「双击窗口」过去再滚到当前句 —— 保证双击的第二下落在同一行同一处
  let tapScrollT = null;
  function armTapScroll() {
    clearTimeout(tapScrollT);
    tapScrollT = setTimeout(() => { tapScrollT = null; highlight(true); }, DBL_MS + 80);
  }
  // 双击判定窗：真机上手速普遍 300~500ms，原来 360ms 太紧（踩过：10 次里 8 次判不出来）
  const DBL_MS = 620;
  let toastTimer = null;
  function toast(msg) {
    setState(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (!audio.paused) setState(''); }, 2600);
  }
  /** 通用弹窗：开屏更新公告 / 离开跟唱页二次确认 */
  function showDialog(o) {
    const d = $('dlg'); if (!d) return;
    const acts = (o && o.actions) || [];
    d.innerHTML = `<div class="dlgcard">
      <div class="dlgt">${esc((o && o.title) || '')}</div>
      ${(o && o.body) ? `<div class="dlgb">${o.body}</div>` : ''}
      <div class="dlga">${acts.map((a, i) => `<button data-di="${i}" class="${a.kind === 'main' ? 'btn-main' : a.kind === 'danger' ? 'btn-danger' : 'toolbtn'}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
    d.hidden = false;
    d.querySelectorAll('[data-di]').forEach((el) => (el.onclick = () => { const a = acts[Number(el.dataset.di)]; d.hidden = true; if (a && a.onClick) a.onClick(); }));
  }

  // ────────────── 数据 ──────────────
  let IDX = null, VOCAB = [], VBY = new Map(), VBYID = new Map(), SURF = new Map(), TRACK = new Map();
  const LIBW = new Map();          // 曲库里的词 → { n: 出现次数, tracks: Set<trackId> }
  let deckCount = 30, twFilter = 'all', filter = 'all', lastNonSearch = '#/learn';

  const levelName = (v) => (v.br ? `标日${v.br.bk} 第${v.br.l}课` : v.jl ? `JLPT N${v.jl}` : '标日未收录');

  function wordRow(v) {
    const st = libStat(v);
    return `<div class="item word" data-id="${v.id}">
      <div class="col">
        <div class="l1">${esc(v.word)}<span class="rd">${esc(v.reading)}</span></div>
        <div class="l2">${esc(meaningOf(v) || '（还没释义）')}</div>
        <div class="l3">${POSNAME[posKind(v)]} · ${esc(levelName(v))} · ${st ? st.tracks.size : 0} 首歌 / ${st ? st.n : 0} 次</div>
      </div>
      ${dotsHtml(v)}
      <button class="tick ${isKnown(v) ? 'on' : ''}" data-known="${v.id}" title="标为已掌握">${icon('check','in')}</button>
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
  /** 曲库里的歌 → 词表（学词 / 复习 / 例句都只看曲库里有的歌） */
  function indexLibrary() {
    LIBW.clear();
    for (const t of IDX.tracks) for (const l of t.lines || []) for (const sg of l.segs || []) {
      if (!sg.w || !sg.b) continue;
      let e = LIBW.get(sg.b);
      if (!e) LIBW.set(sg.b, e = { n: 0, tracks: new Set() });
      e.n++; e.tracks.add(t.id);
    }
  }
  const libStat = (v) => (v ? LIBW.get(v.word) : null);
  /** 这个词在曲库里的例句（正在听的那首排最前） */
  function examplesFor(v, max = 6) {
    const out = [];
    if (!v) return out;
    const hit = (t) => {
      const i = (t.lines || []).findIndex((l) => (l.segs || []).some((sg) => sg.w && sg.b === v.word));
      return i < 0 ? null : { jp: t.lines[i].text, zh: t.lines[i].zh || '', track: t.title, tid: t.id, li: i };
    };
    if (curTrack) { const x = hit(curTrack); if (x) out.push(Object.assign(x, { now: true })); }
    // 先挑能出声的曲目做例句（点「去这句」才不会点过去没声音）
    const playable = (t) => !!(t.audioOss || t.audio || S.audio[t.id]);
    const list = [...IDX.tracks].sort((a, b) => (playable(b) ? 1 : 0) - (playable(a) ? 1 : 0));
    for (const t of list) {
      if (out.length >= max) break;
      const x = hit(t);
      if (x && !out.some((y) => y.tid === x.tid && y.li === x.li)) out.push(x);
    }
    return out;
  }
  function deckList() {
    let list = VOCAB.filter((v) => LIBW.has(v.word) && rangeOk(v, S.dRange || 'all') && ((S.dPos || 'all') === 'all' || v.pos === S.dPos));
    if (S.hideKnown !== false) list = list.filter((v) => !isKnown(v));
    const by = S.dSort || 'easy';
    if (by === 'freq') return [...list].sort((a, b) => b.count - a.count || a.diff - b.diff);
    if (by === 'az') return [...list].sort((a, b) => String(a.reading).localeCompare(String(b.reading), 'ja'));
    if (by === 'azd') return [...list].sort((a, b) => String(b.reading).localeCompare(String(a.reading), 'ja'));
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
        <div class="ht">今日から、<span class="accent">東方</span>の<br>歌詞で言葉を学ぶ。</div>
        <div class="hs">——三首歌里挑五个词；先听懂，再背下。</div>
        <div class="homesearch">
          <input id="h-q" placeholder="搜曲名、社团、原曲、词…" autocomplete="off">
          <button id="h-go">搜索</button>
        </div>
        <div class="hln">
          <button id="h-songs" class="on">曲库 <span class="cnt">${IDX.tracks.length}</span></button>
          <button id="h-words">学词</button>
          <button id="h-mine">生词本 <span class="cnt">${knownN}</span></button>
        </div>
      </div>
      ${last ? `<div class="nowcard">
        <div class="k">NOW LEARNING · 正在学习</div>
        <div class="t">${esc(last.title)}</div>
        <div class="a">${esc(last.artist)}${last.base ? ' · 原曲：' + esc(last.base) : ''}${(S.pos || {})[last.id] > 5 ? ` · 上次听到 ${fmt(S.pos[last.id])}` : ''}</div>
        <div class="acts"><button class="btn-main" id="h-continue">继续学唱</button><button class="btn-ghost" id="h-pick">换一首</button></div>
      </div>` : (IDX.tracks.length ? `<div class="nowcard">
        <div class="k">开始</div>
        <div class="acts"><button class="btn-main" id="h-pick">去曲库挑一首</button><button class="btn-ghost" id="h-imp">导入</button></div>
      </div>` : `<div class="nowcard">
        <div class="k">曲库是空的</div>
        <div class="t">导入歌单 / 专辑 / 单曲</div>
        <div class="acts"><button class="btn-main" id="h-imp">导入</button><button class="btn-ghost" id="h-pick">去曲库</button></div>
      </div>`)}
      <div class="hair"></div>
      <div class="sec-sub">今天学这些</div>
      <div class="wordstrip">${due.map((v) => `<button data-w="${v.id}">${esc(v.word)}<span style="color:var(--ink3)"> ${esc(v.reading || '')}</span></button>`).join('') || '<span class="meta">暂无</span>'}</div>`;
    const goHome = (h) => { location.hash = h; };
    $('h-go').onclick = () => { const q = ($('h-q').value || '').trim(); if (q) goHome('#/search/' + encodeURIComponent(q)); };
    $('h-q').onkeydown = (e) => { if (e.key === 'Enter') $('h-go').click(); };
    $('h-q').oninput = (e) => { const v = e.target.value.trim(); if (v) { clearTimeout(homeQt); homeQt = setTimeout(() => goHome('#/search/' + encodeURIComponent(v)), 320); } };
    $('h-songs').onclick = () => goHome('#/songs');
    $('h-words').onclick = () => goHome('#/learn');
    $('h-mine').onclick = () => goHome('#/mine');
    if ($('h-continue')) $('h-continue').onclick = () => { pendingPlayId = last.id; pendingResumeId = last.id; goHome('#/track/' + last.id); };
    if ($('h-pick')) $('h-pick').onclick = () => goHome('#/songs');
    if ($('h-imp')) $('h-imp').onclick = () => { impState.open = true; goHome('#/songs'); };
    $('view-home').querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => {
      // 点一个词 = 去它真正出现的那句（少一跳）
      const v = VBYID.get(Number(el.dataset.w));
      const ex = v && examplesFor(v, 1)[0];
      if (ex && ex.tid) { toast('从这一句开始'); goHome('#/track/' + ex.tid + '@' + (ex.li || 0)); }
      else goHome('#/word/' + el.dataset.w);
    }));
  }
  let homeQt = null;

  // ────────────── 复习（生词本的学习闭环：看词 → 回忆 → 看释义 → 标记） ──────────────
  let revDeck = [], revI = 0, revShown = false, revStat = { ok: 0, again: 0 };
  function startReview(n) {
    const pool = VOCAB.filter((v) => !isKnown(v) && LIBW.has(v.word));
    const pick = [];
    const step = Math.max(1, Math.floor(pool.length / (n || 20)));
    for (let i = 0; i < pool.length && pick.length < (n || 20); i += step) pick.push(pool[i]);
    revDeck = pick;
    revI = 0; revShown = false; revStat = { ok: 0, again: 0 };
  }
  function renderReview() {
    if (!LIBW.size) {
      $('view-review').innerHTML = emptyBox('曲库是空的', '', [['e-rgo', '导入歌曲']]);
      $('e-rgo').onclick = () => { impState.open = true; go('#/songs'); };
      return;
    }
    if (!revDeck.length) startReview(20);
    const v = revDeck[revI];
    if (!v) {
      $('view-review').innerHTML = `<div class="revwrap">
        <div class="sec-head"><div><div class="sec-title">复习完成</div><div class="sec-sub">这轮 ${revDeck.length} 个词 · 记住了 ${revStat.ok} · 还要再看 ${revStat.again}</div></div></div>
        ${emptyBox('这一轮过完了', '', [])}
        <div class="row" style="justify-content:center;gap:8px">
          <button class="toolbtn" id="rev-again">再来一轮</button>
          <button class="toolbtn" id="rev-mine">回生词本</button>
        </div></div>`;
      if ($('rev-again')) $('rev-again').onclick = () => { startReview(20); renderReview(); };
      if ($('rev-mine')) $('rev-mine').onclick = () => go('#/mine');
      return;
    }
    const ex = examplesFor(v, 1)[0];
    $('view-review').innerHTML = `<div class="revwrap">
      <div class="sec-head"><div><div class="sec-title">复习</div><div class="sec-sub">第 ${revI + 1} / ${revDeck.length} 个 · 记住 ${revStat.ok} · 还要再看 ${revStat.again}</div></div></div>
      <div class="revbar"><i style="width:${Math.round(((revI) / revDeck.length) * 100)}%"></i></div>
      <div class="revcard">
        <div class="rw">${esc(v.word)}</div>
        ${revShown ? `<div class="rr">${esc(v.reading || '')} ${esc(v.romaji || '')}</div>
          <div class="rm">${esc(meaningOf(v) || '（没有释义）')}</div>
          ${ex ? exRowHtml(ex) : ''}`
        : '<div class="rr">？</div>'}
      </div>
      <div class="revacts">
        ${revShown ? `<button id="rev-again2">还不熟</button><button class="k" id="rev-ok">记住了</button>`
        : `<button class="k" id="rev-show">看释义</button>`}
      </div>
      <div class="row" style="justify-content:center;margin-top:12px;gap:8px">
        <button class="toolbtn" id="rev-detail">词条详情</button>
        <button class="toolbtn" id="rev-stop">结束</button>
      </div></div>`;
    bindPreviewRows($('view-review'));
    if ($('rev-show')) $('rev-show').onclick = () => { revShown = true; renderReview(); };
    if ($('rev-ok')) $('rev-ok').onclick = () => { toggleKnown(v); revStat.ok++; revI++; revShown = false; renderReview(); };
    if ($('rev-again2')) $('rev-again2').onclick = () => { if (isKnown(v)) toggleKnown(v); revStat.again++; revDeck.push(v); revI++; revShown = false; renderReview(); };
    if ($('rev-detail')) $('rev-detail').onclick = () => go('#/word/' + v.id);
    if ($('rev-stop')) $('rev-stop').onclick = () => go('#/mine');
  }

  function renderLearn() {
    if (!IDX.tracks.length) {
      $('view-learn').innerHTML = emptyBox('曲库是空的', '', [['e-limp', '导入歌曲']]);
      $('e-limp').onclick = () => { impState.open = true; go('#/songs'); };
      return;
    }
    const libN = VOCAB.filter((v) => LIBW.has(v.word)).length;
    const known = VOCAB.filter((v) => LIBW.has(v.word) && isKnown(v)).length;
    const list = deckList();
    const pct = libN ? Math.round((known / libN) * 100) : 0;
    $('view-learn').innerHTML = `
      <div class="sec-head learn-head">
        <div class="serif learn-title">今日から、<span class="accent">${list.length}</span> つの言葉。</div>
        <div class="learn-sub">已掌握 ${known} / ${libN} 词 · 进度 ${pct}%</div>
      </div>
      <div class="bar learn-bar"><i style="width:${pct}%"></i></div>
      <div class="learn-filters">
        <div class="learn-filter-row">
          <span class="filter-label">范围</span>
          <div class="chips" id="d-range">
            <button class="chip" data-v="all">全部</button><button class="chip" data-v="c1">初级上</button>
            <button class="chip" data-v="c2">初级下</button><button class="chip" data-v="c3">中级</button>
            <button class="chip" data-v="out">未收录</button><button class="chip" data-v="n45">N5-N4</button>
            <button class="chip" data-v="n123">N3-N1</button>
          </div>
        </div>
        <div class="learn-filter-row">
          <span class="filter-label">词性</span>
          <div class="chips" id="d-pos">
            <button class="chip" data-v="all">全部</button><button class="chip" data-v="名詞">名词</button>
            <button class="chip" data-v="動詞">动词</button><button class="chip" data-v="形容詞">形容词</button>
            <button class="chip" data-v="副詞">副词</button>
          </div>
        </div>
        <div class="learn-filter-row">
          <span class="filter-label">排序</span>
          <div class="chips" id="d-sort">
            <button class="chip" data-v="easy">从易到难</button><button class="chip" data-v="freq">最常见</button>
            <button class="chip" data-v="az">五十音 ↑</button><button class="chip" data-v="azd">五十音 ↓</button>
          </div>
        </div>
        <div class="learn-filter-row">
          <button class="tlink ${S.hideKnown !== false ? 'on' : ''}" id="d-hideknown">${S.hideKnown !== false ? '● 隐藏已掌握' : '○ 显示已掌握'}</button>
        </div>
      </div>
      <div class="list" id="deck">${list.slice(0, deckCount).map(wordRow).join('')}</div>
      ${list.length === 0 ? `<div class="empty">${libN ? '这个范围里的词都掌握了' : '曲库里没有可学的词'}</div>` : ''}
      ${list.length > deckCount ? `<div class="row" style="justify-content:center;margin-top:16px"><button class="toolbtn" id="d-more">再看 30 个</button></div>` : ''}
`;
    [['d-range','dRange'], ['d-pos','dPos'], ['d-sort','dSort']].forEach(([id, key]) => {
      const host = $(id); if (!host) return;
      const cur = S[key] || host.querySelector('.chip')?.dataset.v;
      host.querySelectorAll('.chip').forEach((el) => {
        const on = el.dataset.v === cur;
        el.classList.toggle('on', on);
        el.onclick = () => { S[key] = el.dataset.v; save(); if (key === 'dRange' || key === 'dPos') deckCount = 30; renderLearn(); };
      });
    });
    $('d-hideknown').onclick = (e) => { S.hideKnown = S.hideKnown === false; save(); e.target.classList.toggle('on', S.hideKnown !== false); renderLearn(); };
    if ($('d-more')) $('d-more').onclick = () => { deckCount += 30; renderLearn(); };
    wireWords($('view-learn'));
  }

  /** 列表里正在播放的行：动效 + 一键回播放（重渲染后也能恢复状态） */
  function markCurRows() {
    const playing = !!(curTrack && audio.src && !audio.paused && !audio.ended);
    document.querySelectorAll('.item.track').forEach((el) => {
      const isCur = !!(curTrack && String(el.dataset.id) === String(curTrack.id));
      el.classList.toggle('current', isCur);
      el.classList.toggle('playing', isCur && playing);
    });
  }
  function trackRow(t) {
    const isCur = !!(curTrack && String(curTrack.id) === String(t.id));
    const tags = [];
    if (t.imp) tags.push('导入');
    if (t.audio || t.audioOss || S.audio[t.id]) tags.push('有声'); else tags.push('无音源');
    if (isFav(t.id)) tags.push(icon('heart', 'in') + '收藏');
    if (isSing(t.id)) tags.push('会唱');
    if (t.imp && t.audio && t.audio.type === 'tencent') tags.push('QQ音乐');
    if ((S.audio[t.id] && S.audio[t.id].trial) || (t.audio && t.audio.trial)) tags.push('试听片段');
    if (t.lines.some((l) => l.zh)) tags.push('中文');
    const brN = (t.vocabIds || []).filter((i) => VBYID.get(i) && VBYID.get(i).br).length;
    if (brN) tags.push(`标日 ${brN}`);
    // 只有真有封面素材才放图；没有就不放空占位框（不为了填满空间做装饰卡片）
    const cover = t.coverFile ? `<img class="cover" loading="lazy" src="data/${t.coverFile}" alt="">`
      : (t.coverUrl ? `<img class="cover" loading="lazy" src="${esc(httpsImg(t.coverUrl))}" alt="">` : '');
    return `<div class="item track${isCur ? ' current' : ''}" data-id="${t.id}">
      ${cover}
      <div class="col">
        <div class="l1">${esc(t.title)}${isCur ? '<span class="eqbars" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}</div>
        <div class="l2">${esc(t.artist)}${t.base ? ' · ' + esc(t.base) : (t.album ? ' · ' + esc(t.album) : '')}</div>
        <div class="l3">${t.lineCount} 行歌词${tags.length ? ' · ' + tags.join(' · ') : ''}</div>
      </div>
      ${isCur ? `<button class="mini curbtn" data-cur="${esc(t.id)}" title="回播放">${icon('play')}</button>` : ''}
      ${t.imp ? `<button class="tick del" data-del="${esc(t.id)}" title="删除这首">${icon('close')}</button>` : `<span class="mini">${icon('chevron-right')}</span>`}
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
  /** 分词结果版本：1 = 旧（假名读音当表面形）· 2 = 修好同音撞车之后（改分词逻辑就 +1，老记录会自动重算） */
  const SEG_V = 2;
  function buildDict() {
    DICT = new Map();
    const put = (k, v, form) => { if (k && !DICT.has(k)) DICT.set(k, { v, form }); };
    for (const v of VOCAB) {
      put(v.word, v, v.word);
      // 只收含汉字的活用形：纯假名的 forms 是「读音」，当表面形建索引会把
      // 「は/た/から/し/な」认成「歯/田/空/詩/名」（逐词中文错乱的根因，SURF 同款）
      for (const f of Object.keys(v.forms || {})) if (/[\u4e00-\u9fff]/.test(f)) put(f, v, f);
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
      readingsReady = getJson(dataUrl('readings.json')).then(buildReadings).catch(() => {});
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
  /** 服务端分词（kuromoji）：一次一首歌的所有行 */
  async function segmentLines(lines) {
    const j = await apiJson('/segment', { method: 'POST', body: { lines }, timeout: 60000 });
    if (!j.segs) throw new Error('分词失败');
    return j.segs;
  }
  /** 服务端 token → 紧凑存储 [表面形, 读音, 词性码, 词表命中词]（读音能被前端还原成罗马音） */
  function segsCompact(tokens) {
    const out = [];
    for (const t of tokens || []) {
      const s = String((t && t[0]) || ''); if (!s) continue;
      const base = String(t[1] || s), rd = String(t[2] || ''), pos = String(t[3] || ''), detail = String(t[4] || '');
      if (!pos || pos === '記号') { out.push([s, '', 'sym', '']); continue; }
      const kCode = posKind({ pos, detail });
      let hit = DICT.get(s) || DICT.get(base) || null;
      let word = hit ? hit.v.word : '';
      let reading = hit ? ((((hit.v.forms || {})[hit.form] || {}).reading) || rd || '') : '';
      if (!hit && rd) {
        // 读音兜底：只有词性也对得上才认。真机踩过——「は(助詞)」按读音撞上「歯(名詞)」，
        // 于是助词被当成名词，「牙齿」挂在每个「は」下面（用户说的「中文对照不准」）
        const h = DICT.get(rd);
        if (h && posKind(h.v) === kCode) { word = h.v.word; reading = rd; }
      }
      const code = hit ? posKind(hit.v) : kCode;
      out.push([s, reading, code, word]);
    }
    return out;
  }
  /** 紧凑存储 → 渲染用的分片 */
  function segsFromCompact(arr) {
    const out = [];
    for (const t of arr || []) {
      const s = String((t && t[0]) || ''); if (!s) continue;
      const k = t[2] || 'oth';
      if (k === 'sym') { out.push({ s, k: 'sym' }); continue; }
      const rd = String(t[1] || '') || (/^[\u3041-\u309f\u30a0-\u30ff]+$/.test(s) ? s : '');
      const seg = { s, k };
      if (rd) { seg.r = rd; seg.y = kanaRomaji(rd); }
      if (t[3]) { seg.w = true; seg.b = t[3]; }
      out.push(seg);
    }
    return out;
  }
  /** 本机存的导入记录 → 和内置曲目同构的 track */
  function impTrack(rec) {
    const lines = (rec.lines || []).map((l, i) => {
      const compact = rec.segs && rec.segs[i];
      const segs = (compact && compact.length) ? segsFromCompact(compact) : segsFor(l.text);
      return {
        t: l.t, text: l.text, zh: l.zh || '', jp: jpText(l.text), segs,
        romaji: segs.map((s) => s.y || s.s).join(' ').replace(/\s+/g, ' ').trim(),
      };
    });
    const ids = new Set();
    for (const l of lines) for (const sg of l.segs) if (sg.w && sg.b) ids.add(sg.b);
    return {
      id: rec.id, imp: true, addedAt: Number(rec.at) || 0, title: rec.title, artist: rec.artist, album: rec.album,
      base: '', coverUrl: rec.cover || '', plName: rec.plName || '', plId: rec.plId || '',
      audio: rec.noAudio ? null : { type: rec.src || 'netease', nid: rec.nid }, timing: rec.src || 'netease',
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

  /** 从链接/分享文案里抠歌单 ID */
  function plIdOf(input) {
    const s = String(input || '').trim();
    const m = s.match(/[?&#]id=(\d{3,})/) || s.match(/playlist\/?[^\d]{0,8}(\d{3,})/) || s.match(/^(\d{3,})$/);
    return m ? m[1] : '';
  }
  /** 交给后端把「短链 / 分享文案 / 链接 / 数字 ID」解析成 歌单·专辑·单曲（含曲目表） */
  async function apiResolve(text) {
    try {
      const j = await apiJson(`/resolve?q=${encodeURIComponent(text)}`, { timeout: 25000 });
      if (!j.type) throw new Error('解析失败');
      return j;
    } catch (e) {
      const m = (e && e.message) || '';
      throw new Error(/^HTTP /.test(m) ? `解析失败（${m}）` : m);
    }
  }
  /** 导入一张歌单：逐首拉歌词+音频，失败的记原因，不阻塞其它 */
  /** 逐首导入（首次导入和「重试失败」都走这里） */
  async function importTracks(list, plName, pid, onStep, src) {
    const source = src || 'netease';
    const ok = [], fail = [], skip = [];
    let done = 0, quota = false, noAudioN = 0;
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
      let lines = [], why = '', noAudio = false;
      try {
        // 歌词和音频地址并行取，快一点
        const [ly, url] = await Promise.all([resolveLyric(nid, source), resolveAudioUrl(nid, 320, source)]);
        noAudio = !url;                 // 拿不到音源（QQ 会员曲等）也入库：歌词照学，音源可在单曲页绑
        if (!ly) why = '取不到歌词';
        else {
          lines = parseLrc(ly.lyric, ly.tlyric);
          if (lines.length < 3 || lines[lines.length - 1].t <= 0) {   // 纯音乐 / 没有时间轴歌词：跳过，不算失败
            skip.push({ nid, title });
            report(title, '跳过（纯音乐／没有歌词）', 'skip');
            return;
          }
        }
      } catch (e) {
        why = (e && e.message) || '接口不可用';
      }
      if (why) { fail.push({ nid, title, why, tr }); report(title, why, 'fail'); return; }
      let segs = null;                       // 服务端 kuromoji 分词（失败就退回前端贪心匹配）
      try { segs = (await segmentLines(lines.map((l) => l.text))).map(segsCompact); } catch {}
      S.imp['i' + nid] = { id: 'i' + nid, nid, src: source, title, artist, album, cover, lines, segs, segV: SEG_V,
        noAudio: noAudio ? 1 : 0, plId: pid, plName: plName || '', at: Date.now() };
      if (noAudio) noAudioN++;
      try { save(); } catch { delete S.imp['i' + nid]; quota = true; return; }
      ok.push({ nid, title });
      report(title, '', 'ok');
    };
    const queue = [...list];
    await Promise.all([0, 1, 2, 3].map(async () => {
      while (queue.length && !quota) { const tr = queue.shift(); await one(tr); }
    }));
    return { ok, fail, skip, quota, noAudio: noAudioN };
  }
  /** 歌单：曲目表走解析接口（一次能拿整张） */
  async function importPlaylistById(pid, name, limit, onStep) {
    let pl = null;
    try { const j = await gdJson(`types=playlist&source=netease&id=${pid}`); pl = j && j.playlist; }
    catch { return { error: '拉取歌单失败（接口超时或暂时不可用）' }; }
    if (!pl) return { error: '歌单不存在或读不到' };
    const all = (pl.tracks || []).filter((x) => x && x.id);
    if (!all.length) return { error: '这张歌单里没有歌' };
    const list = Number(limit) > 0 ? all.slice(0, Number(limit)) : all;
    const res = await importTracks(list, name || pl.name || '', pid, onStep, 'netease');
    return Object.assign(res, { plName: name || pl.name || '', total: all.length, done: list.length, pid, kind: 'playlist', src: 'netease' });
  }
  /** 统一入口：歌单 / 专辑 / 单曲（含手机 163cn.tv 短链、分享文案、裸 ID） */
  async function importFrom(input, limit, onStep) {
    const text = String(input || '').trim();
    if (!text) return { error: '粘分享链接 / 文案 / ID（网易云或 QQ音乐）' };
    let meta = null, why = '';
    try { meta = await apiResolve(text); } catch (e) { why = (e && e.message) || '解析失败'; }
    if (!meta) {
      const pid = plIdOf(text);                     // 解析接口不可用时，至少还能粘歌单链接 / 数字 ID
      if (!pid) return { error: why };
      meta = { type: 'playlist', id: pid, name: '' };
    }
    const source = meta.src || 'netease';
    if (meta.type === 'playlist' && source === 'netease') return importPlaylistById(meta.id, meta.name, limit, onStep);
    const tracks = (meta.tracks || []).filter((x) => x && x.id);
    const kind = meta.type === 'playlist' ? '歌单' : meta.type === 'album' ? '专辑' : '单曲';
    if (!tracks.length) return { error: `这个${kind}里读不到歌` };
    const list = Number(limit) > 0 ? tracks.slice(0, Number(limit)) : tracks;
    const pid = source === 'tencent'
      ? 'tx' + (meta.type === 'playlist' ? 'pl' : meta.type === 'album' ? 'al' : 'sg') + ':' + meta.id
      : (meta.type === 'album' ? 'al' : 'sg') + meta.id;
    const res = await importTracks(list, meta.name || '', pid, onStep, source);
    return Object.assign(res, { plName: meta.name || '', total: tracks.length, done: list.length, pid, kind: meta.type, src: source });
  }
  /** 老记录补分词：以前导入的歌没有 segs（只有前端贪心匹配），后台慢慢补上服务端的。
   *  另外 segV < SEG_V 的老分词结果是「假名读音当表面形」时代算的（は→歯），也要重算一遍。 */
  let segBackfilling = false;
  async function backfillSegs() {
    if (segBackfilling) return;
    const need = Object.values(S.imp || {}).filter((r) => r && r.lines && r.lines.length
      && (!(r.segs && r.segs.length) || Number(r.segV || 0) < SEG_V));
    if (!need.length) return;
    segBackfilling = true;
    let done = 0;
    for (const rec of need.slice(0, 40)) {
      try {
        const segs = (await segmentLines(rec.lines.map((l) => l.text))).map(segsCompact);
        rec.segs = segs; rec.segV = SEG_V;
        const t = TRACK.get(rec.id);
        if (t) { const nt = impTrack(rec); t.lines = nt.lines; t.lineCount = nt.lineCount; t.vocabIds = nt.vocabIds; }
        done++;
      } catch { break; }        // 接口不可用就下次再说
    }
    segBackfilling = false;
    if (!done) return;
    save(); indexLibrary();
    if (location.hash.startsWith('#/songs')) renderSongs();
    if (location.hash.startsWith('#/learn')) renderLearn();
    if (location.hash.startsWith('#/home')) renderHome();
  }

  /** 单曲懒迁移：老分词（segV < SEG_V）在这首歌被打开时后台重算一次。
   *  比开机一口气重算 200 首温和得多（老用户曲库可能上百首），界面先按老数据渲染、
   *  结果回来再刷一遍。 */
  const segRefreshing = new Set();
  async function refreshSegsFor(id) {
    const rec = S.imp && S.imp[id];
    if (!rec || !rec.lines || !rec.lines.length || segRefreshing.has(id)) return;
    if (Number(rec.segV || 0) >= SEG_V) return;
    segRefreshing.add(id);
    try {
      const segs = (await segmentLines(rec.lines.map((l) => l.text))).map(segsCompact);
      rec.segs = segs; rec.segV = SEG_V; save();
      const t = TRACK.get(id);
      if (t) {
        const nt = impTrack(rec);
        t.lines = nt.lines; t.lineCount = nt.lineCount; t.vocabIds = nt.vocabIds;
        if (curTrack && curTrack.id === id) {          // 正看着这首歌就把歌词重画一遍
          curLines = t.lines;
          renderLyrics($('plyric'), t); bindLyrics($('plyric')); highlight(false);
        }
      }
    } catch { /* 接口不通就下次打开再试 */ } finally { segRefreshing.delete(id); }
  }

  /** 导入 + 把新歌并进内存（供 UI 与测试用） */
  async function importInto(input, limit, onStep) {
    const res = await importFrom(input, limit, onStep);
    if (!res.error) {
      for (const [id, rec] of Object.entries(S.imp)) if (!TRACK.has(id)) { const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(id, t); }
      indexLibrary();
    }
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
  const devId = (() => { let d = kvGet(DEV_KEY); if (!d) { d = Math.random().toString(36).slice(2, 10); kvSet(DEV_KEY, d); } return d || 'x'; })();
  const n0 = (v) => (Number(v) || 0);
  const knownCount = () => (VOCAB || []).filter((v) => n0(S.known[v.id]) > 0).length;
  const hashStr = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return String(h); };

  /** 账号 API（函数计算）：带 token 的 JSON 调用（实现在 platform/net.js） */
  const apiCall = (path, opts = {}) => netApiCall(path, Object.assign({}, opts, { token: ACC && ACC.token }));

  /** 两份状态合并成一份：逐条按时间戳取胜，谁写过的都不丢 */
  function mergeStates(a, b) {
    const A = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, words: {}, clearedAt: 0 }, a);
    const B = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, words: {}, clearedAt: 0 }, b);
    const out = { clearedAt: Math.max(n0(A.clearedAt), n0(B.clearedAt)) };
    out.known = {};
    for (const k of new Set([...Object.keys(A.known), ...Object.keys(B.known)])) {
      const x = n0(A.known[k]), y = n0(B.known[k]);
      const v = Math.abs(y) > Math.abs(x) ? y : x;              // 正=标了，负=取消
      if (v && Math.abs(v) > out.clearedAt) out.known[k] = v;    // 比“清空进度”更早的一律丢掉
    }
    for (const kind of ['fav', 'sing']) {                        // 收藏 / 会唱：取时间戳更新的一条（负=取消）
      out[kind] = {};
      for (const k of new Set([...Object.keys(A[kind]), ...Object.keys(B[kind])])) {
        const x = n0(A[kind][k]), y = n0(B[kind][k]);
        const v = Math.abs(y) > Math.abs(x) ? y : x;
        if (v) out[kind][k] = v;
      }
    }
    out.words = {};                                   // 用户自补的词义：按时间戳取新
    for (const k of new Set([...Object.keys(A.words), ...Object.keys(B.words)])) {
      const x = A.words[k] || {}, y = B.words[k] || {};
      const v = n0(y.u) > n0(x.u) ? y : x;
      if (v && v.m) out.words[k] = v;
    }
    out.notes = {};
    for (const k of new Set([...Object.keys(A.notes), ...Object.keys(B.notes)])) {
      const x = A.notes[k] || {}, y = B.notes[k] || {};
      const v = n0(y.u) > n0(x.u) ? y : x;
      if (v && v.meaning && (n0(v.u) > out.clearedAt || !out.clearedAt)) out.notes[k] = v;
    }
    out.roma = {};                                     // 罗马音纠正：取时间戳更新的一条
    for (const k of new Set([...Object.keys(A.roma), ...Object.keys(B.roma)])) {
      const x = A.roma[k] || {}, y = B.roma[k] || {};
      const v = n0(y.u) > n0(x.u) ? y : x;
      if (v && v.y) out.roma[k] = v;
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
  const userState = (o) => ({ known: o.known || {}, notes: o.notes || {}, audio: o.audio || {}, imp: o.imp || {}, del: o.del || {},
    fav: o.fav || {}, sing: o.sing || {}, roma: o.roma || {}, words: o.words || {}, clearedAt: n0(o.clearedAt) });

  /** 合并后多出来的导入曲目，挂进内存里的曲库 */
  function registerImpTracks() {
    if (!TRACK || !IDX) return false;
    let added = false;
    for (const rec of Object.values(S.imp || {})) {
      if (!rec || !rec.id || TRACK.has(rec.id)) continue;
      const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(t.id, t); added = true;
    }
    if (added) {
      indexLibrary();
      if (location.hash.startsWith('#/songs')) renderSongs();
      if (location.hash.startsWith('#/mine')) renderMine();
      if (location.hash.startsWith('#/me')) renderMe();
    }
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
        S.imp = mergedAcc.imp; S.del = mergedAcc.del; S.fav = mergedAcc.fav; S.sing = mergedAcc.sing; S.roma = mergedAcc.roma;
        S.clearedAt = mergedAcc.clearedAt;
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
    if (!logged) return '未登录';
    if (S.autoSync === false) return '同步已关 · ' + who;
    if (syncBusy) return '同步中… · ' + who;
    if (syncErr) return '同步失败：' + esc(syncErr) + ' · ' + who;
    if (S.syncAt) return '已同步 ' + new Date(S.syncAt).toLocaleString('zh-CN', { hour12: false }).slice(5) + ' · ' + who;
    return '等待同步… · ' + who;
  }

  // ────────────── 账号（注册 / 登录 / 退出 / 改密码） ──────────────
  function accHtml() {
    if (ACC && ACC.token) {
      return `<div class="accbox on">
        <div class="row" style="gap:10px;align-items:center">
          ${avatarHtml(ACC, 'av48')}
          <div class="col"><div class="l1">已登录：${esc(ACC.name)}</div></div>
          <button class="toolbtn" id="acc-av">换头像</button>
          <input type="file" id="acc-avf" accept="image/*" hidden>
        </div>
        <div class="row"><button class="toolbtn" id="acc-out">退出</button></div></div>
        <div class="row" id="acc-pwrow" style="display:none;margin-top:8px">
          <input class="sel" id="acc-old" type="password" placeholder="原密码" style="flex:1;min-width:110px;height:38px">
          <input class="sel" id="acc-new" type="password" placeholder="新密码（≥6 位）" style="flex:1;min-width:110px;height:38px">
          <button class="toolbtn" id="acc-pwdo">改密码</button>
        </div>
        <div class="row" style="margin-top:8px"><button class="toolbtn" id="acc-pw">改密码</button></div>`;
    }
    return `<div class="accbox"><div class="col"><div class="l1">登录 / 注册</div></div>
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
  async function loadAdminFiles(prefix) {
    if (prefix) adminPrefix = prefix;
    try {
      setLoad(true, '读取 OSS 文件…');
      const r = await apiCall('/admin/files?prefix=' + encodeURIComponent(adminPrefix));
      adminFiles = r.files || [];
      setLoad(false);
      if (location.hash.startsWith('#/admin')) renderAdmin(); else renderMe();
    } catch (e) { setLoad(false); toast('读取失败：' + e.message); }
  }
  async function adminDelete(key) {
    if (!confirm('删除 ' + key + ' ？')) return;
    try {
      await apiCall('/admin/delete', { method: 'POST', body: { key } });
      toast('已删除 ' + key);
      await loadAdminFiles();
    } catch (e) { toast('删除失败：' + e.message); }
  }

  // ────────────── 手机键盘：把底部抽屉顶上去 ──────────────
  // 手机弹键盘时 visualViewport 会变小，但 position:fixed 的元素仍贴着"物理底部"，
  // 于是输入框和保存按钮被键盘盖住。这里按差值把抽屉 bottom 抬起来，并把聚焦的输入滚进可视区。
  function setupKeyboardAwareSheet() {
    const vv = window.visualViewport;
    const pop = $('pop');
    if (!pop) return;
    const apply = (gapOverride) => {
      const gap = gapOverride != null ? Number(gapOverride)
        : (vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0);
      const on = gap > 60 && pop.classList.contains('on');
      pop.style.bottom = on ? Math.round(gap) + 'px' : '';
      pop.style.maxHeight = on ? Math.max(220, Math.round(((vv ? vv.height : window.innerHeight) - 24))) + 'px' : '';
      if (on) {
        const el = document.activeElement;
        if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
          setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {} }, 80);
        }
      }
    };
    if (vv) { vv.addEventListener('resize', () => apply()); vv.addEventListener('scroll', () => apply()); }
    window.addEventListener('resize', () => apply());
    window.__kb = apply;               // 测试钩子：window.__kb(320) 模拟 320px 高的键盘
    apply();
  }

  // ────────────── 登录闸门（没登录不让用） ──────────────
  function gateMsg(t) { const el = $('g-msg'); if (el) el.textContent = t || ''; }
  let gateAvatar = '';                                    // 注册时选的头像
  function afterLogin() {
    const g = $('gate'); if (g) g.hidden = true;
    document.body.classList.remove('gated');
    route();
    // 开屏公告：从闸门登录/注册进来时 boot 早就 return 了，这里补一次检查
    if (appUpdater.available && !window.__NO_BACKFILL) setTimeout(() => checkApk(false), 2500);
    setTimeout(voicePackPrompt, 1200);
  }
  function showGate(msg) {
    const g = $('gate'); if (!g) return;
    g.hidden = false;
    document.body.classList.add('gated');
    g.innerHTML = `<div class="gatecard">
      <img class="glogo" src="icon-192.png" alt=""><div class="gtitle">TH Lyrics</div>
      <label class="avpick" for="g-av"><span class="av" id="g-avp">＋</span><span>头像（可选）</span></label>
      <input type="file" id="g-av" accept="image/*" hidden>
      <input class="sel" id="g-name" placeholder="用户名（2~20 位）" autocomplete="username">
      <input class="sel" id="g-pass" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password">
      <div class="row"><button class="btn-primary" id="g-login">登录</button><button class="toolbtn" id="g-reg">注册新账号</button></div>
      <div class="gmsg" id="g-msg">${esc(msg || '')}</div>
    </div>`;
    gateAvatar = '';
    if ($('g-av')) $('g-av').onchange = (e) => pickAvatar(e.target.files[0], (url) => {
      gateAvatar = url;
      const p = $('g-avp');
      if (p) p.outerHTML = `<img class="av" id="g-avp" src="${url}" alt="">`;
    });
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
      if (kind === 'reg') { body.data = userState(S); if (gateAvatar) body.avatar = gateAvatar; }   // 注册时把本机记录 + 头像一起带上去
      const res = await apiCall('/' + (kind === 'reg' ? 'register' : 'login'), { method: 'POST', body });
      ACC = { token: res.token, name: res.user.name, uid: res.user.uid, admin: !!res.user.admin, avatar: res.user.avatar || '' };
      saveAcc(); renderAv();
      setLoad(false);
      toast(kind === 'reg' ? `注册好了，欢迎 ${res.user.name}` : `已登录：${res.user.name}`);
      if (after) { await syncNow({ auto: true }); after(); }   // 闸门里登录：拉一次再放行
      else { await syncNow({ auto: true }); if (location.hash.startsWith('#/me')) renderMe(); else renderMine(); }
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
    if (syncBusy) { toast('同步中'); return; }
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
    if (syncBusy) { toast('同步中'); return; }
    const impB = Object.keys(S.imp || {}).length, kB = knownCount();
    setLoad(true, '从云端拉取…');
    const ok = await syncNow({ manual: true });
    setLoad(false);
    if (!ok) { toast('拉取失败：' + syncErr); if (location.hash.startsWith('#/me')) renderMe(); else renderMine(); return; }
    const d1 = Object.keys(S.imp || {}).length - impB, d2 = knownCount() - kB;
    toast(d1 || d2 ? `已拉回：导入的歌 +${d1} 首 · 已掌握 +${d2} 词` : '云端和本机一样');
    if (location.hash.startsWith('#/me')) renderMe(); else renderMine();
  }

  // ── 歌单定期体检：一天查一次有没有新歌；也可以手动点 ──
  const PL_CHECK_EVERY = 24 * 3600 * 1000;
  let plChecking = false;
  /** 记录里的 plId → { src, kind, id }（兼容老数据：纯数字=网易云歌单；al/sg=网易云专辑/单曲）*/
  function plInfoOf(id) {
    const s0 = String(id || '');
    let m;
    if ((m = s0.match(/^tx(pl|al|sg):(.+)$/))) return { src: 'tencent', kind: m[1], id: m[2] };
    if ((m = s0.match(/^(al|sg)(.+)$/))) return { src: 'netease', kind: m[1], id: m[2] };
    return { src: 'netease', kind: 'pl', id: s0 };
  }
  async function checkPlaylists(opts = {}) {
    if (plChecking) { if (!opts.silent) toast('正在检查中…'); return; }
    const pls = impPlaylists().filter((p) => plInfoOf(p.id).kind === 'pl');
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
        const info = plInfoOf(pl.id);
        let tracks = null;
        try {
          if (info.src === 'tencent') {
            const meta = await apiResolve('https://y.qq.com/n/ryqq/playlist/' + info.id);
            tracks = (meta && meta.tracks) || [];
          } else {
            const data = await gdJson('?types=playlist&id=' + pl.id);
            tracks = (data && data.playlist && data.playlist.tracks) || [];
          }
        } catch { bad++; lines.push(`《${pl.name}》：接口没读到，跳过`); continue; }
        tracks = tracks || [];
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
          const res = await importTracks(missing, pl.name, pl.id, null, info.src);
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
    impState.fails = []; impState.failsRaw = []; impState.skips = [];
    const stat = $('plstat');
    if ($('plgo')) $('plgo').disabled = true;
    if ($('pllist')) $('pllist').innerHTML = '';
    if (stat) stat.textContent = `重试 ${ctx.list.length} 首…`;
    const res = await importTracks(ctx.list, ctx.plName, ctx.pid, (n, total, title, mark, kind) => {
      if (kind === 'skip') impState.skips.push({ title, mark });
      if (kind === 'fail') impState.fails.push({ title, mark });
      if ($('pllist')) $('pllist').innerHTML = impRowsHtml();
      if (stat) stat.textContent = `重试 ${n}/${total}…`;
    }, ctx.src);
    importing = false;
    if ($('plgo')) $('plgo').disabled = false;
    for (const [id, rec] of Object.entries(S.imp)) if (!TRACK.has(id)) { const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(id, t); }
    indexLibrary();
    impState.ctx = res.fail.length ? { list: res.fail.map((f) => f.tr).filter(Boolean), plName: ctx.plName, pid: ctx.pid, src: ctx.src } : null;
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
    indexLibrary();
    if (curTrack && curTrack.id === id) { audio.pause(); audio.removeAttribute('src'); curTrack = null; mediaSession.stop(); }
    if (S.audio[id] && S.audio[id].type === 'local') { mediaStore.remove(S.audio[id]); delete S.audio[id]; }
    renderSongs();
  }
  function impRowsHtml() {
    const rows = impState.skips.map((x) => `<div class="improw">· <b>${esc(x.title)}</b> <span>${esc(x.mark)}</span></div>`)
      .concat(impState.fails.map((x) => `<div class="improw bad">✗ <b>${esc(x.title)}</b> <span>${esc(x.mark)}</span></div>`));
    if (!rows.length) return '';
    return `<div class="implog">${rows.join('')}</div>`
      + (impState.fails.length ? `<div class="row" style="margin-top:8px"><button class="toolbtn" id="plretry">重试失败的 ${impState.fails.length} 首</button></div>` : '');
  }
  const impState = { fails: [], failsRaw: [], skips: [], ctx: null, msg: '', open: false };
  async function startImport() {
    if (importing) return;
    const input = $('plinput') ? $('plinput').value : '';
    const stat = $('plstat');
    impState.fails = []; impState.skips = []; impState.msg = '';
    importing = true;
    if ($('plgo')) $('plgo').disabled = true;      // 先锁住按钮：中间还有可能要等读音表
    if ($('pllist')) $('pllist').innerHTML = '';
    if (stat) stat.textContent = '解析中…';
    await ensureReadings();
    const res = await importInto(input, 0, (n, total, title, mark, kind) => {
      if (kind === 'skip') impState.skips.push({ title, mark });
      if (kind === 'fail') impState.fails.push({ title, mark });
      if ($('pllist')) $('pllist').innerHTML = impRowsHtml();
      if (stat) stat.textContent = `正在导入 ${n}/${total}…`;
    });
    importing = false;
    if ($('plgo')) $('plgo').disabled = false;
    if (res.error) { impState.msg = res.error; if (stat) stat.textContent = res.error; return; }
    const bits = [`入库 ${res.ok.length} 首`];
    if (res.noAudio) bits.push(`${res.noAudio} 首暂无音源`);
    if (res.skip.length) bits.push(`跳过 ${res.skip.length} 首`);
    if (res.fail.length) bits.push(`失败 ${res.fail.length} 首`);
    impState.msg = `${res.plName || ''} · 共 ${res.total} 首 · ` + bits.join(' · ') + (res.quota ? '（本机存储满了，先导到这里）' : '');
    impState.ctx = res.fail && res.fail.length ? { list: res.fail.map((f) => f.tr).filter(Boolean), plName: res.plName, pid: res.pid, src: res.src || 'netease' } : null;
    renderSongs();
    if ($('plstat')) $('plstat').textContent = impState.msg;
    if ($('pllist')) $('pllist').innerHTML = impRowsHtml();
    if (res.ok.length) toast(`导入完成：${res.ok.length} 首`);
    else toast('没有可导入的歌');
  }

  let songQ = '', songView = 'list';
  /** 专辑：两列网格（封面 + 专辑名），点开 = 按专辑过滤曲库 */
  function albumGridHtml(list) {
    const m = new Map();
    for (const t of list) {
      const k = String(t.album || '未知专辑').trim() || '未知专辑';
      if (!m.has(k)) m.set(k, { name: k, cover: '', n: 0, artist: '' });
      const a = m.get(k); a.n++;
      if (!a.cover) a.cover = httpsImg(t.coverUrl) || (t.coverFile ? 'data/' + t.coverFile : '');
      if (!a.artist) a.artist = t.artist || '';
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ja'))
      .map((a) => `<div class="albumcard" data-album="${esc(a.name)}">
        <div class="cov">${a.cover ? `<img loading="lazy" src="${esc(a.cover)}" alt="">` : '<span class="ph">♪</span>'}</div>
        <div class="nm">${esc(a.name)}</div>
        <div class="mt">${esc(a.artist)} · ${a.n} 首</div>
      </div>`).join('');
  }
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
        <div class="list">${sortTracks(arr).map(trackRow).join('')}</div></details>`).join('');
  }
  function renderSongs() {
    const nq = norm(songQ.trim());
    const list = IDX.tracks.filter((t) => {
      if (filter === 'audio' && !(t.audioOss || t.audio || S.audio[t.id])) return false;
      if (filter === 'imp' && !t.imp) return false;
      if (filter === 'fav' && !isFav(t.id)) return false;
      if (filter === 'sing' && !isSing(t.id)) return false;
      if (filter === 'zh' && !t.lines.some((l) => l.zh)) return false;
      if (filter === 'known') {
        const k = (t.vocabIds || []).filter((i) => Number(S.known[i]) > 0).length;
        if (t.vocabIds && t.vocabIds.length && k / t.vocabIds.length > .8) return false;
      }
      if (nq && !norm(`${t.title} ${t.artist} ${t.album} ${t.plName || ''}`).includes(nq)) return false;
      return true;
    });
    const sorted = sortTracks(list);
    $('view-songs').innerHTML = `
      <div class="sec-head">
        <div><div class="sec-title">曲库</div><div class="sec-sub">${IDX.tracks.length} 首 · 显示 ${sorted.length} 首</div></div>
        <div class="segtext">
          <button class="${songView === 'list' ? 'on' : ''}" data-v="list">列表</button>
          <button class="${songView === 'artist' ? 'on' : ''}" data-v="artist">社团</button>
          <button class="${songView === 'album' ? 'on' : ''}" data-v="album">专辑</button>
        </div>
      </div>
      <div class="row" style="margin:2px 0 0">
        <input id="qs" class="sel" style="flex:1;min-width:150px;height:34px" placeholder="搜曲名 / 社团 / 专辑" value="${esc(songQ)}">
        ${curTrack ? `<button class="toolbtn on" id="jump-cur">${icon('play','in')}正在播放</button>` : ''}
        <select id="tsort" class="sel" style="height:34px">${TRACK_SORTS.map(([k, t]) => `<option value="${k}"${(S.tSort || 'new') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
      </div>
      <div class="chips">
        <button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">全部</button>
        <button class="chip ${filter === 'audio' ? 'on' : ''}" data-f="audio">有音频</button>
        <button class="chip ${filter === 'zh' ? 'on' : ''}" data-f="zh">有中文</button>
        <button class="chip ${filter === 'imp' ? 'on' : ''}" data-f="imp">我导入的</button>
        <button class="chip ${filter === 'fav' ? 'on' : ''}" data-f="fav">${icon('heart','in')}收藏</button>
        <button class="chip ${filter === 'sing' ? 'on' : ''}" data-f="sing">会唱</button>
        <button class="chip ${filter === 'known' ? 'on' : ''}" data-f="known">跳过已掌握</button>
      </div>
      <details class="impbox" ${impState.fails.length || impState.msg || impState.open || !IDX.tracks.length ? 'open' : ''}>
        <summary>导入歌单</summary>
        <div class="row" style="margin-top:10px">
          <input id="plinput" class="sel" style="flex:1;min-width:180px;height:36px" placeholder="歌单 / 专辑 / 单曲链接（网易云 / QQ音乐）">
          <button class="toolbtn on" id="plgo">${importing ? '导入中…' : '导入'}</button>
        </div>
        <div class="meta" id="plstat" style="margin-top:8px">${esc(impState.msg || '')}</div>
        <div id="pllist">${impRowsHtml()}</div>
        ${impPlaylists().length ? `<div class="meta" style="margin-top:10px">已导入：${impPlaylists().map((p) => `${esc(p.name)}（${p.n} 首）`).join('、')}</div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="toolbtn" id="plchk" ${plChecking ? 'disabled' : ''}>检查歌单更新${plChecking ? '（进行中）' : ''}</button>
          <span class="meta" style="align-self:center">上次检查：${S.plCheckAt ? new Date(S.plCheckAt).toLocaleString('zh-CN', { hour12: false }).slice(5) : '还没检查过'}</span>
        </div>
      </details>
      ${songView === 'list'
        ? `<div class="list" id="list">${sorted.map(trackRow).join('') || emptyBox(songQ ? `没有匹配「${songQ}」的曲目` : (IDX.tracks.length ? '这个筛选下没有曲目' : '曲库是空的'), '', IDX.tracks.length ? [['e-pick', '清空搜索与筛选']] : [['e-imp', '导入']])}</div>`
        : songView === 'album'
          ? `<div class="albumgrid">${albumGridHtml(sorted)}</div>${sorted.length ? '' : emptyBox('这个筛选下没有专辑', '', [['e-pick', '清空搜索与筛选']])}`
          : (groupsHtml(sorted) || emptyBox('这个筛选下没有曲目', '', [['e-pick', '清空搜索与筛选']]))}`;
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
      if (e.target.closest('[data-del]') || e.target.closest('[data-cur]')) return;
      go('#/track/' + el.dataset.id);
    }));
    $('view-songs').querySelectorAll('[data-cur]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); openPlayer(); }));
    if ($('jump-cur')) $('jump-cur').onclick = () => openPlayer();
    markCurRows();
    $('view-songs').querySelectorAll('[data-del]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); delImpTrack(el.dataset.del); }));
    if ($('plgo')) $('plgo').onclick = () => startImport();
    if ($('plchk')) $('plchk').onclick = () => checkPlaylists({ manual: true });
    if ($('tsort')) $('tsort').onchange = (e) => { S.tSort = e.target.value; save(); renderSongs(); };
    $('view-songs').querySelectorAll('.albumcard').forEach((el) => (el.onclick = () => {
      songQ = el.dataset.album; songView = 'list'; filter = 'all'; renderSongs();
    }));
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
      <div class="sec-head">
        <div><div class="sec-title">生词本</div><div class="sec-sub">已掌握 ${knownList.length} 词 · 改过释义 ${noted.length} 词</div></div>
        <button class="toolbtn" id="m-review">开始复习</button>
      </div>
      ${knownList.length ? `<div class="chips">${knownList.slice(0, 200).map((v) => `<span class="chip" data-w="${v.id}">${esc(v.word)}</span>`).join('')}</div>` : ''}
      ${knownList.length ? '' : emptyBox('还没有标过词', '', [['e-mlearn', '去学词'], ['e-mreview', '复习']])}
      <div class="hair"></div>
      ${noted.length ? noted.map((v) => `<div class="item" data-w="${v.id}"><div class="col"><div class="l1">${esc(v.word)}</div><div class="l2">${esc(S.notes[v.id].meaning)}</div></div></div>`).join('') : '<div class="meta">还没有改过释义</div>'}`;
    $('view-mine').querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => go('#/word/' + el.dataset.w)));
    if ($('e-mlearn')) $('e-mlearn').onclick = () => go('#/learn');
    if ($('e-mreview')) $('e-mreview').onclick = () => go('#/review');
    if ($('m-review')) $('m-review').onclick = () => { startReview(20); go('#/review'); };
  }

  // ── 分享码：只带「歌单/专辑/单曲的来源」，对方导入时重新解析 ──
  const b64u = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (str) => decodeURIComponent(escape(atob(String(str).replace(/-/g, '+').replace(/_/g, '/'))));
  function shareSources() {
    const seen = new Set(), items = [];
    for (const r of Object.values(S.imp || {})) {
      if (!r) continue;
      const info = plInfoOf(r.plId);
      if (!info.id) continue;
      const key = info.src + '|' + info.kind + '|' + info.id;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ s: info.src, k: info.kind, i: String(info.id) });
    }
    return { v: 2, items };
  }
  const shareCode = () => 'TL1.' + b64u(JSON.stringify(shareSources()));
  async function importShareCode(code, onStep) {
    const raw = String(code || '').trim().replace(/^TL1[.\s]*/, '').replace(/\s+/g, '');
    let src = null;
    try { src = JSON.parse(unb64u(raw)); } catch { return { error: '分享码读不出来' }; }
    const jobs = [];
    const linkOf = (s0, k, i) => (s0 === 'tencent'
      ? 'https://y.qq.com/n/ryqq/' + (k === 'al' ? 'albumDetail/' : k === 'sg' ? 'songDetail/' : 'playlist/') + i
      : 'https://music.163.com/' + (k === 'al' ? 'album' : k === 'sg' ? 'song' : 'playlist') + '?id=' + i);
    if (src.v === 2) {
      for (const it of src.items || []) jobs.push(() => importFrom(linkOf(it.s, it.k, it.i), 0, onStep));
    } else {
      for (const id of src.pl || []) jobs.push(() => importPlaylistById(String(id), '', 0, onStep));
      for (const id of src.al || []) jobs.push(() => importFrom('https://music.163.com/album?id=' + id, 0, onStep));
      for (const id of src.sg || []) jobs.push(() => importFrom('https://music.163.com/song?id=' + id, 0, onStep));
    }
    if (!jobs.length) return { error: '分享码里没有歌单 / 专辑 / 单曲' };
    let ok = 0, skip = 0, fail = 0;
    for (const run of jobs) {
      try {
        const r = await run();
        if (!r || r.error) { fail++; continue; }
        ok += (r.ok || []).length; skip += (r.skip || []).length; fail += (r.fail || []).length;
      } catch { fail++; }
    }
    for (const [id, rec] of Object.entries(S.imp)) if (!TRACK.has(id)) { const t = impTrack(rec); IDX.tracks.push(t); TRACK.set(id, t); }
    indexLibrary();
    return { ok, skip, fail };
  }

  // ────────────── 我的（账号 / 主题 / 数据） ──────────────
  let shMsg = '';                                          // 分享码的结果提示（重渲染后还在）
  // ── App 自更新（只有原生壳）：读远端 apk.json → 比版本号 → 原生下载 + 系统安装 ──
  let apkRemote = null, apkCheckedAt = 0, updIgnoredOnce = '';
  const apkNewer = () => !!(apkRemote && apkRemote.version && String(apkRemote.version) > V);
  function showUpdateDialog() {
    const v = apkRemote.version;
    showDialog({
      title: '发现新版本 ' + v,
      body: apkRemote.notes ? esc(String(apkRemote.notes)).replace(/\n/g, '<br>') : '',
      actions: [
        { label: '更新', kind: 'main', onClick: () => installApk() },
        { label: '忽略这次', onClick: () => { updIgnoredOnce = v; } },
        { label: '忽略 ' + v, onClick: () => { S.updSkip = v; save(); if (location.hash.startsWith('#/me')) renderMe(); } },
      ],
    });
  }
  async function checkApk(manual) {
    if (!appUpdater.available) { if (manual) toast('网页版请到「我的 → 安卓 App → 下载 APK」'); return; }
    try { apkRemote = await appUpdater.check(); apkCheckedAt = Date.now(); }
    catch (e) { if (manual) toast('检查更新失败：' + ((e && e.message) || e)); return; }
    if (apkNewer()) {
      if (manual || (S.updSkip !== apkRemote.version && updIgnoredOnce !== apkRemote.version)) showUpdateDialog();
    } else if (manual) toast('已经是最新版本（' + V + '）');
    if (location.hash.startsWith('#/me')) renderMe();
  }
  async function installApk() {
    if (!apkRemote || !apkRemote.url) { toast('先点一次「检查更新」'); return; }
    toast('开始下载 ' + apkRemote.version + '…');
    try {
      await appUpdater.install(apkRemote.url, apkRemote.version, (type, d) => {
        if (type === 'progress') setState(`下载中 ${(d && d.pct != null) ? d.pct + '%' : '…'}`);
        else if (type === 'done') setState('下载完成，请在系统界面点「安装」');
        else if (type === 'error') setState('更新失败：' + ((d && d.message) || ''));
      });
    } catch (e) { toast('更新失败：' + ((e && e.message) || e)); }
  }

  function renderMe() {
    const favN = Object.keys(S.fav || {}).filter((k) => Number(S.fav[k]) > 0).length;
    const singN = Object.keys(S.sing || {}).filter((k) => Number(S.sing[k]) > 0).length;
    const theme = S.theme || 'dark';
    const seg = (id, cur, opts) => `<div class="segtext" id="${id}">${opts.map(([k, t]) => `<button data-v="${k}" class="${cur === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    $('view-me').innerHTML = `
      <div class="sec-head"><div><div class="sec-title">我的</div>
        <div class="sec-sub">导入 ${Object.keys(S.imp || {}).length} 首 · 收藏 ${favN} · 会唱 ${singN}</div></div></div>
      ${accHtml()}
      <div class="meta" id="syncmsg" style="color:var(--ink2);margin-top:10px">${syncMsgHtml()}</div>
      <div class="sect">外观</div>
      <div class="setrow"><div class="k">主题</div>${seg('me-theme', theme, THEMES)}</div>
      <div class="setrow"><div class="k">曲目排序</div>
        <select class="sel" id="me-tsort">${TRACK_SORTS.map(([k, t]) => `<option value="${k}"${(S.tSort || 'new') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="setrow"><div class="k">逐词罗马音</div><button class="toolbtn ${S.ruby !== false ? 'on' : ''}" id="me-ruby">${S.ruby !== false ? '开' : '关'}</button></div>
      <div class="setrow"><div class="k">整句中文</div><button class="toolbtn ${S.zh !== false ? 'on' : ''}" id="me-zh">${S.zh !== false ? '开' : '关'}</button></div>
      <div class="setrow"><div class="k">逐词中文</div><button class="toolbtn ${S.gloss !== false ? 'on' : ''}" id="me-gloss">${S.gloss !== false ? '开' : '关'}</button></div>
      ${IS_NATIVE ? `<div class="sect">发音</div>
      <div class="setrow"><div class="k">离线语音包</div><button class="toolbtn" id="tts-packs">语音包</button></div>
      <div class="setrow"><div class="k">试听</div><button class="toolbtn" id="tts-test">发音</button></div>` : ''}
      <div class="sect">同步</div>
      <div class="row" style="margin-top:8px">
        <button class="toolbtn" id="m-push">立即同步</button>
        <button class="toolbtn" id="m-pull">从云端拉回</button>
        <button class="toolbtn ${S.autoSync !== false ? 'on' : ''}" id="m-auto">自动同步：${S.autoSync !== false ? '开' : '关'}</button>
      </div>
      ${IS_NATIVE ? `<div class="sect">更新</div>
      <div class="updrow"><div class="k"><b>当前版本</b><small>${V}${apkCheckedAt ? ' · ' + new Date(apkCheckedAt).toLocaleTimeString('zh-CN') : ''}</small></div>
        <button class="toolbtn" id="me-upd">检查更新</button></div>
      ${apkNewer() && S.updSkip !== apkRemote.version ? `<div class="updrow"><div class="k"><b>新版本 ${esc(apkRemote.version)}</b><small>${esc(apkRemote.notes || '')}</small></div>
        <button class="toolbtn on" id="me-upd-go">下载并安装</button></div>` : ''}` : `<div class="sect">安卓 App</div>
      <div class="setrow"><div class="k">装到手机上</div>
        <a class="toolbtn on" id="m-apk" href="${APK_URL}" rel="noopener">${icon('download','in')}下载 APK</a>
        <a class="toolbtn" href="${APK_URL_BACKUP}" rel="noopener">备用</a></div>`}
      <div class="sect">数据</div>
      <div class="setrow"><div class="k">导出 / 导入</div>
        <div class="row"><button class="toolbtn" id="m-export">导出</button><button class="toolbtn" id="m-import">导入</button></div></div>
      <div class="setrow"><div class="k">清空进度</div><button class="btn-danger" id="m-clear">清空</button></div>
      <div class="sect">分享歌单</div>
      <textarea class="code" id="sh-code" placeholder="分享码"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="toolbtn" id="sh-gen">生成分享码</button>
        <button class="toolbtn on" id="sh-imp">导入分享码</button>
        <button class="toolbtn" id="sh-copy">复制</button>
      </div>
      <div class="meta" id="sh-stat" style="margin-top:8px">${esc(shMsg)}</div>
      ${ACC && ACC.admin ? `<div class="sect">管理员</div><div class="row" style="margin-top:8px"><button class="toolbtn" id="me-admin">OSS 文件管理</button></div>` : ''}`;

    if ($('me-upd')) $('me-upd').onclick = () => checkApk(true);
    if ($('me-upd-go')) $('me-upd-go').onclick = () => installApk();
    const accReg = $('acc-reg'), accLogin = $('acc-login'), accOut = $('acc-out');
    if (accReg) accReg.onclick = () => doAuth('reg');
    if (accLogin) accLogin.onclick = () => doAuth('login');
    if (accOut) accOut.onclick = () => { ACC = null; saveAcc(); renderAv(); toast('已退出登录'); showGate(''); };
    if ($('acc-av')) $('acc-av').onclick = () => $('acc-avf').click();
    if ($('acc-avf')) $('acc-avf').onchange = (e) => pickAvatar(e.target.files[0], async (url) => {
      try { await apiCall('/avatar', { method: 'POST', body: { avatar: url } }); ACC.avatar = url; saveAcc(); renderAv(); toast('头像已换'); renderMe(); }
      catch (err) { toast('换头像失败：' + err.message); }
    });
    const accPw = $('acc-pw'), accPwDo = $('acc-pwdo');
    if (accPw) accPw.onclick = () => { const r = $('acc-pwrow'); r.style.display = r.style.display === 'none' ? 'flex' : 'none'; };
    if (accPwDo) accPwDo.onclick = () => changePass();
    $('view-me').querySelectorAll('#me-theme button').forEach((el) => (el.onclick = () => { S.theme = el.dataset.v; save(); applyTheme(); renderMe(); }));
    if ($('me-tsort')) $('me-tsort').onchange = (e) => { S.tSort = e.target.value; save(); renderMe(); };
    const disp = (key, id) => { const el = $(id); if (el) el.onclick = () => { S[key] = S[key] === false; save(); applyDisplay(); renderMe(); }; };
    disp('ruby', 'me-ruby'); disp('zh', 'me-zh'); disp('gloss', 'me-gloss');
    if ($('me-admin')) $('me-admin').onclick = () => go('#/admin');
    if ($('tts-packs')) $('tts-packs').onclick = () => go('#/voicepack');
    if ($('tts-test')) $('tts-test').onclick = () => speak('こんにちは');
    $('m-push').onclick = () => pushCloud();
    $('m-pull').onclick = () => pullCloud();
    $('m-auto').onclick = () => {
      S.autoSync = S.autoSync === false;
      applying = true; save(); applying = false;
      renderMe();
      if (S.autoSync === false) toast('自动同步已关');
      else { toast('自动同步已开'); syncNow({ auto: true }); }
    };
    $('m-export').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
      a.download = 'thlyrics-progress.json'; document.body.appendChild(a); a.click(); a.remove();
    };
    $('m-import').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { try { S = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, rate: 1 }, JSON.parse(String(fr.result))); save(); location.reload(); } catch { alert('读不了这个文件'); } }; fr.readAsText(f); };
      inp.click();
    };
    if ($('m-clear')) $('m-clear').onclick = () => { if (!confirm('清空进度？云端也会一起清')) return; S.known = {}; S.notes = {}; S.fav = {}; S.sing = {}; S.clearedAt = Date.now(); save(); renderMe(); };
    const shStat = $('sh-stat');
    if ($('sh-gen')) $('sh-gen').onclick = async () => {
      const code = shareCode();
      $('sh-code').value = code;
      try { await navigator.clipboard.writeText(code); shMsg = '已生成并复制（' + Object.keys(S.imp || {}).length + ' 首的来源）'; }
      catch { shMsg = '已生成（点「复制」）'; }
      if (shStat) shStat.textContent = shMsg;
    };
    if ($('sh-copy')) $('sh-copy').onclick = async () => {
      const v = ($('sh-code').value || '').trim(); if (!v) return;
      try { await navigator.clipboard.writeText(v); toast('已复制'); } catch { toast('复制失败，手动选中吧'); }
    };
    if ($('sh-imp')) $('sh-imp').onclick = async () => {
      const v = ($('sh-code').value || '').trim();
      if (!v) { shMsg = '先把分享码粘进来'; if (shStat) shStat.textContent = shMsg; return; }
      shMsg = '正在导入…'; if (shStat) shStat.textContent = shMsg;
      const r = await importShareCode(v, null);
      if (r.error) { shMsg = r.error; if (shStat) shStat.textContent = shMsg; return; }
      shMsg = `导入完成：入库 ${r.ok} 首 · 跳过 ${r.skip} 首 · 失败 ${r.fail} 首`;
      toast(`导入完成：${r.ok} 首`);
      renderMe();
    };
  }

  // ────────────── 语音包（App 内自管离线日语发音数据） ──────────────
  /** App 内「语音包」页：从 OSS 下数据包到本地，解压即用；不装 APK、不走系统 */
  async function renderVoicepack() {
    const host = $('view-voicepack'); if (!host) return;
    host.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="toolbtn" id="vp-back">${icon('chevron-left','in')}返回</button></div>
      <div class="sec-head"><div><div class="sec-title">语音包</div><div class="sec-sub">离线日语发音</div></div></div>
      <div id="vp-list"><div class="meta">加载中…</div></div>`;
    $('vp-back').onclick = () => goBack('#/me');
    const box = $('vp-list');
    if (!voicePack.available) { box.innerHTML = '<div class="empty">仅 App 内可用</div>'; return; }
    let packs = [];
    try { const j = await getJson(dataUrl('voice-packs.json')); packs = (j && j.packs) || []; } catch { packs = []; }
    if (!packs.length) { box.innerHTML = '<div class="empty">暂无</div>'; return; }
    const rows = [];
    for (const p of packs) {
      let st = null;
      try { st = await voicePack.status(p.id); } catch { st = null; }
      const installed = !!(st && st.installed);
      rows.push(`<div class="item" data-pack="${esc(p.id)}">
        <div class="col"><div class="l1">${esc(p.name)}</div>
          <div class="l2">${installed ? '已安装' : fmtSize(p.size)}</div>
          <div class="bar" id="vp-bar-${esc(p.id)}" hidden><i style="width:0"></i></div></div>
        <div class="row" style="flex:0 0 auto">
          ${installed
            ? `<button class="toolbtn" data-test="${esc(p.id)}">试听</button><button class="toolbtn" data-rm="${esc(p.id)}">删除</button>`
            : `<button class="toolbtn on" data-dl="${esc(p.id)}">下载</button>`}
        </div></div>`);
    }
    box.innerHTML = rows.join('');
    const byId = new Map(packs.map((x) => [x.id, x]));
    box.querySelectorAll('[data-dl]').forEach((el) => (el.onclick = async () => {
      const p = byId.get(el.dataset.dl); if (!p) return;
      el.disabled = true;
      const bar = document.getElementById('vp-bar-' + p.id);
      const fill = bar ? bar.querySelector('i') : null;
      if (bar) bar.hidden = false;
      try {
        await voicePack.install({ id: p.id, url: p.url, sha256: p.sha256, version: p.version, kind: p.kind || 'ojt' }, (ev, d) => {
          if (ev === 'progress' && fill && d && d.pct != null) fill.style.width = d.pct + '%';
        });
        vpCheckedAt = 0;
        toast('已安装');
        renderVoicepack();
      } catch (e) {
        toast('下载失败');
        el.disabled = false;
        if (bar) bar.hidden = true;
      }
    }));
    box.querySelectorAll('[data-rm]').forEach((el) => (el.onclick = async () => {
      try { await voicePack.remove(el.dataset.rm); vpCheckedAt = 0; toast('已删除'); renderVoicepack(); } catch { toast('删除失败'); }
    }));
    box.querySelectorAll('[data-test]').forEach((el) => (el.onclick = () => speak('こんにちは')));
  }

  function renderAdmin() {
    if (!ACC || !ACC.admin) {
      $('view-admin').innerHTML = emptyBox('没有管理员权限', '', [['a-home', '回首页']]);
      if ($('a-home')) $('a-home').onclick = () => go('#/home');
      return;
    }
    const total = adminFiles ? adminFiles.reduce((n, f) => n + f.size, 0) : 0;
    $('view-admin').innerHTML = `
      <div class="sec-head">
        <div><div class="sec-title">管理员</div>
          <div class="sec-sub">${adminFiles ? `${adminFiles.length} 个文件 · ${fmtSize(total)}` : 'OSS 存储'}</div></div>
        <button class="toolbtn" id="adm-list">${adminFiles ? '刷新' : '读取'}</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="toolbtn ${adminPrefix === 'sync/' ? 'on' : ''}" id="adm-sync">账号数据</button>
        <button class="toolbtn ${adminPrefix === 'audio/' ? 'on' : ''}" id="adm-audio">音频</button>
        <button class="toolbtn ${adminPrefix === 'kuromoji/' ? 'on' : ''}" id="adm-kuro">分词词典</button>
      </div>
      ${adminFiles ? (adminFiles.length ? `<div class="list" style="margin-top:8px">${adminFiles.map((f) => `<div class="item"><div class="col"><div class="l1" style="font-size:12px;word-break:break-all;font-weight:400">${esc(f.key)}</div><div class="l2">${fmtSize(f.size)} · ${esc(String(f.at || '').slice(0, 16).replace('T', ' '))}</div></div><button class="toolbtn" data-admdel="${esc(f.key)}">删除</button></div>`).join('')}</div>` : '<div class="meta" style="margin-top:8px">这个前缀下没有文件</div>') : ''}`;
    if ($('adm-list')) $('adm-list').onclick = () => loadAdminFiles();
    if ($('adm-sync')) $('adm-sync').onclick = () => loadAdminFiles('sync/');
    if ($('adm-audio')) $('adm-audio').onclick = () => loadAdminFiles('audio/');
    if ($('adm-kuro')) $('adm-kuro').onclick = () => loadAdminFiles('kuromoji/');
    $('view-admin').querySelectorAll('[data-admdel]').forEach((el) => (el.onclick = () => adminDelete(el.dataset.admdel)));
  }

  // ────────────── 词条详情 ──────────────
  function showWord(id) {
    const v = VBYID.get(Number(id));
    if (!v) { go('#/learn'); return; }
    const order = deckList();
    const at = order.findIndex((x) => x.id === v.id);
    const prev = at > 0 ? order[at - 1] : null, next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
    const forms = Object.entries(v.forms || {}).filter(([f]) => f !== v.word).slice(0, 8);
    const exs = examplesFor(v, 6);
    $('view-word').innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <button class="toolbtn" id="w-back">${icon('chevron-left','in')}返回</button>
        ${prev ? `<button class="toolbtn" data-go-word="${prev.id}">${icon('chevron-left','in')}${esc(prev.word)}</button>` : ''}
        ${next ? `<button class="toolbtn" data-go-word="${next.id}">${esc(next.word)}${icon('chevron-right','in')}</button>` : ''}
      </div>
      <div class="sec-title" style="font-size:30px">${esc(v.word)}</div>
      <div class="sec-sub" style="font-size:13px;color:var(--ink2)">${esc(v.reading)} · ${esc(v.romaji)} · ${POSNAME[posKind(v)]} · ${esc(levelName(v))}${v.brZh ? ' · 教材释义：' + esc(v.brZh) : ''}</div>
      <div class="bar" style="margin:14px 0 0"><i style="width:${level(v) * 20}%"></i></div>
      <div style="font-size:17px;margin-top:14px;color:#ffe9df" id="w-mean">${esc(meaningOf(v) || '（还没有释义）')}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn-primary" id="w-play">${icon('volume','in')}发音</button>
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
      <div class="list">${exs.length ? exs.map(exRowHtml).join('') : '<div class="meta">曲库里还没有这个词的例句</div>'}</div>`;
    $('w-back').onclick = () => goBack('#/learn');
    $('view-word').querySelectorAll('[data-go-word]').forEach((el) => (el.onclick = () => go('#/word/' + el.dataset.goWord)));
    $('w-play').onclick = () => speak(v.reading || v.word);
    $('w-known').onclick = () => { toggleKnown(v); showWord(v.id); };
    $('w-edit').onclick = () => { const r = $('w-editrow'); r.style.display = r.style.display === 'none' ? 'flex' : 'none'; $('w-editinput').focus(); };
    const saveMean = () => { S.notes[v.id] = Object.assign({}, S.notes[v.id], { meaning: $('w-editinput').value.trim(), u: Date.now() }); save(); showWord(v.id); };
    $('w-save').onclick = saveMean;
    $('w-editinput').onkeydown = (e) => { if (e.key === 'Enter') saveMean(); };
    bindPreviewRows($('view-word'));
  }

  // ────────────── 检索 ──────────────
  function searchAll(q) {
    const nq = norm(q);
    const words = VOCAB.filter((v) => LIBW.has(v.word)).map((v) => {
      const forms = Object.keys(v.forms || {});
      let sc = 99;
      if (v.word === q) sc = 0; else if (v.reading === q) sc = 1; else if (forms.includes(q)) sc = 2;
      else if (norm(v.word).startsWith(nq)) sc = 3;
      else if (meaningOf(v).startsWith(q)) sc = 4;
      else if (norm(v.word + ' ' + v.reading + ' ' + v.romaji + ' ' + meaningOf(v) + ' ' + forms.join(' ')).includes(nq)) sc = 5;
      return sc < 99 ? { v, sc } : null;
    }).filter(Boolean).sort((a, b) => a.sc - b.sc || a.v.diff - b.v.diff).slice(0, 40).map((x) => x.v);
    const tracks = sortTracks(IDX.tracks.filter((t) => norm(t.title + ' ' + t.artist + ' ' + t.album + ' ' + t.base).includes(nq)));
    const originals = IDX.originals.filter((o) => (o.tracks || []).some((id) => TRACK.has(id)) && norm(o.name).includes(nq)).slice(0, 12);
    return { words, tracks, originals };
  }
  function showSearch(q) {
    if (!q.trim()) { go(lastNonSearch); return; }
    const r = searchAll(q.trim());
    $('view-search').innerHTML = `
      <div class="sec-head">
        <div><div class="sec-title">搜索「${esc(q)}」</div><div class="sec-sub">词 ${r.words.length} · 曲目 ${r.tracks.length} · 原曲 ${r.originals.length}</div></div>
        ${r.tracks.length ? `<select class="sel" id="ssort" style="height:32px">${TRACK_SORTS.map(([k, t]) => `<option value="${k}"${(S.tSort || 'new') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      </div>
      ${r.tracks.length ? `<div class="srhead">曲目 <b>${r.tracks.length}</b></div><div class="list">${r.tracks.map(trackRow).join('')}</div>` : ''}
      ${r.words.length ? `<div class="srhead">词 <b>${r.words.length}</b></div><div class="list">${r.words.map(wordRow).join('')}</div>` : ''}
      ${r.originals.length ? `<div class="srhead">原曲 <b>${r.originals.length}</b></div><div class="chips">${r.originals.map((o) => `<span class="chip" data-base="${esc(o.name)}">${esc(o.name)} · ${o.tracks.length}</span>`).join('')}</div>` : ''}
      ${!r.words.length && !r.tracks.length && !r.originals.length ? (() => {
        const hot = [...new Set(IDX.tracks.map((t) => t.artist).filter(Boolean))].slice(0, 6);
        return emptyBox(`没找到「${q.trim()}」`, '', [['e-sc', '清空搜索'], ['e-ssongs', '去曲库']]) +
          `<div class="sec-sub" style="margin-top:18px">社团</div><div class="chips">${hot.map((a) => `<span class="chip" data-artist="${esc(a)}">${esc(a)}</span>`).join('')}</div>`;
      })() : ''}`;
    if ($('ssort')) $('ssort').onchange = (e) => { S.tSort = e.target.value; save(); showSearch(q); };
    wireWords($('view-search'));
    $('view-search').querySelectorAll('.track').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('[data-del]') || e.target.closest('[data-cur]')) return;
      go('#/track/' + el.dataset.id);
    }));
    $('view-search').querySelectorAll('[data-cur]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); openPlayer(); }));
    markCurRows();
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
        ${li >= 0 ? `<button class="tick" data-line="${li}" title="跳到这句">${icon('arrow-turn')}</button>` : ''}
      </div>`;
    }).join('') : '<div class="empty">这个筛选下没有词</div>';
    host.querySelectorAll('[data-line]').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation();
      const i = Number(el.dataset.line);
      $('player').classList.add('on');                 // 先开页，不然歌词区没布局，滚动算不准
      renderLyrics($('plyric'), curTrack); bindLyrics($('plyric'));
      setLoop(i);
      setTimeout(() => highlight(true), 420);          // 等全屏动画（0.3s）走完再滚到那一句
    }));
    host.querySelectorAll('.word').forEach((el) => (el.onclick = (e) => { if (!e.target.closest('[data-line]')) go('#/word/' + el.dataset.id); }));
  }
  function renderLyrics(host, t) {
    if (!t || !t.lines || !t.lines.length) {
      host.innerHTML = emptyBox('这首歌还没有歌词', '', [['e-noly', '去曲库']]);
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
        for (let ti = 0; ti < l.segs.length; ti++) {
          const sg = l.segs[ti];
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
          const w = sym ? null : wordForSeg(sg);
          const span = document.createElement('span');
          span.className = 'w k-' + sg.k + (w && isKnown(w) ? ' known' : '');
          const y = romaOf(t.id, i, ti) || sg.y || '';
          span.dataset.s = sg.s;
          if (sg.r) span.dataset.r = sg.r;
          span.dataset.ti = String(ti);
          if (romaOf(t.id, i, ti)) span.dataset.fixed = '1';       // 改过的标一下（用户自己看得见）
          if (y) span.dataset.y = y;
          if (sym) span.dataset.plain = '1';
          if (sg.w && sg.b) span.dataset.w = sg.b;
          // 罗马音那一行必须每块都占位（没有读音也留空行），否则同一句里
          // 有读音的词会被顶下去、没读音的浮在上面 —— 看起来就是「歌词一上一下」
          if (ruby) { const ri = document.createElement('i'); ri.className = 'r'; ri.textContent = y; span.appendChild(ri); }
          span.appendChild(document.createTextNode(sg.s));
          const g = glossOf(sg, w);
          if (g) { const gi = document.createElement('i'); gi.className = 'g'; gi.textContent = g; span.appendChild(gi); }
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
        const blk = e.target.closest('.lblock[data-i]');
        const li = blk ? Number(blk.dataset.i) : null;
        const cur = curLineIdx();
        // 只有「当前句」里的词能点开词条。
        // 点别的句、或者还没有当前句（没播 / 没时间轴）→ 一律跳转播放那一句，不弹词条（用户要求）。
        if (li != null && (cur < 0 || li !== Number(cur))) {
          playFrom(li, false);                 // 切句 + 播放；forceLoop=false 不动模式
          toast('已切到这一句 · 再点词看释义');
          return;                              // ← 关键：直接结束，不开抽屉
        }
        // 当前句的词 → 开词条；showPop 里会暂停播放（续播交给收起抽屉）
        const w = (wEl.dataset.w && VBY.get(wEl.dataset.w)) || SURF.get(wEl.dataset.s) || null;
        showPop(w, wEl.dataset.s, { r: wEl.dataset.r || '', y: wEl.dataset.y || '', li,
          ti: wEl.dataset.ti != null ? Number(wEl.dataset.ti) : null });
        return;
      }
      const b = e.target.closest('.lblock[data-i]');
      if (!b) return;
      const i = Number(b.dataset.i);
      const now = Date.now();
      if (now - lastTap < DBL_MS && lastTapIdx === i) {          // 双击 → 切到单句循环
        lastTap = 0; clearTimeout(tapScrollT); tapScrollT = null;
        setLoop(i); toast('单句循环'); return;
      }
      lastTap = now; lastTapIdx = i;
      playFrom(i);
    });
    host.addEventListener('dblclick', (e) => {           // 原生双击（安卓 WebView 会直接给这个）
      const b = e.target.closest('.lblock[data-i]');
      if (b && !e.target.closest('.w')) {
        clearTimeout(tapScrollT); tapScrollT = null;
        setLoop(Number(b.dataset.i)); toast('单句循环');
      }
    });
    host.addEventListener('contextmenu', (e) => { const b = e.target.closest('.lblock[data-i]'); if (b) { e.preventDefault(); setLoop(Number(b.dataset.i)); } });
    host.addEventListener('touchstart', (e) => {
      const b = e.target.closest('.lblock[data-i]');
      if (!b || e.target.closest('.w')) return;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { setLoop(Number(b.dataset.i)); toast('单句循环'); }, 420);   // 长按 = 单句循环
    }, { passive: true });
    host.addEventListener('touchend', () => clearTimeout(pressTimer));
    host.addEventListener('touchmove', () => clearTimeout(pressTimer));
  }
  // 重播/续播标记：只有「播放器里切歌」「首页继续」「播完自动下一首」才自动出声；
  // 点进学词页一律不播（用户要求：只有点「进入跟唱」才开始）。
  let pendingPlayId = '', pendingResumeId = '';
  function showTrack(id, atIdx) {
    const t = TRACK.get(id);
    if (!t) { go('#/learn'); return; }
    const same = !!(curTrack && curTrack.id === t.id);
    const auto = pendingPlayId === t.id;
    const resume = pendingResumeId === t.id;
    pendingPlayId = ''; pendingResumeId = '';
    if (!same) {
      if (!auto) { try { audio.pause(); } catch {} }     // 切到别的曲目但不自动出声
      curTrack = t; curLines = t.lines || []; loopLine = null; activeLine = -1;
      if (t.imp) refreshSegsFor(t.id);                   // 老分词结果按需重算（只算这一首）
    } else {
      curLines = t.lines || [];
    }
    S.lastTrack = t.id; save();
    const zhN = t.lines.filter((l) => l.zh).length;
    $('view-track').innerHTML = `
      <div class="track-head">
        <div class="track-back"><button id="b-back" class="tlink tlink-ghost">‹ ${icon('chevron-left','in')}返回</button></div>
        <div class="track-meta">
          ${t.coverFile ? `<img class="cover xl" src="data/${t.coverFile}" alt="">`
            : (t.coverUrl ? `<img class="cover xl" src="${esc(httpsImg(t.coverUrl))}" alt="">` : '<div class="cover xl"></div>')}
          <div class="col">
            <div class="track-title serif">${esc(t.title)}</div>
            <div class="track-artist">${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</div>
            <div class="track-base">${t.imp ? `来自歌单：${esc(t.plName || '导入')}` : `原曲：${esc(t.base || '—')}`} · ${t.lineCount} 行${zhN ? ' · 中文 ' + zhN : ''}</div>
          </div>
        </div>
        <div class="track-actions">
          <button class="tlink" id="t-sing">▶ 进入跟唱</button>
          <button class="tlink-ghost tlink" id="t-fav">${isFav(t.id) ? '♥ 已收藏' : '♡ 收藏'}</button>
          <button class="tlink-ghost tlink" id="t-mark">${isSing(t.id) ? '✓ 会唱' : '标记会唱'}</button>
        </div>
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
    $('t-sing').onclick = () => {
      openPlayer();
      if (audio.getAttribute('data-tid') === t.id && audio.src) { if (audio.paused) audio.play().catch(() => {}); }
      else playTrack(t);                                 // 第一次进这首：从 0 开始
    };
    $('t-fav').onclick = () => { toggleMark('fav', t.id); showTrack(t.id); };
    $('t-mark').onclick = () => { toggleMark('sing', t.id); showTrack(t.id); };
    renderTrackWords();
    $('twchips').querySelectorAll('.chip').forEach((el) => (el.onclick = () => { twFilter = el.dataset.f; $('twchips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === el)); renderTrackWords(); }));
    $('b-back').onclick = () => goBack('#/songs');
    $('p-title').textContent = t.title; $('p-artist').textContent = t.artist + ' · ' + t.album;
    const pc = $('p-cover');                             // 全屏页头部也给一张封面，别只有一行字
    if (pc) {
      const psrc = t.coverFile ? 'data/' + t.coverFile : httpsImg(t.coverUrl);
      if (psrc) { pc.src = psrc; pc.hidden = false; } else { pc.removeAttribute('src'); pc.hidden = true; }
    }
    const mbCover = $('mb-cover');
    if (mbCover) {
      const src = t.coverFile ? 'data/' + t.coverFile : httpsImg(t.coverUrl);
      if (src) { mbCover.src = src; mbCover.hidden = false; }
      else { mbCover.removeAttribute('src'); mbCover.hidden = true; }
    }
    setNow(t.title + ' — ' + t.artist);
    $('minibar').classList.add('on');
    $('srcinfo').textContent = describeSource(t);
    $('nidinput').value = (S.audio[t.id] && S.audio[t.id].nid) || (t.audio && t.audio.nid) || '';
    if ($('p-nosrc')) $('p-nosrc').hidden = !!(t.audioOss || t.audio || S.audio[t.id]);
    if (!same) { activeLine = -1; loopLine = null; }
    applyControls();
    if (!raf) raf = requestAnimationFrame(frame);
    renderLyrics($('plyric'), t); bindLyrics($('plyric'));   // 先进跟唱页时就绪，不白屏
    if (atIdx != null && Number.isFinite(Number(atIdx))) {
      $('player').classList.add('on'); renderLyrics($('plyric'), t); bindLyrics($('plyric'));
      // 先把「当前句」定到目标句并高亮/滚动：解析音频可能要 1~3 秒，不能让用户干等
      loopLine = atIdx; activeLine = atIdx;
      if (mode !== 'loop') { mode = 'loop'; S.mode = mode; save(); applyControls(); }
      const mb0 = $('mb-loop'); if (mb0) mb0.hidden = false;
      highlight(false);
      setTimeout(() => highlight(true), 420);
      playTrack(t).then(() => setLoop(atIdx));            // 音频就绪后再跳到那句的时间轴
    } else if (auto) {
      const p0 = (S.pos || {})[t.id];
      playTrack(t, resume && p0 > 5 ? { at: p0 } : {});
      if (resume && p0 > 5) toast('上次听到 ' + fmt(p0));
    } else {
      prepAudio(t);                                       // 只准备，不出声
      if (!(audio.getAttribute('data-tid') === t.id && audio.src && !audio.paused)) setState('点播放开始');
    }
    markCurRows();
  }
  /** 开屏恢复：把上次那首挂到播放条上（暂停状态），首页/开屏页也能看到播放器 */
  function restoreBar() {
    const t = S.lastTrack && TRACK.get(S.lastTrack);
    if (!t) return;
    curTrack = t; curLines = t.lines || [];
    setNow(t.title + ' — ' + t.artist);
    const p0 = (S.pos || {})[t.id];
    setState(p0 > 5 ? '上次听到 ' + fmt(p0) : '点播放开始');
    const mbCover = $('mb-cover');
    if (mbCover) {
      const src = t.coverFile ? 'data/' + t.coverFile : httpsImg(t.coverUrl);
      if (src) { mbCover.src = src; mbCover.hidden = false; }
      else { mbCover.removeAttribute('src'); mbCover.hidden = true; }
    }
    $('p-title').textContent = t.title;
    $('p-artist').textContent = t.artist + ' · ' + (t.album || '');
    $('minibar').classList.add('on');
    markCurRows();
  }
  function describeSource(t) {
    if (t.audioOss) return `音频：阿里云 OSS`;
    const s = S.audio[t.id] || t.audio;
    if (s && s.type === 'local') return `音频：本机文件${s.name ? ' · ' + s.name : ''}`;
    if (s && s.nid) return `音频：${s.type === 'tencent' ? 'QQ音乐' : '网易云'}${s.trial ? ' · 试听片段（约 30 秒）' : ''}`;
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
  let popWord = null, popFallback = null, popSeg = null, popPos = null, romaCtx = null, popWasPlaying = false;
  function showPop(w, fallback, seg) {
    // 抽屉一弹出就暂停；续播交给"收起抽屉"（用户要求：暂停/续播绑抽屉，不绑编辑器）
    if (!popWasPlaying && !audio.paused && audio.src) { popWasPlaying = true; try { audio.pause(); } catch {} }
    popFallback = fallback || null;
    popSeg = seg || null;
    popPos = (seg && seg.li != null && seg.ti != null && curTrack) ? { tid: curTrack.id, li: seg.li, ti: seg.ti } : null;
    $('pop').classList.remove('expanded');                 // 每次打开都回到一阶段
    closeRomaEditor();                                     // 编辑器别残留
    const row = $('p-editrow'); if (row) row.hidden = true;

    if (!w) {
      popWord = null;                                      // 必须清掉：否则补释义会写到上一个查过的词上
      const rd = (seg && seg.r) ? norm(seg.r) : '';
      const mine = userWord(seg, fallback);
      $('p-word').textContent = fallback || '';
      $('p-reading').textContent = rd ? '（' + rd + '）' : '';
      $('p-romaji').textContent = (popPos && romaOf(popPos.tid, popPos.li, popPos.ti)) || (seg && seg.y) || '';
      $('p-meaning').textContent = (mine && mine.m) || '暂无释义';
      $('p-meta').textContent = [POSNAME[seg && seg.k], mine ? '自补释义' : ''].filter(Boolean).join(' · ');
      $('p-known').style.display = 'none';
      const sp = $('p-speak'); if (sp) sp.style.display = 'none';   // 没收录的词没有标准读音可发
      if ($('p-edit')) $('p-edit').textContent = (mine && mine.m) ? '改释义' : '补一条释义';
      $('p-exlist').innerHTML = '<div class="mt">这个词是自补的，暂时没有例句</div>';
      bindPreviewRows($('pop'));
      $('pop').classList.add('on');
      return;
    }

    popWord = w;
    $('p-known').style.display = '';
    const sp = $('p-speak'); if (sp) sp.style.display = '';
    $('p-word').textContent = w.word;
    $('p-reading').textContent = w.reading ? '（' + w.reading + '）' : '';
    $('p-romaji').textContent = (popPos && romaOf(popPos.tid, popPos.li, popPos.ti)) || w.romaji || '';
    $('p-meaning').textContent = meaningOf(w) || '没有释义';
    $('p-known').classList.toggle('on', !!isKnown(w));
    $('p-known').title = isKnown(w) ? '取消已掌握' : '标为已掌握';
    if ($('p-edit')) $('p-edit').textContent = '改释义';
    const st = libStat(w);
    $('p-meta').textContent = [POSNAME[posKind(w)], levelName(w), st ? `${st.tracks.size} 首歌 / ${st.n} 次` : ''].filter(Boolean).join(' · ');
    renderPopExamples();                                   // 「出现的句子」直接铺出来，不再藏在按钮后面
    bindPreviewRows($('pop'));
    $('pop').classList.add('on');
  }
  /** 例句区块：正在听这首里的 + 其它曲目里的 */
  function renderPopExamples() {
    const box = $('p-exlist'); if (!box) return;
    const head = (text) => `<div class="mt">${text}</div>`;
    const here = (popWord && curTrack)
      ? curTrack.lines.map((l, i) => ({ l, i })).filter((x) => (x.l.segs || []).some((s) => s.w && s.b === popWord.word)).slice(0, 3)
      : [];
    const others = popWord ? examplesFor(popWord, 5).filter((x) => !x.now) : [];
    box.innerHTML =
      (here.length ? head('正在听的这首里') + `<div class="list">${here.map((x) => exRowHtml({ jp: x.l.text, zh: x.l.zh, track: '', tid: curTrack.id, li: x.i, now: true })).join('')}</div>` : '')
      + (others.length ? head('其它曲目里') + `<div class="list">${others.map(exRowHtml).join('')}</div>` : '')
      + ((!here.length && !others.length) ? '<div class="mt">曲库里还没有这个词的例句</div>' : '');
  }
  /** 关弹层：顺手收起罗马音编辑器；抽屉弹出时暂停的播放，在这里续上 */
  const hidePop = (keepPaused) => {
    const skip = keepPaused === true;               // ⚠️ 会被当 onclick 用，参数可能是 MouseEvent，必须判 === true
    pvStop(false);
    const b = $('p-exlist'); if (b) b.innerHTML = '';
    closeRomaEditor();
    $('pop').classList.remove('on', 'expanded');
    // 抽屉弹出时暂停的播放，收起时续上；整首已经播完就不用再起播了
    if (!skip && popWasPlaying && !audio.ended && curTrack) playTrack(curTrack);
    popWasPlaying = false;
  };
  function closeRomaEditor() {
    const box = $('p-romabox'); if (box) box.hidden = true;
    romaCtx = null;
  }
  const romaboxHint = () => $('p-romahint');
  function refreshLyricsNow() {
    if (!curTrack) return;
    renderLyrics($('plyric'), curTrack); bindLyrics($('plyric')); highlight(true);
  }

  // ────────────── 路由 ──────────────
  const VIEWS = ['view-home', 'view-learn', 'view-songs', 'view-mine', 'view-me', 'view-admin', 'view-word', 'view-track', 'view-search', 'view-review', 'view-voicepack'];
  function show(which) {
    try { pvStop(); } catch {}
    const avd = $('avdrop'); if (avd) avd.hidden = true;
    if ($('tabs')) $('tabs').hidden = (which === 'view-home');
    const slot = $('srcslot');
    if (slot) slot.hidden = !(which === 'view-me' || which === 'view-track');
    VIEWS.forEach((v) => { const el = $(v); if (el) el.hidden = v !== which; });
    const map = { 'view-learn': 'tab-learn', 'view-songs': 'tab-songs', 'view-mine': 'tab-mine', 'view-me': 'tab-me', 'view-admin': 'tab-me' };
    ['tab-learn', 'tab-songs', 'tab-mine', 'tab-me'].forEach((t) => { const el = $(t); if (el) el.classList.toggle('on', map[which] === t); });
    window.scrollTo(0, 0);
  }
  const go = (h) => { if (String(h || '') !== location.hash) armAllowLeave(); location.hash = h; };        // 自己点的导航不算误触
  const goBack = (fallback) => { armAllowLeave(); if (history.length > 1) history.back(); else go(fallback); };

  // ── 返回：能回上一页就直接回；只有回不到上一页（会退出 App）才问一句 ──
  // 路由是 hash：#/track/... → 主 tab 时直接回；全屏播放器开着时返回手势只收播放器。
  let navFrom = '#/home', allowLeaveGuard = false, leaveT = null;
  function armAllowLeave() { allowLeaveGuard = true; clearTimeout(leaveT); leaveT = setTimeout(() => { allowLeaveGuard = false; }, 900); }
  if (typeof window !== 'undefined') window.__tlGuard = () => ({ navFrom, allow: allowLeaveGuard, noGuard: !!window.__NO_GUARD });
  const DETAIL_ROUTE = /^#\/(track|word)\//;
  let lastMainHash = '#/home';                       // 最近一次非详情页：退出详情时的兜底

  /** 不可回退（再返回就退桌面）：问一次是否退出 App */
  function askExitApp() {
    showDialog({
      title: '退出 App？',
      actions: [
        { label: '退出', kind: 'main', onClick: () => nativeBack.exit() },
        { label: '取消' },
      ],
    });
  }

  /** 详情页返回：优先按历史退回列表，没历史就回最近的主 tab */
  function leaveDetail() {
    const fallback = lastMainHash || '#/home';
    if (history.length > 1) goBack(fallback); else go(fallback);
  }

  // 原生 BACK 键/侧滑返回：MainActivity 把事件交给这里，网页决定怎么退（不然原生壳直接 finish 到桌面）
  window.__tlOnBackPressed = () => {
    try {
      const d = $('dlg'); if (d && !d.hidden) { d.hidden = true; return; }
      const p = $('pop'); if (p && p.classList.contains('on')) { hidePop(); return; }
      const pl = $('player'); if (pl && pl.classList.contains('on')) { pl.classList.remove('on'); return; }
      const g = $('gate'); if (g && !g.hidden) { askExitApp(); return; }
      const h = location.hash || '#/home';
      if (DETAIL_ROUTE.test(h)) { leaveDetail(); return; }     // 详情页：直接回，不弹窗
      if (h === '#/home' || h === '') { askExitApp(); return; } // 回不到上一页：问是否退出
      if (history.length > 1) { history.back(); return; }
      askExitApp();
    } catch (e) { /* 退不出去也别崩 */ }
  };

  function onNavGuard() {
    const to = location.hash || '#/home';
    if (typeof window !== 'undefined' && window.__NO_GUARD) { navFrom = to; return; }   // 自动化测试用
    if (allowLeaveGuard) { allowLeaveGuard = false; navFrom = to; return; }             // 自己点的导航：无条件放行一次
    const from = navFrom;
    navFrom = to;
    if (to === from) return;
    const pl = $('player');
    if (DETAIL_ROUTE.test(from) && pl && pl.classList.contains('on')) {
      // 全屏跟唱页开着：先收播放器，不离开详情页
      pl.classList.remove('on');
      allowLeaveGuard = true; go(from);
      return;
    }
    // 其余返回一律直接走，不再二次确认
  }

  // ── 侧滑返回：详情页/播放器里左缘右划（真机边缘手势多被系统截走，最终仍走原生 BACK → __tlOnBackPressed）──
  function swipeBack() {
    const pl = $('player');
    if (pl && pl.classList.contains('on')) { pl.classList.remove('on'); return; }   // 全屏播放器：先收播放器
    window.__tlOnBackPressed();
  }
  if (typeof window !== 'undefined') window.__tlSwipe = () => swipeBack();   // 测试钩子：等价于左缘右划
  (function edgeSwipeBack() {
    let x0 = null, y0 = null;
    const active = () => {
      const pl = $('player');
      if (pl && pl.classList.contains('on')) return true;
      const vt = $('view-track'), vw = $('view-word');
      return !!((vt && !vt.hidden) || (vw && !vw.hidden));
    };
    document.addEventListener('touchstart', (e) => {
      const t = e.touches && e.touches[0]; if (!t) return;
      if (t.clientX > 30 || !active()) return;
      x0 = t.clientX; y0 = t.clientY;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (x0 == null) return;
      const t = e.touches && e.touches[0]; if (!t) return;
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (dx > 72 && Math.abs(dy) < 60 && dx > Math.abs(dy) * 1.4) {
        x0 = null;
        if (e.cancelable) { try { e.preventDefault(); } catch {} }
        swipeBack();
      }
    }, { passive: false });
    const end = () => { x0 = null; y0 = null; };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  })();

  function route() {
    const raw = decodeURIComponent(String(location.hash || '').replace(/^#\/?/, ''));
    const [path, at] = raw.split('@');
    const parts = path.split('/');
    const v = parts[0] || 'home';
    if (v !== 'track' && v !== 'word') lastMainHash = location.hash || '#/home';
    if (v !== 'search') lastNonSearch = '#/' + path;
    if (v === 'word') { show('view-word'); return showWord(parts[1]); }
    if (v === 'track') { show('view-track'); return showTrack(parts[1], at != null && at !== '' ? Number(at) : null); }
    if (v === 'search') { show('view-search'); $('searchwrap').classList.add('on'); $('q').value = parts.slice(1).join('/'); return showSearch(parts.slice(1).join('/')); }
    if (v === 'home') { show('view-home'); return renderHome(); }
    if (v === 'review') { show('view-review'); return renderReview(); }
    if (v === 'songs') { show('view-songs'); return renderSongs(); }
    if (v === 'mine') { show('view-mine'); return renderMine(); }
    if (v === 'me') { show('view-me'); return renderMe(); }
    if (v === 'admin') { show('view-admin'); return renderAdmin(); }
    if (v === 'voicepack') { show('view-voicepack'); return renderVoicepack(); }
    show('view-learn'); renderLearn();
  }

  // ────────────── 启动 ──────────────
  async function boot() {
    loadAcc();
    loadLS();
    applyTheme();
    document.body.classList.toggle('gloss', S.gloss !== false);
    document.body.classList.toggle('ruby', S.ruby !== false);
    let data;
    try { data = await getJson(dataUrl('index.json'), { cache: 'no-cache' }); }
    catch {
      $('view-learn').innerHTML = emptyBox('数据没加载出来', '', [['e-retry', '重试']]);
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
    for (const w of VOCAB) {
      SURF.set(w.word, w);
      // 只收「含汉字」的活用形：forms 里还塞着纯假名的读音（歯→は、田→た、空→から、詩→し），
      // 以前一并当表面形建索引 → 助词「は／から／た」被认成「牙齿／天空／田地」，
      // 逐词中文全是错的（用户反馈「中文逐字对照翻译准确性很差」的根因就是这个）
      for (const f of Object.keys(w.forms || {})) if (/[\u4e00-\u9fff]/.test(f) && !SURF.has(f)) SURF.set(f, w);
    }
    TRACK = new Map(data.tracks.map((t) => [t.id, t]));
    buildDict();
    for (const rec of Object.values(S.imp || {})) {
      if (!rec || !rec.id || TRACK.has(rec.id)) continue;
      const t = impTrack(rec); data.tracks.push(t); TRACK.set(t.id, t);
    }
    indexLibrary();
    const hs = $('headstat'); if (hs) hs.textContent = `${IDX.tracks.length} 首 · ${LIBW.size} 词`;
    $('genat').textContent = '数据生成于 ' + new Date(data.generatedAt).toLocaleString('zh-CN');

    if ($('brand')) $('brand').onclick = () => go('#/home');
    renderAv();
    if ($('btn-av')) $('btn-av').onclick = (e) => { e.stopPropagation(); const d = $('avdrop'); d.hidden = !d.hidden; if (!d.hidden) renderAv(); };
    document.addEventListener('click', (e) => { const d = $('avdrop'); if (d && !d.hidden && !e.target.closest('.avwrap')) d.hidden = true; });
    $('tab-learn').onclick = () => go('#/learn');
    $('tab-songs').onclick = () => go('#/songs');
    $('tab-mine').onclick = () => go('#/mine');
    if ($('tab-me')) $('tab-me').onclick = () => go('#/me');
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
    setupKeyboardAwareSheet();
    $('playbtn').onclick = (e) => { e.stopPropagation(); togglePlay(); };
    $('mb-meta').onclick = () => openPlayer();
    $('mb-loop').onclick = (e) => { e.stopPropagation(); setMode('all'); toast('已退出单句循环'); };
    $('mb-prev').onclick = (e) => { e.stopPropagation(); stepTrack(-1); };
    $('mb-next').onclick = (e) => { e.stopPropagation(); stepTrack(1); };
    $('p-close').onclick = () => $('player').classList.remove('on');
    $('p-play').onclick = () => togglePlay();
    $('p-ptrack').onclick = () => stepTrack(-1);
    $('p-ntrack').onclick = () => stepTrack(1);
    $('p-prev').onclick = () => step(-1);
    $('p-next').onclick = () => step(1);
    // 单句 / 全曲：合成一个开关，点一下换边（两个半区都看得见当前是哪一档）
    $('p-scope').onclick = () => { const to = mode === 'loop' ? 'all' : 'loop'; setMode(to); toast(to === 'loop' ? '单句循环' : '全曲播放'); };
    $('p-order').onclick = () => cycleOrder();
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
    applyControls();                       // 单句/全曲 + 播放顺序：进页面就显示当前档位

    if ($('p-speak')) $('p-speak').innerHTML = icon('volume', 'in') + '发音';
    $('p-speak').onclick = () => speak((popWord && (popWord.reading || popWord.word)) || (popSeg && popSeg.r) || popFallback);
    $('p-close2').onclick = hidePop;
    // 底部「上拉看更多」：点一下展开到 75%；展开态再点标题栏区域可收回
    // 点释义就地改；点罗马音就地改 —— 取代原来那排「改释义 / 罗马音」链接
    const mg = $('p-meaning');
    if (mg) mg.onclick = () => { const e = $('p-edit'); if (e) e.onclick(); };
    const rj = $('p-romaji');
    if (rj) rj.onclick = () => { const e = $('p-roma'); if (e) e.onclick(); };

    const expandBtn = $('p-expand');
    if (expandBtn) expandBtn.onclick = () => {
      const sh = $('pop'); if (!sh) return;
      sh.classList.add('expanded');
      const b = $('p-body'); if (b) b.scrollTop = 0;
    };
    // 把手点一下 = 收起回一阶段（再点一下不会关抽屉，关闭走「更多」里的关闭或下拉）
    const grab = document.querySelector('#pop .grab');
    if (grab) grab.onclick = () => $('pop').classList.remove('expanded');
    $('p-edit').onclick = () => {
      if (!popWord) return;
      const r = $('p-editrow');
      const opening = r.hidden;
      r.hidden = !opening;
      if (opening) { $('p-editinput').value = meaningOf(popWord); $('p-editinput').focus(); }
    };
    $('p-editinput').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const text = e.target.value.trim();
      if (!text) return;
      if (popWord) { S.notes[popWord.id] = Object.assign({}, S.notes[popWord.id], { meaning: text, u: Date.now() }); save(); showPop(popWord); refreshLyricsNow(); return; }
      if (popFallback) {                                    // 词表没收录的词：自己补一条
        setUserWord(popSeg, popFallback, text);
        refreshLyricsNow();
        showPop(null, popFallback, popSeg);
        toast('已记下：' + popFallback + ' = ' + text);
      }
    };
    $('p-known').onclick = () => { if (!popWord) return; toggleKnown(popWord); showPop(popWord); if (curTrack) renderLyrics($('plyric'), curTrack); };
    // ── 罗马音纠正：打开时暂停播放，保存/关闭后继续 ──
    const romaTarget = () => {
      if (!popPos) return null;
      const seg = popSeg, w = popWord;
      const surface = (seg && seg.s) || (w && w.word) || '';
      const reading = (seg && seg.r) || (w && w.reading) || '';
      return surface ? Object.assign({ surface, reading, seg, w }, popPos) : null;
    };
    $('p-roma').onclick = () => {
      const t = romaTarget(); if (!t) return;
      romaCtx = t;
      if (romaboxHint()) romaboxHint().textContent = popWasPlaying ? '暂停中' : '选一个，或自己写';
      const box = $('p-romabox'); if (box) box.hidden = false;
      $('p-romainput').value = romaOf(t.tid, t.li, t.ti) || (t.seg && t.seg.y) || (t.w && t.w.romaji) || '';
      $('p-romacands').dataset.hint = (t.seg && t.seg.s) || t.surface;
      const cands = romaVariants(t.reading);
      $('p-romacands').innerHTML = cands.map((v) => `<button class="chip" data-r="${esc(v)}">${esc(v)}</button>`).join('')
        + (cands.length ? '' : '<span class="meta">这个词没有读音可推，直接手写吧</span>');
      $('p-romacands').querySelectorAll('[data-r]').forEach((el) => (el.onclick = () => { $('p-romainput').value = el.dataset.r; }));
      $('p-romainput').focus();
    };
    const saveRoma = (drop) => {
      if (!romaCtx) return;
      setRoma(romaCtx.tid, romaCtx.li, romaCtx.ti, drop ? '' : $('p-romainput').value, drop);
      const box = $('p-romabox'); if (box) box.hidden = true;
      romaCtx = null;
      refreshLyricsNow();
      if (popWord || popSeg) showPop(popWord, popFallback, popSeg);
      else hidePop();
      toast(drop ? '已还原' : '这一处的罗马音已更新');
    };
    $('p-romasave').onclick = () => saveRoma(false);
    $('p-romareset').onclick = () => saveRoma(true);
    $('p-romainput').onkeydown = (e) => { if (e.key === 'Enter') saveRoma(false); };
    document.addEventListener('click', (e) => {
      const p = $('pop');
      if (!p || !p.classList.contains('on')) return;     // 抽屉没开就别 hidePop：会把例句试听一起停掉
      if (!e.target.closest('#pop') && !e.target.closest('.w') && !e.target.closest('[data-known]')) hidePop();
    });

    // 抽屉开着时，点外面那一下**只用来关抽屉**，不能穿透到下面的歌词（否则会"顺手跳到那一句"）。
    // 必须在 click 的**捕获阶段**吞掉：pointerdown 拦不住后续的 click，而 #plyric 的处理函数是 click。
    // 例外：点在「词」上 = 切到那个词（查词习惯，不吞）
    document.addEventListener('click', (e) => {
      const pop = $('pop');
      if (!pop || !pop.classList.contains('on')) return;
      if (e.target.closest('#pop')) return;
      const wEl = e.target.closest('.w');
      if (wEl && !wEl.dataset.plain) {
        // 只有「当前这一句里的词」才允许换成它（同句查词顺手）；别的句的词一律先关抽屉
        const blk = wEl.closest('.lblock[data-i]');
        const li = blk ? Number(blk.dataset.i) : null;
        const cur = curLineIdx();
        if (li != null && cur >= 0 && li === Number(cur)) return;
      }
      hidePop();
      e.stopPropagation();
      e.preventDefault();
    }, true);

    // 底部抽屉手势：只在「把手」和「上拉看更多」上跟手，且只跟向下 ——
    // 之前挂在整块 .sheet 上，会在内部滚动词条时抢手势 → 卡顿/乱跳，向上拖还能把抽屉整个拎起来。
    (function sheetPull() {
      const sh = $('pop'); if (!sh) return;
      const body = $('p-body');
      const zones = [sh.querySelector('.grab'), $('p-expand')].filter(Boolean);
      let y0 = null, dy = 0, raf = 0;
      const paint = () => {
        raf = 0;
        // 只向下跟手；向上不给位移（靠松手后的 snap 展开）
        sh.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
      };
      const start = (e) => { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; };
      const move = (e) => {
        if (y0 == null) return;
        dy = e.touches[0].clientY - y0;
        if (!raf) raf = requestAnimationFrame(paint);          // rAF 节流，别每个 touchmove 都写样式
      };
      const end = () => {
        if (y0 == null) return;
        cancelAnimationFrame(raf); raf = 0;
        const d = dy;
        sh.style.transition = ''; sh.style.transform = '';
        y0 = null; dy = 0;
        if (d > 80) {
          if (sh.classList.contains('expanded')) sh.classList.remove('expanded');  // 先收回一阶段
          else hidePop();                                                          // 再拉就关
        } else if (d < -40) {
          sh.classList.add('expanded');
          if (body) body.scrollTop = 0;
        }
      };
      zones.forEach((el) => {
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchmove', move, { passive: true });
        el.addEventListener('touchend', end);
        el.addEventListener('touchcancel', end);
      });
    })();
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowDown') step(1);
      if (e.key === 'ArrowUp') step(-1);
      if (e.key === 'l' || e.key === 'L') setMode(mode === 'loop' ? 'all' : 'loop');
      if (e.key === 'o' || e.key === 'O') cycleOrder();
      if (e.key === 'Escape') { $('player').classList.remove('on'); hidePop(); }
    });
    $('p-nosrc').onclick = () => {
      $('player').classList.remove('on');
      const box = $('srcbox');
      if (box) { box.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if ($('nidinput')) $('nidinput').focus();
    };
    if ($('pickfile')) $('pickfile').onclick = async () => {
      if (!curTrack) return;
      let f = null;
      try { f = await mediaStore.pick(); } catch (e) { toast('打开选择器失败：' + (e && e.message || e)); return; }
      if (!f) return;
      if (f.error) { toast('导入失败：' + f.error); return; }
      S.audio[curTrack.id] = { type: 'local', key: f.key, path: f.path, name: f.name };
      delete curTrack.audioOss;
      save();
      $('srcinfo').textContent = describeSource(curTrack);
      if ($('localfile')) $('localfile').textContent = f.name ? `${f.name} · ${(f.size / 1048576).toFixed(1)}MB` : '';
      audio.removeAttribute('src');
      toast('已绑定本机音频，正在起播…');
      playTrack(curTrack);
    };
    $('nidsave').onclick = () => {
      if (!curTrack) return;
      const raw = $('nidinput').value.trim();
      const qq = raw.match(/songDetail\/([A-Za-z0-9]{10,})/) || (/^[A-Za-z0-9]{12,16}$/.test(raw) ? [null, raw] : null);
      const m = raw.match(/(\d{3,})/);
      const prev = S.audio[curTrack.id];
      if (prev && prev.type === 'local') mediaStore.remove(prev);      // 换回在线源：本机那份不再需要
      if (qq) S.audio[curTrack.id] = { type: 'tencent', nid: qq[1] };
      else if (m) S.audio[curTrack.id] = { type: 'netease', nid: m[1] };
      else { alert('没识别出歌曲 ID（网易云数字 ID 或 QQ 歌曲 mid 都行）'); return; }
      save(); $('srcinfo').textContent = describeSource(curTrack); toast('已绑定');
    };
    function togglePlay() {
      if (!curTrack) return;
      if (audio.getAttribute('data-tid') !== curTrack.id || !audio.src) {
        const p0 = (S.pos || {})[curTrack.id];
        playTrack(curTrack, p0 > 5 ? { at: p0 } : {});     // 开屏恢复的那首：从上次听到的地方继续
        return;
      }
      if (audio.paused) { if (audio.error || audio.readyState === 0) playTrack(curTrack); else audio.play().catch(() => {}); }
      else audio.pause();
    }
    if (!location.hash) history.replaceState(null, '', '#/home');   // 用 replaceState：别触发 hashchange（否则闸门后面的页面会被渲染出来）
    navFrom = location.hash || '#/home';
    window.addEventListener('hashchange', onNavGuard);                 // 先挂守卫：误触退出要拦下来问一句
    window.addEventListener('hashchange', route);                     // 闸门也要挂：登录后靠它路由
    if (!ACC || !ACC.token) { showGate(); return; }   // 必须登录才能用
    route();
    if (!location.hash.startsWith('#/track/')) restoreBar();   // 开屏页显示上次那首（暂停，点了才播）
    // 打开页面先跟账号对一次：本机空的就恢复，本机有的就并上去
    if (S.autoSync !== false) setTimeout(() => syncNow({ auto: true }), 600);
    apiCall('/me').then((r) => { if (r && r.user) { ACC.name = r.user.name; ACC.admin = !!r.user.admin; ACC.avatar = r.user.avatar || ACC.avatar || ''; saveAcc(); renderAv(); if (location.hash.startsWith('#/mine')) renderMine(); else if (location.hash.startsWith('#/me') || location.hash.startsWith('#/admin')) route(); } }).catch(() => {});
    // 老数据补分词：只补没有 segs 的（静默，慢一点没关系）；测试里不跑
    if (!window.__NO_BACKFILL && Object.keys(S.imp || {}).length) setTimeout(() => backfillSegs(), 4000);
    setTimeout(() => gcLocalAudio(), 3000);            // 清掉没人认领的本机音频副本
    if (appUpdater.available && !window.__NO_BACKFILL) setTimeout(() => checkApk(false), 2500);   // 静默查一次新版本
    setTimeout(voicePackPrompt, 1800);
    // 歌单体检：一天一次（静默，别打扰）；测试里用 window.__NO_PLCHECK 关掉
    if (!window.__NO_PLCHECK && impPlaylists().length && Date.now() - (S.plCheckAt || 0) > PL_CHECK_EVERY) {
      setTimeout(() => checkPlaylists({ silent: true }), 9000);
    }
  }
  boot();
})();
