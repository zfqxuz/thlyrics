/**
 * 真机验证（线上真账号）：注册（带头像）→ 导入一首真歌 → 标收藏/会唱/已掌握 → 清浏览器数据重登 → 全都回来。
 * 用完记得清理：临时账号对象 + sync/users/_index.json 里的键（脚本会把账号名打出来）。
 * 用法：node acc-real.mjs [baseUrl] [name]
 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.argv[2] || 'https://zfqxuz.github.io/thlyrics/';
const NAME = process.argv[3] || ('probe_av_' + Date.now().toString(36));
const PASS = 'probe-live-123456';
const HOME = process.env.HOME || '/home/zfq';
const root = HOME + '/.cache/ms-playwright';
const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort();
const chrome = path.join(root, dirs[dirs.length - 1], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const libPath = ['root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib'].map((p) => path.join(HERE, p)).join(':');
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const browser = await chromium.launch({ executablePath: chrome, env: { ...process.env, LD_LIBRARY_PATH: libPath },
  args: ['--no-sandbox', '--disable-dev-shm-usage', ...(PROXY ? ['--proxy-server=' + PROXY, '--proxy-bypass-list=localhost;127.0.0.1;::1'] : [])] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errs.push('console: ' + m.text().slice(0, 120)); });
let bad = 0;
const check = (n, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

await page.goto(BASE + '?acc=' + Date.now(), { waitUntil: 'load' });
await page.waitForSelector('#g-reg', { timeout: 30000 });
await page.setInputFiles('#g-av', { name: 'a.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=', 'base64') });
await page.waitForTimeout(800);
await page.locator('#g-name').fill(NAME);
await page.locator('#g-pass').fill(PASS);
await page.locator('#g-reg').click();
await page.waitForTimeout(7000);
const reg = await page.evaluate(() => ({ gate: document.getElementById('gate').hidden, av: !!document.querySelector('#btn-av img'), name: (JSON.parse(localStorage.getItem('thlyrics.account.v1') || '{}').name) || '' }));
check('线上注册（带头像）并放行', reg.gate && reg.name === NAME, `${reg.name} · 头像 ${reg.av ? '有' : '无'}`);

// 导入一首真歌（单曲）
await page.goto(BASE + '?acc=' + Date.now() + '2#/songs', { waitUntil: 'load' });
await page.waitForTimeout(1500);
const plopen = await page.locator('.impbox').evaluate((el) => el.open).catch(() => false);
if (!plopen) { await page.locator('.impbox summary').click(); await page.waitForTimeout(400); }
await page.locator('#plinput').fill('https://music.163.com/song?id=22645196');
await page.locator('#plgo').click();
await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 180000 });
await page.waitForTimeout(1200);
const st = ((await page.locator('#plstat').textContent()) || '').trim();
check('真账号能导入真歌', /入库 1 首/.test(st), st.slice(0, 40));

// 标收藏 / 会唱 / 已掌握
await page.goto(BASE + '?acc=' + Date.now() + '3#/songs', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('#list .track').first().click();
await page.waitForSelector('#t-fav', { timeout: 30000 });
await page.locator('#t-fav').click(); await page.waitForTimeout(400);
await page.locator('#t-mark').click(); await page.waitForTimeout(400);
await page.goto(BASE + '?acc=' + Date.now() + '4#/learn', { waitUntil: 'load' });
await page.waitForSelector('#deck .word .tick:not(.on)', { timeout: 30000 });
await page.locator('#deck .word .tick:not(.on)').first().click();
await page.waitForTimeout(6000);

const local = () => page.evaluate(() => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}');
  return { fav: Object.keys(j.fav || {}).filter((k) => j.fav[k] > 0).length, sing: Object.keys(j.sing || {}).filter((k) => j.sing[k] > 0).length,
    known: Object.keys(j.known || {}).filter((k) => j.known[k] > 0).length, imp: Object.keys(j.imp || {}).length, av: !!document.querySelector('#btn-av img') }; });
const before = await local();
check('标收藏 / 会唱 / 已掌握 / 导入', before.fav === 1 && before.sing === 1 && before.known > 0 && before.imp === 1, JSON.stringify(before));
await page.waitForTimeout(3000);

// 换设备：清掉浏览器数据 + 重新登录
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '?acc=' + Date.now() + '5#/me', { waitUntil: 'load' });
await page.waitForSelector('#g-login', { timeout: 30000 });
await page.locator('#g-name').fill(NAME);
await page.locator('#g-pass').fill(PASS);
await page.locator('#g-login').click();
await page.waitForTimeout(9000);
const after = await local();
check('清浏览器数据 + 重登：记录全回来（含头像）',
  after.fav === before.fav && after.sing === before.sing && after.known === before.known && after.imp === before.imp && after.av,
  `重登后 ${JSON.stringify(after)}`);
console.log('报错：', errs.length ? errs.slice(0, 3).join(' || ') : '无');
console.log('账号名（清理用）：', NAME);
console.log(bad === 0 && errs.length === 0 ? '\n===== 真账号验收通过 =====' : `\n===== 有 ${bad} 项失败 / ${errs.length} 条报错 =====`);
await browser.close();
process.exit(bad === 0 && errs.length === 0 ? 0 : 1);
