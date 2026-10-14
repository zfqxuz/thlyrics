/**
 * thlyrics 账号 / 同步 API（阿里云函数计算 FC 3.0，HTTP 触发器）
 *
 * 无第三方依赖：口令用 node:crypto 的 scrypt 加盐哈希，令牌是 HMAC 签名，
 * 数据挂在用户自己 OSS 桶的 sync/users/ 前缀下（每个账号两个对象）。
 *
 * 路由：
 *   GET  /api/health
 *   GET  /api/resolve   ?q=<链接/分享文案/ID>      歌曲/专辑/歌单解析：网易云（含 163cn.tv 短链）+ QQ音乐（y.qq.com / c6.y.qq.com 短链）
 *   GET  /api/audio     ?id=<歌曲id>&br=320&source=  取可播地址（netease / tencent）
 *   GET  /api/lyric     ?id=<歌曲id>&source=         取歌词 + 中文翻译
 *   POST /api/segment   {lines:[...]}               kuromoji 分词（词性/读音/辞书形）
 *   POST /api/register  {name, pass}
 *   POST /api/login     {name, pass}
 *   GET  /api/me
 *   POST /api/password  {old, new}
 *   GET  /api/data
 *   PUT  /api/data      {data}
 */
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const ENV = process.env;
const OSS_HOST = ENV.OSS_HOST || 'thlyrics-audio.oss-cn-hangzhou.aliyuncs.com';
const OSS_BUCKET = ENV.OSS_BUCKET || 'thlyrics-audio';
const PREFIX = 'sync/users/';
const TOKEN_DAYS = 180;
const ALLOW = (ENV.ALLOW_ORIGINS || 'https://zfqxuz.github.io,http://127.0.0.1:8848,http://localhost:8848').split(',');
const ADMINS = (ENV.ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);   // 管理员用户名（环境变量，可选）
const MAX_BODY = 8 * 1024 * 1024;      // 单次请求体上限
const AVATAR_MAX = 80000;              // 头像 data URL 上限（前端会压到 128×128 jpeg，约 6~12KB）
/** 头像只收「128 小图」的 data URL，超了/格式不对就当没有 */
function cleanAvatar(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return '';
  return s.length <= AVATAR_MAX ? s : '';
}
const MAX_STORE = 12 * 1024 * 1024;    // 每个账号记录的存储上限

// ─────────── OSS 读写（V1 签名，手写，避免打包依赖） ───────────
const b64 = (b) => Buffer.from(b).toString('base64');
function ossRequest(method, key, body, contentType, raw) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const md5 = body ? crypto.createHash('md5').update(body).digest('base64') : '';
    const ctype = body ? (contentType || 'application/json') : '';
    const canon = `/${OSS_BUCKET}/${key}`;
    const sts = [method, md5, ctype, date, canon].join('\n');
    const sig = crypto.createHmac('sha1', ENV.OSS_SK).update(sts).digest('base64');
    const req = https.request({
      host: OSS_HOST, method, path: '/' + key.split('/').map(encodeURIComponent).join('/'),
      headers: Object.assign({
        Date: date,
        Authorization: `OSS ${ENV.OSS_AK}:${sig}`,
      }, body ? { 'Content-Type': ctype, 'Content-MD5': md5, 'Content-Length': Buffer.byteLength(body) } : {}),
      timeout: 15000,
    }, (res) => {
      let buf = [];
      res.on('data', (d) => buf.push(d));
      res.on('end', () => {
        const all = Buffer.concat(buf);
        resolve({ status: res.statusCode, body: raw ? all : all.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('oss timeout')); });
    if (body) req.write(body);
    req.end();
  });
}
async function ossGetJson(key) {
  const r = await ossRequest('GET', key);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error('oss get ' + r.status + ' ' + key);
  try { return JSON.parse(r.body); } catch { return null; }
}
/** 列对象（V1 签名，prefix 过滤，最多 1000 个） */
function ossList(prefix) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const q = { 'max-keys': '1000', prefix: prefix || '' };
    // ⚠️ OSS V1 签名里「只有 sub-resource 才进 CanonicalizedResource」，prefix / max-keys 都不算
    const canon = `/${OSS_BUCKET}/`;
    const sts = ['GET', '', '', date, canon].join('\n');
    const sig = crypto.createHmac('sha1', ENV.OSS_SK).update(sts).digest('base64');
    const path = '/?' + Object.keys(q).sort().map((k) => `${k}=${encodeURIComponent(q[k]).replace(/%2F/gi, '/')}`).join('&');
    const req = https.request({ host: OSS_HOST, method: 'GET', path, headers: { Date: date, Authorization: `OSS ${ENV.OSS_AK}:${sig}` }, timeout: 15000 }, (res) => {
      const buf = [];
      res.on('data', (d) => buf.push(d));
      res.on('end', () => {
        const xml = Buffer.concat(buf).toString('utf8');
        if (res.statusCode !== 200) return resolve([]);
        const files = [];
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const c = m[1];
          const g = (tag) => { const r = c.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)); return r ? r[1] : ''; };
          files.push({ key: g('Key'), size: Number(g('Size')) || 0, at: g('LastModified') });
        }
        resolve(files);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('oss list timeout')));
    req.end();
  });
}
async function ossDelete(key) {
  const r = await ossRequest('DELETE', key);
  return r.status === 204 || r.status === 200;
}
async function requireAdmin(req) {
  const me = userOf(req);
  if (!me) return { err: reply(req, 401, { error: '请先登录' }) };
  const acct = await ossGetJson(acctKey(me.sub));
  const isAdmin = (acct && acct.admin) || ADMINS.indexOf(String(me.name || '').toLowerCase()) >= 0;
  if (!isAdmin) return { err: reply(req, 403, { error: '需要管理员账号' }) };
  return { me, acct };
}

