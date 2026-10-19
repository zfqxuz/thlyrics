/* 自动生成，别手改：node scripts/gen-sw.mjs（版本 20261019z） */
const V = '20261019z';
const CACHE = 'thlyrics-' + V;
const SHELL = [
  "index.html",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "favicon.ico",
  "manifest.webmanifest?v=20261019z",
  "og-a.png",
  "og-b.png",
  "data/index.json?v=20261019z",
  "data/readings.json?v=20261019z",
  "data/voice-packs.json?v=20261019z",
  "apk.json?v=20261019z",
  "app.js?v=20261019z",
  "core/vault.js?v=20261019z",
  "i18n.js?v=20261019z",
  "icons.js?v=20261019z",
  "locales/de.json?v=20261019z",
  "locales/en.json?v=20261019z",
  "locales/es.json?v=20261019z",
  "locales/fr.json?v=20261019z",
  "locales/ja.json?v=20261019z",
  "locales/ko.json?v=20261019z",
  "locales/pt.json?v=20261019z",
  "locales/ru.json?v=20261019z",
  "platform/app-update.js?v=20261019z",
  "platform/back.js?v=20261019z",
  "platform/index.js?v=20261019z",
  "platform/kv.js?v=20261019z",
  "platform/media-session.js?v=20261019z",
  "platform/media-store.js?v=20261019z",
  "platform/music.js?v=20261019z",
  "platform/net.js?v=20261019z",
  "platform/ota.js?v=20261019z",
  "platform/player.js?v=20261019z",
  "platform/tts.js?v=20261019z",
  "platform/voice-pack.js?v=20261019z",
  "update.json?v=20261019z",
  "version.js?v=20261019z"
];
const SKIP = [/\/dl\//, /\.apk$/];

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

const isStatic = (url) => /\.(js|json|png|jpe?g|webp|svg|ico|webmanifest|woff2?|css|mp3)$/i.test(url.pathname) || url.pathname.endsWith('/locales/');

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
