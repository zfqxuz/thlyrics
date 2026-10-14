/**
 * 真机验证：曲库=自己导入的（不带内置曲目）+ 真解析接口（网易云）导入 专辑 / 单曲 / 短链。
 * 用假登录态只为过闸门，不碰账号 API（同步请求会 401，已过滤）。
 * 用法：node import-real.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.argv[2] || 'http://127.0.0.1:8848/';
const HOME = process.env.HOME || '/home/zfq';
const root = HOME + '/.cache/ms-playwright';
const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort();
const chrome = path.join(root, dirs[dirs.length - 1], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const libPath = ['root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib'].map((p) => path.join(HERE, p)).join(':');
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const browser = await chromium.launch({ executablePath: chrome, env: { ...process.env, LD_LIBRARY_PATH: libPath },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
    ...(PROXY ? ['--proxy-server=' + PROXY, '--proxy-bypass-list=localhost;127.0.0.1;::1'] : [])] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true })).newPage();
await page.addInitScript(() => localStorage.setItem('thlyrics.account.v1', JSON.stringify({ token: 'probe', name: 'probe', uid: 'probe' })));
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errs.push('console: ' + m.text().slice(0, 120)); });
let bad = 0;
const check = (n, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

await page.goto(BASE + '?probe=' + Date.now(), { waitUntil: 'load' });
await page.waitForSelector('#view-home .nowcard', { timeout: 30000 });
const shipped = await page.evaluate(async () => (await (await fetch('data/index.json?v=probe')).json()).tracks.length);
check('线上曲库数据不含内置曲目', shipped === 0, `tracks ${shipped}`);

await page.goto(BASE + '?probe=' + Date.now() + '2#/songs', { waitUntil: 'load' });
await page.waitForTimeout(1500);
check('曲库空 + 导入面板自动展开', (await page.locator('#list .track').count()) === 0 && (await page.locator('.impbox').getAttribute('open')) !== null, ((await page.locator('.impbox summary').textContent()) || '').trim());

const imp = async (q) => {
  await page.locator('#plinput').fill(q);
  await page.locator('#plgo').click();
  await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 300000 });
  await page.waitForTimeout(800);
  return ((await page.locator('#plstat').textContent()) || '').trim();
};
const albumStat = await imp('https://music.163.com/album?id=72343');
check('真·专辑导入（AQ -永久-）', /入库 \d+ 首/.test(albumStat) && !/失败/.test(albumStat), albumStat.slice(0, 60));
const songStat = await imp('分享单曲: Bad Apple!! https://music.163.com/song?id=22645196');
check('真·单曲导入（分享文案）', /入库 1 首/.test(songStat), songStat.slice(0, 60));
const shortStat = await imp('https://163cn.tv/zzzz');
check('真·163cn.tv 短链：能解到域名、认不出就报错', /链接里没有|短链/.test(shortStat), shortStat.slice(0, 60));

await page.waitForTimeout(500);
const listN = await page.locator('#list .track').count();
check('曲库 = 导入的歌', listN >= 6, listN + ' 首');
await page.locator('#list .track').first().click();
await page.waitForTimeout(2500);
const words = await page.evaluate(() => document.querySelectorAll('#twlist .word').length);
await page.locator('#t-sing').click();
await page.waitForTimeout(5000);
const t = await page.evaluate(() => ({ blocks: document.querySelectorAll('#plyric .lblock').length || 0, words: 0, src: (document.querySelector('audio') || {}).src || '' }));
t.words = words;
check('导入曲目有歌词/词汇', t.words > 0 && t.blocks > 0, `${t.blocks} 行歌词 · ${t.words} 词`);
check('导入曲目能解析到可播地址（走后端）', /^https:/.test(t.src) && /music\.126\.net/.test(t.src), t.src.slice(0, 56));
const qual = await page.evaluate(() => {
  // 只看日语词（英文曲目 / ASCII 词本来就不该有罗马音）
  const w = [...document.querySelectorAll('#plyric .w:not([data-plain])')]
    .filter((x) => /[\u3041-\u30ff\u4e00-\u9fff]/.test(x.dataset.s || ''));
  const withR = w.filter((x) => ((x.querySelector('.r') || {}).textContent || '').trim()).length;
  const dict = w.filter((x) => x.dataset.w).length;
  return { n: w.length, withR, pct: Math.round((withR / Math.max(1, w.length)) * 100), dict, dictPct: Math.round((dict / Math.max(1, w.length)) * 100),
    cover: (document.getElementById('mb-cover') || {}).src || '', bar: document.getElementById('minibar').classList.contains('on') };
});
check('日语词逐词罗马音覆盖（服务端 kuromoji）', qual.n > 10 && qual.pct >= 95, `${qual.withR}/${qual.n} = ${qual.pct}%`);
check('词表命中率（6423 词库 + 读音兜底）', qual.dictPct >= 50, `${qual.dict}/${qual.n} = ${qual.dictPct}% 的词能点开看释义`);
check('迷你播放条显示专辑小图', qual.bar && /music\.126\.net/.test(qual.cover), qual.cover.slice(0, 56));
check('点开曲目自动起播', qual.bar && !!t.src, '播放条已出现：' + qual.bar);

await page.goto(BASE + '?probe=' + Date.now() + '3#/learn', { waitUntil: 'load' });
await page.waitForTimeout(2500);
const deckN = await page.locator('#deck .word').count();
const stat = ((await page.locator('#headstat').textContent()) || '').trim();
check('学词页的词来自导入曲库', deckN > 0 && /首/.test(stat), `${deckN} 张词卡 · 头部「${stat}」`);
console.log('报错：', errs.length ? errs.slice(0, 3).join(' || ') : '无');
console.log(bad === 0 && errs.length === 0 ? '\n===== 真机导入链路通过 =====' : `\n===== 有 ${bad} 项失败 / ${errs.length} 条报错 =====`);
await browser.close();
process.exit(bad === 0 && errs.length === 0 ? 0 : 1);
