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
 *   POST /api/recover   {name, code, new}
 *   GET  /api/data
 *   PUT  /api/data      {data}
 *   GET  /api/ota-url?key=<oss key> 把 /bundles /tts 这类私有对象换成一个 1 小时签名地址（公开清单里不出现 AK）
 *   GET  /api/vault                取账号保险箱（只有密文，服务端解不开）
 *   PUT  /api/vault    {vault}     存账号保险箱
 *   DELETE /api/vault              清掉保险箱
 */
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ENV = process.env;
// 函数→OSS 走内网域名（不计公网流量、也不慢）；发给客户端的签名 URL 必须用公网域名
const OSS_HOST = ENV.OSS_HOST || 'thlyrics-audio.oss-cn-hangzhou.aliyuncs.com';
const OSS_PUBLIC_HOST = ENV.OSS_PUBLIC_HOST || 'thlyrics-audio.oss-cn-hangzhou.aliyuncs.com';
const OSS_BUCKET = ENV.OSS_BUCKET || 'thlyrics-audio';
const PREFIX = 'sync/users/';
const TOKEN_DAYS = 180;
const ALLOW = (ENV.ALLOW_ORIGINS || 'https://zfqxuz.github.io,https://localhost,capacitor://localhost,http://127.0.0.1:8848,http://localhost:8848').split(',');
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
const VAULT_MAX = 64000;               // 账号保险箱上限（ECDH 公钥 + 几条 AES-GCM 密文，几 KB）

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
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const recoveryCode = () => { const b = crypto.randomBytes(16); let s = ''; for (let i = 0; i < 16; i++) s += RC_ALPHABET[b[i] % RC_ALPHABET.length]; return s; };
const fmtRecovery = (s) => String(s || '').replace(/(.{4})(?=.)/g, '$1-');
const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashRecovery = (code, salt) => crypto.scryptSync(normRecovery(code), salt, 32).toString('hex');
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
const vaultKey = (uid) => `${PREFIX}${uid}/vault.json`;
const INDEX_KEY = `${PREFIX}_index.json`;

/**
 * 账号保险箱（vault）：网易云 / QQ 音乐这类平台凭据的密文。
 * 服务端只做「形状校验 + 原样存取」，没有密码解不出私钥，解不出数据密钥，也解不出凭据。
 * 结构见 docs/core/vault.js：
 *   { v:1, kdf:{algo,iter,salt}, pubKey, privKeyEnc:{iv,ct,iter,salt}, entries:{name:{iv,ct,dekEnc:{epk,iv,ct,salt},...}} }
 */
function cleanVault(v) {
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : null);
  const str = (x, n) => (typeof x === 'string' && x.length <= n ? x : '');
  const num = (x, lo, hi, dflt) => { const n = Number(x); return isFinite(n) && n >= lo && n <= hi ? Math.round(n) : dflt; };
  const blob = (o, fields) => {
    const b = obj(o); if (!b) return null;
    const out = {};
    for (const f of fields) { const v = str(b[f], 4096); if (!v) return null; out[f] = v; }
    return out;
  };
  const root = obj(v); if (!root || root.v !== 1) return null;
  const kdf = obj(root.kdf), pk = obj(root.privKeyEnc);
  if (!kdf || !pk) return null;
  const pubKey = str(root.pubKey, 2048);
  if (!pubKey) return null;
  const out = {
    v: 1,
    kdf: { algo: 'PBKDF2-SHA256', iter: num(kdf.iter, 1000, 4000000, 310000), salt: str(kdf.salt, 512) },
    pubKey,
    privKeyEnc: { iv: str(pk.iv, 512), ct: str(pk.ct, 8192), iter: num(pk.iter, 1000, 4000000, 310000), salt: str(pk.salt, 512) },
    locked: !!root.locked,
    entries: {},
    updatedAt: new Date().toISOString(),
  };
  if (!out.kdf.salt || !out.privKeyEnc.iv || !out.privKeyEnc.ct || !out.privKeyEnc.salt) return null;
  const entries = obj(root.entries) || {};
  for (const name of Object.keys(entries).slice(0, 8)) {
    if (!/^[a-z][a-z0-9_]{0,15}$/.test(name)) continue;
    const e = obj(entries[name]); if (!e) continue;
    const dek = blob(e.dekEnc, ['epk', 'iv', 'ct', 'salt']);
    if (!dek || !str(e.iv, 512) || !str(e.ct, 8192)) continue;
    out.entries[name] = {
      iv: str(e.iv, 512), ct: str(e.ct, 8192), dekEnc: dek,
      updatedAt: str(e.updatedAt, 40) || new Date().toISOString(),
      device: str(e.device, 60),
    };
  }
  return out;
}

// ─────────── 记录合并（和时间戳规则同前端：谁改得晚听谁的） ───────────
const n0 = (v) => (Number(v) || 0);
const loggerWarn = (...a) => { try { console.warn('[sep]', ...a); } catch { /* 忽略 */ } };
function mergeStates(a, b) {
  const A = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, words: {}, star: {}, rev: {}, sep: {}, sepOn: {}, clearedAt: 0 }, a || {});
  const B = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, words: {}, star: {}, rev: {}, sep: {}, sepOn: {}, clearedAt: 0 }, b || {});
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
  out.words = {};                                  // 用户自己补的词义（词表没收录的词，按 u 取新）
  for (const k of new Set([...Object.keys(A.words), ...Object.keys(B.words)])) {
    const x = A.words[k] || {}, y = B.words[k] || {};
    const v = n0(y.u) > n0(x.u) ? y : x;
    if (v && v.m && (n0(v.u) > out.clearedAt || !out.clearedAt)) out.words[k] = v;
  }
  out.star = {};                                   // 星标（和 known 同构：正=标了，负=取消）
  for (const k of new Set([...Object.keys(A.star), ...Object.keys(B.star)])) {
    const x = n0(A.star[k]), y = n0(B.star[k]);
    const v = Math.abs(y) > Math.abs(x) ? y : x;
    if (v && Math.abs(v) > out.clearedAt) out.star[k] = v;
  }
  out.rev = {};                                    // 复习档案（按最后作答时间 t 取胜）
  for (const k of new Set([...Object.keys(A.rev), ...Object.keys(B.rev)])) {
    const x = A.rev[k] || {}, y = B.rev[k] || {};
    const v = n0(y.t) > n0(x.t) ? y : x;
    if (v && (n0(v.s) > 0 || n0(v.e) > 0)) out.rev[k] = v;
  }
  out.sep = {};                                    // 伴奏地址（按 at 取新）
  for (const k of new Set([...Object.keys(A.sep), ...Object.keys(B.sep)])) {
    const x = A.sep[k] || {}, y = B.sep[k] || {};
    const v = n0(y.at) > n0(x.at) ? y : x;
    if (v && v.url) out.sep[k] = v;
  }
  out.sepOn = {};                                  // 是否用伴奏播放（有符号时间戳）
  for (const k of new Set([...Object.keys(A.sepOn), ...Object.keys(B.sepOn)])) {
    const x = n0(A.sepOn[k]), y = n0(B.sepOn[k]);
    const v = Math.abs(y) > Math.abs(x) ? y : x;
    if (v) out.sepOn[k] = v;
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
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

/** 和 httpGet 一样，但返回原始 Buffer（音频代理用） */
function httpGetBuf(url, headers, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      host: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: headers || {}, timeout: timeout || 12000,
    }, (res) => {
      const buf = [];
      res.on('data', (d) => buf.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(buf) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('上游超时')));
    req.end();
  });
}

// ─────────── 伴奏生成（去人声 · 声道相消） ───────────
// 说明：这是「快速伴奏」——把居中人声用 L/R 相消抵掉，再把 150Hz 以下的低频加回去保住底鼓/贝斯。
// 不是 AI 分轨（Demucs 那类要容器镜像，本机没有 docker 打不了包），质量档次写在返回里。
// 同一来源只解析一次：L1 来源缓存（平台+id）→ L2 内容缓存（音频 sha256）→ 都没有才真算。
const SEP_DAILY = 3;                       // 每人每天最多 3 首
const SEP_ENGINE = ENV.SEP_ENGINE || 'mdx';   // mdx = AI 分轨；其它 = 声道相消
const SEP_TTL_DAYS = 3650;
let SEP_MODS = null;

function ossSign(key, expiresIn = SEP_TTL_DAYS * 86400) {
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const sts = ['GET', '', '', String(exp), `/${OSS_BUCKET}/${key}`].join('\n');
  const sig = crypto.createHmac('sha1', ENV.OSS_SK).update(sts).digest('base64');
  const q = `OSSAccessKeyId=${encodeURIComponent(ENV.OSS_AK)}&Expires=${exp}&Signature=${encodeURIComponent(sig)}`;
  return `https://${OSS_PUBLIC_HOST}/` + key.split('/').map(encodeURIComponent).join('/') + '?' + q;
}

async function ossHead(key) {
  const r = await ossRequest('HEAD', key);
  return r.status === 200;
}