async function ossPutJson(key, obj) {
  const r = await ossRequest('PUT', key, Buffer.from(JSON.stringify(obj), 'utf8'), 'application/json');
  if (r.status !== 200) throw new Error('oss put ' + r.status + ' ' + key);
  return true;
}

// ─────────── 账号 ───────────
const rid = (n) => crypto.randomBytes(n).toString('hex');
const nameOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_\u4e00-\u9fa5-]{2,20}$/.test(s);
const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 64).toString('hex');
const tokenFor = (uid, name) => {
  const payload = b64(JSON.stringify({ sub: uid, name, exp: Date.now() + TOKEN_DAYS * 864e5 })).replace(/=/g, '');
  return payload + '.' + crypto.createHmac('sha256', ENV.TOKEN_SECRET).update(payload).digest('hex').slice(0, 40);
};
function verifyToken(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [p, sig] = tok.split('.');
  const expect = crypto.createHmac('sha256', ENV.TOKEN_SECRET).update(p).digest('hex').slice(0, 40);
  if (sig !== expect) return null;
  try {
    const j = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!j.exp || j.exp < Date.now()) return null;
    return j;
  } catch { return null; }
}
const acctKey = (uid) => `${PREFIX}${uid}/account.json`;
const dataKey = (uid) => `${PREFIX}${uid}/data.json`;
const INDEX_KEY = `${PREFIX}_index.json`;

// ─────────── 记录合并（和时间戳规则同前端：谁改得晚听谁的） ───────────
const n0 = (v) => (Number(v) || 0);
function mergeStates(a, b) {
  const A = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, clearedAt: 0 }, a || {});
  const B = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, clearedAt: 0 }, b || {});
  const out = { clearedAt: Math.max(n0(A.clearedAt), n0(B.clearedAt)) };
  out.known = {};
  for (const k of new Set([...Object.keys(A.known), ...Object.keys(B.known)])) {
    const x = n0(A.known[k]), y = n0(B.known[k]);
    const v = Math.abs(y) > Math.abs(x) ? y : x;
    if (v && Math.abs(v) > out.clearedAt) out.known[k] = v;
  }
  for (const kind of ['fav', 'sing']) {          // 收藏 / 会唱：同样取时间戳更新的一条
    out[kind] = {};
    for (const k of new Set([...Object.keys(A[kind]), ...Object.keys(B[kind])])) {
      const x = n0(A[kind][k]), y = n0(B[kind][k]);
      const v = Math.abs(y) > Math.abs(x) ? y : x;
      if (v) out[kind][k] = v;
    }
  }
  out.notes = {};
  for (const k of new Set([...Object.keys(A.notes), ...Object.keys(B.notes)])) {
    const x = A.notes[k] || {}, y = B.notes[k] || {};
    const v = n0(y.u) > n0(x.u) ? y : x;
    if (v && v.meaning && (n0(v.u) > out.clearedAt || !out.clearedAt)) out.notes[k] = v;
  }
  out.roma = {};                                    // 罗马音纠正
  for (const k of new Set([...Object.keys(A.roma), ...Object.keys(B.roma)])) {
    const x = A.roma[k] || {}, y = B.roma[k] || {};
    const v = n0(y.u) > n0(x.u) ? y : x;
    if (v && v.y) out.roma[k] = v;
  }
  out.audio = Object.assign({}, B.audio, A.audio);
  out.del = Object.assign({}, B.del);
  for (const [k, v] of Object.entries(A.del)) out.del[k] = Math.max(n0(out.del[k]), n0(v));
  out.imp = {};
  for (const k of new Set([...Object.keys(A.imp), ...Object.keys(B.imp)])) {
    const x = A.imp[k] || {}, y = B.imp[k] || {};
    const v = n0(y.at) > n0(x.at) ? y : x;
    if (n0(out.del[k]) > n0(v.at)) continue;
    out.imp[k] = v;
  }
  return out;
}

