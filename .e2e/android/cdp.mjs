/**
 * 安卓 WebView 的 CDP 小客户端。
 * 背景：Android WebView 只暴露「页面级」调试端点（/devtools/page/xxx），没有浏览器级端点，
 * 所以 Playwright 的 connectOverCDP 连不上（会 1006 断开）。这里用 Node 自带的 WebSocket 直连页面。
 *
 * 用法：node cdp.mjs            → 打印页面信息
 *       import { withCDP } from './cdp.mjs'
 */
import fs from 'node:fs';

export const ENDPOINT = process.env.CDP || 'http://127.0.0.1:9222';

export async function withCDP(fn) {
  const list = await (await fetch(`${ENDPOINT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page' && /localhost|capacitor/.test(t.url)) || list.find((t) => t.type === 'page');
  if (!target) throw new Error('没有找到页面级调试目标（App 没在跑？）');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('WS 连接失败')); });
  let seq = 0; const pending = new Map(); const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) throw new Error('页面抛错: ' + (ex.exception?.description || ex.text || '').slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (path) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    return path;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try { return await fn({ send, evaluate, shot, sleep, events, page: target }); }
  finally { try { ws.close(); } catch {} }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await withCDP(async ({ evaluate, page }) => {
    console.log('URL:', page.url);
    console.log('标题:', await evaluate('document.title'));
    console.log('UA:', await evaluate('navigator.userAgent'));
  });
}