async function loadSepMods() {
  if (!SEP_MODS) {
    const [{ MPEGDecoder }, lame] = await Promise.all([import('mpg123-decoder'), import('@breezystack/lamejs')]);
    SEP_MODS = { MPEGDecoder, lamejs: lame.default || lame };
  }
  return SEP_MODS;
}

/** 声道相消 + 低频回补 → MP3（192kbps） */
async function vocalCut(buf) {
  const { MPEGDecoder, lamejs } = await loadSepMods();
  const t0 = Date.now();
  const dec = new MPEGDecoder();
  await dec.ready;
  const r = await dec.decode(buf);
  dec.free();
  if (!r || !r.samplesDecoded) throw new Error('音频解不开');
  if (r.channelData.length < 2) throw new Error('单声道音轨去不了人声');
  const sr = r.sampleRate || 44100;
  const n = r.samplesDecoded;
  const L = r.channelData[0], R = r.channelData[1];
  const t1 = Date.now();
  // 四阶低通（两级 RBJ biquad，140Hz）：只把「底鼓/贝斯」这一层加回中置，
  // 一阶太缓（1kHz 才 -16dB，人声会漏回来），两级 -24dB/oct 才够干净。
  const mkLP = () => {
    const w0 = 2 * Math.PI * 140 / sr, cw = Math.cos(w0), al = Math.sin(w0) / (2 * 0.7071);
    const a0 = 1 + al;
    return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  };
  const lp1 = mkLP(), lp2 = mkLP();
  const lpStep = (f, x) => {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  };
  let peak = 0;
  const fL = new Float32Array(n), fR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const mid = (L[i] + R[i]) * 0.5, side = (L[i] - R[i]) * 0.5;
    const low = lpStep(lp2, lpStep(lp1, mid));
    const yl = side + low, yr = -side + low;
    fL[i] = yl; fR[i] = yr;
    const am = (yl < 0 ? -yl : yl) > (yr < 0 ? -yr : yr) ? (yl < 0 ? -yl : yl) : (yr < 0 ? -yr : yr);
    if (am > peak) peak = am;
  }
  const g = peak > 0.95 ? 0.95 / peak : 1;
  const iL = new Int16Array(n), iR = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = fL[i] * g * 32767, y = fR[i] * g * 32767;
    iL[i] = x > 32767 ? 32767 : x < -32768 ? -32768 : x | 0;
    iR[i] = y > 32767 ? 32767 : y < -32768 ? -32768 : y | 0;
  }
  const t2 = Date.now();
  const enc = new lamejs.Mp3Encoder(2, sr, 192);
  const out = [];
  const STEP = 1152;
  for (let i = 0; i < n; i += STEP) {
    const b = enc.encodeBuffer(iL.subarray(i, i + STEP), iR.subarray(i, i + STEP));
    if (b.length) out.push(Buffer.from(b));
  }
  const fb = enc.flush();
  if (fb.length) out.push(Buffer.from(fb));
  return { mp3: Buffer.concat(out), sr, dur: n / sr, ms: { decode: t1 - t0, proc: t2 - t1, enc: Date.now() - t2 } };
}

/** 异步调自己（FC 3.0 OpenAPI，V3 签名）：提交后立刻返回，活儿在后台跑 */
function fcInvokeAsync(payload) {
  return new Promise((resolve, reject) => {
    const host = 'fcv3.cn-hangzhou.aliyuncs.com';
    const path = `/2023-03-30/functions/${encodeURIComponent(ENV.SEP_FUNCTION || 'thlyrics-sep')}/invocations`;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const hashed = crypto.createHash('sha256').update(body).digest('hex');
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const nonce = crypto.randomUUID();
    const H = {
      host, 'x-acs-version': '2023-03-30', 'x-acs-date': date, 'x-acs-signature-nonce': nonce,
      'x-acs-content-sha256': hashed, 'x-fc-invocation-type': 'Async', 'content-type': 'application/json',
    };
    const signed = Object.keys(H).sort().join(';');
    const canonHeaders = Object.keys(H).sort().map((k) => `${k}:${String(H[k]).trim()}\n`).join('');
    const canon = ['POST', path, '', canonHeaders, signed, hashed].join('\n');
    const sts = 'ACS3-HMAC-SHA256\n' + crypto.createHash('sha256').update(canon).digest('hex');
    const sig = crypto.createHmac('sha256', ENV.OSS_SK).update(sts).digest('hex');
    const req = https.request({
      host, path, method: 'POST', timeout: 15000,
      headers: Object.assign({}, H, {
        'content-length': body.length,
        Authorization: `ACS3-HMAC-SHA256 Credential=${ENV.OSS_AK},SignedHeaders=${signed},Signature=${sig}`,
      }),
    }, (res) => {
      const b = [];
      res.on('data', (d) => b.push(d));
      res.on('end', () => {
        const txt = Buffer.concat(b).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body: txt });
        else reject(new Error('FC invoke ' + res.statusCode + ' ' + txt.slice(0, 200)));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('FC invoke timeout')));
    req.write(body); req.end();
  });
}

const sepTaskKey = (id) => `sep/tasks/${id}.json`;
const sepActiveKey = (uid) => `sep/active/${uid}.json`;
const sepRunToken = () => crypto.createHmac('sha256', ENV.TOKEN_SECRET).update('sep-run-v1').digest('hex').slice(0, 32);

/** 真正干活：下载 → 相消 → 上传 → 写任务 */
async function sepRun(taskId) {
  const tk = await ossGetJson(sepTaskKey(taskId));
  if (!tk) return;
  const t0 = Date.now();
  const upd = async (patch) => { Object.assign(tk, patch); await ossPutJson(sepTaskKey(taskId), tk); };
  await upd({ status: 'running', startedAt: Date.now() });
  try {
    const src = tk.src, id = tk.id;
    const a = src === 'tencent' ? await qqAudio(id) : await netAudio(id, 320);
    if (!a || !a.url) throw new Error('这首歌没有可播地址');
    const dl = await httpGetBuf(a.url, { 'User-Agent': NET_UA, Referer: 'https://music.163.com/' }, 60000);
    if (dl.status !== 200 || !dl.body || !dl.body.length) throw new Error('音频下载失败');
    const sha = crypto.createHash('sha256').update(dl.body).digest('hex');
    let engine = 'side-cancel', size = 0, reused = false, ms = null;
    const keyOf = (e) => `sep/out/${e}/${sha}.mp3`;
    const wantEngine = SEP_ENGINE === 'umx' ? 'umx-hq' : SEP_ENGINE === 'mdx' ? 'mdx-kara2' : 'side-cancel';
    if (wantEngine !== 'side-cancel' && await ossHead(keyOf(wantEngine))) { engine = wantEngine; reused = true; }
    else {
      let r = null;
      if (SEP_ENGINE === 'umx' || SEP_ENGINE === 'mdx') {
        try { r = SEP_ENGINE === 'umx' ? await vocalCutUmx(dl.body) : await vocalCutMdx(dl.body); engine = SEP_ENGINE === 'umx' ? 'umx-hq' : 'mdx-kara2'; }
        catch (e) { loggerWarn('AI 分轨失败，退回声道相消：' + ((e && e.message) || e)); r = null; }
      }
      if (!r) { engine = 'side-cancel'; r = await vocalCut(dl.body); }
      ms = r.ms || null;
      const outKey = keyOf(engine);
      const put = await ossRequest('PUT', outKey, r.mp3, 'audio/mpeg');
      if (put.status !== 200) throw new Error('上传失败 ' + put.status);
      size = r.mp3.length;
    }
    const url = ossSign(keyOf(engine));
    const rec = { src, id, url, size, engine, at: Date.now() };
    await ossPutJson('sep/cache/' + engine + '/' + crypto.createHash('sha1').update(src + ':' + id).digest('hex') + '.json', rec);
    await upd({ status: 'done', url, size, engine, cached: reused, ms, detail: ms, u: Date.now() });
  } catch (e) {
    await upd({ status: 'error', error: String((e && e.message) || e), ms: Date.now() - t0, u: Date.now() });
  } finally {
    try { const act = await ossGetJson(sepActiveKey(tk.uid)); if (act && act.taskId === taskId) await ossPutJson(sepActiveKey(tk.uid), { taskId: '', at: Date.now() }); } catch { /* 忽略 */ }
  }
}

// ── AI 分轨：UVR-MDX-NET KARA2（ONNX）──
// 管线：STFT(5120, hop 1024, periodic Hann, 反射补边) → 2048 bins 分块(256 帧, 边 32 帧)
//      → 模型 → iSTFT 重叠相加 → MP3。模型和 ORT 都不进包，冷启动从 OSS 拉（/tmp 缓存）。
const MDX = { n: 5120, hop: 1024, bins: 2048, dimT: 256, off: 32 };
const MDX_STRIDE = MDX.dimT - 2 * MDX.off;
let ORT = null, ORT_ERR = null, MDX_SESS = null, MDX_ERR = null, FFT_T = null;

