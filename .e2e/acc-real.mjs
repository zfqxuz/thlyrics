/** 真机验证：线上站点 + 真函数计算 API（注册/登录/换设备恢复）。
 *  用一次性账号 probe_live_*，跑完由调用方清理 OSS 里的账号对象。 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.argv[2] || 'https://zfqxuz.github.io/thlyrics/';
const NAME = process.argv[3] || 'probe_live_1';
const PASS = 'probe-live-123456';
const HOME = process.env.HOME || '/home/zfq';
const root = HOME + '/.cache/ms-playwright';
const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort();
const chrome = path.join(root, dirs[dirs.length - 1], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const libPath = ['root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib'].map((p) => path.join(HERE, p)).join(':');
const browser = await chromium.launch({ executablePath: chrome, env: { ...process.env, LD_LIBRARY_PATH: libPath }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errs.push('console: ' + m.text().slice(0, 120)); });
const api = [];
page.on('response', (r) => { if (/fcapp\.run/.test(r.url())) api.push(r.status() + ' ' + r.request().method() + ' ' + new URL(r.url()).pathname); });

await page.goto(BASE + '?acc=' + Date.now() + '#/mine', { waitUntil: 'load' });
await page.waitForSelector('#acc-reg', { timeout: 30000 });
await page.locator('#acc-name').fill(NAME);
await page.locator('#acc-pass').fill(PASS);
await page.locator('#acc-reg').click();
await page.waitForTimeout(6000);
const reg = { out: await page.locator('#acc-out').count(), msg: (await page.locator('#syncmsg').textContent()) || '', state: (await page.locator('#p-state').textContent()) || '' };
console.log('① 线上注册：', reg.out === 1 ? '已登录' : '失败', '|', reg.msg.slice(0, 46), '| toast:', reg.state.slice(0, 30));

await page.goto(BASE + '?acc=' + Date.now() + '2#/learn', { waitUntil: 'load' });
await page.waitForSelector('#deck .word .tick:not(.on)', { timeout: 30000 });
const wid = await page.evaluate(() => { const el = document.querySelector('#deck .word .tick:not(.on)'); return el ? el.closest('.word').dataset.id : null; });
await page.locator('#deck .word .tick:not(.on)').first().click();
await page.waitForTimeout(6000);
console.log('② 标词后本机 known：', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}').known || {}).length), '词（id ' + wid + '）');

await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '?acc=' + Date.now() + '3#/mine', { waitUntil: 'load' });
await page.waitForSelector('#acc-login', { timeout: 30000 });
await page.waitForTimeout(4000);
await page.locator('#acc-name').fill(NAME);
await page.locator('#acc-pass').fill(PASS);
await page.locator('#acc-login').click();
await page.waitForTimeout(7000);
const back = await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}'); return { known: Object.keys(j.known || {}).filter((k) => j.known[k] > 0).length, acc: !!localStorage.getItem('thlyrics.account.v1') }; });
console.log('③ 清掉浏览器数据 + 登录同账号：', JSON.stringify(back));
console.log('④ API 调用：', api.join(' | '));
console.log('⑤ 报错：', errs.length ? errs.slice(0, 3).join(' || ') : '无');
const ok = reg.out === 1 && back.acc && back.known > 0 && errs.length === 0;
console.log(ok ? '\n===== 线上账号验证通过 =====' : '\n===== 线上账号验证失败 =====');
await browser.close();
process.exit(ok ? 0 : 1);
