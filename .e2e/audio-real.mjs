/** 真网络排查：内置曲目（无 OSS 音频）现在到底能不能出声 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BASE = process.argv[2] || 'http://127.0.0.1:8848/';
const NAME = 'probe_audio_' + Math.floor(Math.random() * 1e6);
const HOME = process.env.HOME || '/home/zfq';
const root = HOME + '/.cache/ms-playwright';
const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort();
const chrome = path.join(root, dirs[dirs.length - 1], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const libPath = ['root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib'].map((p) => path.join(HERE, p)).join(':');
const browser = await chromium.launch({ executablePath: chrome, env: { ...process.env, LD_LIBRARY_PATH: libPath }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 160)); });
const net = [];
page.on('request', (r) => { if (/gdstudio|music\.126\.net/.test(r.url())) net.push('→ ' + r.method() + ' ' + r.url().slice(0, 90)); });
page.on('response', (r) => { if (/gdstudio|music\.126\.net/.test(r.url())) net.push('← ' + r.status() + ' ' + new URL(r.url()).host + ' ' + (r.headers()['content-type'] || '')); });
await page.goto(BASE + '?a=1', { waitUntil: 'load' });
await page.waitForSelector('#g-reg', { timeout: 25000 });
await page.locator('#g-name').fill(NAME);
await page.locator('#g-pass').fill('probe-pass-123');
await page.locator('#g-reg').click();
await page.waitForTimeout(3500);
await page.goto(BASE + '?a=2#/track/t1', { waitUntil: 'load' });
await page.waitForTimeout(2500);
console.log('== 单曲页状态：', (await page.locator('#p-state').textContent()) || '(空)');
await page.locator('#t-sing').click();          // 进入跟唱 → 触发播放
await page.waitForTimeout(9000);
const st = await page.evaluate(() => {
  const a = document.querySelector('audio');
  return { src: (a.src || '').slice(0, 80), ready: a.readyState, err: a.error ? (a.error.code + ':' + (a.error.message || '')) : null, paused: a.paused, t: a.currentTime, state: (document.getElementById('p-state') || {}).textContent };
});
console.log('== audio：', JSON.stringify(st));
console.log('== 网络：'); net.slice(-8).forEach((l) => console.log('   ', l));
await browser.close();