function loadOrt() {
  if (ORT || ORT_ERR) return ORT;
  try { ORT = require('./vendor/onnxruntime-node'); } catch (e) { ORT_ERR = e; }
  return ORT;
}

/** 5120 = 5 × 1024：5 个 radix-2 FFT + 一次混合基合并（预分配，热路径不 new） */
function initFft() {
  if (FFT_T) return FFT_T;
  const N = MDX.n, P = 5, M = 1024;
  const REV = new Uint16Array(M);
  for (let i = 0; i < M; i++) { let x = i, r = 0; for (let b = 0; b < 10; b++) { r = (r << 1) | (x & 1); x >>= 1; } REV[i] = r; }
  const COS = new Float64Array(M / 2), SIN = new Float64Array(M / 2);
  for (let i = 0; i < M / 2; i++) { COS[i] = Math.cos(-2 * Math.PI * i / M); SIN[i] = Math.sin(-2 * Math.PI * i / M); }
  const TC = new Float64Array(P * N), TS = new Float64Array(P * N);
  for (let r = 0; r < P; r++) for (let k = 0; k < N; k++) { const a = -2 * Math.PI * ((r * k) % N) / N; TC[r * N + k] = Math.cos(a); TS[r * N + k] = Math.sin(a); }
  const sub = [];
  for (let r = 0; r < P; r++) sub.push([new Float64Array(M), new Float64Array(M)]);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  FFT_T = { N, P, M, REV, COS, SIN, TC, TS, sub, win, zr: new Float64Array(N), zi: new Float64Array(N) };
  return FFT_T;
}

