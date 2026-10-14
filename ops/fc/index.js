/**
 * thlyrics 账号 / 同步 API（阿里云函数计算 FC 3.0，HTTP 触发器）
 *
 * 无第三方依赖：口令用 node:crypto 的 scrypt 加盐哈希，令牌是 HMAC 签名，
 * 数据挂在用户自己 OSS 桶的 sync/users/ 前缀下（每个账号两个对象）。
 *
 * 路由：
 *   GET  /api/health
 *   POST /api/register  {name, pass}
 *   POST /api/login     {name, pass}
 *   GET  /api/me
 *   POST /api/password  {old, new}
 *   GET  /api/data
 *   PUT  /api/data      {data}
 */
const crypto = require('node:crypto');
const https = require('node:https');

const ENV = process.env;
const OSS_HOST = ENV.OSS_HOST || 'thlyrics-audio.oss-cn-hangzhou.aliyuncs.com';
const OSS_BUCKET = ENV.OSS_BUCKET || 'thlyrics-audio';
const PREFIX = 'sync/users/';
const TOKEN_DAYS = 180;
const ALLOW = (ENV.ALLOW_ORIGINS || 'https://zfqxuz.github.io,http://127.0.0.1:8848,http://localhost:8848').split(',');
const MAX_BODY = 8 * 1024 * 1024;      // 单次请求体上限
const MAX_STORE = 12 * 1024 * 1024;    // 每个账号记录的存储上限

// ─────────── OSS 读写（V1 签名，手写，避免打包依赖） ───────────
const b64 = (b) => Buffer.from(b).toString('base64');
function ossRequest(method, key, body, contentType) {
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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(buf).toString('utf8') }));
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
  const A = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, clearedAt: 0 }, a || {});
  const B = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, clearedAt: 0 }, b || {});
  const out = { clearedAt: Math.max(n0(A.clearedAt), n0(B.clearedAt)) };
  out.known = {};
  for (const k of new Set([...Object.keys(A.known), ...Object.keys(B.known)])) {
    const x = n0(A.known[k]), y = n0(B.known[k]);
    const v = Math.abs(y) > Math.abs(x) ? y : x;
    if (v && Math.abs(v) > out.clearedAt) out.known[k] = v;
  }
  out.notes = {};
  for (const k of new Set([...Object.keys(A.notes), ...Object.keys(B.notes)])) {
    const x = A.notes[k] || {}, y = B.notes[k] || {};
    const v = n0(y.u) > n0(x.u) ? y : x;
    if (v && v.meaning && (n0(v.u) > out.clearedAt || !out.clearedAt)) out.notes[k] = v;
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

    if (action === '/register' && method === 'POST') {
      const name = String(body.name || '').trim(), pass = String(body.pass || '');
      if (!nameOk(name)) return reply(req, 400, { error: '用户名要 2~20 位，字母/数字/下划线/中文' });
      if (pass.length < 6) return reply(req, 400, { error: '密码至少 6 位' });
      const key = name.toLowerCase();
      const index = (await ossGetJson(INDEX_KEY)) || {};
      if (index[key]) return reply(req, 409, { error: '这个用户名已经被用了' });
      const uid = rid(8);
      const salt = rid(16);
      const acct = { uid, name, nameLower: key, salt, hash: hashPass(pass, salt), createdAt: new Date().toISOString() };
      await ossPutJson(acctKey(uid), acct);
      index[key] = uid;
      await ossPutJson(INDEX_KEY, index);
      if (body.data) await ossPutJson(dataKey(uid), { v: 1, at: new Date().toISOString(), data: body.data });
      return reply(req, 200, { ok: true, token: tokenFor(uid, name), user: { uid, name } });
    }

    if (action === '/login' && method === 'POST') {
      const name = String(body.name || '').trim().toLowerCase(), pass = String(body.pass || '');
      const index = (await ossGetJson(INDEX_KEY)) || {};
      const uid = index[name];
      if (!uid) return reply(req, 401, { error: '用户名或密码不对' });
      const acct = await ossGetJson(acctKey(uid));
      if (!acct || hashPass(pass, acct.salt) !== acct.hash) return reply(req, 401, { error: '用户名或密码不对' });
      return reply(req, 200, { ok: true, token: tokenFor(uid, acct.name), user: { uid, name: acct.name } });
    }

    // 余下的都要登录
    const me = userOf(req);
    if (!me) return reply(req, 401, { error: '请先登录' });

    if (action === '/me') return reply(req, 200, { ok: true, user: { uid: me.sub, name: me.name } });

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