// ─────────── HTTP ───────────
function reply(event, statusCode, obj) {
  const origin = (event.headers && (event.headers.Origin || event.headers.origin)) || '';
  const allow = ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0];
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': allow,
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'access-control-max-age': '86400',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(obj),
  };
}
const userOf = (event) => verifyToken(((event.headers && (event.headers.Authorization || event.headers.authorization)) || '').replace(/^Bearer\s+/i, ''));


// ─────────── 网易云解析（歌单 / 专辑 / 单曲，含 163cn.tv 手机短链） ───────────
const NET_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const NET_HEADERS = {
  'User-Agent': NET_UA, Referer: 'https://music.163.com/', Cookie: 'os=pc; appver=2.9.7;',
  Accept: 'application/json, text/plain, */*',
};

function httpGet(url, headers, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      host: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: headers || {}, timeout: timeout || 12000,
    }, (res) => {
      const buf = [];
      res.on('data', (d) => buf.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, location: res.headers.location,
        body: Buffer.concat(buf).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('上游超时')));
    req.end();
  });
}

/** 从一段分享文案里认出「平台 + 类型 + ID」；认不出类型但带链接时，返回 url 交给 follow 解析 */
function shareHit(text) {
  const s = String(text || '');
  const url = (s.match(/https?:\/\/[^\s"'<>，,、）)】]+/) || [])[0] || '';
  const scan = url || s;
  if (/y\.qq\.com|c\.y\.qq\.com|i\.y\.qq\.com|u\.y\.qq\.com|url\.cn|c6\.y\.qq\.com/i.test(scan)) {
    const qq = [
      [/songDetail\/([A-Za-z0-9]{10,})/i, 'song'], [/albumDetail\/([A-Za-z0-9]{10,})/i, 'album'], [/playlist\/(\d{5,})/i, 'playlist'],
      [/\/song\/([A-Za-z0-9]{10,})\.html/i, 'song'], [/\/album\/([A-Za-z0-9]{10,})\.html/i, 'album'], [/\/playlist\/(\d{5,})\.html/i, 'playlist'],
      [/songmid=([A-Za-z0-9]{10,})/i, 'song'], [/albummid=([A-Za-z0-9]{10,})/i, 'album'], [/disstid=(\d{5,})/i, 'playlist'],
    ];
    for (const [re, type] of qq) { const m = scan.match(re); if (m) return { src: 'tencent', type, id: m[1] }; }
    return { src: 'tencent', type: '', id: '', url };
  }
  const pats = [
    [/playlist[^\d]{0,24}(\d{5,})/i, 'playlist'],
    [/album[^\d]{0,24}(\d{5,})/i, 'album'],
    [/song[^\d]{0,24}(\d{5,})/i, 'song'],
    [/program[^\d]{0,24}(\d{5,})/i, 'program'],
  ];
  for (const [re, type] of pats) { const m = scan.match(re); if (m) return { src: 'netease', type, id: m[1] }; }
  const bare = s.trim().match(/^(\d{5,})$/);
  if (bare) return { src: 'netease', type: 'playlist', id: bare[1] };
  const bareQq = s.trim().match(/^([A-Za-z0-9]{12,16})$/);
  if (bareQq) return { src: 'tencent', type: 'song', id: bareQq[1] };
  return url ? { src: '', type: '', id: '', url } : null;
}

/** 跟进 302（163cn.tv 这类手机短链），最多 6 跳；顺便在响应体里兜底找链接 */
async function followShort(url) {
  let cur = url, body = '';
  for (let i = 0; i < 6; i++) {
    const r = await httpGet(cur, { 'User-Agent': NET_UA, Accept: 'text/html,*/*' }, 10000);
    if (r.status >= 300 && r.status < 400 && r.location) {
      cur = new URL(r.location, cur).href;
      const hit = shareHit(cur);
      if (hit && hit.type) return hit;
      if (/music\.163\.com/.test(cur) === false) continue;
      continue;
    }
    body = r.body || '';
    break;
  }
  for (const src of [cur, body]) {
    const hit = shareHit(src);
    if (hit && hit.type) return hit;
    const m = String(src).match(/https?:\/\/music\.163\.com\/[^\s"'<>\\]+/);
    if (m) { const h2 = shareHit(m[0]); if (h2 && h2.type) return h2; }
  }
  return null;
}

// ─────────── 分词：kuromoji(IPADIC)。词典 18MB 放 OSS，冷启动拉到 /tmp 后复用 ───────────
const KURO_DIR = '/tmp/kuromoji-dict';
const KURO_PREFIX = 'kuromoji/dict/';
const KURO_FILES = ['base.dat.gz', 'cc.dat.gz', 'check.dat.gz', 'tid.dat.gz', 'tid_map.dat.gz', 'tid_pos.dat.gz',
  'unk.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz', 'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz'];
let TOKENIZER = null;

async function ensureTokenizer() {
  if (TOKENIZER) return TOKENIZER;
  TOKENIZER = (async () => {
    if (!fs.existsSync(KURO_DIR)) fs.mkdirSync(KURO_DIR, { recursive: true });
    for (const f of KURO_FILES) {
      const p = path.join(KURO_DIR, f);
      if (fs.existsSync(p) && fs.statSync(p).size > 0) continue;
      const r = await ossRequest('GET', KURO_PREFIX + f, null, null, true);
      if (r.status !== 200) throw new Error('词典拉取失败 ' + f + '（' + r.status + '）');
      fs.writeFileSync(p, r.body);
    }
    const kuromoji = require('./vendor/kuromoji');
    return await new Promise((res, rej) => kuromoji.builder({ dicPath: KURO_DIR }).build((e, t) => (e ? rej(e) : res(t))));
  })().catch((e) => { TOKENIZER = null; throw e; });
  return TOKENIZER;
}

/** 片假名 → 平假名（读音显示用） */
const toHira = (s) => String(s || '').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// ─────────── QQ 音乐 ───────────
const QQ_HEADERS = { 'User-Agent': NET_UA, Referer: 'https://y.qq.com/' };
const QQ_LYRIC_HEADERS = { 'User-Agent': NET_UA, Referer: 'https://y.qq.com/portal/player.html' };

async function qqJson(url, headers) {
  const r = await httpGet(url, headers || QQ_HEADERS, 12000);
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  try { return JSON.parse(r.body); } catch { throw new Error('返回不是 JSON'); }
}
const qqCover = (albm) => (albm ? `https://y.qq.com/music/photo_new/T002R300x300M000${albm}.jpg` : '');
const qqTrack = (x) => ({
  id: x.songmid || x.mid, name: x.songname || x.name || '',
  ar: (x.singer || x.singers || []).map((a) => ({ name: a && (a.name || a.title) })).filter((a) => a.name),
  al: { name: x.albumname || (x.album && (x.album.name || x.album.title)) || '',
    picUrl: qqCover(x.albummid || (x.album && x.album.mid)) },
});

const QQ_CACHE = new Map();     // { type:id → meta }，热实例内复用
async function qqMeta(hit) {
  const key = 'qq:' + hit.type + ':' + hit.id;
  const c = QQ_CACHE.get(key);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.v;
  let out;
  if (hit.type === 'song') {
    const j = await qqJson(`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${encodeURIComponent(hit.id)}&platform=yqq&format=json`);
    const t = qqTrack((j.data || [])[0] || {});
    if (!t.id) throw new Error('这首歌读不到');
    out = { type: 'song', id: t.id, name: t.name, cover: t.al.picUrl, tracks: [t] };
  } else if (hit.type === 'album') {
    const j = await qqJson(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(hit.id)}&format=json&newsong=1&platform=yqq`);
    const d = j.data || {};
    const tracks = (d.list || []).map(qqTrack).filter((t) => t.id);
    if (!tracks.length) throw new Error('这张专辑里读不到歌');
    out = { type: 'album', id: hit.id, name: d.albumname || d.name || '', cover: qqCover(d.albummid || hit.id), tracks };
  } else {
    const j = await qqJson(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?id=${encodeURIComponent(hit.id)}&format=json&newsong=1&platform=yqq`);
    const d = ((j.data || {}).cdlist || [])[0] || {};
    const tracks = (d.songlist || []).map(qqTrack).filter((t) => t.id);
    if (!tracks.length) throw new Error('这张歌单里读不到歌');
    out = { type: 'playlist', id: String(d.disstid || hit.id), name: d.dissname || '', cover: qqCover(d.album_pic_mid), total: tracks.length, tracks };
  }
  if (QQ_CACHE.size > 60) QQ_CACHE.clear();
  QQ_CACHE.set(key, { at: Date.now(), v: out });
  return out;
}

/** QQ 取流：vkey（免费曲给 purl，会员/下架返回空） */
async function qqAudio(id) {
  const key = 'qqa:' + id;
  const c = QQ_CACHE.get(key);
  if (c && Date.now() - c.at < 3 * 60 * 1000) return c.v;
  const body = { req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey',
    param: { guid: '10000', songmid: [id], songtype: [0], uin: '0', loginflag: 1, platform: '20' } },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 } };
  const j = await qqJson('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' + encodeURIComponent(JSON.stringify(body)));
  const d = (j.req_0 && j.req_0.data) || {};
  const m = (d.midurlinfo || [])[0] || {};
  const out = m.purl ? { url: String((d.sip || [])[0] + m.purl).replace(/^http:/, 'https:'), br: 128000, size: 0, expi: 600 } : null;
  if (QQ_CACHE.size > 60) QQ_CACHE.clear();
  QQ_CACHE.set(key, { at: Date.now(), v: out });
  return out;
}

const normTrack = (x) => ({
  id: x.id, name: x.name || '',
  ar: (x.ar || x.artists || []).map((a) => ({ name: a && a.name })).filter((a) => a.name),
  al: { name: ((x.al || x.album || {}).name) || '', picUrl: ((x.al || x.album || {}).picUrl) || '' },
});

async function netJson(url) {
  const r = await httpGet(url, NET_HEADERS, 12000);
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  try { return JSON.parse(r.body); } catch { throw new Error('返回不是 JSON'); }
}

const RESOLVE_CACHE = new Map();   // 热实例内缓存，避免重复打网易云
const AUDIO_CACHE = new Map();     // 直链有效期约 20 分钟，缓存 8 分钟足够
const numId = (v) => { const s = String(v == null ? '' : v).replace(/\D/g, ''); return /^\d{3,}$/.test(s) ? s : ''; };

async function netAudio(id, br) {
  const k = id + ':' + br;
  const c = AUDIO_CACHE.get(k);
  if (c && Date.now() - c.at < 8 * 60 * 1000) return c.v;
  const j = await netJson(`https://music.163.com/api/song/enhance/player/url?id=${id}&ids=%5B${id}%5D&br=${br * 1000}`);
  const d = (j.data || [])[0] || {};
  const out = d.url ? { url: String(d.url).replace(/^http:/, 'https:'), br: d.br, size: d.size, expi: d.expi } : null;
  if (AUDIO_CACHE.size > 200) AUDIO_CACHE.clear();
  AUDIO_CACHE.set(k, { at: Date.now(), v: out });
  return out;
}
async function neteaseMeta(hit) {
  const key = hit.type + ':' + hit.id;
  const c = RESOLVE_CACHE.get(key);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.v;
  let out;
  if (hit.type === 'playlist') {
    const j = await netJson('https://music.163.com/api/v6/playlist/detail?id=' + hit.id);
    const p = j.playlist || {};
    out = { type: 'playlist', id: String(hit.id), name: p.name || '', cover: p.coverImgUrl || '',
      total: (p.trackIds || []).length, tracks: [] };      // 曲目表由前端走解析接口拿（那边一次能拿整张）
  } else if (hit.type === 'album') {
    const j = await netJson('https://music.163.com/api/v1/album/' + hit.id);
    const a = j.album || {};
    out = { type: 'album', id: String(hit.id), name: a.name || '', cover: a.picUrl || '',
      tracks: (j.songs || []).map(normTrack) };
  } else {
    const j = await netJson('https://music.163.com/api/song/detail/?ids=%5B' + hit.id + '%5D');
    const tracks = (j.songs || []).map(normTrack);
    if (!tracks.length) throw new Error('这首歌读不到');
    out = { type: 'song', id: String(hit.id), name: tracks[0].name, cover: tracks[0].al.picUrl, tracks };
  }
  if (RESOLVE_CACHE.size > 80) RESOLVE_CACHE.clear();
  RESOLVE_CACHE.set(key, { at: Date.now(), v: out });
  return out;
}

exports.handler = async (event) => {
  let req = event;
  if (Buffer.isBuffer(event)) { try { req = JSON.parse(event.toString('utf8')); } catch { req = {}; } }
  else if (typeof event === 'string') { try { req = JSON.parse(event); } catch { req = {}; } }
  const method = ((req.requestContext && req.requestContext.http && req.requestContext.http.method) || 'GET').toUpperCase();
  const path = (req.rawPath || '/').replace(/\/+$/, '') || '/';
  const q = req.queryParameters || req.queryStringParameters || {};
  let body = {};
  if (req.body) {
    const raw = req.isBase64Encoded ? Buffer.from(req.body, 'base64').toString('utf8') : req.body;
    if (raw.length > MAX_BODY) return reply(req, 413, { error: '数据太大' });
    try { body = JSON.parse(raw); } catch { return reply(req, 400, { error: 'body 不是 JSON' }); }
  }
  if (method === 'OPTIONS') return reply(req, 204, {});
  const want = q.token ? { auth: q.token } : {};

  try {
    // 页面会从 OSS 的静态 JSON 里读这个地址，允许 ?action=xxx 这种便于排查
    const action = q.action ? '/' + q.action.replace(/^\/+/, '') : path.replace(/^\/api/, '');

    if (action === '/health' || path === '/' || path === '/health') {
      return reply(req, 200, { ok: true, service: 'thlyrics-auth', version: 1, time: new Date().toISOString() });
    }


    // 分词：导入的歌在入库时就分好（比前端贪心匹配准得多）
    if (action === '/segment' && (method === 'POST' || method === 'GET')) {
      let lines = body.lines;
      if (!Array.isArray(lines) && q.lines) { try { lines = JSON.parse(String(q.lines)); } catch { lines = null; } }
      if (!Array.isArray(lines) || !lines.length) return reply(req, 400, { error: '缺 lines' });
      lines = lines.slice(0, 300).map((x) => String(x == null ? '' : x).slice(0, 400));
      try {
        const tk = await ensureTokenizer();
        const segs = lines.map((text) => tk.tokenize(text)
          .map((t) => [t.surface_form, t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form,
            t.reading && t.reading !== '*' ? toHira(t.reading) : '', t.pos, t.pos_detail_1])
          .filter((t) => String(t[0]).trim() !== ''));
        return reply(req, 200, { ok: true, segs });
      } catch (e) { return reply(req, 500, { error: '分词失败：' + String((e && e.message) || e) }); }
    }

    // 音频直链 / 歌词：走自己的函数，前端不吃第三方限流和跨域（公开接口，不要求登录）
    if (action === '/audio') {
      const src = String(q.source || 'netease');
      // 网易云是纯数字 id，QQ 是 songmid（字母数字混合），别用同一套校验
      const id = src === 'tencent' ? String(q.id || '').trim().slice(0, 32) : numId(q.id);
      if (src === 'tencent' ? !/^[A-Za-z0-9]{10,}$/.test(id) : !id) return reply(req, 400, { error: 'id 不对' });
      const br = Math.min(999, Math.max(64, Number(q.br) || 320));
      try {
        const a = src === 'tencent' ? await qqAudio(id) : await netAudio(id, br);
        if (!a) return reply(req, 404, { error: '这首歌没有可播地址（可能要会员或已下架）' });
        return reply(req, 200, Object.assign({ ok: true }, a));
      } catch (e) { return reply(req, 502, { error: (src === 'tencent' ? 'QQ音乐' : '网易云') + '读不到：' + String((e && e.message) || e) }); }
    }

    if (action === '/lyric') {
      const src = String(q.source || 'netease');
      if (src === 'tencent') {
        const id = String(q.id || '').trim().slice(0, 32);
        if (!/^[A-Za-z0-9]{10,}$/.test(id)) return reply(req, 400, { error: 'id 不对' });
        try {
          const j = await qqJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(id)}&format=json&nobase64=1&g_tk=5381`, QQ_LYRIC_HEADERS);
          return reply(req, 200, { ok: true, lyric: j.lyric || '', tlyric: j.trans || '' });
        } catch (e) { return reply(req, 502, { error: 'QQ音乐读不到：' + String((e && e.message) || e) }); }
      }
      const id = numId(q.id);
      if (!id) return reply(req, 400, { error: 'id 不对' });
      try {
        const j = await netJson(`https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`);
        return reply(req, 200, { ok: true, lyric: (j.lrc && j.lrc.lyric) || '', tlyric: (j.tlyric && j.tlyric.lyric) || '' });
      } catch (e) { return reply(req, 502, { error: '网易云读不到：' + String((e && e.message) || e) }); }
    }

    // 网易云解析：短链 / 歌单 / 专辑 / 单曲（公开接口，不要求登录）
    if (action === '/resolve') {
      const text = String(q.q || q.text || '').slice(0, 800);
      if (!text) return reply(req, 400, { error: '缺 q 参数' });
      let hit = shareHit(text);
      if (!hit) return reply(req, 400, { error: '没识别出链接，粘网易云分享链接或 ID' });
      if (!hit.type) {
        try { hit = await followShort(hit.url); }
        catch (e) { return reply(req, 502, { error: '短链打不开：' + String((e && e.message) || e) }); }
      }
      if (!hit || !hit.type) return reply(req, 400, { error: '链接里没有歌曲 / 专辑 / 歌单 ID' });
      if (hit.type === 'program') return reply(req, 400, { error: '电台节目暂不支持' });
      const src = hit.src || 'netease';
      try { return reply(req, 200, Object.assign({ ok: true, src }, await (src === 'tencent' ? qqMeta : neteaseMeta)(hit))); }
      catch (e) { return reply(req, 502, { error: (src === 'tencent' ? 'QQ音乐' : '网易云') + '读不到：' + String((e && e.message) || e) }); }
    }

    if (action === '/register' && method === 'POST') {
      const name = String(body.name || '').trim(), pass = String(body.pass || '');
      if (!nameOk(name)) return reply(req, 400, { error: '用户名要 2~20 位，字母/数字/下划线/中文' });
      if (pass.length < 6) return reply(req, 400, { error: '密码至少 6 位' });
      const key = name.toLowerCase();
      const index = (await ossGetJson(INDEX_KEY)) || {};
      if (index[key]) return reply(req, 409, { error: '这个用户名已经被用了' });
      const uid = rid(8);
      const salt = rid(16);
      const first = Object.keys(index).length === 0;      // 第一个注册的就是管理员
      const avatar = cleanAvatar(body.avatar);
      const acct = { uid, name, nameLower: key, salt, hash: hashPass(pass, salt), avatar, createdAt: new Date().toISOString(),
        admin: first || ADMINS.indexOf(key) >= 0 };
      await ossPutJson(acctKey(uid), acct);
      index[key] = uid;
      await ossPutJson(INDEX_KEY, index);
      if (body.data) await ossPutJson(dataKey(uid), { v: 1, at: new Date().toISOString(), data: body.data });
      return reply(req, 200, { ok: true, token: tokenFor(uid, name), user: { uid, name, admin: !!acct.admin, avatar: acct.avatar || '' } });
    }

    if (action === '/login' && method === 'POST') {
      const name = String(body.name || '').trim().toLowerCase(), pass = String(body.pass || '');
      const index = (await ossGetJson(INDEX_KEY)) || {};
      const uid = index[name];
      if (!uid) return reply(req, 401, { error: '用户名或密码不对' });
      const acct = await ossGetJson(acctKey(uid));
      if (!acct || hashPass(pass, acct.salt) !== acct.hash) return reply(req, 401, { error: '用户名或密码不对' });
      const adm = !!acct.admin || ADMINS.indexOf(String(acct.nameLower || '').toLowerCase()) >= 0;
      return reply(req, 200, { ok: true, token: tokenFor(uid, acct.name), user: { uid, name: acct.name, admin: adm, avatar: acct.avatar || '' } });
    }

    // 余下的都要登录
    const me = userOf(req);
    if (!me) return reply(req, 401, { error: '请先登录' });

    if (action === '/me') {
      const acct0 = await ossGetJson(acctKey(me.sub));
      const adm = !!((acct0 && acct0.admin) || ADMINS.indexOf(String(me.name || '').toLowerCase()) >= 0);
      return reply(req, 200, { ok: true, user: { uid: me.sub, name: me.name, admin: adm, avatar: (acct0 && acct0.avatar) || '' } });
    }

    if (action === '/avatar' && method === 'POST') {
      const acct = await ossGetJson(acctKey(me.sub));
      if (!acct) return reply(req, 404, { error: '账号不存在' });
      acct.avatar = cleanAvatar(body.avatar);
      await ossPutJson(acctKey(me.sub), acct);
      return reply(req, 200, { ok: true, avatar: acct.avatar });
    }

    // ── 管理员：看 / 删 OSS 上的文件（只允许 sync/ 和 audio/ 前缀） ──
    if (action === '/admin/files') {
      const a = await requireAdmin(req);
      if (a.err) return a.err;
      const prefix = String(q.prefix || '').replace(/^\/+/, '');
      const files = await ossList(prefix);
      return reply(req, 200, { ok: true, prefix, files, total: files.reduce((n, f) => n + f.size, 0) });
    }
    if (action === '/admin/delete' && (method === 'POST' || method === 'DELETE')) {
      const a = await requireAdmin(req);
      if (a.err) return a.err;
      const key = String(body.key || '');
      if (!/^(sync|audio|kuromoji)\//.test(key)) return reply(req, 400, { error: '只允许删 sync/ / audio/ / kuromoji/ 下的对象' });
      const done = await ossDelete(key);
      return reply(req, done ? 200 : 500, { ok: done, key });
    }

    if (action === '/password' && method === 'POST') {
      const acct = await ossGetJson(acctKey(me.sub));
      if (!acct || hashPass(String(body.old || ''), acct.salt) !== acct.hash) return reply(req, 401, { error: '原密码不对' });
      if (String(body.new || '').length < 6) return reply(req, 400, { error: '新密码至少 6 位' });
      acct.salt = rid(16); acct.hash = hashPass(String(body.new), acct.salt);
      await ossPutJson(acctKey(me.sub), acct);
      return reply(req, 200, { ok: true, token: tokenFor(me.sub, acct.name), user: { uid: me.sub, name: acct.name } });
    }

    if (action === '/data') {
      const cur = (await ossGetJson(dataKey(me.sub))) || { v: 1, at: null, data: null };
      if (method === 'GET') {
        return reply(req, 200, { ok: true, at: cur.at, data: cur.data, count: cur.data ? {
          known: Object.keys(cur.data.known || {}).length, imp: Object.keys(cur.data.imp || {}).length,
        } : { known: 0, imp: 0 } });
      }
      if (method === 'PUT' || method === 'POST') {
        const merged = mergeStates(body.data || {}, cur.data || {});
        if (JSON.stringify(merged).length > MAX_STORE) {
          return reply(req, 413, { error: `这个账号的记录超过上限（${Math.round(MAX_STORE / 1048576)}MB），先删掉一些导入的歌再同步` });
        }
        const at = new Date().toISOString();
        await ossPutJson(dataKey(me.sub), { v: 1, at, data: merged });
        return reply(req, 200, { ok: true, at, data: merged });
      }
      return reply(req, 405, { error: '方法不支持' });
    }

    return reply(req, 404, { error: '没有这个接口', path: '/api' + action });
  } catch (e) {
    return reply(req, 500, { error: String((e && e.message) || e) });
  }
};