function fft1024(t, re, im, inv) {
  const { M, REV, COS, SIN } = t;
  for (let i = 0; i < M; i++) { const j = REV[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
  const sgn = inv ? -1 : 1;
  for (let len = 2; len <= M; len <<= 1) {
    const half = len >> 1, step = M / len;
    for (let i = 0; i < M; i += len) {
      for (let j = 0; j < half; j++) {
        const q = j * step, c = COS[q], s = sgn * SIN[q];
        const a = i + j, b = a + half;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

function fft5120(t, re, im, inverse) {
  const { N, P, M, TC, TS, sub } = t;
  for (let r = 0; r < P; r++) {
    const sr = sub[r][0], si = sub[r][1];
    for (let k = 0; k < M; k++) { sr[k] = re[k * P + r]; si[k] = im[k * P + r]; }
    fft1024(t, sr, si, inverse);
  }
  const sgn = inverse ? -1 : 1;
  for (let k = 0; k < N; k++) {
    let sr = 0, si = 0;
    for (let r = 0; r < P; r++) {
      const a = sub[r][0][k % M], b = sub[r][1][k % M];
      const c = TC[r * N + k], s = sgn * TS[r * N + k];
      sr += a * c - b * s; si += a * s + b * c;
    }
    re[k] = sr; im[k] = si;
  }
}

const refl = (x, i) => { const n = x.length; if (i >= 0 && i < n) return x[i]; if (i < 0) { let k = -i; while (k >= n) k = 2 * n - k - 2; return x[k]; } let k = 2 * n - i - 2; while (k < 0) k = -k; return x[k]; };

/** 一帧：两个声道打包进一次复数 FFT（省一半） */
function mdxForward(t, L, R, start, Lre, Lim, Rre, Rim) {
  const { zr, zi, win, N, N: n } = t;
  for (let i = 0; i < n; i++) { zr[i] = refl(L, start + i) * win[i]; zi[i] = refl(R, start + i) * win[i]; }
  fft5120(t, zr, zi);
  for (let k = 0; k < MDX.bins; k++) {
    const j = (N - k) % N;
    const a = zr[k], b = zi[k], c = zr[j], d = zi[j];
    Lre[k] = 0.5 * (a + c); Lim[k] = 0.5 * (b - d);
    Rre[k] = 0.5 * (b + d); Rim[k] = 0.5 * (c - a);
  }
}

function mdxInverse(t, Lre, Lim, Rre, Rim, outL, outR, wsum, start) {
  const { zr, zi, win, N } = t;
  zr.fill(0); zi.fill(0);
  zr[0] = Lre[0]; zi[0] = Rre[0];
  for (let k = 1; k < MDX.bins; k++) {
    zr[k] = Lre[k] - Rim[k]; zi[k] = Lim[k] + Rre[k];
    const j = N - k;
    zr[j] = Lre[k] + Rim[k]; zi[j] = Rre[k] - Lim[k];
  }
  fft5120(t, zr, zi, true);
  for (let i = 0; i < N; i++) {
    const p = start + i;
    if (p < 0 || p >= outL.length) continue;
    const w = win[i];
    outL[p] += (zr[i] / N) * w; outR[p] += (zi[i] / N) * w; wsum[p] += w * w;
  }
}

async function mdxSession() {
  if (MDX_SESS || MDX_ERR) return MDX_SESS;
  try {
    const ort = loadOrt();
    if (!ort) throw ORT_ERR || new Error('ORT 不可用');
    const mp = '/tmp/kara2.onnx';
    if (!fs.existsSync(mp) || fs.statSync(mp).size < 1e6) {
      const r = await ossRequest('GET', 'sep/models/kara2.onnx', null, null, true);
      if (r.status !== 200) throw new Error('模型下载失败 ' + r.status);
      fs.writeFileSync(mp, r.body);
    }
    MDX_SESS = await ort.InferenceSession.create(mp, { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1 });
  } catch (e) { MDX_ERR = e; MDX_SESS = null; }
  return MDX_SESS;
}

/** AI 分轨：输入 mp3 buffer，输出「去掉主唱」的 mp3 */
async function vocalCutMdx(buf) {
  const sess = await mdxSession();
  if (!sess) throw new Error('模型不可用：' + String((MDX_ERR && MDX_ERR.message) || ''));
  const { MPEGDecoder, lamejs } = await loadSepMods();
  const t0 = Date.now();
  const dec = new MPEGDecoder();
  await dec.ready;
  const r = await dec.decode(buf);
  dec.free();
  if (!r || !r.samplesDecoded) throw new Error('音频解不开');
  if (r.channelData.length < 2) throw new Error('单声道音轨分不了');
  const sr = r.sampleRate || 44100, n = r.samplesDecoded;
  const L = r.channelData[0], R = r.channelData[1];
  const t = initFft();
  const total = n + MDX.n;
  const outL = new Float32Array(total), outR = new Float32Array(total), wsum = new Float32Array(total);
  const Lre = new Float64Array(MDX.bins), Lim = new Float64Array(MDX.bins), Rre = new Float64Array(MDX.bins), Rim = new Float64Array(MDX.bins);
  const inp = new Float32Array(4 * MDX.bins * MDX.dimT);
  const nFrames = 1 + Math.floor(n / MDX.hop);
  const pad = MDX.n / 2;
  const t1 = Date.now();
  let chunks = 0;
  for (let f0 = -MDX.off; f0 < nFrames; f0 += MDX_STRIDE) {
    inp.fill(0);
    for (let ti = 0; ti < MDX.dimT; ti++) {
      const fi = f0 + ti;
      if (fi < 0 || fi >= nFrames) continue;
      mdxForward(t, L, R, fi * MDX.hop - pad, Lre, Lim, Rre, Rim);
      for (let k = 0; k < 3; k++) { Lre[k] = 0; Lim[k] = 0; Rre[k] = 0; Rim[k] = 0; }   // 极低频置零
      for (let k = 0; k < MDX.bins; k++) {
        inp[(0 * MDX.bins + k) * MDX.dimT + ti] = Lre[k];
        inp[(1 * MDX.bins + k) * MDX.dimT + ti] = Lim[k];
        inp[(2 * MDX.bins + k) * MDX.dimT + ti] = Rre[k];
        inp[(3 * MDX.bins + k) * MDX.dimT + ti] = Rim[k];
      }
    }
    const out = await sess.run({ input: new ORT.Tensor('float32', inp, [1, 4, MDX.bins, MDX.dimT]) });
    const o = out.output.data;
    chunks++;
    for (let ti = MDX.off; ti < MDX.dimT - MDX.off; ti++) {
      const fi = f0 + ti;
      if (fi < 0 || fi >= nFrames) continue;
      for (let k = 0; k < MDX.bins; k++) {
        Lre[k] = o[(0 * MDX.bins + k) * MDX.dimT + ti]; Lim[k] = o[(1 * MDX.bins + k) * MDX.dimT + ti];
        Rre[k] = o[(2 * MDX.bins + k) * MDX.dimT + ti]; Rim[k] = o[(3 * MDX.bins + k) * MDX.dimT + ti];
      }
      mdxInverse(t, Lre, Lim, Rre, Rim, outL, outR, wsum, fi * MDX.hop - pad);
    }
  }
  const t2 = Date.now();
  let peak = 0;
  for (let i = 0; i < total; i++) { const w = wsum[i]; if (w > 1e-6) { outL[i] /= w; outR[i] /= w; } }
  for (let i = 0; i < n; i++) { const a = outL[i] < 0 ? -outL[i] : outL[i], b = outR[i] < 0 ? -outR[i] : outR[i]; if (a > peak) peak = a; if (b > peak) peak = b; }
  const g = peak > 0.98 ? 0.98 / peak : 1;
  const iL = new Int16Array(n), iR = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = outL[i] * g * 32767, b = outR[i] * g * 32767;
    iL[i] = a > 32767 ? 32767 : a < -32768 ? -32768 : a | 0;
    iR[i] = b > 32767 ? 32767 : b < -32768 ? -32768 : b | 0;
  }
  const enc = new lamejs.Mp3Encoder(2, sr, 192);
  const parts = [];
  for (let i = 0; i < n; i += 1152) {
    const b = enc.encodeBuffer(iL.subarray(i, i + 1152), iR.subarray(i, i + 1152));
    if (b.length) parts.push(Buffer.from(b));
  }
  const fb = enc.flush(); if (fb.length) parts.push(Buffer.from(fb));
  return { mp3: Buffer.concat(parts), sr, dur: n / sr, ms: { decode: t1 - t0, sep: t2 - t1, enc: Date.now() - t2, chunks } };
}

// ── AI 分轨 v2：Open-Unmix UMX-HQ vocals（幅度掩码） ──
// 契约（模型方 README）：输入 magnitude [1,2,2049,frames]（44.1k 立体声，
// n_fft 4096 / hop 1024 / periodic Hann / 居中反射补边）；输出是人声幅度。
// 掩码 = clip(输出/输入幅度,0,1)，伴奏 = 复数谱 ×(1-掩码) → iSTFT。
const UMX = { n: 4096, hop: 1024, bins: 2049 };
let UMX_SESS = null, UMX_ERR = null, FFT4K = null;

function initFft4k() {
  if (FFT4K) return FFT4K;
  const N = UMX.n;
  const REV = new Uint16Array(N);
  for (let i = 0; i < N; i++) { let x = i, r = 0; for (let b = 0; b < 12; b++) { r = (r << 1) | (x & 1); x >>= 1; } REV[i] = r; }
  const COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos(-2 * Math.PI * i / N); SIN[i] = Math.sin(-2 * Math.PI * i / N); }
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  FFT4K = { N, REV, COS, SIN, win, zr: new Float64Array(N), zi: new Float64Array(N) };
  return FFT4K;
}

function fft4k(t, re, im, inverse) {
  const { N, REV, COS, SIN } = t;
  for (let i = 0; i < N; i++) { const j = REV[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
  const sgn = inverse ? -1 : 1;
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1, step = N / len;
    for (let i = 0; i < N; i += len) {
      for (let j = 0; j < half; j++) {
        const q = j * step, c = COS[q], s = sgn * SIN[q];
        const a = i + j, b = a + half;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

async function umxSession() {
  if (UMX_SESS || UMX_ERR) return UMX_SESS;
  try {
    const ort = loadOrt();
    if (!ort) throw ORT_ERR || new Error('ORT 不可用');
    const mp = '/tmp/unmix-vocals.onnx';
    if (!fs.existsSync(mp) || fs.statSync(mp).size < 1e6) {
      const r = await ossRequest('GET', 'sep/models/unmix-vocals.onnx', null, null, true);
      if (r.status !== 200) throw new Error('模型下载失败 ' + r.status);
      fs.writeFileSync(mp, r.body);
    }
    UMX_SESS = await ort.InferenceSession.create(mp, { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1 });
  } catch (e) { UMX_ERR = e; UMX_SESS = null; }
  return UMX_SESS;
}

/** 一帧 → L/R 的 rfft 半边（0..2048），用一次 FFT 同时算两个声道 */
function umxFrame(t, L, R, start, outL, outR) {
  const { N, win, zr, zi } = t;
  for (let i = 0; i < N; i++) { zr[i] = refl(L, start + i) * win[i]; zi[i] = refl(R, start + i) * win[i]; }
  fft4k(t, zr, zi);
  const half = N / 2;
  for (let k = 0; k <= half; k++) {
    const j = (N - k) % N;
    const a = zr[k], b = zi[k], c = zr[j], d = zi[j];
    outL[2 * k] = 0.5 * (a + c); outL[2 * k + 1] = 0.5 * (b - d);
    outR[2 * k] = 0.5 * (b + d); outR[2 * k + 1] = 0.5 * (c - a);
  }
}

/** AI 分轨（幅度掩码）：返回伴奏 mp3 */
async function vocalCutUmx(buf) {
  const sess = await umxSession();
  if (!sess) throw new Error('模型不可用：' + String((UMX_ERR && UMX_ERR.message) || ''));
  const { MPEGDecoder, lamejs } = await loadSepMods();
  const ort = loadOrt();
  const t0 = Date.now();
  const dec = new MPEGDecoder();
  await dec.ready;
  const r = await dec.decode(buf);
  dec.free();
  if (!r || !r.samplesDecoded) throw new Error('音频解不开');
  if (r.channelData.length < 2) throw new Error('单声道音轨分不了');
  const sr = r.sampleRate || 44100, n = r.samplesDecoded;
  if (sr !== 44100) throw new Error('采样率不是 44.1k');     // 模型是按 44.1k 训的
  const L = r.channelData[0], R = r.channelData[1];
  const { n: N, hop, bins } = UMX;
  const pad = N / 2;
  const t = initFft4k();
  const frames = 1 + Math.floor(n / hop);
  if (frames > 40000) throw new Error('歌太长（>15 分钟）');
  const t1 = Date.now();

  // ① 幅度谱 → 模型输入（通道优先布局 [2, bins, frames]）
  const mag = new Float32Array(2 * bins * frames);
  const half = new Float64Array(2 * bins), halfR = new Float64Array(2 * bins);
  for (let f = 0; f < frames; f++) {
    umxFrame(t, L, R, f * hop - pad, half, halfR);
    for (let k = 0; k < bins; k++) {
      const a = half[2 * k], b = half[2 * k + 1], c = halfR[2 * k], d = halfR[2 * k + 1];
      mag[(0 * bins + k) * frames + f] = Math.sqrt(a * a + b * b);
      mag[(1 * bins + k) * frames + f] = Math.sqrt(c * c + d * d);
    }
  }
  const t2 = Date.now();
  const feeds = {};
  feeds[sess.inputNames[0]] = new ort.Tensor('float32', mag, [1, 2, bins, frames]);
  const outObj = await sess.run(feeds);
  const vm = outObj[sess.outputNames[0]].data;
  const t3 = Date.now();

  // ② 掩码 → 伴奏复数谱 → iSTFT 叠加
  const total = n + N;
  const oL = new Float32Array(total), oR = new Float32Array(total), wsum = new Float32Array(total);
  const segL = new Float64Array(N), segR = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    umxFrame(t, L, R, f * hop - pad, half, halfR);
    for (let k = 0; k < bins; k++) {
      const ml = Math.min(1, Math.max(0, vm[(0 * bins + k) * frames + f] / Math.max(1e-8, mag[(0 * bins + k) * frames + f])));
      const mr = Math.min(1, Math.max(0, vm[(1 * bins + k) * frames + f] / Math.max(1e-8, mag[(1 * bins + k) * frames + f])));
      half[2 * k] *= (1 - ml); half[2 * k + 1] *= (1 - ml);
      halfR[2 * k] *= (1 - mr); halfR[2 * k + 1] *= (1 - mr);
    }
    // 打包逆变换：Z[k] = L[k] + iR[k]
    const zr = t.zr, zi = t.zi;
    zr.fill(0); zi.fill(0);
    zr[0] = half[0]; zi[0] = halfR[0];
    for (let k = 1; k < bins; k++) {
      const lre = half[2 * k], lim = half[2 * k + 1], rre = halfR[2 * k], rim = halfR[2 * k + 1];
      zr[k] = lre - rim; zi[k] = lim + rre;
      const j = N - k;
      zr[j] = lre + rim; zi[j] = rre - lim;
    }
    fft4k(t, zr, zi, true);
    const base = f * hop - pad;
    for (let i = 0; i < N; i++) {
      const p = base + i;
      if (p < 0 || p >= total) continue;
      const w = t.win[i];
      oL[p] += (zr[i] / N) * w; oR[p] += (zi[i] / N) * w; wsum[p] += w * w;
    }
  }
  const t4 = Date.now();
  for (let i = 0; i < total; i++) { const w = wsum[i]; if (w > 1e-6) { oL[i] /= w; oR[i] /= w; } }
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(oL[i]), b = Math.abs(oR[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
  const g = peak > 0.98 ? 0.98 / peak : 1;
  const iL = new Int16Array(n), iR = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = oL[i] * g * 32767, b = oR[i] * g * 32767;
    iL[i] = a > 32767 ? 32767 : a < -32768 ? -32768 : a | 0;
    iR[i] = b > 32767 ? 32767 : b < -32768 ? -32768 : b | 0;
  }
  const enc = new lamejs.Mp3Encoder(2, sr, 192);
  const parts = [];
  for (let i = 0; i < n; i += 1152) {
    const b = enc.encodeBuffer(iL.subarray(i, i + 1152), iR.subarray(i, i + 1152));
    if (b.length) parts.push(Buffer.from(b));
  }
  const fb = enc.flush(); if (fb.length) parts.push(Buffer.from(fb));
  return { mp3: Buffer.concat(parts), sr, dur: n / sr, ms: { decode: t1 - t0, stft: t2 - t1, infer: t3 - t2, istft: t4 - t3, enc: Date.now() - t4, frames } };
}

/** 每人每天 3 首（按天记，跨天自动重置） */
async function sepQuota(uid) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);   // 按北京时间算天
  const key = `sep/quota/${uid}.json`;
  const cur = (await ossGetJson(key)) || { day: today, n: 0 };
  if (cur.day !== today) { cur.day = today; cur.n = 0; }
  return { key, cur };
}

/** 在线 TTS（只给网页版用）：百度优先、有道兜底；按语言选提供商的语言码 */
const TTS_LANG = {
  ja: ['jp', 'jap'], en: ['en', 'en'], zh: ['zh', 'zh'], fr: ['fr', 'fr'], de: ['de', 'de'],
  es: ['es', 'es'], pt: ['pt', 'pt'], ru: ['ru', 'ru'], ko: ['kor', 'ko'],
};
async function onlineTts(text, lang) {
  const t = String(text || '').trim().slice(0, 60);
  if (!t) throw new Error('没有要读的内容');
  const code = TTS_LANG[String(lang || 'ja').toLowerCase().split('-')[0]] || TTS_LANG.ja;
  const enc = encodeURIComponent(t);
  const ua = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
  const tries = [
    { url: `https://fanyi.baidu.com/gettts?lan=${code[0]}&text=${enc}&spd=3&source=web`, headers: { 'User-Agent': ua, Referer: 'https://fanyi.baidu.com/' } },
    { url: `https://dict.youdao.com/dictvoice?audio=${enc}&le=${code[1]}`, headers: { 'User-Agent': ua, Referer: 'https://dict.youdao.com/' } },
  ];
  let last = null;
  for (const t0 of tries) {
    try {
      const r = await httpGetBuf(t0.url, t0.headers, 9000);
      const type = String((r.headers && r.headers['content-type']) || '');
      if (r.status === 200 && /audio|mpeg|octet/i.test(type) && r.body && r.body.length > 400) {
        return { mime: /mpeg|mp3/i.test(type) ? 'audio/mpeg' : (type.split(';')[0] || 'audio/mpeg'), buffer: r.body };
      }
      last = new Error('上游返回 ' + r.status + ' ' + type);
    } catch (e) { last = e; }
  }
  throw last || new Error('取不到日语发音');
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
  // Spotify：open.spotify.com/track|album|playlist/<22 位 id> 或 spotify:track:<id>
  const sp = scan.match(/(?:open\.spotify\.com\/(track|album|playlist)\/|spotify:(track|album|playlist):)([A-Za-z0-9]{22})/i);
  if (sp) return { src: 'spotify', type: String(sp[1] || sp[2]).toLowerCase(), id: sp[3] };
  // Apple Music：music.apple.com/<cc>/<album|playlist|song>/<slug>/<id>?i=<trackId>
  if (/music\.apple\.com/i.test(scan)) {
    const song = scan.match(/[?&]i=(\d{5,})/);
    const kind = (scan.match(/music\.apple\.com\/[a-z]{2}\/?(album|playlist|song)?/i) || [])[1] || 'album';
    const cc = (scan.match(/music\.apple\.com\/([a-z]{2})\//i) || [])[1] || 'us';
    const pl = scan.match(/pl\.[0-9a-f]{16,}/i);
    const idm = scan.match(/\/(\d{5,})(?:\?|$|&)/) || scan.match(/[?&]i=(\d{5,})/);
    if (pl && !song) return { src: 'apple', type: 'playlist', id: pl[0], cc };
    if (idm) return { src: 'apple', type: song ? 'song' : String(kind).toLowerCase(), id: song ? song[1] : idm[1], cc };
    return { src: 'apple', type: '', id: '', url, cc };
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

/** 跟着 302 走几跳再取页面（Apple Music 会按地区重定向到 /cn、/us） */
async function httpGetFollow(url, headers, timeout = 15000, hops = 3) {
  let cur = url;
  for (let i = 0; i <= hops; i++) {
    const r = await httpGetBuf(cur, headers, timeout);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      cur = new URL(r.headers.location, cur).toString();
      continue;
    }
    return r;
  }
  throw new Error('重定向太多');
}

/** Spotify：Client Credentials 换 token（需要在函数环境变量里配 SPOTIFY_ID / SPOTIFY_SECRET） */
const SPOTIFY_TOKEN = { v: '', at: 0 };
function httpPostForm(url, body, headers, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      host: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers || {}),
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('超时')); });
    req.write(body);
    req.end();
  });
}
async function spotifyToken() {
  const id = process.env.SPOTIFY_ID, sec = process.env.SPOTIFY_SECRET;
  if (!id || !sec) throw new Error('服务端没配 Spotify 凭据（SPOTIFY_ID / SPOTIFY_SECRET）');
  if (SPOTIFY_TOKEN.v && Date.now() - SPOTIFY_TOKEN.at < 3000e3) return SPOTIFY_TOKEN.v;
  const basic = Buffer.from(id + ':' + sec).toString('base64');
  const r = await httpPostForm('https://accounts.spotify.com/api/token', 'grant_type=client_credentials',
    { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' });
  if (r.status !== 200) throw new Error('Spotify 取 token 失败 HTTP ' + r.status);
  const j = JSON.parse(r.body);
  SPOTIFY_TOKEN.v = j.access_token;
  SPOTIFY_TOKEN.at = Date.now();
  return SPOTIFY_TOKEN.v;
}
async function spotifyGet(path) {
  const r = await httpGet('https://api.spotify.com' + path, { Authorization: 'Bearer ' + await spotifyToken() }, 15000);
  if (r.status !== 200) {
    let why = '';
    try { why = String((JSON.parse(r.body) || {}).error || (JSON.parse(r.body) || {}).error_description || ''); } catch { why = String(r.body || '').slice(0, 120); }
    if (/premium subscription required/i.test(why)) throw new Error('Spotify 要求 App 所有者有 Premium 订阅（订阅生效后要等几小时）');
    if (r.status === 401) throw new Error('Spotify 凭据无效或已过期');
    if (r.status === 429) throw new Error('Spotify 限流，稍后再试');
    throw new Error('Spotify 读不到 HTTP ' + r.status + (why ? '：' + why : ''));
  }
  return JSON.parse(r.body);
}
const spTrack = (t) => ({
  name: t.name || '',
  artist: (t.artists || []).map((a) => a.name).join(' / '),
  album: (t.album && t.album.name) || '',
  cover: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || '',
  duration: Math.round((t.duration_ms || 0) / 1000),
  src: 'spotify', mirror: true,
});
async function spotifyMeta(hit) {
  if (hit.type === 'track') {
    const t = await spotifyGet('/v1/tracks/' + hit.id);
    return { type: 'song', id: hit.id, name: t.name, cover: (t.album.images[0] || {}).url || '', mirror: true, tracks: [spTrack(t)] };
  }
  if (hit.type === 'album') {
    const a = await spotifyGet('/v1/albums/' + hit.id);
    let tracks = (a.tracks && a.tracks.items) || [];
    let next = a.tracks && a.tracks.next;
    while (next && tracks.length < 300) {
      const p = await spotifyGet(next.replace('https://api.spotify.com', ''));
      tracks = tracks.concat(p.items || []); next = p.next;
    }
    const full = tracks.map((t) => Object.assign({}, t, { album: { name: a.name, images: a.images } }));
    return { type: 'album', id: hit.id, name: a.name, cover: (a.images[0] || {}).url || '', mirror: true, tracks: full.map(spTrack) };
  }
  const pl = await spotifyGet('/v1/playlists/' + hit.id);
  let items = (pl.tracks && pl.tracks.items) || [];
  let next = pl.tracks && pl.tracks.next;
  while (next && items.length < 500) {
    const p = await spotifyGet(next.replace('https://api.spotify.com', ''));
    items = items.concat(p.items || []); next = p.next;
  }
  const tracks = items.map((x) => x && x.track).filter((t) => t && t.name);
  return { type: 'playlist', id: hit.id, name: pl.name, cover: (pl.images[0] || {}).url || '', mirror: true, tracks: tracks.map(spTrack) };
}

/** Apple Music：单曲/专辑走公开的 iTunes API；歌单走页面里的 serialized-server-data */
const appleTrack = (t) => ({
  name: t.trackName || '', artist: t.artistName || '', album: t.collectionName || '',
  cover: (t.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
  duration: Math.round((t.trackTimeMillis || 0) / 1000), src: 'apple', mirror: true, preview: t.previewUrl || '',
});
/** iTunes 是按国家/地区分店的：链接给的书店没有这首就换 us / jp / cn 再试 */
async function itunesLookup(id, entity, cc) {
  const order = [...new Set([cc || 'us', 'us', 'jp', 'cn', 'hk', 'tw'].map((x) => String(x).toLowerCase()))];
  let last = null;
  for (const c of order) {
    try {
      const j = JSON.parse((await httpGet(`https://itunes.apple.com/lookup?id=${id}&entity=${entity}&country=${c}&limit=200`, {}, 15000)).body);
      const rows = j.results || [];
      const songs = rows.filter((x) => x.kind === 'song' || x.wrapperType === 'track');
      if (songs.length) return { rows, songs, cc: c };
      last = rows;
    } catch { /* 换下一个书店 */ }
  }
  return { rows: last || [], songs: [], cc: '' };
}
async function appleMeta(hit) {
  if (hit.type === 'song') {
    const r = await itunesLookup(hit.id, 'song', hit.cc);
    const t = r.songs[0] || (r.rows || [])[0];
    if (!t) throw new Error('这首歌读不到');
    return { type: 'song', id: hit.id, name: t.trackName, cover: appleTrack(t).cover, mirror: true, tracks: [appleTrack(t)] };
  }
  if (hit.type === 'album') {
    const r = await itunesLookup(hit.id, 'song', hit.cc);
    if (!r.songs.length) throw new Error('这张专辑读不到');
    const album = (r.rows || []).find((x) => x.collectionId) || {};
    return { type: 'album', id: hit.id, name: album.collectionName || '', cover: appleTrack(album).cover, mirror: true, tracks: r.songs.map(appleTrack) };
  }
  // 歌单：抓页面里的 serialized-server-data
  const page = await httpGetFollow('https://music.apple.com/' + (hit.cc || 'us') + '/playlist/' + hit.id,
    { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9' }, 15000);
  const html = String(page.body || '');
  const m = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('这个歌单读不到（页面结构变了）');
  let data;
  try { data = JSON.parse(m[1]); } catch { throw new Error('歌单数据解析失败'); }
  const out = [];
  const name = (() => {
    const head = (data && data.data && data.data[0] && data.data[0].data && data.data[0].data.header) || {};
    if (head.title) return String(head.title);
    const t = html.match(/<title>([^<]{1,120})<\/title>/);
    return t ? t[1].replace(/^\u200e?Apple\s*Music\s*[-–]\s*/i, '').trim() : '';
  })();
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const cd = o.contentDescriptor;
    if (cd && cd.kind === 'song' && o.title) {
      const sid = String((cd.identifiers && cd.identifiers.storeAdamID) || '');
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        const art = (o.artwork && o.artwork.dictionary && o.artwork.dictionary.url) || '';
        out.push({
          name: o.title,
          artist: (o.subtitleLinks && o.subtitleLinks[0] && o.subtitleLinks[0].title) || o.artistName || '',
          album: name, cover: art ? art.replace(/\{w\}x\{h\}\{c\}\.\{f\}/, '600x600bb') : '',
          duration: o.duration ? Math.round(o.duration / 1000) : 0, src: 'apple', mirror: true,
        });
      }
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  if (!out.length) throw new Error('歌单里没有歌');
  return { type: 'playlist', id: hit.id, name, cover: '', mirror: true, tracks: out };
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
/** QQ 扫码登录的会话缓存（key → qrsig） */
const QQ_QR = new Map();
function hash33(s) { let h = 0; for (let i = 0; i < s.length; i++) h += (h << 5) + s.charCodeAt(i); return h & 0x7fffffff; }
let REQ_QQ_COOKIE = '';
const qqCookie = () => REQ_QQ_COOKIE || String(ENV.QQ_COOKIE || '').trim();
const QQ_LYRIC_HEADERS = { 'User-Agent': NET_UA, Referer: 'https://y.qq.com/portal/player.html' };

async function qqJson(url, headers) {
  const ck = qqCookie();
  const h = headers || (ck ? Object.assign({}, QQ_HEADERS, { Cookie: ck }) : QQ_HEADERS);
  const r = await httpGet(url, h, 12000);
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

/** 网易云 cookie：优先用「这次请求带上来的用户自己的 cookie」，其次才是服务端兜底的那份 */
let REQ_COOKIE = '';
const netCookie = () => REQ_COOKIE || String(ENV.NETEASE_COOKIE || '').trim();
async function netJson(url) {
  const cookie = netCookie();
  const headers = cookie ? Object.assign({}, NET_HEADERS, { Cookie: NET_HEADERS.Cookie + '; ' + cookie }) : NET_HEADERS;
  const r = await httpGet(url, headers, 12000);
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
  // 同一个代码包部署成两个函数：thlyrics-auth（账号/同步/解析）和 thlyrics-sep（伴奏，重活）
  const action0 = q.action ? '/' + q.action.replace(/^\/+/, '') : path.replace(/^\/api/, '');
  const ROLE = ENV.ROLE || 'auth';
  if (ROLE === 'sep') {
    if (!['/sep', '/sep/status', '/sep/quota', '/sep/run', '/sep/bench', '/health'].includes(action0)) {
      return reply(req, 404, { error: '没有这个接口' });
    }
  } else if (action0 === '/sep/run') {
    return reply(req, 404, { error: '没有这个接口' });
  }

  try {
    // 页面会从 OSS 的静态 JSON 里读这个地址，允许 ?action=xxx 这种便于排查
    const action = q.action ? '/' + q.action.replace(/^\/+/, '') : path.replace(/^\/api/, '');
    // 用户自己的网易云 cookie（只作用于本次请求，不落库）；没带就用服务端兜底的那份
    REQ_COOKIE = String((req.headers && (req.headers['x-net-cookie'] || req.headers['X-Net-Cookie'])) || '').slice(0, 2000);
    REQ_QQ_COOKIE = String((req.headers && (req.headers['x-qq-cookie'] || req.headers['X-Qq-Cookie'])) || '').slice(0, 2000);

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
    // ── QQ 扫码登录（拿 qm_keyst，绿钻曲要它） ──
    if (action === '/qq/qr') {
      const key = String(q.key || '').trim();
      if (!key) {
        try {
          const r = await httpGetBuf('https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=' + Math.random() + '&daid=383&pt_3rd_aid=100497308',
            { 'User-Agent': NET_UA, Referer: 'https://xui.ptlogin2.qq.com/' }, 12000);
          const qrsig = ((r.headers['set-cookie'] || []).join('; ').match(/qrsig=([^;\s]+)/) || [])[1] || '';
          if (!qrsig) return reply(req, 502, { error: '取二维码失败' });
          const id = rid(10);
          QQ_QR.set(id, { qrsig, at: Date.now() });
          if (QQ_QR.size > 50) QQ_QR.clear();
          return reply(req, 200, { ok: true, key: id, img: 'data:image/png;base64,' + r.body.toString('base64'),
            link: 'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609&daid=383&style=33&hide_title_bar=1&hide_border=1&target=self&s_url=https%3A%2F%2Fy.qq.com%2F' });
        } catch (e) { return reply(req, 502, { error: '二维码生成失败' }); }
      }
      const rec = QQ_QR.get(key);
      if (!rec) return reply(req, 200, { ok: true, state: 'expired' });
      const ptqrtoken = hash33(rec.qrsig);
      try {
        const u = 'https://ssl.ptlogin2.qq.com/ptqrlogin?u1=' + encodeURIComponent('https://graph.qq.com/oauth2.0/login_jump')
          + '&ptqrtoken=' + ptqrtoken + '&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-' + Date.now()
          + '&js_ver=20102616&js_type=1&login_sig=&pt_uistyle=40&aid=716027609&daid=383&pt_3d_aid=100497308&has_onekey=1&pt_3rd_aid=100497308';
        const r = await httpGet(u, { 'User-Agent': NET_UA, Referer: 'https://xui.ptlogin2.qq.com/', Cookie: 'qrsig=' + rec.qrsig }, 12000);
        const m = r.body.match(/ptuiCB\('(\d+)','\d+','([^']*)','\d+','([^']*)'/);
        const code = m ? Number(m[1]) : -1;
        if (code !== 0) return reply(req, 200, { ok: true, code, state: code === 65 ? 'expired' : code === 67 ? 'scanned' : 'wait' });
        // 登录成功：跟着回调把 cookie 收齐（qm_keyst 在跳转链路上）
        let url = m[2];
        let cookies = 'qrsig=' + rec.qrsig;
        for (let i = 0; i < 4 && url; i++) {
          const rr = await httpGet(url, { 'User-Agent': NET_UA, Referer: 'https://y.qq.com/', Cookie: cookies }, 12000);
          const sc = (rr.headers['set-cookie'] || []).join('; ');
          if (sc) cookies += '; ' + sc.replace(/;\s*(path|domain|expires|httponly|secure|samesite)=[^;]*/gi, '');
          url = rr.location || '';
        }
        QQ_QR.delete(key);
        const keep = ['qm_keyst', 'uin', 'qqmusic_key', 'p_skey', 'skey', 'qzone_uin'].map((n) => {
          const v = (cookies.match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)')) || [])[1];
          return v ? n + '=' + v : '';
        }).filter(Boolean).join('; ');
        if (!/qm_keyst/.test(keep)) return reply(req, 200, { ok: true, code: 0, state: 'ok', error: '没拿到音乐凭证' });
        return reply(req, 200, { ok: true, code: 0, state: 'ok', cookie: keep });
      } catch (e) { return reply(req, 502, { error: '查询登录状态失败' }); }
    }

    // ── 网易云扫码登录：拿到用户自己的 cookie（只在用户设备上保存） ──
    if (action === '/netease/qr') {
      const key = String(q.key || '').trim();
      if (!key) {
        try {
          const r = await httpGet('https://music.163.com/api/login/qrcode/unikey?type=1', NET_HEADERS, 10000);
          const j = JSON.parse(r.body);
          if (!j.unikey) return reply(req, 502, { error: '取二维码失败' });
          const target = 'https://music.163.com/login?codekey=' + encodeURIComponent(j.unikey);
          const img = await httpGetBuf('https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=' + encodeURIComponent(target), {}, 12000);
          const b64 = img.status === 200 ? 'data:image/png;base64,' + img.body.toString('base64') : '';
          return reply(req, 200, { ok: true, key: j.unikey, img: b64, link: target });
        } catch (e) { return reply(req, 502, { error: '二维码生成失败：' + String((e && e.message) || e) }); }
      }
      try {
        const r = await httpGet('https://music.163.com/api/login/qrcode/client/login?key=' + encodeURIComponent(key) + '&type=1', NET_HEADERS, 10000);
        const j = JSON.parse(r.body);
        const code = Number(j.code) || 0;
        const state = code === 800 ? 'expired' : code === 802 ? 'scanned' : code === 803 ? 'ok' : 'wait';
        if (code !== 803) return reply(req, 200, { ok: true, code, state });
        const raw = [].concat(r.headers['set-cookie'] || []).join('; ');
        const musicU = (raw.match(/MUSIC_U=([^;\s]+)/) || [])[1] || '';
        const csrf = (raw.match(/__csrf=([^;\s]+)/) || [])[1] || '';
        if (!musicU) return reply(req, 200, { ok: true, code, state: 'ok', error: '没拿到登录凭证' });
        return reply(req, 200, { ok: true, code, state: 'ok', cookie: 'MUSIC_U=' + musicU + (csrf ? '; __csrf=' + csrf : '') });
      } catch (e) { return reply(req, 502, { error: '查询登录状态失败' }); }
    }

    // QQ 搜索（换源用，匿名可用）
    if (action === '/qq/search') {
      const kw = String(q.name || q.q || '').trim().slice(0, 80);
      if (!kw) return reply(req, 400, { error: '缺关键词' });
      try {
        const j = await qqJson('https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&n=8&w=' + encodeURIComponent(kw));
        const list = ((j.data || {}).song || {}).list || [];
        return reply(req, 200, { ok: true, list: list.map((x) => ({ id: x.songmid, name: x.songname, artist: (x.singer || []).map((a) => a.name).join(' / ') })) });
      } catch (e) { return reply(req, 502, { error: '搜索失败' }); }
    }

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

    // OTA / 语音包下载地址解析：公开清单里只写这个中转地址，真正的签名地址在响应里现算（1 小时有效）。
    // 好处：update.json / voice-packs.json 这些公开文件里再也不会出现 OSSAccessKeyId。
    // （不能直接 302 到 OSS：FC 默认域名禁止外部跳转，会报 ExternalRedirectForbidden。）
    if (action === '/ota-url') {
      const key = decodeURIComponent(String(q.key || '')).replace(/^\/+/, '').slice(0, 200);
      if (!/^(bundles|tts|apk|kuromoji|sep)\/[A-Za-z0-9._\/-]+$/.test(key) || key.indexOf('..') >= 0) {
        return reply(req, 400, { error: 'key 不允许' });
      }
      return reply(req, 200, { ok: true, key, expiresIn: 3600, url: ossSign(key, 3600) });
    }

    // 网页版在线日语发音（原生 App 不用这条；限 60 字）
    if (action === '/tts') {
      const text = String(q.text || q.q || '').slice(0, 60);
      if (!text.trim()) return reply(req, 400, { error: '缺 text' });
      try {
        const r = await onlineTts(text, q.lang || 'ja');
        return reply(req, 200, { ok: true, mime: r.mime, url: 'data:' + r.mime + ';base64,' + r.buffer.toString('base64') });
      } catch (e) {
        return reply(req, 502, { error: '发音服务暂时不可用：' + String((e && e.message) || e) });
      }
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
      try {
        const meta = src === 'spotify' ? await spotifyMeta(hit)
          : src === 'apple' ? await appleMeta(hit)
          : await (src === 'tencent' ? qqMeta : neteaseMeta)(hit);
        return reply(req, 200, Object.assign({ ok: true, src, mirror: !!meta.mirror }, meta));
      } catch (e) {
        const who = src === 'spotify' ? 'Spotify' : src === 'apple' ? 'Apple Music' : src === 'tencent' ? 'QQ音乐' : '网易云';
        return reply(req, 502, { error: who + '读不到：' + String((e && e.message) || e) });
      }
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
      const rc = recoveryCode();
      const acct = { uid, name, nameLower: key, salt, hash: hashPass(pass, salt), avatar, createdAt: new Date().toISOString(),
        recoverySalt: rid(16), admin: first || ADMINS.indexOf(key) >= 0 };
      acct.recoveryHash = hashRecovery(rc, acct.recoverySalt);
      await ossPutJson(acctKey(uid), acct);
      index[key] = uid;
      await ossPutJson(INDEX_KEY, index);
      if (body.data) await ossPutJson(dataKey(uid), { v: 1, at: new Date().toISOString(), data: body.data });
      return reply(req, 200, { ok: true, token: tokenFor(uid, name), recovery: fmtRecovery(rc), user: { uid, name, admin: !!acct.admin, avatar: acct.avatar || '' } });
    }

    if (action === '/login' && method === 'POST') {
      const name = String(body.name || '').trim().toLowerCase(), pass = String(body.pass || '');
      const index = (await ossGetJson(INDEX_KEY)) || {};
      const uid = index[name];
      if (!uid) return reply(req, 401, { error: '用户名或密码不对' });
      const acct = await ossGetJson(acctKey(uid));
      if (!acct || hashPass(pass, acct.salt) !== acct.hash) return reply(req, 401, { error: '用户名或密码不对' });
      let rc = '';
      if (!acct.recoveryHash || !acct.recoverySalt) {          // 老账号：登录时补发一次恢复码
        rc = recoveryCode();
        acct.recoverySalt = rid(16);
        acct.recoveryHash = hashRecovery(rc, acct.recoverySalt);
        await ossPutJson(acctKey(uid), acct);
      }
      const adm = !!acct.admin || ADMINS.indexOf(String(acct.nameLower || '').toLowerCase()) >= 0;
      return reply(req, 200, { ok: true, token: tokenFor(uid, acct.name), recovery: rc ? fmtRecovery(rc) : undefined, user: { uid, name: acct.name, admin: adm, avatar: acct.avatar || '' } });
    }

    if (action === '/recover' && method === 'POST') {
      const name = String(body.name || '').trim().toLowerCase();
      const code = normRecovery(body.code);
      const pass = String(body.new || '');
      if (!name || !code) return reply(req, 400, { error: '用户名和恢复码都要填' });
      if (pass.length < 6) return reply(req, 400, { error: '新密码至少 6 位' });
      const index = (await ossGetJson(INDEX_KEY)) || {};
      const uid = index[name];
      if (!uid) return reply(req, 401, { error: '用户名或恢复码不对' });
      const acct = await ossGetJson(acctKey(uid));
      if (!acct || !acct.recoverySalt || !acct.recoveryHash || hashRecovery(code, acct.recoverySalt) !== acct.recoveryHash) {
        return reply(req, 401, { error: '用户名或恢复码不对' });
      }
      const rc = recoveryCode();
      acct.salt = rid(16); acct.hash = hashPass(pass, acct.salt);
      acct.recoverySalt = rid(16); acct.recoveryHash = hashRecovery(rc, acct.recoverySalt);
      await ossPutJson(acctKey(uid), acct);
      // 恢复码重置拿不到旧密码 → 保险箱私钥再也解不开，标记成待重绑（密文不删，等客户端重建）
      const vault = await ossGetJson(vaultKey(uid)).catch(() => null);
      if (vault) {
        vault.locked = true; vault.lockedAt = new Date().toISOString();
        await ossPutJson(vaultKey(uid), vault).catch(() => {});
      }
      const adm = !!acct.admin || ADMINS.indexOf(String(acct.nameLower || '').toLowerCase()) >= 0;
      return reply(req, 200, { ok: true, token: tokenFor(uid, acct.name), recovery: fmtRecovery(rc), vaultLocked: !!vault,
        user: { uid, name: acct.name, admin: adm, avatar: acct.avatar || '' } });
    }

    // 临时：ONNX 分离器在 FC 上的速度标定（只有内部 token 能用）
    if (action === '/sep/bench') {
      const tok = String((req.headers && (req.headers['x-sep-token'] || req.headers['X-Sep-Token'])) || '');
      if (tok !== sepRunToken()) return reply(req, 403, { error: 'forbidden' });
      const t0 = Date.now();
      let ort = null;
      try { ort = require('./vendor/onnxruntime-node'); } catch (e) { return reply(req, 500, { error: 'ORT 加载失败：' + String(e.message || e) }); }
      const mp = '/tmp/kara2.onnx';
      if (!fs.existsSync(mp) || fs.statSync(mp).size < 1e6) {
        const r = await ossRequest('GET', 'sep/models/kara2.onnx', null, null, true);
        if (r.status !== 200) return reply(req, 500, { error: '模型下载失败 ' + r.status });
        fs.writeFileSync(mp, r.body);
      }
      const t1 = Date.now();
      const th = Math.max(1, Math.min(16, Number(q.threads) || 1));
      const sess = await ort.InferenceSession.create(mp, { executionProviders: ['cpu'], intraOpNumThreads: th, interOpNumThreads: 1 });
      const t2 = Date.now();
      const n = 4 * 2048 * 256;
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      const feeds = { input: new ort.Tensor('float32', data, [1, 4, 2048, 256]) };
      const times = [];
      for (let i = 0; i < 2; i++) { const s0 = Date.now(); await sess.run(feeds); times.push(Date.now() - s0); }
      return reply(req, 200, { ok: true, cpus: os.cpus().length, memGB: +(os.totalmem() / 1e9).toFixed(2), threads: th,
        dlMs: t1 - t0, loadMs: t2 - t1, runMs: times, totalMs: Date.now() - t0 });
    }

    // 内部：异步调用的落点（不对外，靠 x-sep-token 认）
    if (action === '/sep/run' && method === 'POST') {
      const tok = String((req.headers && (req.headers['x-sep-token'] || req.headers['X-Sep-Token'])) || '');
      if (tok !== sepRunToken()) return reply(req, 403, { error: 'forbidden' });
      await sepRun(String(body.taskId || ''));
      return reply(req, 200, { ok: true });
    }

    // 余下的都要登录
    const me = userOf(req);
    if (!me) return reply(req, 401, { error: '请先登录' });

    // ── 伴奏生成（去人声）：同一来源不重复解析；提交后异步跑，客户端轮询 ──
    if (action === '/sep' && method === 'POST') {
      const src = String(body.src || 'netease');
      const id = String(body.id || '').trim().slice(0, 40);
      const trackId = String(body.trackId || '').trim().slice(0, 80);
      if (!id || !trackId) return reply(req, 400, { error: '缺 id / trackId' });
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return reply(req, 400, { error: 'id 不对' });
      const cacheKey = 'sep/cache/' + (SEP_ENGINE === 'umx' ? 'umx-hq' : SEP_ENGINE === 'mdx' ? 'mdx-kara2' : 'side-cancel') + '/' + crypto.createHash('sha1').update(src + ':' + id).digest('hex') + '.json';
      const hit = await ossGetJson(cacheKey).catch(() => null);
      if (hit && hit.url) return reply(req, 200, { ok: true, cached: true, url: hit.url, size: hit.size || 0, engine: hit.engine });
      const act = await ossGetJson(sepActiveKey(me.sub)).catch(() => null);
      if (act && act.taskId) {
        const cur = await ossGetJson(sepTaskKey(act.taskId)).catch(() => null);
        if (cur && (cur.status === 'queued' || cur.status === 'running') && Date.now() - n0(cur.at) < 15 * 60000) {
          return reply(req, 200, { ok: true, taskId: act.taskId, status: cur.status, reused: true });
        }
      }
      const acct = await ossGetJson(acctKey(me.sub)).catch(() => null);
      const unlimited = !!((acct && acct.admin) || ADMINS.indexOf(String(me.name || '').toLowerCase()) >= 0);
      const qt = await sepQuota(me.sub);
      if (!unlimited && qt.cur.n >= SEP_DAILY) return reply(req, 429, { error: `今天已经做了 ${SEP_DAILY} 首，明天再来` });
      const taskId = crypto.randomBytes(9).toString('hex');
      const tk = { taskId, uid: me.sub, trackId, src, id, status: 'queued', at: Date.now() };
      await ossPutJson(sepTaskKey(taskId), tk);
      if (!unlimited) { qt.cur.n += 1; await ossPutJson(qt.key, qt.cur); }
      await ossPutJson(sepActiveKey(me.sub), { taskId, at: Date.now() });
      try {
        await fcInvokeAsync({
          rawPath: '/api/sep/run', requestContext: { http: { method: 'POST' } },
          headers: { 'x-sep-token': sepRunToken(), 'x-sep-task': taskId },
          body: JSON.stringify({ taskId }),
        });
      } catch (e) {
        await ossPutJson(sepTaskKey(taskId), Object.assign(tk, { status: 'error', error: '任务启动失败' }));
        return reply(req, 500, { error: '任务启动失败：' + String((e && e.message) || e) });
      }
      return reply(req, 200, { ok: true, taskId, status: 'queued', left: unlimited ? 999 : SEP_DAILY - qt.cur.n, unlimited });
    }

    if (action === '/sep/status') {
      const taskId = String(q.taskId || '').replace(/[^a-f0-9]/g, '');
      if (!taskId) return reply(req, 400, { error: '缺 taskId' });
      const tk = await ossGetJson(sepTaskKey(taskId));
      if (!tk || tk.uid !== me.sub) return reply(req, 404, { error: '任务不存在' });
      return reply(req, 200, { ok: true, status: tk.status, url: tk.url || '', size: tk.size || 0, error: tk.error || '', engine: tk.engine || '', ms: tk.ms || 0 });
    }

    // 查今天还剩几次（前端显示用）
    if (action === '/sep/quota') {
      const acct = await ossGetJson(acctKey(me.sub)).catch(() => null);
      const unlimited = !!((acct && acct.admin) || ADMINS.indexOf(String(me.name || '').toLowerCase()) >= 0);
      const qt = await sepQuota(me.sub);
      return reply(req, 200, { ok: true, left: unlimited ? 999 : Math.max(0, SEP_DAILY - qt.cur.n), total: SEP_DAILY, unlimited });
    }

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
      if (!/^(sync|audio|kuromoji|sep|bundles)\//.test(key)) return reply(req, 400, { error: '只允许删 sync/ / audio/ / kuromoji/ 下的对象' });
      const done = await ossDelete(key);
      return reply(req, done ? 200 : 500, { ok: done, key });
    }

    // ── 账号保险箱：只存密文，服务端没有解密能力 ──
    if (action === '/vault') {
      if (method === 'GET') {
        const v = await ossGetJson(vaultKey(me.sub)).catch(() => null);
        return reply(req, 200, { ok: true, vault: v || null });
      }
      if (method === 'PUT' || method === 'POST') {
        if (body.vault === null) {                 // 传 null = 清掉（HTTP 触发器只放行 GET/POST/PUT，DELETE 走不通）
          await ossDelete(vaultKey(me.sub));
          return reply(req, 200, { ok: true });
        }
        const v = cleanVault(body.vault);
        if (!v) return reply(req, 400, { error: '保险箱格式不对' });
        if (JSON.stringify(v).length > VAULT_MAX) return reply(req, 413, { error: '保险箱太大' });
        await ossPutJson(vaultKey(me.sub), v);
        return reply(req, 200, { ok: true, updatedAt: v.updatedAt, entries: Object.keys(v.entries) });
      }
      if (method === 'DELETE') {
        await ossDelete(vaultKey(me.sub));
        return reply(req, 200, { ok: true });
      }
      return reply(req, 405, { error: '方法不支持' });
    }

    if (action === '/password' && method === 'POST') {
      const acct = await ossGetJson(acctKey(me.sub));
      if (!acct || hashPass(String(body.old || ''), acct.salt) !== acct.hash) return reply(req, 401, { error: '原密码不对' });
      if (String(body.new || '').length < 6) return reply(req, 400, { error: '新密码至少 6 位' });
      acct.salt = rid(16); acct.hash = hashPass(String(body.new), acct.salt);
      await ossPutJson(acctKey(me.sub), acct);
      // 保险箱的私钥是用「旧密码派生的密钥」包的，客户端拿到新 token 后要自己重新包一次
      const vault = await ossGetJson(vaultKey(me.sub)).catch(() => null);
      return reply(req, 200, { ok: true, token: tokenFor(me.sub, acct.name), vault: !!vault, user: { uid: me.sub, name: acct.name } });
    }

    // 只回一个「云端有没有变」的小哨兵：客户端启动时先问它，没变就不必传整份状态
    if (action === '/data/meta') {
      const cur = (await ossGetJson(dataKey(me.sub))) || { v: 1, at: null, data: null };
      return reply(req, 200, { ok: true, at: cur.at || null, bytes: cur.data ? JSON.stringify(cur.data).length : 0 });
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

exports.__test = { vocalCut, ossSign, sepQuota };
