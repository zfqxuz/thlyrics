#!/usr/bin/env node
/**
 * gen-sw.mjs —— 生成 docs/sw.js（App 外壳的 Service Worker）
 *
 * 为什么要有它：网页版每次刷新都要向 GitHub Pages 要 20 个文件（1 个 HTML + 19 个 ES 模块），
 * 国内首字节经常几百毫秒到几秒，叠起来就是「刷新很慢」。SW 把外壳（含 data/index.json）
 * 装进 Cache Storage，之后刷新只剩 index.html 一个网络请求，其余全从本地读。
 *
 * 策略：
 *   导航请求（index.html）→ 网络优先，2.5s 超时就回缓存（离线/慢网也不至于白屏）
 *   同源静态（js/json/png/locales）→ 缓存优先（这些 URL 带 ?v=<版本>，天然不可变）
 *   跨域（云函数 / OSS / 封面）→ 不接管
 *   大文件（dl/*.apk）→ 不接管，别往缓存里塞 40MB
 *
 * 用法：node scripts/gen-sw.mjs   （改完前端、bump-version 之后跑一次，再发布内容包）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const V = (fs.readFileSync(path.join(DOCS, 'version.js'), 'utf8').match(/V\s*=\s*'([^']+)'/) || [])[1];
if (!V) { console.error('✗ 读不到 docs/version.js 里的 V'); process.exit(1); }

const SKIP_DIRS = new Set(['data', 'vendor', 'dl', '_screenshots', 'node_modules']);
const SHELL = ['index.html', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.ico', 'manifest.webmanifest', 'og-a.png', 'og-b.png'];
// data/ 里只有首屏/常驻要用的这几个进外壳（大词库/音频包仍然按需）
const SHELL_DATA = ['data/index.json', 'data/readings.json', 'data/voice-packs.json'];

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...walk(dir, r)); continue; }
    if (!/\.(js|json|png|ico|webmanifest)$/.test(e.name)) continue;
    if (e.name === 'sw.js') continue;
    out.push(r);
  }
  return out;
}
const files = [...new Set([...SHELL, ...SHELL_DATA, ...walk(DOCS).filter((f) => f !== 'index.html')])];
const withV = files.map((f) => (/\.(js|json)$/.test(f) || f === 'manifest.webmanifest' ? `${f}?v=${V}` : f));

const src = `/* 自动生成，别手改：node scripts/gen-sw.mjs（版本 ${V}） */
const V = '${V}';
const CACHE = 'thlyrics-' + V;
const SHELL = ${JSON.stringify(withV, null, 2)};
const SKIP = [/\\/dl\\//, /\\.apk$/];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 单个文件失败不该让整次安装挂掉：逐个 add
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isStatic = (url) => /\\.(js|json|png|jpe?g|webp|svg|ico|webmanifest|woff2?|css|mp3)$/i.test(url.pathname) || url.pathname.endsWith('/locales/');

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(req, { signal: ac.signal });
    if (r && r.ok) c.put('index.html', r.clone());
    return r;
  } catch {
    const hit = (await c.match('index.html')) || (await c.match(req));
    if (hit) return hit;
    return fetch(req).catch(() => new Response('OFFLINE', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  } finally { clearTimeout(timer); }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreSearch: false });
  if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok && r.status === 200) c.put(req, r.clone()).catch(() => {});
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;          // 云函数 / OSS / 封面：不接管
  if (SKIP.some((re) => re.test(url.pathname))) return;      // APK 下载别塞缓存
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req)); return; }
  if (isStatic(url)) { e.respondWith(cacheFirst(req)); return; }
});
`;
fs.writeFileSync(path.join(DOCS, 'sw.js'), src);
console.log(`✓ docs/sw.js：${withV.length} 个外壳文件（版本 ${V}）`);
