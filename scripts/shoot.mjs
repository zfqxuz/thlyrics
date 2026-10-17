#!/usr/bin/env node
/**
 * 视觉自测：起本地静态服务 → playwright 截图全部路由 × 两种主题 → 输出到 .shots/
 * 用法：node scripts/shoot.mjs [基准对照图目录]
 *
 * 在这台机器上 firefox-1555 缺 libasound2，所以先把 deb 解到 .libs/ 再 LD_LIBRARY_PATH。
 */
import { firefox } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const SHOTS = path.join(ROOT, '.shots');
const PORT = 8900;
const LIBS = path.join(ROOT, '.libs');

fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(path.join(LIBS, 'usr/lib/x86_64-linux-gnu/libasound.so.2'))) {
  // 一次性准备 libasound：下载 deb 并解压
  fs.mkdirSync(LIBS, { recursive: true });
  const { execSync } = await import('node:child_process');
  console.log('▶ 准备 libasound');
  execSync(`cd /tmp && apt-get download libasound2t64 2>&1 | tail -3`);
  const deb = fs.readdirSync('/tmp').find((f) => f.startsWith('libasound2t64_') && f.endsWith('.deb'));
  if (!deb) throw new Error('没下到 libasound2 deb');
  execSync(`dpkg-deb -x /tmp/${deb} ${LIBS}`);
  fs.unlinkSync(path.join('/tmp', deb));
}
process.env.LD_LIBRARY_PATH = `${LIBS}/usr/lib/x86_64-linux-gnu:${LIBS}/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH || ''}`;

// 起本地服务
const srv = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), String(PORT)], {
  stdio: 'ignore', detached: false,
});
await new Promise((r) => setTimeout(r, 600));

const browser = await firefox.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 880 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN',
});
const page = await ctx.newPage();
// 跳过登录 gate
await page.addInitScript(() => {
  localStorage.setItem('thlyrics.account.v1', JSON.stringify({ token: 'beta-shot', name: 'β', uid: 'beta', admin: false }));
});

const routes = [
  ['home',   '/#/home'],
  ['songs',  '/#/songs'],
  ['learn',  '/#/learn'],
  ['me',     '/#/me'],
  ['mine',   '/#/mine'],
];

const themes = ['warm', 'dark'];
const out = [];
for (const [n, r] of routes) {
  for (const theme of themes) {
    await page.goto(`http://127.0.0.1:${PORT}${r}`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.evaluate((t) => { document.body.classList.toggle('warm', t === 'warm'); }, theme);
    await page.waitForTimeout(250);
    const f = path.join(SHOTS, `${theme}-${n}.png`);
    await page.screenshot({ path: f, fullPage: true });
    out.push(f);
    console.log('  ', path.relative(ROOT, f));
  }
}

await browser.close();
srv.kill('SIGTERM');
console.log('✓ 截图完成', out.length, '张');
