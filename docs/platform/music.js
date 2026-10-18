/**
 * 音乐平台直连（原生壳用 CapInstanceHttp，绕过 WebView 的 CORS）：
 *   扫码登录（网易云 / QQ）、取音频地址。
 * 目的：登录会话由**本机**发起（登录地点就是个手机 IP），cookie 也只留在设备上，
 *      不再经过我们的服务器。网页版没有这条通道，仍走云端接口兜底。
 */
const cap = (typeof window !== 'undefined') ? window.Capacitor : null;
const native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
const http = (native && cap.Plugins && cap.Plugins.CapacitorHttp) ? cap.Plugins.CapacitorHttp : null;
const rawHttp = (native && cap.Plugins && cap.Plugins.NativeHttp) ? cap.Plugins.NativeHttp : null;

export const musicNative = !!http;

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const JAR = new Map();                 // host → Map(name → value)
const jarFor = (host) => {
  if (!JAR.has(host)) JAR.set(host, new Map());
  return JAR.get(host);
};
const HOST = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

/** 把响应里的 Set-Cookie 收进 jar（CapacitorHttp 给的是数组或字符串） */
function absorb(url, headers) {
  const raw = headers && (headers['Set-Cookie'] || headers['set-cookie']);
  if (!raw) return;
  const host = HOST(url);
  const list = Array.isArray(raw) ? raw : String(raw).split(/,(?=[^;]+=)/);
  for (const line of list) {
    const m = String(line).match(/^\s*([^=;\s]+)=([^;]*)/);
    if (m) jarFor(host).set(m[1], m[2]);
  }
}
function cookieHeader(url) {
  const host = HOST(url);
  const parts = [];
  for (const [h, m] of JAR) {
    if (host === h || host.endsWith('.' + h) || h.endsWith('.' + host)) {
      for (const [k, v] of m) parts.push(k + '=' + v);
    }
  }
  return parts.join('; ');
}

async function req(url, opt = {}) {
  const headers = Object.assign({ 'User-Agent': UA }, opt.headers || {});
  const ck = cookieHeader(url);
  if (ck) headers.Cookie = headers.Cookie ? headers.Cookie + '; ' + ck : ck;
  const r = await http.request({
    url, method: opt.method || 'GET', headers,
    ...(opt.data ? { data: opt.data } : {}),
    responseType: opt.responseType || 'text',
    connectTimeout: 15000, readTimeout: 15000,
  });
  absorb(url, r.headers);
  return r;
}

/** CapacitorHttp 有时直接给对象，有时给字符串，统一一下 */
const asJson = (d) => (typeof d === 'string' ? JSON.parse(d || '{}') : (d || {}));
/** 单跳请求（不跟随重定向），返回 status / headers / body */
async function hop(url, headers) {
  if (!rawHttp) {
    // 没有原生插件时退回 CapacitorHttp（会跟随重定向，拿不全中间 cookie）
    const r = await req(url, { headers });
    return { status: r.status, headers: r.headers || {}, body: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
  }
  const r = await rawHttp.raw({ url, headers: Object.assign({ 'User-Agent': UA }, headers || {}) });
  return { status: r.status, headers: r.headers || {}, body: String(r.body || '') };
}
const hash33 = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h += (h << 5) + s.charCodeAt(i); return h & 0x7fffffff; };

// ── 网易云 ──
export async function neteaseQrStart() {
  const r = await req('https://music.163.com/api/login/qrcode/unikey?type=1', {
    headers: { Referer: 'https://music.163.com/', Cookie: 'os=pc; appver=2.9.7' },
  });
  const j = asJson(r.data);
  if (!j.unikey) throw new Error('取二维码失败');
  const target = 'https://music.163.com/login?codekey=' + encodeURIComponent(j.unikey);
  return { key: j.unikey, img: 'https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=' + encodeURIComponent(target), link: target };
}
export async function neteaseQrPoll(key) {
  const r = await req('https://music.163.com/api/login/qrcode/client/login?key=' + encodeURIComponent(key) + '&type=1', {
    headers: { Referer: 'https://music.163.com/', Cookie: 'os=pc; appver=2.9.7' },
  });
  const j = asJson(r.data);
  const code = Number(j.code) || 0;
  if (code !== 803) return { state: code === 800 ? 'expired' : code === 802 ? 'scanned' : 'wait', code };
  const m = jarFor(HOST('https://music.163.com'));
  const musicU = m.get('MUSIC_U') || '';
  const csrf = m.get('__csrf') || '';
  if (!musicU) return { state: 'ok', code, error: '没拿到凭证' };
  return { state: 'ok', code, cookie: 'MUSIC_U=' + musicU + (csrf ? '; __csrf=' + csrf : '') };
}

