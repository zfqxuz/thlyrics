/** 真机（真 OSS）验证：本地页面 → 标一个词 → 自动同步 → 清掉浏览器数据重载 → 自动恢复。
 *  跑完记得把云端对象恢复成空（seed），别把测试词留给用户。 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.argv[2] || 'http://127.0.0.1:8848/';
const HOME = process.env.HOME || '/home/zfq';
const root = HOME + '/.cache/ms-playwright';
const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort();
const chrome = path.join(root, dirs[dirs.length - 1], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const libPath = ['root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib'].map((p) => path.join(HERE, p)).join(':');
const browser = await chromium.launch({ executablePath: chrome, env: { ...process.env, LD_LIBRARY_PATH: libPath }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 850 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
const reqs = [];
page.on('request', (r) => { if (/aliyuncs\.com\/sync\//.test(r.url())) reqs.push(r.method() + ' sync'); });
page.on('response', (r) => { if (/aliyuncs\.com\/sync\//.test(r.url())) reqs.push(r.status() + ' ' + r.request().method()); });

await page.goto(BASE + '#/learn', { waitUntil: 'load' });
await page.waitForSelector('#deck .word', { timeout: 20000 });
const wid = await page.evaluate(() => { const el = document.querySelector('#deck .word .tick:not(.on)'); return el ? el.closest('.word').dataset.id : null; });
await page.locator('#deck .word .tick:not(.on)').first().click();
await page.waitForTimeout(5000);
const cloud1 = await page.evaluate(async () => {
  const cfg = await (await fetch('data/oss-sync.json', { cache: 'no-store' })).json();
  const [prog, imp] = await Promise.all([
    (await fetch(cfg.progress.get, { cache: 'no-store' })).json(),
    (await fetch(cfg.imports.get, { cache: 'no-store' })).json(),
  ]);
  return { known: prog.known || {}, notes: prog.notes || {}, del: prog.del || {}, imp: imp.imp || {}, impCount: Object.keys(imp.imp || {}).length };
});
console.log('① 自动同步后云端 known 里有这个词：', !!cloud1.known[wid], '词 id =', wid, '· 云端 known 条数', Object.keys(cloud1.known).length, '· 歌单', cloud1.impCount, '首');
console.log('   同步请求：', reqs.join(' | '));

await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '?wipe=1#/learn', { waitUntil: 'load' });
await page.waitForSelector('#deck .word', { timeout: 20000 });
await page.waitForTimeout(6000);
const back = await page.evaluate((id) => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}'); return { v: j.known ? j.known[id] : null, n: Object.keys(j.known || {}).length, at: j.syncAt, err: j.syncErr || '' }; }, wid);
console.log('② 清空浏览器数据后重载：恢复的这个词 =', back.v, '· 本机 known 条数', back.n, '· syncAt', back.at, '· err', back.err || '（无）');
console.log('③ 页面报错：', errs.length ? errs.slice(0, 3).join(' || ') : '无');
const ok = !!cloud1.known[wid] && Number(back.v) > 0 && errs.length === 0;
console.log(ok ? '\n===== 真 OSS 持久化验证通过 =====' : '\n===== 真 OSS 持久化验证失败 =====');
await browser.close();
process.exit(ok ? 0 : 1);
