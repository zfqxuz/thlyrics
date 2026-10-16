/**
 * 网络层：所有出网请求都从这里走。
 * 分开的三个来源：自己的后端（函数计算）、第三方中继（gdstudio）、站内静态数据。
 * 原生壳里不需要 CORS，行为一致，所以也不需要分实现。
 */
import { V } from '../version.js?v=20261016i';

export const API_BASE = 'https://thlyrics-auth-bybvhpggbp.cn-hangzhou.fcapp.run/api';   // 账号 / 同步 / 解析 / 分词
export const GD = 'https://music-api.gdstudio.xyz/api.php';                             // 第三方中继（仅网易云）

/** 给请求套一个超时（ms <= 0 表示不设超时） */
async function withTimeout(run, ms) {
  if (!(ms > 0)) return run(undefined);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await run(ac.signal); } finally { clearTimeout(timer); }
}

/** 站内静态数据（带版本号，绕开 Pages 的 10 分钟缓存） */
export function dataUrl(name) { return `data/${name}?v=${V}`; }

/** 任意 JSON：非 2xx 直接失败 */
export function getJson(url, { timeout = 20000, ...opts } = {}) {
  return withTimeout(async (signal) => {
    const r = await fetch(url, { ...opts, signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }, timeout);
}

/** 自己的后端：把后端给的 error 文案透出来（音频直链 / 歌词） */
export function fcJson(path, { timeout = 20000 } = {}) {
  return withTimeout(async (signal) => {
    const r = await fetch(API_BASE + path, { signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  }, timeout);
}

/** 后端 JSON（可带 body）：/segment、/resolve 这类 */
export function apiJson(path, { method = 'GET', body, timeout = 20000 } = {}) {
  return withTimeout(async (signal) => {
    const r = await fetch(API_BASE + path, {
      method, signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
  }, timeout);
}

/** 账号 API：带 token；同步一次可能很久，所以默认不设超时（与旧行为一致） */
export async function apiCall(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch { /* 空响应 */ }
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j || {};
}

/** 第三方中继：偶尔抽风（限流 / 少 CORS 头），失败退避重试 */
export async function gdJson(q, tries = 3) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch(`${GD}?${q}`, { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = (e && e.name === 'AbortError') ? new Error('接口超时') : new Error('接口不可用');
      if (i < tries - 1) await new Promise((r2) => setTimeout(r2, 600 * (i + 1)));
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}