// ── QQ 音乐 ──
const QQ_HOSTS = 'https://ssl.ptlogin2.qq.com';
export async function qqQrStart() {
  const url = QQ_HOSTS + '/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=' + Math.random() + '&daid=383&pt_3rd_aid=100497308';
  const r = await req(url, { responseType: 'arraybuffer', headers: { Referer: 'https://xui.ptlogin2.qq.com/' } });
  const b64 = String(r.data || '');
  if (!b64) throw new Error('取二维码失败');
  return { key: 'qq', img: 'data:image/png;base64,' + b64 };
}
export async function qqQrPoll() {
  const m = jarFor('ssl.ptlogin2.qq.com');
  const qrsig = m.get('qrsig') || '';
  if (!qrsig) return { state: 'expired', code: 65 };
  const u = QQ_HOSTS + '/ptqrlogin?u1=' + encodeURIComponent('https://graph.qq.com/oauth2.0/login_jump')
    + '&ptqrtoken=' + hash33(qrsig) + '&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-' + Date.now()
    + '&js_ver=20102616&js_type=1&login_sig=&pt_uistyle=40&aid=716027609&daid=383&pt_3d_aid=100497308&has_onekey=1&pt_3rd_aid=100497308';
  const r = await req(u, { headers: { Referer: 'https://xui.ptlogin2.qq.com/' } });
  const hit = String(r.data || '').match(/ptuiCB\('(\d+)','\d+','([^']*)','\d+','([^']*)'/);
  const code = hit ? Number(hit[1]) : -1;
  if (code !== 0) return { state: code === 65 ? 'expired' : code === 67 ? 'scanned' : 'wait', code };
  // 手动串重定向：每一步的 Set-Cookie 都要收（qm_keyst 在中间某跳下发）
  let next = hit[2];
  const bag = new Map();
  const hops = [];
  const absorbLine = (line) => {
    const m = String(line).match(/^\s*([^=;\s]+)=([^;]*)/);
    if (m) bag.set(m[1], m[2]);
  };
  const takeCookies = (hdr) => {
    const sc = hdr['set-cookie'] || hdr['Set-Cookie'] || '';
    String(sc).split('\n').forEach(absorbLine);
  };
  for (let i = 0; i < 6 && next; i++) {
    const ck = [...bag].map(([k, v]) => k + '=' + v).join('; ');
    const rr = await hop(next, { Referer: 'https://y.qq.com/', ...(ck ? { Cookie: ck } : {}) });
    takeCookies(rr.headers);
    const loc = rr.headers.location || rr.headers.Location || '';
    hops.push({ status: rr.status, loc: String(loc).slice(0, 120), setCookie: Object.keys(rr.headers).filter((k) => /set-cookie/i.test(k)).length, bag: [...bag.keys()] });
    if (!loc) break;
    next = loc.startsWith('http') ? loc : new URL(loc, next).toString();
  }
  // 最后再打一次音乐站，确保 qm_keyst 落地
  try {
    const ck2 = [...bag].map(([k, v]) => k + '=' + v).join('; ');
    const rr2 = await hop('https://y.qq.com/', { Referer: 'https://y.qq.com/', ...(ck2 ? { Cookie: ck2 } : {}) });
    takeCookies(rr2.headers);
  } catch { /* 忽略 */ }
  const keep = [];
  for (const n of ['qm_keyst', 'qqmusic_key', 'uin', 'p_skey', 'skey']) {
    const v = bag.get(n);
    if (v) keep.push(n + '=' + v);
  }
  const cookie = keep.join('; ');
  if (!/qm_keyst|qqmusic_key/.test(cookie)) return { state: 'ok', code: 0, error: '没拿到音乐凭证', debug: { hops, cookies: [...bag.keys()], start: String(hit[2]).slice(0, 120) } };
  return { state: 'ok', code: 0, cookie };
}

// ── 取音频地址（带本机 cookie，不经过我们的服务器） ──
export async function neteaseAudioUrl(id, br, cookie) {
  const url = 'https://music.163.com/api/song/enhance/player/url?id=' + id + '&ids=%5B' + id + '%5D&br=' + (br || 320) * 1000;
  const r = await req(url, { headers: { Referer: 'https://music.163.com/', Cookie: 'os=pc; appver=2.9.7' + (cookie ? '; ' + cookie : '') } });
  const j = asJson(r.data);
  const d = (j.data || [])[0] || {};
  if (!d.url) return null;
  return { url: String(d.url).replace(/^http:/, 'https:'), br: d.br, size: d.size };
}

export async function qqAudioUrl(id, cookie) {
  const body = { req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey',
    param: { guid: '10000', songmid: [id], songtype: [0], uin: '0', loginflag: 1, platform: '20' } },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 } };
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' + encodeURIComponent(JSON.stringify(body));
  const r = await req(url, { headers: { Referer: 'https://y.qq.com/' + (cookie ? '' : ''), ...(cookie ? { Cookie: cookie } : {}) } });
  const j = asJson(r.data);
  const d = (j.req_0 && j.req_0.data) || {};
  const m = (d.midurlinfo || [])[0] || {};
  if (!m.purl) return null;
  return { url: String((d.sip || [])[0] + m.purl).replace(/^http:/, 'https:'), br: 128000, size: 0 };
}
