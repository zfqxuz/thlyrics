/** 快速出图：只 stub 账号 API，用来调版面（不碰真 OSS/真 API） */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = 'http://127.0.0.1:8848/';
const HOME = process.env.HOME || '/home/zfq';
const root = HOME + '/.cache/ms-playwright';
const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort();
const chrome = path.join(root, dirs[dirs.length - 1], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const libPath = ['root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib'].map((p) => path.join(HERE, p)).join(':');
const browser = await chromium.launch({ executablePath: chrome, env: { ...process.env, LD_LIBRARY_PATH: libPath }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true })).newPage();
let data = null;
await page.route('**/*', (route) => {
  const req = route.request(); const u = req.url();
  if (/^https:\/\/thlyrics-auth-[^/]+\.cn-hangzhou\.fcapp\.run\//.test(u)) {
    const p = new URL(u).pathname.replace(/^\/api/, '');
    const send = (c, o) => route.fulfill({ status: c, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' }, body: JSON.stringify(o) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
    if (p === '/register') { data = body.data || {}; return send(200, { ok: true, token: 't1', user: { uid: 'u1', name: 'shot', admin: false } }); }
    if (p === '/me') return send(200, { ok: true, user: { uid: 'u1', name: 'shot', admin: false } });
    if (p === '/data') { data = Object.assign({}, data, body.data); return send(200, { ok: true, at: new Date().toISOString(), data }); }
    return send(404, { error: 'no' });
  }
  return route.continue();
});
await page.goto(BASE + '?q=' + Date.now(), { waitUntil: 'load' });
await page.waitForSelector('#g-reg', { timeout: 20000 });
await page.locator('#g-name').fill('shot'); await page.locator('#g-pass').fill('shot-pass-123');
await page.locator('#g-reg').click();
await page.waitForTimeout(2500);
const which = process.argv[2] || 'player';
if (which === 'home') { await page.goto(BASE + '?q=2#/home'); await page.waitForTimeout(1500); }
else if (which === 'songs') { await page.goto(BASE + '?q=3#/songs'); await page.waitForTimeout(1800); }
else if (which === 'mine') { await page.goto(BASE + '?q=4#/mine'); await page.waitForTimeout(1800); }
else { await page.goto(BASE + '?q=5#/track/t36@5'); await page.waitForTimeout(4000); }
await page.screenshot({ path: path.join(HERE, 'shots', 'quick-' + which + '.png') });
console.log('已出图 shots/quick-' + which + '.png');
await browser.close();
