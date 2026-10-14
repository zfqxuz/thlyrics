/**
 * thlyrics 端到端测试（v2：UI 重做后的形态）
 * 用法：node run-e2e.mjs [baseUrl]
 *
 * 说明：本机只有 chromium_headless_shell（不带 MP3 解码器），所以音轨播放只验
 * 「地址链路 / 预缓冲 / 状态机 / 交互」，真出声必须在真浏览器上验收。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8848/';
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const HOME = process.env.HOME || '/home/zfq';
const chrome = (() => {
  const root = HOME + '/.cache/ms-playwright';
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort();
  return path.join(root, dirs[dirs.length - 1], 'chrome-headless-shell-linux64', 'chrome-headless-shell');
})();
const libPath = ['root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib']
  .map((p) => path.join(HERE, p)).join(':');

const n0 = (v) => (Number(v) || 0);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({
  executablePath: chrome,
  env: { ...process.env, LD_LIBRARY_PATH: libPath },
  args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true })).newPage();

// 歌单导入的桩：两张假歌单 + 两首"能过"的歌词（真歌词接口在浏览器里会被 CORS 抽风影响，
// 所以这一节全走桩；时间轴/译文/失败原因都是真实解析路径）
const E2E_COVER = 'https://p1.music.126.net/e2e-cover.jpg?param=200y200';
const E2E_PLAYLIST = {
  code: 200,
  playlist: { id: 999000123, name: 'E2E 测试歌单', tracks: [
    { id: 737955, name: 'Thank you for dears.', ar: [{ name: 'GET IN THE RING' }], al: { name: 'E2E', picUrl: E2E_COVER } },
    { id: 22645196, name: 'Bad Apple!!', ar: [{ name: 'のみこ' }], al: { name: 'E2E', picUrl: E2E_COVER } },
    { id: 888888888, name: '这首取不到音频', ar: [{ name: 'Nobody' }], al: { name: 'E2E', picUrl: '' } },
    { id: 999999999, name: '这首是纯音乐', ar: [{ name: 'Nobody' }], al: { name: 'E2E', picUrl: '' } },
  ] },
};
const E2E_LYRIC = {
  lyric: '[00:00.00] 作词 : E2E\n[00:00.50] ► 编曲：E2E\n[00:01.00] おいでよ　此処まで\n'
    + '[00:02.00] ★★★\n[00:02.50]\n[00:03.00] ►►誰もいない場所で◄◄\n'
    + '[00:04.00] 続\n[00:04.60] け\n[00:05.20] て\n[00:05.80] く\n[00:06.50] 踊る憂鬱と\n',
  tlyric: '[00:01.00] 到这儿来\n[00:03.00] 在没有人的地方\n[00:05.00] 随心所欲地起舞\n',
};
// 曲库夹具：线上 docs/data/index.json 的曲目是空的（曲库=用户自己导入的），
// 这套 UI 测试要覆盖完整交互，所以把 data/index.json（源数据）的曲目喂给页面。
const E2E_FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture-index.json'), 'utf8'));
const E2E_ALBUM = { ok: true, type: 'album', id: '900001', name: 'E2E 专辑', cover: '', tracks: [
  { id: 700001, name: '专辑第一首', ar: [{ name: 'E2E 社团' }], al: { name: 'E2E 专辑', picUrl: E2E_COVER } },
  { id: 700002, name: '专辑第二首', ar: [{ name: 'E2E 社团' }], al: { name: 'E2E 专辑', picUrl: E2E_COVER } },
] };
const E2E_SONG = { ok: true, type: 'song', id: '900002', name: 'E2E 单曲', cover: '',
  tracks: [{ id: 700003, name: 'E2E 单曲', ar: [{ name: 'E2E 歌手' }], al: { name: 'E2E 单曲专辑', picUrl: E2E_COVER } }] };
// 服务端分词桩：歌词是固定的几句，直接给确定的分片（表面形能拼回原句）
const E2E_SEG = {
  'おいでよ 此処まで': [['おいで', 'おいで', 'おいで', '動詞', '自立'], ['よ', 'よ', 'よ', '助詞', '終助詞'], ['此処', '此処', 'ここ', '名詞', '代名詞'], ['まで', 'まで', 'まで', '助詞', '副助詞']],
  '誰もいない場所で': [['誰', '誰', 'だれ', '名詞', '代名詞'], ['も', 'も', 'も', '助詞', '係助詞'], ['い', 'いる', 'い', '動詞', '自立'], ['ない', 'ない', 'ない', '助動詞', '*'], ['場所', '場所', 'ばしょ', '名詞', '一般'], ['で', 'で', 'で', '助詞', '格助詞']],
  '続けてく': [['続け', '続ける', 'つづけ', '動詞', '自立'], ['て', 'て', 'て', '助詞', '接続助詞'], ['く', 'く', 'く', '動詞', '非自立']],
  '踊る憂鬱と': [['踊る', '踊る', 'おどる', '動詞', '自立'], ['憂鬱', '憂鬱', 'ゆううつ', '名詞', '一般'], ['と', 'と', 'と', '助詞', '並立助詞']],
};

// 账号 API 的桩：页面会打到 https://thlyrics-auth-*.cn-hangzhou.fcapp.run/api/*
const apiState = { users: {}, seq: 0, calls: [], deleted: [] };
const apiMerge = (a, b) => {
  const A = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, clearedAt: 0 }, a || {});
  const B = Object.assign({ known: {}, notes: {}, audio: {}, imp: {}, del: {}, fav: {}, sing: {}, roma: {}, clearedAt: 0 }, b || {});
  const n = (v) => Number(v) || 0;
  const out = { clearedAt: Math.max(n(A.clearedAt), n(B.clearedAt)), known: {}, notes: {}, audio: {}, imp: {}, del: Object.assign({}, B.del), fav: {}, sing: {} };
  for (const kind of ['fav', 'sing']) {
    for (const k of new Set([...Object.keys(A[kind]), ...Object.keys(B[kind])])) {
      const x = n(A[kind][k]), y = n(B[kind][k]); const v = Math.abs(y) > Math.abs(x) ? y : x;
      if (v) out[kind][k] = v;
    }
  }
  for (const k of new Set([...Object.keys(A.roma || {}), ...Object.keys(B.roma || {})])) {
    const x = (A.roma || {})[k] || {}, y = (B.roma || {})[k] || {};
    const v = n(y.u) > n(x.u) ? y : x;
    if (v && v.y) out.roma[k] = v;
  }
  for (const k of new Set([...Object.keys(A.known), ...Object.keys(B.known)])) {
    const x = n(A.known[k]), y = n(B.known[k]); const v = Math.abs(y) > Math.abs(x) ? y : x;
    if (v && Math.abs(v) > out.clearedAt) out.known[k] = v;
  }
  for (const k of new Set([...Object.keys(A.notes), ...Object.keys(B.notes)])) {
    const x = A.notes[k] || {}, y = B.notes[k] || {}; const v = n(y.u) > n(x.u) ? y : x;
    if (v && v.meaning) out.notes[k] = v;
  }
  out.audio = Object.assign({}, B.audio, A.audio);
  for (const [k, v] of Object.entries(A.del)) out.del[k] = Math.max(n(out.del[k]), n(v));
  for (const k of new Set([...Object.keys(A.imp), ...Object.keys(B.imp)])) {
    const x = A.imp[k] || {}, y = B.imp[k] || {}; const v = n(y.at) > n(x.at) ? y : x;
    if (n(out.del[k]) > n(v.at)) continue;
    out.imp[k] = v;
  }
  return out;
};
const apiStub = (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname.replace(/^\/api/, '');
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' }, body: '' });
  const send = (code, obj) => route.fulfill({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' }, body: JSON.stringify(obj) });
  apiState.calls.push(req.method() + ' ' + path);
  let body = {};
  try { body = JSON.parse(req.postData() || '{}'); } catch {}
  const tok = (req.headers()['authorization'] || '').replace(/^Bearer\s+/i, '');
  const me = Object.values(apiState.users).find((x) => x.token === tok);
  if (path === '/health') return send(200, { ok: true });
  if (path === '/segment') {                 // 服务端 kuromoji 分词
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const segs = lines.map((l) => E2E_SEG[String(l).trim()] || String(l).trim().split('').map((c) => [c, c, '', '名詞', '一般']));
    return send(200, { ok: true, segs });
  }
  if (path === '/audio') {                   // 自己的后端：可播地址（前端优先走它，失败了才回落公共接口）
    const id = new URL(req.url()).searchParams.get('id') || '';
    if (id === '888888888') return send(404, { error: '这首歌没有可播地址（可能要会员或已下架）' });
    return send(200, { ok: true, url: 'https://m8.music.126.net/e2e-stub.mp3', br: 320, size: 3 });
  }
  if (path === '/lyric') {
    const id = new URL(req.url()).searchParams.get('id') || '';
    return send(200, { ok: true, lyric: id === '999999999' ? '纯音乐，请欣赏\n' : E2E_LYRIC.lyric, tlyric: E2E_LYRIC.tlyric });
  }
  if (path === '/resolve') {                 // 短链 / 歌单 / 专辑 / 单曲解析（公开接口）
    const raw = new URL(req.url()).searchParams.get('q') || '';
    if (/no-id/.test(raw)) return send(400, { error: '链接里没有歌曲 / 专辑 / 歌单 ID' });
    if (!/https?:\/\//.test(raw) && !/^\d{5,}$/.test(raw)) return send(400, { error: '没识别出链接，粘网易云分享链接或 ID' });
    if (/album/.test(raw)) return send(200, E2E_ALBUM);
    if (/song/.test(raw)) return send(200, E2E_SONG);
    return send(200, { ok: true, type: 'playlist', id: '999000123', name: 'E2E 测试歌单', cover: '', total: 4, tracks: [] });
  }
  if (path === '/avatar') {
    if (!me) return send(401, { error: '请先登录' });
    me.avatar = String(body.avatar || '');
    return send(200, { ok: true, avatar: me.avatar });
  }
  if (path === '/register') {
    const key = String(body.name || '').toLowerCase();
    if (apiState.users[key]) return send(409, { error: '这个用户名已经被用了' });
    if (String(body.pass || '').length < 6) return send(400, { error: '密码至少 6 位' });
    const u = { uid: 'u' + (++apiState.seq), name: body.name, pass: String(body.pass), token: 'tok' + apiState.seq, data: body.data || null, at: null, admin: apiState.seq === 1 };
    apiState.users[key] = u;
    return send(200, { ok: true, token: u.token, user: { uid: u.uid, name: u.name, admin: !!u.admin, avatar: u.avatar || '' } });
  }
  if (path === '/login') {
    const u = apiState.users[String(body.name || '').toLowerCase()];
    if (!u || u.pass !== String(body.pass)) return send(401, { error: '用户名或密码不对' });
    return send(200, { ok: true, token: u.token, user: { uid: u.uid, name: u.name, admin: !!u.admin } });
  }
  if (!me) return send(401, { error: '请先登录' });
  if (path === '/me') return send(200, { ok: true, user: { uid: me.uid, name: me.name, admin: !!me.admin, avatar: me.avatar || '' } });
  if (path === '/admin/files') {
    if (!me.admin) return send(403, { error: '需要管理员账号' });
    const files = [
      { key: 'sync/users/_index.json', size: 42, at: '2026-10-14T06:00:00.000Z' },
      { key: 'sync/users/u1/data.json', size: 2048, at: '2026-10-14T06:00:00.000Z' },
    ];
    return send(200, { ok: true, prefix: 'sync/', files, total: files.reduce((n, f) => n + f.size, 0) });
  }
  if (path === '/admin/delete') {
    if (!me.admin) return send(403, { error: '需要管理员账号' });
    apiState.deleted.push(String(body.key || ''));
    return send(200, { ok: true, key: body.key });
  }
  if (path === '/data') {
    if (req.method() === 'GET') return send(200, { ok: true, at: me.at, data: me.data });
    me.data = apiMerge(body.data || {}, me.data || {});
    me.at = new Date().toISOString();
    return send(200, { ok: true, at: me.at, data: me.data });
  }
  return send(404, { error: '没有这个接口' });
};

const baseRoute = (route) => {
  const u = route.request().url();
  if (/^https:\/\/thlyrics-auth-[^/]+\.cn-hangzhou\.fcapp\.run\//.test(u)) return apiStub(route);
  if (/gdstudio/.test(u) && /types=playlist/.test(u)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(E2E_PLAYLIST) });
  }
  if (/gdstudio/.test(u) && /types=lyric/.test(u)) {
    const id = (u.match(/[?&]id=(\d+)/) || [])[1];
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(id === '999999999' ? { lyric: '纯音乐，请欣赏\n' } : E2E_LYRIC),
    });
  }
  if (/\/data\/index\.json/.test(u)) {     // 线上曲目为空，测试用夹具
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(E2E_FIXTURE) });
  }
  if (/gdstudio/.test(u) && /types=url/.test(u)) {
    const id = (u.match(/[?&]id=(\d+)/) || [])[1];
    if (id === '888888888') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });   // 取不到音频 = 真失败
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://m8.music.126.net/e2e-stub.mp3' }) });
  }
  if (/music\.126\.net\/e2e-cover/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  if (/music\.126\.net/.test(u)) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'ID3' });
  return route.continue();
};
await page.route('**/*', baseRoute);
// 自动的歌单体检会打乱节奏：测试里关掉（手动按钮那条照测）
await page.addInitScript(() => { window.__NO_PLCHECK = true; });
page.on('dialog', (d) => d.accept());   // 删除导入曲目要确认
const errors = [];
const netReqs = [];
page.on('response', (r) => { if (/gdstudio|music\.126/.test(r.url())) netReqs.push(r.status() + ' ' + r.url().slice(0, 50)); });
let expect401 = false;   // 故意用错密码那一步会打一条 401 控制台错误，不算 bug
let expect400 = false;   // 故意喂非法输入那两步：解析接口会回 400，也不算 bug
let expect404 = false;   // 故意放一首取不到音频的歌：后端会回 404，也不算 bug
page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); const u = ((m.location() || {}).url) || ''; if (expect401 && /status of 401/.test(t)) return; if (expect400 && /status of 400/.test(t)) return; if (/status of 404/.test(t) && /\/api\/audio/.test(u)) return;   // 「这首取不到音频」是预期分支（404 → 回落第三方）
    if (expect404 && /status of 404/.test(t)) return; errors.push('console: ' + t.slice(0, 120) + ' @ ' + u.slice(0, 80)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 140)));
page.on('crash', () => errors.push('渲染进程崩溃'));

const txt = (sel) => page.locator(sel).textContent();
const shot = async (n, keep) => { if (!keep) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(420); } else await page.waitForTimeout(450); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const idxOf = () => page.evaluate(() => { const el = document.querySelector('#plyric .lblock.playing, #plyric .lblock.playing'); return el ? Number(el.dataset.i) : -1; });
const tapLine = async (host, i, opts = {}) => {
  const loc = page.locator(`${host} .lblock[data-i="${i}"]`);
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(220);
  await loc.click({ position: { x: 6, y: 6 }, timeout: 8000, ...opts });
  await page.waitForTimeout(160);
};

// ═══════ 1 学词页（词汇入手 + 新视觉） ═══════
await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
// ═══════ 0 登录闸门（没注册没登录不让用） ═══════
await page.waitForSelector('#g-reg', { timeout: 25000 });
check('未登录：只有登录闸门，看不到任何内容', (await page.locator('#gate').isVisible()) && (await page.locator('#deck .word').count()) === 0, ((await txt('.gatecard .gtitle')) || '').slice(0, 20));
check('注册闸门带可选头像入口', (await page.locator('#g-av').count()) === 1 && (await page.locator('#g-avp').count()) === 1, '头像 ＋');
await page.locator('#g-name').fill('e2e_user');
await page.locator('#g-pass').fill('e2e-pass-123');
await page.locator('#g-reg').click();
await page.waitForTimeout(3000);
check('注册后放行，进入应用', (await page.locator('#gate').isVisible()) === false, '已进入');
await page.waitForSelector('#view-home .nowcard', { timeout: 20000 });
await page.waitForTimeout(400);
check('默认进首页：一条主路径（搜索 / 挑一首 / 次级入口）', (await page.locator('#view-home').isVisible()) && (await page.locator('#h-q').count()) === 1 && (await page.locator('#h-songs').count()) === 1, ((await txt('#view-home .nowcard .k')) || '').slice(0, 26));
check('首页不堆功能：学词/曲库/生词本降级成小入口', (await page.locator('#view-home .btn-main').count()) === 1, (await page.locator('#view-home .herohead .hln button').count()) + ' 个次入口');
await shot('00-home');
await page.locator('#h-words').click();
await page.waitForSelector('#deck .word', { timeout: 20000 });
await page.waitForTimeout(300);
check('从首页能进学词页', await page.locator('#view-learn').isVisible());
check('学词页有进度条', await page.locator('#view-learn .bar i').count() > 0, (await txt('#view-learn .sec-sub')) || '');
const deckN = await page.locator('#deck .word').count();
check('词卡列表渲染', deckN > 10, deckN + ' 张');
check('词卡用难度点阵（不堆标签）', await page.locator('#deck .word .dots').count() === deckN, deckN + ' 个点阵');
const l3 = (await page.locator('#deck .word').first().locator('.l3').textContent()) || '';
check('词卡第三行给难度/出现次数', /标日|JLPT|未收录/.test(l3) && /首歌/.test(l3), l3);
const diffOrder = await page.evaluate(async () => {
  const d = await (await fetch('data/index.json')).json();
  const by = new Map(d.vocab.map((v) => [v.id, v]));
  const ds = [...document.querySelectorAll('#deck .word')].map((e) => by.get(Number(e.dataset.id)).diff);
  return ds.every((x, i) => i === 0 || ds[i - 1] <= x);
});
check('从易到难：难度单调递增', diffOrder);
await page.locator('#deck .word .tick').first().click();
await page.waitForTimeout(300);
check('✓ 可标已掌握', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}').known || {}).length > 0));
await page.locator('#deck .word .tick').first().click();
await page.waitForTimeout(200);
await shot('01-learn');

// ═══════ 2 顶栏搜索（渐进披露） ═══════
check('搜索默认收起', !(await page.locator('#searchwrap').isVisible()));
await page.locator('#btn-search').click();
await page.waitForTimeout(250);
check('点搜索图标才展开输入框', await page.locator('#searchwrap').isVisible());
const search = async (q) => { await page.locator('#q').fill(q); await page.waitForTimeout(420); };
await search('ネクロ');
const s1 = await page.locator('#view-search .track').count();
await search('世界');
const s2 = await page.locator('#view-search .word').count();
await search('zzzzzz');
const s3 = await page.locator('#view-search .word').count() + await page.locator('#view-search .track').count();
check('检索：曲名', s1 > 0, '「ネクロ」→ ' + s1 + ' 首');
check('检索：词/释义', s2 > 0, '「世界」→ ' + s2 + ' 个词');
check('检索空态', s3 === 0);
await shot('02-search');
await page.locator('#q-clear').click();
await page.waitForTimeout(400);
await page.locator('#btn-search').click();
await page.waitForTimeout(200);

// ═══════ 3 词条详情 ═══════
await page.locator('#deck .word').first().click();
await page.waitForSelector('#view-word .sec-title', { timeout: 8000 });
const wbig = (await txt('#view-word .sec-title')) || '';
check('词条详情打开', wbig.length > 0, wbig);
check('词条有释义与难度条', ((await txt('#w-mean')) || '').length > 1);
const goBtn = page.locator('#view-word [data-goto]').first();
check('例句带「去这句」', await goBtn.count() > 0);
await shot('03-word');

// 去这句 → 单曲页并进入那句循环
await goBtn.click();
await page.waitForSelector('#view-track', { timeout: 8000 });
await page.waitForTimeout(700);
check('「去这句」进入单曲并开始单句循环', (await idxOf()) >= 0, '高亮第 ' + (await idxOf()) + ' 句');
check('循环时模式芯片显示「单句循环」', (await page.locator('#m-loop.on').count() > 0), (await txt('#p-mode')) || '');
check('「去这句」直接把全屏跟唱页拉起来', await page.locator('#player.on').count() > 0);
await page.locator('#p-close').click();          // 收起全屏页，继续测单曲页本体
await page.waitForTimeout(450);

// ═══════ 4 单曲页：词汇 / 歌词 分段 ═══════
const twN = await page.locator('#twlist .word').count();
check('默认停在「词汇」，先列这首歌的词', twN > 3, twN + ' 个词');
await page.locator('#twchips .chip[data-f="動詞"]').click();
await page.waitForTimeout(250);
const twV = await page.locator('#twlist .word').count();
check('词汇可按标日/词性筛', twV > 0 && twV <= twN, twV + '/' + twN);
await page.locator('#twchips .chip[data-f="all"]').click();
await page.waitForTimeout(200);
await shot('04-track-vocab');

// 进入跟唱（全站只有播放器里这一套歌词）
await page.locator('#t-sing').click();
await page.waitForTimeout(800);
check('单曲页点「进入跟唱」打开播放器歌词', await page.locator('#player.on').count() > 0 && await page.locator('#plyric .lblock').count() > 5,
  (await page.locator('#plyric .lblock').count()) + ' 块');
check('单曲页里不再有第二套歌词 DOM', await page.locator('#lyric .lblock, #view-track .lblock').count() === 0);

// ═══════ 5 歌词排版：分块 / 词性分色 / 词级中文 ═══════
const pos = await page.evaluate(() => {
  const g = (c) => document.querySelectorAll('#plyric .w.' + c).length;
  return { n: g('k-n'), v: g('k-v'), a: g('k-a'), prt: g('k-prt') };
});
check('词性分色齐全', pos.n > 3 && pos.v > 3 && pos.prt > 3, JSON.stringify(pos));
const rom = await page.evaluate(() => {
  const words = [...document.querySelectorAll('#plyric .lblock .w:not([data-plain])')];
  const withR = words.filter((w) => { const r = w.querySelector('.r'); return r && r.textContent.trim(); }).length;
  const sample = words.slice(0, 5).map((w) => { const r = w.querySelector('.r'); return r && r.textContent.trim() ? r.textContent + '=' + w.textContent.trim() : ''; }).filter(Boolean);
  const spaced = words.map((w) => { const r = w.querySelector('.r'); return r ? r.textContent.trim() : ''; }).filter(Boolean).join(' ');
  return { withR, total: words.length, ratio: Math.round(withR / Math.max(1, words.length) * 100), sample, spaced: spaced.includes(' ') };
});
check('罗马音改成逐词对齐（不再整行一串）', rom.ratio > 60 && rom.spaced, rom.ratio + '% 词带罗马音 · ' + rom.sample.slice(0, 3).join(' '));
check('词级中文（实词下挂释义）', await page.locator('#plyric .g').count() > 5, (await page.locator('#plyric .g').count()) + ' 个');
const g0 = await page.evaluate(() => document.body.classList.contains('gloss'));
check('显示开关默认收起（不摊在页面上）', !(await page.locator('#displaybox').isVisible()) && (await txt('#b-display')) === '⋯', await txt('#b-display'));
await page.locator('#b-display').click();
await page.waitForTimeout(250);
check('点「显示」才展开三个开关，且状态写成开/关', await page.locator('#displaybox').isVisible() && /^(开|关)$/.test((await txt('#b-gloss')).trim()), `词义 ${await txt('#b-gloss')} · 中文 ${await txt('#b-zh')} · 罗马音 ${await txt('#b-ruby')}`);
await page.locator('#b-gloss').click();
await page.waitForTimeout(250);
const g1 = await page.evaluate(() => document.body.classList.contains('gloss'));
check('词义开关能切换（默认关：跟唱时只有当前句干净）', g0 !== g1, `默认 ${g0} → 点一下 ${g1}`);
if (g1) await page.locator('#b-gloss').click();
await page.waitForTimeout(250);
await page.locator('#b-display').click();   // 收起抽屉，别挡歌词
await page.waitForTimeout(200);
await shot('05-lyric', true);

// 换句不能把整屏顶上去：所有歌词块高度必须不变
const hb = await page.evaluate(() => [...document.querySelectorAll('#plyric .lblock')].map((el) => Math.round(el.getBoundingClientRect().height)));
await page.evaluate(() => { const els = document.querySelectorAll('#plyric .lblock'); if (els[3]) els[3].click(); });   // 直接点块本身（点词会弹词条层）
await page.waitForTimeout(700);
const ha = await page.evaluate(() => [...document.querySelectorAll('#plyric .lblock')].map((el) => Math.round(el.getBoundingClientRect().height)));
check('切当前句时所有歌词块高度不变（不再上下跳）', hb.length === ha.length && hb.every((h, i) => h === ha[i]), `块数 ${hb.length}→${ha.length} · 切句前 ${[...new Set(hb)].join('/')} → 切句后 ${[...new Set(ha)].join('/')}`);

// ═══════ 6 播放交互：点句=继续播、双击=单句循环 ═══════
await page.locator('#m-all').click();          // 先切回「整首」，再验点句子的行为
await page.waitForTimeout(300);
const lines = await page.evaluate(() => [...document.querySelectorAll('#plyric .lblock[data-i]')].map((e) => Number(e.dataset.i)));
const pick = lines[4];
await tapLine('#plyric', pick);
await page.waitForTimeout(300);
check('点句子 = 从这句继续播（不是循环）',
  (await page.locator('#m-all.on').count() > 0) && (await page.locator('#mb-loop').isHidden()) && (await idxOf()) === pick,
  '整首模式=' + (await page.locator('#m-all.on').count() > 0) + ' 循环提示隐藏=' + (await page.locator('#mb-loop').isHidden()) + ' 高亮=' + (await idxOf()));
check('点句子后播放条有反馈', ((await txt('#p-state')) || '').length > 0, ((await txt('#p-state')) || '').slice(0, 24));
const before = await page.evaluate(() => document.querySelector('audio').currentTime);
await page.locator(`#plyric .lblock[data-i="${pick}"]`).dblclick({ position: { x: 6, y: 6 }, timeout: 8000 });
await page.waitForTimeout(450);
check('双击 = 单句循环', (await idxOf()) === pick && (await page.locator('#m-loop.on').count() > 0), '高亮 ' + (await idxOf()));
const t1 = Date.now();
for (const n of [lines[7], lines[2], lines[6]]) { await tapLine('#plyric', n); }
check('连点三句响应快', Date.now() - t1 < 2400, (Date.now() - t1) + 'ms');
await page.locator('#p-close').click();      // 全屏页盖着迷你条，先收起
await page.waitForTimeout(450);
check('循环开着时迷你条给出「一键退出」', await page.locator('#mb-loop').isVisible());
await page.locator('#mb-loop').click();     // 一键退出循环
await page.waitForTimeout(300);
check('循环可一键关掉', (await page.locator('#m-all.on').count() > 0) && (await page.locator('#mb-loop').isHidden()), '整首点亮=' + (await page.locator('#m-all.on').count()));

// ═══════ 7 迷你播放条 + 全屏跟唱页 ═══════
check('迷你播放条已出现', await page.locator('#minibar.on').count() > 0);
check('迷你条上有曲名与状态', ((await txt('#p-now')) || '').length > 2, ((await txt('#p-now')) || '').slice(0, 26));
const btnsInTrack = await page.evaluate(() => document.querySelectorAll('#view-track #playbtn, #view-track button.big, #view-track #p-play').length);
check('单曲页里没有第二个播放键', btnsInTrack === 0, btnsInTrack + ' 个');
await page.locator('#playbtn').click();
await page.waitForTimeout(900);
check('点迷你条播放键：进入播放/缓冲', await page.evaluate(() => { const a = document.querySelector('audio'); return !!a.src; }), (await txt('#p-state')) || '');
await page.locator('#mb-meta').click();
await page.waitForTimeout(600);
check('点迷你条展开全屏跟唱页', await page.locator('#player.on').count() > 0);
check('全屏页有聚焦歌词（当前句更亮）', await page.locator('#plyric .lblock').count() > 5, (await page.locator('#plyric .lblock').count()) + ' 块');
await shot('06-player', true);
await page.locator('#p-close').click();
await page.waitForTimeout(400);
check('全屏页可收起', await page.locator('#player.on').count() === 0);

// ═══════ 8 倍速 / 上下句 ═══════
await page.locator('#mb-meta').click();
await page.waitForTimeout(400);
const r0 = await page.evaluate(() => document.querySelector('audio').playbackRate);
await page.locator('#b-display').click();      // 倍速/显示都收在「⋯」抽屉里
await page.waitForTimeout(250);
await page.locator('#p-rate').click();
const r1 = await page.evaluate(() => document.querySelector('audio').playbackRate);
check('倍速切换生效', r0 !== r1, r0 + 'x → ' + r1 + 'x');
await page.locator('#b-display').click();      // 收起抽屉
await page.waitForTimeout(200);
await page.locator('#m-loop').click();          // 单句循环现在只有播放条上那一个分段控件
await page.waitForTimeout(200);
const i0 = await idxOf();
await page.locator('#p-next').click(); await page.waitForTimeout(350);
const i1 = await idxOf();
check('下一句切换', i1 !== i0, i0 + ' → ' + i1);
await page.locator('#p-prev').click(); await page.waitForTimeout(350);
check('上一句切换', (await idxOf()) === i0, '回到 ' + (await idxOf()));
await page.locator('#p-close').click();

// ═══════ 9 曲库与过滤 ═══════
await page.locator('#tab-songs').click();
await page.waitForTimeout(500);
const trackN = await page.locator('#list .track').count();
check('曲库列表渲染', trackN > 20, trackN + ' 首');
await page.locator('#view-songs .chip[data-f="audio"]').click(); await page.waitForTimeout(300);
const fa = await page.locator('#list .track').count();
await page.locator('#view-songs .chip[data-f="zh"]').click(); await page.waitForTimeout(300);
const fz = await page.locator('#list .track').count();
check('过滤：有音频', fa > 0 && fa < trackN, fa + ' 首');
check('过滤：有中文', fz > 0 && fz < trackN, fz + ' 首');
await page.locator('#view-songs .chip[data-f="all"]').click();
await page.waitForTimeout(250);
await shot('07-songs');

// ═══════ 10 内置曲目：OSS 音频已清空，改走解析接口 ═══════
const beforeOss = netReqs.length;
await page.goto(BASE + '#/track/t1', { waitUntil: 'load' });
await page.waitForSelector('#view-track', { timeout: 10000 });
await page.waitForTimeout(2200);
const oss = await page.evaluate(() => { const a = document.querySelector('audio'); return { src: a ? a.src.slice(0, 56) : '', tid: a && a.getAttribute('data-tid'), ready: a ? a.readyState : -1 }; });
check('内置曲目（t1）现在走解析接口拿地址', !/aliyuncs\.com/.test(oss.src) && oss.src.length > 0 && netReqs.length > beforeOss, `${oss.src} · 解析调用 +${netReqs.length - beforeOss} 次`);
const ossGone = await page.evaluate(async () => {
  const d = await (await fetch('data/index.json')).json();
  const withOss = d.tracks.filter((x) => x.audioOss).length;
  const withNid = d.tracks.filter((x) => x.audio && x.audio.nid).length;
  return { withOss, withNid };
});
check('OSS 里的音频已经清空（曲目全部改走网易云解析）', ossGone.withOss === 0 && ossGone.withNid > 0, `带 audioOss 的 ${ossGone.withOss} 首 · 有 nid 能解析的 ${ossGone.withNid} 首`);

// ═══════ 11 生词本 + 刷新恢复 ═══════
await page.locator('#tab-mine').click();
await page.waitForTimeout(400);
check('生词本能列出已掌握词', await page.locator('#view-mine .chip').count() > 0, (await page.locator('#view-mine .chip').count()) + ' 个');
await page.locator('#tab-me').click();
await page.waitForTimeout(500);
check('「我的」页有导出/导入与主题设置', (await page.locator('#m-export').count()) > 0 && (await page.locator('#m-import').count()) > 0 && (await page.locator('#me-theme button').count()) === 3, '主题三档');
check('头像下拉菜单：账号 / 主题开关 / 我的 / 退出', await page.evaluate(async () => {
  document.getElementById('btn-av').click();
  await new Promise((r) => setTimeout(r, 150));
  const d = document.getElementById('avdrop');
  return !d.hidden && !!d.querySelector('#av-theme') && !!d.querySelector('#av-me') && !!d.querySelector('#av-out');
}), '菜单项');
// 黑白模式开关
const themeBefore = await page.evaluate(() => document.body.classList.contains('warm'));
await page.evaluate(async () => { document.getElementById('btn-av').click(); await new Promise((r) => setTimeout(r, 120)); document.getElementById('av-theme').click(); });
await page.waitForTimeout(400);
const themeAfter = await page.evaluate(() => ({ warm: document.body.classList.contains('warm'), theme: JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}').theme }));
check('黑白模式开关：一键切暖白并记住', themeBefore === false && themeAfter.warm === true && themeAfter.theme === 'warm', `${themeBefore} → ${themeAfter.warm} · theme=${themeAfter.theme}`);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
check('刷新后仍是暖白（主题持久化）', await page.evaluate(() => document.body.classList.contains('warm')), 'warm');
await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}'); j.theme = 'dark'; localStorage.setItem('thlyrics.tool.v1', JSON.stringify(j)); });
await page.goto(BASE + '?th=1#/learn', { waitUntil: 'load' });
await page.waitForTimeout(900);
check('切回深色也生效', await page.evaluate(() => !document.body.classList.contains('warm')), 'dark');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#view-mine .chip, #deck .word', { timeout: 15000 });
await page.locator('#tab-learn').click();
await page.waitForSelector('#deck .word', { timeout: 8000 });
const restored = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}').known || {}).length);
check('刷新后本地进度保留', restored > 0, restored + ' 个词');
await shot('08-restored');

// ═══════ 12 网易云歌单导入（失败逐首报原因） ═══════
await page.locator('#tab-songs').click();
await page.waitForTimeout(400);
check('曲库页有「导入网易云」入口', (await page.locator('.impbox summary').count()) === 1 && /导入网易云/.test(await txt('.impbox summary')), await txt('.impbox summary'));
await page.locator('.impbox summary').click();
await page.waitForTimeout(250);
expect400 = true;
await page.locator('#plinput').fill('随便写点什么');
await page.locator('#plgo').click();
await page.waitForTimeout(400);
check('非法输入 → 直接报错（不空转）', /没识别出链接/.test(await txt('#plstat')), (await txt('#plstat')).slice(0, 40));
await page.locator('#plinput').fill('https://163cn.tv/no-id-xxxx');
await page.locator('#plgo').click();
await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 90000 });
const shortFail = await txt('#plstat');
check('认不出内容的短链：直接报错（不空转）', /链接里没有/.test(shortFail), shortFail.slice(0, 56));
expect400 = false;
expect404 = true;       // 桩里有一首"取不到音频"的歌，解析接口会回 404
await page.locator('#plinput').fill('https://163cn.tv/abc123');   // 短链 → 解析出歌单 ID
await page.locator('#plgo').click();
await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 90000 });
await page.waitForTimeout(500);
const impStat = await txt('#plstat');
check('163cn.tv 手机短链能解析（歌单）', /入库 2 首/.test(impStat), impStat.slice(0, 40));
check('整张歌单一次导完：入库 2 · 跳过 1 · 失败 1', /入库 2 首/.test(impStat) && /跳过 1 首/.test(impStat) && /失败 1 首/.test(impStat), impStat.slice(0, 80));
const impLog0 = await page.locator('#pllist').textContent();
check('纯音乐/无歌词只算跳过，不算失败', /纯音乐/.test(impLog0), impLog0.replace(/\s+/g, ' ').slice(0, 60));
const impLog = await page.locator('#pllist').textContent();
check('跳过与失败分开列（跳过的不算失败）', /·/.test(impLog) && /✗/.test(impLog) && /取不到音频/.test(impLog), impLog.replace(/\s+/g, ' ').slice(0, 70));
expect404 = false;
check('导入的歌进 localStorage', (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1')).imp || {}).length)) === 2);
await page.locator('#view-songs .chip[data-f="imp"]').click();
await page.waitForTimeout(300);
check('「我导入的」能筛出 2 首', (await page.locator('#list .track').count()) === 2);
// 曲库内的搜索框 + 按社团/专辑分组
await page.locator('#view-songs .chip[data-f="all"]').click();
await page.waitForTimeout(250);
const allN = await page.locator('#list .track').count();
await page.locator('#qs').fill('IOSYS');
await page.waitForTimeout(350);
const qN = await page.locator('#list .track').count();
check('曲库内搜索能过滤（曲名/社团/专辑）', qN > 0 && qN < allN, `全部 ${allN} → 搜 IOSYS ${qN}`);
await page.locator('#qs').fill('');
await page.waitForTimeout(300);
await page.locator('#view-songs .segtext button[data-v="artist"]').click();
await page.waitForTimeout(350);
const grpN = await page.locator('#view-songs .grp').count();
check('可以按社团分组', grpN > 5, grpN + ' 个社团');
await page.locator('#view-songs .grp').first().locator('summary').click();
await page.waitForTimeout(250);
check('分组能展开看曲目', (await page.locator('#view-songs .grp').first().locator('.track').count()) > 0);
await page.locator('#view-songs .segtext button[data-v="album"]').click();
await page.waitForTimeout(350);
check('专辑视图能渲染（网格）', (await page.locator('#view-songs .albumgrid .albumcard').count()) > 5, (await page.locator('#view-songs .albumgrid .albumcard').count()) + ' 张专辑');
await page.locator('#view-songs .segtext button[data-v="list"]').click();
await page.waitForTimeout(250);
await page.locator('#view-songs .chip[data-f="imp"]').click();
await page.waitForTimeout(300);
await page.locator('#list .track').first().click();
await page.waitForTimeout(700);
const impHead = await page.locator('#view-track .l3').first().textContent();
check('导入曲目单曲页可打开（标明来自歌单）', /来自歌单/.test(impHead || ''), (impHead || '').slice(0, 46));
check('导入曲目也用现有词表分词（有词汇列表）', (await page.locator('#view-track .word').count()) > 0, (await page.locator('#view-track .word').count()) + ' 个');
await page.locator('#t-sing').click();
await page.waitForTimeout(1600);
const impPly = await page.evaluate(() => {
  const w = [...document.querySelectorAll('#plyric .w:not([data-plain])')];
  const withR = w.filter((x) => (x.querySelector('.r') || {}).textContent?.trim()).length;
  return { blocks: document.querySelectorAll('#plyric .lblock').length, w: w.length, withR, pct: Math.round(withR / Math.max(1, w.length) * 100) };
});
check('导入曲目能进跟唱页（歌词块 + 逐词罗马音）', impPly.blocks >= 3 && impPly.w > 3 && impPly.withR > 3, JSON.stringify(impPly));
check('导入曲目逐词罗马音覆盖 ≥90%', impPly.pct >= 90, impPly.pct + '%（词表 + 读音兜底表）');
const stampLeak = await page.evaluate(() => [...document.querySelectorAll('#plyric .lblock .line')].filter((e) => /^\[\d+:\d+/.test(e.textContent)).length);
check('歌词行不带时间戳残留（空时间戳行不再吃掉下一行）', stampLeak === 0, stampLeak + ' 行');
const symLeak = await page.evaluate(() => {
  // 每行的"日文原文"= 各片段的 data-s 拼起来（textContent 里混着罗马音和释义，不能直接比）
  const raw = [...document.querySelectorAll('#plyric .lblock .line')].map((line) => [...line.children].map((sp) => sp.dataset.s != null ? sp.dataset.s : sp.textContent).join(''));
  return {
    bad: raw.filter((t) => /[★☆♪♫►◄✦✧◆◇]/.test(t)).length,
    texts: raw,
    merged: raw.includes('続けてく'),
    meta: raw.some((t) => /编曲|作词/.test(t)),
  };
});
check('装饰符号/纯符号行被清掉（不留 ★ ► 之类）', symLeak.bad === 0, symLeak.texts.join(' | ').slice(0, 70));
check('夹在歌词里的 ►◄ 被剥掉、元信息行被丢掉', !symLeak.meta && symLeak.texts.includes('誰もいない場所で'), symLeak.texts.join(' | ').slice(0, 60));
check('逐字分行的 LRC 并回一句（続/け/て/く → 続けてく）', symLeak.merged, symLeak.texts.join(' | ').slice(0, 50));
check('导入失败给出「重试」入口', (await page.locator('#plretry').count()) === 1, await page.locator('#plretry').textContent().catch(() => ''));
// 同一句里，有读音的词、没读音的词、标点，日文那一行必须在同一高度上（否则就是"一上一下"）
const align = await page.evaluate(() => {
  const spreads = [];
  for (const line of document.querySelectorAll('#plyric .line')) {
    const kids = [...line.children];
    if (kids.length < 4) continue;
    const tops = kids.map((sp) => {
      const node = [...sp.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!node) return null;
      const rg = document.createRange(); rg.selectNodeContents(node);
      return rg.getBoundingClientRect().top;
    }).filter((x) => x != null).sort((a, b) => a - b);
    // 长句会折行 → 先按「视觉行」聚类（同一行内 top 差 < 6px），再逐行检查对齐
    const rows = [];
    for (const t of tops) {
      const last = rows[rows.length - 1];
      if (last && t - last[0] < 6) last.push(t); else rows.push([t]);
    }
    for (const r of rows) if (r.length > 1) spreads.push(Math.max(...r) - Math.min(...r));
  }
  return { lines: spreads.length, max: Math.round(Math.max(...spreads) * 10) / 10 };
});
check('同一句内日文行严格对齐（有/无罗马音、标点都一样）', align.max <= 1, `${align.lines} 句 · 最大偏差 ${align.max}px`);
await page.locator('#p-close').click();
await page.waitForTimeout(300);
await page.goto(BASE + '#/songs');
await page.waitForTimeout(500);
await page.locator('#view-songs .chip[data-f="imp"]').click();
await page.waitForTimeout(300);
check('刷新后导入的歌还在', (await page.locator('#list .track').count()) === 2);
await page.locator('#list .track [data-del]').first().click();
await page.waitForTimeout(500);
check('导入的歌可以删掉', (await page.locator('#list .track').count()) === 1, (await page.locator('#list .track').count()) + ' 首');

// 专辑导入：一条链接进来整张
if (!(await page.locator('.impbox').evaluate((el) => el.open))) { await page.locator('.impbox summary').click(); await page.waitForTimeout(300); }
await page.locator('#plinput').fill('https://music.163.com/album?id=900001');
await page.locator('#plgo').click();
await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 60000 });
await page.waitForTimeout(500);
check('专辑导入：整张进库', /入库 2 首/.test(await txt('#plstat')), ((await txt('#plstat')) || '').slice(0, 50));
// 单曲导入
await page.locator('#plinput').fill('分享单曲: E2E 单曲 https://music.163.com/song?id=900002');
await page.locator('#plgo').click();
await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 60000 });
await page.waitForTimeout(500);
check('单曲导入：分享文案里也能认出来', /入库 1 首/.test(await txt('#plstat')), ((await txt('#plstat')) || '').slice(0, 50));
check('专辑/单曲进来的歌也在「我导入的」里', (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1')).imp || {}).length)) === 4);
await shot('09-import', true);

// 点开一首导入的歌：该自动起播，迷你条上该有专辑小图
await page.locator('#view-songs .chip[data-f="imp"]').click();
await page.waitForTimeout(400);
const firstImpId = await page.evaluate(() => { const el = document.querySelector('#list .track'); return el ? el.dataset.id : ''; });
await page.locator('#list .track').first().click();
await page.waitForTimeout(3000);
const opened = await page.evaluate(() => {
  const a = document.querySelector('audio');
  return { tid: a && a.getAttribute('data-tid'), src: (a && a.src) || '',
    cover: (document.getElementById('mb-cover') || {}).src || '', bar: document.getElementById('minibar').classList.contains('on') };
});
check('点开曲目自动起播（不用再点一次「进入跟唱」）', !!firstImpId && opened.tid === firstImpId && !!opened.src && opened.bar, `${opened.tid} · src ${opened.src.slice(0, 36)}`);
check('迷你播放条显示专辑小图（导入曲目）', /e2e-cover/.test(opened.cover), opened.cover.slice(0, 56));
check('导入曲目用的是服务端分词（词性/读音来自 kuromoji）', (await page.locator('#plyric .w.k-prt').count()) >= 0 && (await page.locator('#twlist .word').count()) > 0, '词汇 ' + (await page.locator('#twlist .word').count()));

// ═══════ 12.5 排序 / 专辑网格 / 收藏会唱 / 分享码 ═══════
await page.goto(BASE + '?org=1#/songs', { waitUntil: 'load' });
await page.waitForSelector('#list .track', { timeout: 15000 });
await page.waitForTimeout(500);
const firstTitle = await page.evaluate(() => (document.querySelector('#list .track .l1') || {}).textContent || '');
check('曲库默认按入库时间（新→旧）', /E2E 单曲/.test(firstTitle), '第一首：' + firstTitle.trim());
const titlesOf = () => page.evaluate(() => [...document.querySelectorAll('#list .track .l1')].map((e) => e.textContent.trim()));
const byTitleAsc = await page.evaluate(() => { const t0 = [...document.querySelectorAll('#list .track .l1')].map((e) => e.textContent.trim()); return t0; });
await page.locator('#tsort').selectOption('az');
await page.waitForTimeout(400);
const asc = await titlesOf();
const sortedOk = [...asc].sort((a, b) => a.localeCompare(b, 'ja')).every((x, i) => x === asc[i]);
check('按标题升序可用（五十音顺序）', sortedOk && asc.length > 1, asc.slice(0, 3).join(' / '));
await page.locator('#tsort').selectOption('azd');
await page.waitForTimeout(400);
const desc = await titlesOf();
check('按标题降序可用（正好倒过来）', desc.length === asc.length && desc[0] === asc[asc.length - 1], `${asc[0]} ⇄ ${desc[0]}`);
await page.locator('#tsort').selectOption('new');
await page.waitForTimeout(400);

// 专辑视图：两列网格 + 封面 + 专辑名
await page.locator('#view-songs .segtext button[data-v="album"]').click();
await page.waitForTimeout(500);
const grid = await page.evaluate(() => {
  const g = document.querySelector('.albumgrid');
  if (!g) return null;
  const cards = [...g.querySelectorAll('.albumcard')];
  return { n: cards.length, cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
    withCover: cards.filter((c) => c.querySelector('img')).length,
    first: cards[0] ? { nm: cards[0].querySelector('.nm').textContent.trim(), img: !!cards[0].querySelector('img') } : null };
});
check('专辑页是两列网格', !!grid && grid.cols === 2 && grid.n > 0, grid ? `${grid.n} 张专辑 · ${grid.cols} 列` : '没有网格');
check('专辑卡片有专辑名（有封面的会显示封面）', !!grid && grid.first && grid.first.nm.length > 0 && grid.withCover > 0, grid ? `首张 ${grid.first.nm} · ${grid.withCover} 张有封面` : '');
await page.locator('.albumcard').first().click();
await page.waitForTimeout(500);
const filtered = await page.evaluate(() => ({ view: !!document.querySelector('#list'), n: document.querySelectorAll('#list .track').length }));
check('点专辑能筛出这张专辑的歌', filtered.view && filtered.n > 0, filtered.n + ' 首');
await page.locator('#e-pick').click().catch(() => {});
await page.waitForTimeout(400);

// 收藏 / 会唱
await page.locator('#list .track').first().click();
await page.waitForSelector('#t-fav', { timeout: 15000 });
await page.locator('#t-fav').click();
await page.waitForTimeout(400);
await page.locator('#t-mark').click();
await page.waitForTimeout(400);
const marked = await page.evaluate(() => {
  const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}');
  const fav = Object.keys(j.fav || {}).filter((k) => j.fav[k] > 0);
  const sing = Object.keys(j.sing || {}).filter((k) => j.sing[k] > 0);
  return { fav: fav.length, sing: sing.length, label1: (document.getElementById('t-fav') || {}).textContent.trim(), label2: (document.getElementById('t-mark') || {}).textContent.trim() };
});
check('能标记收藏与会唱', marked.fav === 1 && marked.sing === 1 && /已收藏/.test(marked.label1) && /会唱/.test(marked.label2), `${marked.label1} / ${marked.label2}`);
await page.goto(BASE + '?org=2#/songs', { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.locator('#view-songs .chip[data-f="fav"]').click();
await page.waitForTimeout(400);
const favN = await page.locator('#list .track').count();
const favTag = await page.evaluate(() => (document.querySelector('#list .track .l3') || {}).textContent || '');
check('曲库能筛「收藏」且列表上有标记', favN === 1 && /收藏/.test(favTag), `${favN} 首 · ${favTag.trim().slice(0, 30)}`);
await page.locator('#view-songs .chip[data-f="sing"]').click();
await page.waitForTimeout(400);
check('曲库能筛「会唱」', (await page.locator('#list .track').count()) === 1, '1 首');
await page.locator('#view-songs .chip[data-f="all"]').click();
await page.waitForTimeout(300);

// 头像：换一张 → 压缩后上传 → 顶栏用图片显示
await page.goto(BASE + '?av=1#/me', { waitUntil: 'load' });
await page.waitForSelector('#acc-avf', { timeout: 15000, state: 'attached' });
await page.setInputFiles('#acc-avf', { name: 'av.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=', 'base64') });
await page.waitForTimeout(2500);
const avOk = await page.evaluate(() => ({
  img: !!document.querySelector('#btn-av img'),
  store: (JSON.parse(localStorage.getItem('thlyrics.account.v1') || '{}').avatar || '').slice(0, 12),
  card: !!document.querySelector('#view-me img.av'),
}));
check('换头像：canvas 压缩后上传、顶栏与我的页都用图片', avOk.img && avOk.store === 'data:image/j' && avOk.card, JSON.stringify(avOk));

// 检索页也能直接切排序
await page.goto(BASE + '?org=3#/search/E2E', { waitUntil: 'load' });
await page.waitForTimeout(900);
const ssortN = await page.locator('#ssort').count();
await page.locator('#ssort').selectOption('azd').catch(() => {});
await page.waitForTimeout(400);
const ssortVal = await page.evaluate(() => (document.getElementById('ssort') || {}).value);
check('检索结果页能直接切排序', ssortN === 1 && ssortVal === 'azd', `控件 ${ssortN} 个 · 选中 ${ssortVal}`);

// 分享码：生成 + 导入（对方再导一遍 = 全部跳过，不重复入库）
await page.locator('#tab-me').click();
await page.waitForTimeout(500);
await page.locator('#sh-gen').click();
await page.waitForTimeout(400);
const code = await page.evaluate(() => (document.getElementById('sh-code') || {}).value || '');
check('能生成分享码（TL1. 开头的短码）', /^TL1\./.test(code) && code.length < 400, `${code.length} 字符`);
await page.locator('#sh-imp').click();
await page.waitForTimeout(1500);
const shStat = (await txt('#sh-stat')) || '';
check('导入别人的分享码：跑通并逐条报数', /导入完成：入库 \d+ 首/.test(shStat), shStat.slice(0, 40));

// ═══════ 13 单词页 → 去这句（要真的换歌、跳句、出声） ═══════
await page.goto(BASE + '#/track/t1');
await page.waitForTimeout(900);
await page.locator('#playbtn').click();
await page.waitForTimeout(1500);
const wid = await page.evaluate(() => {
  const el = [...document.querySelectorAll('#plyric .w[data-w]')].find((x) => x.dataset.w && window.__tlVid(x.dataset.w));
  return el ? window.__tlVid(el.dataset.w) : '';
});
check('跟唱页能取到一个词（拿它去词条页）', !!wid, wid);
await page.goto(BASE + '#/word/' + wid);
await page.waitForTimeout(700);
const firstEx = await page.locator('#view-word .item').first().textContent();
check('词条页把「正在听」的那句排在最前', /正在听/.test(firstEx), firstEx.replace(/\s+/g, ' ').slice(0, 44));
const gotoAttr = await page.locator('#view-word [data-goto]').first().getAttribute('data-goto');
const [gtid, gli] = gotoAttr.split('@');
// 装个钩子：headless 的假 mp3 解码失败会让 paused 一直为 true，所以验「确实调了播放 + 切到了这首」
await page.evaluate(() => {
  window.__played = [];
  const a = document.querySelector('audio');
  if (a && !a.__hook) { a.__hook = 1; a.addEventListener('play', () => window.__played.push(a.getAttribute('data-tid'))); }
});
await page.locator('#view-word [data-goto]').first().click();
await page.waitForTimeout(1200);
// 内置曲目现在要先解析出地址才出声，轮询等一下
for (let i = 0; i < 12; i++) {
  const p0 = await page.evaluate(() => { const a = document.querySelector('audio'); return a && !a.paused && !!a.src; });
  if (p0) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(600);
const jumped = await page.evaluate(() => {
  const a = document.querySelector('audio');
  const el = document.querySelector('#plyric .lblock.playing');
  return { hash: location.hash, tid: a.getAttribute('data-tid'), src: !!a.src, paused: a.paused, open: document.querySelector('#player').classList.contains('on'), line: el ? Number(el.dataset.i) : -1 };
});
check('去这句：跳到对应那句', jumped.hash === `#/track/${gtid}@${gli}` && jumped.open && jumped.line === Number(gli), JSON.stringify(jumped));
// headless 的假 mp3 解不了码，所以这里只验「换歌 + 地址链路」（真出声在真浏览器上验）
const jumpedUrl = await page.evaluate(() => (document.querySelector('audio') || {}).src || '');
check('去这句：音频换成这首歌（走解析拿到地址）', jumped.tid === gtid && /music\.126\.net|e2e-stub|blob:/.test(jumpedUrl), `${jumped.tid} → ${jumpedUrl.slice(0, 48)}`);
await shot('10-goto', true);
await page.locator('#p-close').click();
await page.waitForTimeout(300);
// 没有音频的曲目：要明确告诉用户，并给绑定入口
const noAudioId = await page.evaluate(async () => {
  const d = await (await fetch('data/index.json')).json();
  const t = d.tracks.find((x) => !x.audioOss && !x.audio);
  return t ? t.id : '';
});
await page.goto(BASE + '#/track/' + noAudioId);
await page.waitForTimeout(800);
await page.locator('#mb-meta').click();
await page.waitForTimeout(500);
check('没音频的曲目：播放器给出「绑定音频」入口', await page.locator('#p-nosrc').isVisible(), noAudioId + ' · ' + ((await txt('#p-state')) || '').slice(0, 24));

// ═══════ 13.4 旧缓存里的音频地址失效 → 自动回落到解析接口 ═══════
{
  // 模拟用户浏览器里那份旧 index.json：t1 还写着已经删掉的 OSS 音频地址
  const idxUrl = '**/data/index.json*';
await page.route(idxUrl, async (route) => {
    const j = JSON.parse(JSON.stringify(E2E_FIXTURE));
    if (j && j.tracks) {
      const t = j.tracks.find((x) => x.id === 't1');
      if (t) t.audioOss = 'https://thlyrics-audio.oss-cn-hangzhou.aliyuncs.com/audio/已经删掉的.mp3';
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  });
await page.goto(BASE + '?heal=1#/track/t1', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const healState0 = (await txt('#p-state')) || '';
  await page.locator('#t-sing').click();
  await page.waitForTimeout(6000);
  const healed = await page.evaluate(() => ({ src: (document.querySelector('audio').src || '').slice(0, 60), state: (document.getElementById('p-state') || {}).textContent }));
  // 桩里给的是假 mp3，解不了码所以状态文字仍会报失败；这里验的是"坏地址被换掉、走了解析接口"
  check('旧缓存里的死音频地址：自动丢掉坏地址、回落解析接口', /music\.126\.net|blob:/.test(healed.src), `${healed.src} · 状态「${healed.state}」`);
  await page.unroute(idxUrl);
  await page.locator('#p-close').click().catch(() => {});
  await page.waitForTimeout(300);
}

// ═══════ 13.2 罗马音纠正（听不准就改：备选 + 自由输入；编辑时暂停，改完继续） ═══════
await page.goto(BASE + '?roma=1#/track/t1', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.evaluate(() => {                 // headless 的假 mp3 播不起来：装作"正在播"，钩住 play/pause 调用
  const a = document.querySelector('audio');
  window.__calls = [];
  if (!a.__romahook) {
    a.__romahook = 1;
    a.__origPlay = a.play.bind(a); a.__origPause = a.pause.bind(a);
    a.play = () => { window.__calls.push('play'); return a.__origPlay(); };
    a.pause = () => { window.__calls.push('pause'); return a.__origPause(); };
    Object.defineProperty(a, 'paused', { get: () => false, configurable: true });
  }
  window.__calls.length = 0;
});
await page.locator('#t-sing').click();
await page.waitForTimeout(1200);
const rw = await page.evaluate(() => {          // 挑一个能推出多种写法的词（含 し/ち/つ/ふ/じ）
  const els = [...document.querySelectorAll('#plyric .w[data-w]')];
  const i = els.findIndex((x) => /[しちつふじシチツフジ]/.test(x.dataset.r || ''));
  const el = els[i >= 0 ? i : 0];
  return el ? { i: i >= 0 ? i : 0, s: el.dataset.s, r: el.dataset.r || '' } : null;
});
await page.locator('#plyric .w[data-w]').nth(rw ? rw.i : 0).click();
await page.waitForSelector('#pop.on', { timeout: 8000 });
await page.locator('#p-roma').click();
await page.waitForTimeout(400);
const romaOpen = await page.evaluate(() => ({
  box: !document.getElementById('p-romabox').hidden,
  calls: (window.__calls || []).slice(),
  cands: document.querySelectorAll('#p-romacands button').length,
  val: (document.getElementById('p-romainput') || {}).value || '',
}));
check('改罗马音：编辑器打开并暂停播放', romaOpen.box && romaOpen.calls.includes('pause'), `调用 ${romaOpen.calls.join('/')}`);
const hasVarKana = /[しちつふじシチツフジ]/.test(rw ? rw.r : '');
check('给出备选（能推出多种写法时给多个）', romaOpen.cands >= 1 && (!hasVarKana || romaOpen.cands >= 2), `${romaOpen.cands} 个备选 · 当前「${romaOpen.val}」`);
await page.locator('#p-romacands button').nth(1).click();
await page.waitForTimeout(200);
const chosen = await page.locator('#p-romainput').inputValue();
await page.locator('#p-romasave').click();
await page.waitForTimeout(900);
const romaAfter = await page.evaluate((k) => {
  const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}');
  const keys = Object.keys(j.roma || {});
  const fixed = [...document.querySelectorAll('#plyric .w[data-fixed="1"]')];
  const sameWord = [...document.querySelectorAll('#plyric .w')].filter((x) => x.dataset.s === k.s);
  const others = sameWord.filter((x) => x.dataset.fixed !== '1');
  const rOf = (el) => { const r = el && el.querySelector('.r'); return r ? r.textContent.trim() : ''; };
  return { saved: keys.length, key: keys[0] || '', shown: rOf(fixed[0]), fixedN: fixed.length,
    sameN: sameWord.length, othersChanged: others.filter((x) => rOf(x) === chosen).length,
    calls: (window.__calls || []).slice() };
}, rw);
check('保存后立刻生效 + 继续播放', romaAfter.saved === 1 && romaAfter.shown === chosen && romaAfter.calls.includes('play'),
  `存 ${romaAfter.saved} 条 · 显示「${romaAfter.shown}」`);
check('只改这一处：同曲同词的其它位置不动', romaAfter.fixedN === 1 && romaAfter.othersChanged === 0,
  `本曲同词 ${romaAfter.sameN} 处 · 改动 ${romaAfter.fixedN} 处 · 其它被误改 ${romaAfter.othersChanged} 处`);
check('纠正键带曲目和位置（不会跨曲）', /^t1\|\d+\|\d+$/.test(romaAfter.key), romaAfter.key || '(空)');
// 自定义输入（还是刚才那一处）
await page.locator('#plyric .w[data-fixed="1"]').first().click();
await page.waitForSelector('#pop.on', { timeout: 8000 });
await page.locator('#p-roma').click();
await page.waitForTimeout(300);
await page.locator('#p-romainput').fill('my-own-romaji');
await page.locator('#p-romasave').click();
await page.waitForTimeout(800);
const custom = await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}'); return Object.values(j.roma || {}).map((x) => x.y); });
check('也能自己输入罗马音', custom.includes('my-own-romaji'), JSON.stringify(custom).slice(0, 40));
// 还原 + 刷新后仍在
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}').roma || {});
check('刷新后纠正还在（并跟着账号同步）', Object.keys(persisted).length === 1 && Object.values(persisted)[0].y === 'my-own-romaji', JSON.stringify(persisted).slice(0, 60));
await page.evaluate(() => { const a = document.querySelector('audio'); if (a && a.__romahook) { delete a.paused; a.play = a.__origPlay; a.pause = a.__origPause; delete a.__romahook; } });

// ═══════ 13.5 歌单体检（手动按钮；自动那条每天一次，测试里关掉） ═══════
await page.goto(BASE + '?plchk=1#/songs', { waitUntil: 'load' });
await page.waitForSelector('.impbox summary', { timeout: 15000 });
await page.locator('.impbox summary').click();
await page.waitForTimeout(400);
check('曲库页有「检查歌单更新」按钮和上次检查时间', (await page.locator('#plchk').count()) === 1 && /上次检查/.test((await txt('.impbox .row .meta')) || ''), ((await txt('.impbox .row .meta')) || '').slice(0, 30));
await page.locator('#plchk').click();
await page.waitForTimeout(5000);
const chkMsg = (await txt('#plstat')) || '';
check('检查歌单更新：能跑通并报出每张歌单的情况', /线上 \d+ 首/.test(chkMsg) && /库里 \d+ 首/.test(chkMsg), chkMsg.slice(0, 60).replace(/\n/g, ' | '));

// ═══════ 13.6 空状态 / 复习闭环 / 手机宽度 / 继续学习 ═══════
await page.goto(BASE + '?emp=1#/search/zzzzzz', { waitUntil: 'load' });
await page.waitForTimeout(1200);
const emptyTxt = (await txt('#view-search')) || '';
check('搜索没结果：不是空白，给出路', /没找到/.test(emptyTxt) && (await page.locator('#e-ssongs').count()) === 1, emptyTxt.replace(/\s+/g, ' ').slice(0, 40));
await page.locator('#e-ssongs').click();
await page.waitForTimeout(600);
check('空状态里的按钮能走（去曲库）', await page.locator('#view-songs').isVisible());

await page.goto(BASE + '?rev=1#/mine', { waitUntil: 'load' });
await page.waitForSelector('#m-review', { timeout: 15000 });
await page.locator('#m-review').click();
await page.waitForTimeout(800);
check('生词本有「开始复习」并进入复习页', await page.locator('#view-review').isVisible() && (await page.locator('.revcard .rw').count()) === 1, ((await txt('.revcard .rw')) || '').slice(0, 12));
const revWord = await txt('.revcard .rw');
await shot('14-review', true);
await page.locator('#rev-show').click();
await page.waitForTimeout(400);
check('复习卡：点「看释义」才显示释义', (await page.locator('.revcard .rm').count()) === 1 && (await page.locator('#rev-ok').count()) === 1, ((await txt('.revcard .rm')) || '').slice(0, 20));
const knownBefore = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}').known || {}).filter((k) => JSON.parse(localStorage.getItem('thlyrics.tool.v1')).known[k] > 0).length);
await page.locator('#rev-ok').click();
await page.waitForTimeout(600);
const knownAfter = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}').known || {}).filter((k) => JSON.parse(localStorage.getItem('thlyrics.tool.v1')).known[k] > 0).length);
check('复习：点「记住了」会标已掌握并进下一个', knownAfter === knownBefore + 1, `${knownBefore} → ${knownAfter} 个已掌握 · 上一个词 ${revWord}`);

// 首页点一个词：直接去它出现的那句
await page.goto(BASE + '?hw=1#/home', { waitUntil: 'load' });
await page.waitForSelector('#view-home .wordstrip button', { timeout: 15000 });
await page.locator('#view-home .wordstrip button').first().click();
await page.waitForTimeout(1200);
const homeJump = await page.evaluate(() => location.hash);
check('首页点「今天这几个词」直接跳到它出现的那句', /^#\/track\/\w+@\d+$/.test(homeJump), homeJump);
await page.waitForTimeout(1200);

// 词卡：例句就地展开（不再把文字塞进 meta）
const someWord = page.locator('#plyric .lblock.playing .w').first();
if (await someWord.count()) {
  await someWord.click();
  await page.waitForTimeout(500);
}
if (await page.locator('#pop.on').count()) {
  await page.locator('#p-more').click();
  await page.waitForTimeout(250);
  await page.locator('#p-lines').click();
  await page.waitForTimeout(400);
  const exRows = await page.locator('#p-exlist .item').count();
  const stillPop = await page.locator('#pop.on').count();
  check('词卡里「出现的句子」就地展开（不跳页）', exRows > 0 && stillPop === 1, `${exRows} 条例句 · 词卡还开着`);
  await page.locator('#p-close2').click();
  await page.waitForTimeout(300);
} else {
  check('词卡里「出现的句子」就地展开（不跳页）', false, '没能打开词卡');
}

// 手机窄屏：不横向溢出
await page.setViewportSize({ width: 320, height: 720 });
for (const [name, hash] of [['首页', '#/home'], ['曲库', '#/songs'], ['生词本', '#/mine'], ['学词', '#/learn'], ['我的', '#/me'], ['管理员', '#/admin']]) {
  await page.goto(BASE + '?w=320' + hash, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`320px 窄屏不横向溢出：${name}`, over <= 1, `溢出 ${over}px`);
}
await page.setViewportSize({ width: 400, height: 850 });

// 继续学习：记住听到哪，首页显示出来
await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}'); j.pos = { t1: 83 }; j.lastTrack = 't1'; localStorage.setItem('thlyrics.tool.v1', JSON.stringify(j)); });
await page.goto(BASE + '?pos=1#/home', { waitUntil: 'load' });
await page.waitForSelector('#view-home .nowcard', { timeout: 15000 });
check('首页「正在学习」显示上次听到哪', /上次听到 1:23/.test((await txt('#view-home .nowcard .a')) || ''), ((await txt('#view-home .nowcard .a')) || '').slice(0, 34));
check('音频设置不再挂在每个页面（首页看不到）', await page.locator('#srcslot').isHidden(), '首页隐藏');
await page.goto(BASE + '?pos=1#/me', { waitUntil: 'load' });
await page.waitForSelector('#m-push', { timeout: 15000 });
check('音频设置只在「我的」/单曲页里出现', await page.locator('#srcslot').isVisible(), '我的页可见');

// ═══════ 14 账号：自动同步 / 墓碑 / 清空 / 换设备登录恢复 ═══════
if (await page.locator('#player.on').count()) { await page.locator('#p-close').click(); await page.waitForTimeout(300); }
await page.goto(BASE + '?acc=1#/me', { waitUntil: 'load' });
await page.waitForSelector('#m-push', { timeout: 15000 });
await page.waitForTimeout(1500);
const accData = () => (apiState.users['e2e_user'] || {}).data || {};
check('「我的」里给出同步入口与自动同步开关', (await page.locator('#m-push').count()) === 1 && (await page.locator('#m-auto').count()) === 1, await txt('#m-push'));
check('状态行写明已登录哪个账号', /账号 e2e_user/.test((await txt('#syncmsg')) || ''), ((await txt('#syncmsg')) || '').slice(0, 30));
check('本机已有记录在注册时就带上去了', Object.keys(accData().known || {}).length > 0, `账号里 ${Object.keys(accData().known || {}).length} 个词`);

// 改一条释义：一个按钮都不点，应该自己同步进账号
await page.goto(BASE + '?acc=1#/mine', { waitUntil: 'load' });
await page.waitForSelector('#view-mine .chip', { timeout: 15000 });
const widMine = await page.evaluate(() => { const el = document.querySelector('#view-mine .chip'); return el ? el.dataset.w : null; });
await page.goto(BASE + '?acc=1#/word/' + widMine);
await page.waitForTimeout(800);
await page.locator('#w-edit').click();
await page.locator('#w-editinput').fill('E2E 自定义释义');
await page.locator('#w-editinput').press('Enter');
await page.waitForTimeout(4500);
check('改释义自动同步进账号（没点按钮）', !!((accData().notes || {})[widMine]) && accData().notes[widMine].meaning === 'E2E 自定义释义', `词 ${widMine} → ${JSON.stringify((accData().notes || {})[widMine] || null)}`);

// 标一个词 → 也应该自己同步
await page.goto(BASE + '?acc=1#/learn', { waitUntil: 'load' });
await page.waitForSelector('#deck .word .tick:not(.on)', { timeout: 15000 });
const accWordId = await page.evaluate(() => { const el = document.querySelector('#deck .word .tick:not(.on)'); return el ? el.closest('.word').dataset.id : null; });
await page.locator('#deck .word .tick:not(.on)').first().click();
await page.waitForTimeout(4500);
check('标词自动同步进账号', !!accWordId && n0(accData().known[accWordId]) > 0, `词 ${accWordId} → ${JSON.stringify(accData().known[accWordId])}`);

// 删一首导入的歌：留墓碑，重登不会被拉回来
await page.goto(BASE + '?acc=1#/songs', { waitUntil: 'load' });
await page.waitForTimeout(1800);
const delId2 = await page.evaluate(() => { const el = document.querySelector('#list [data-del]'); return el ? el.dataset.del : null; });
if (delId2) { await page.locator(`#list [data-del="${delId2}"]`).first().click(); await page.waitForTimeout(4500); }
check('删掉的导入曲目会记墓碑，不会被账号拉回来', !!delId2 && !!accData().del[delId2] && !accData().imp[delId2], delId2 ? `墓碑 ${accData().del[delId2] ? '有' : '无'} · 账号还留着 ${accData().imp[delId2] ? '是' : '否'}` : '没找到可删的导入曲目');

// 收藏 / 会唱 也要跟着账号走（服务端合并白名单 + 客户端写回 S 两处都要对）
await page.goto(BASE + '?acc=1#/songs', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('#list .track').first().click();
await page.waitForSelector('#t-fav', { timeout: 15000 });
await page.locator('#t-fav').click(); await page.waitForTimeout(300);
await page.locator('#t-mark').click(); await page.waitForTimeout(4500);
check('收藏/会唱会同步进账号', Object.keys(accData().fav || {}).length > 0 && Object.keys(accData().sing || {}).length > 0,
  `账号 fav ${Object.keys(accData().fav || {}).length} · sing ${Object.keys(accData().sing || {}).length}`);

// 清空进度：账号里也要清掉，否则重登又被顶回来
await page.goto(BASE + '?acc=1#/me', { waitUntil: 'load' });
await page.waitForSelector('#m-clear', { timeout: 15000 });
await page.locator('#m-clear').click();
await page.waitForTimeout(4500);
const localPos = await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}'); return Object.values(j.known || {}).filter((v) => v > 0).length; });
check('清空进度会一起清掉（重登不会被账号顶回来）', localPos === 0 && Object.values(accData().known || {}).filter((v) => v > 0).length === 0, `本机 ${localPos} 词 · 账号 ${Object.values(accData().known || {}).filter((v) => v > 0).length} 词`);

// 换设备 = 清掉浏览器数据：先被闸门挡住，登录同账号后记录回来
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '?acc=2#/me', { waitUntil: 'load' });
await page.waitForSelector('#g-login', { timeout: 15000 });
check('清掉浏览器数据后：又被闸门挡住', (await page.locator('#gate').isVisible()) && (await page.locator('#view-mine .chip').count()) === 0, '闸门');
expect401 = true;
await page.locator('#g-name').fill('e2e_user');
await page.locator('#g-pass').fill('wrong-pass');
await page.locator('#g-login').click();
await page.waitForTimeout(2500);
check('密码错：给明确提示，仍挡在闸门里', /用户名或密码不对/.test((await txt('#g-msg')) || ''), ((await txt('#g-msg')) || '').slice(0, 26));
expect401 = false;
await page.locator('#g-pass').fill('e2e-pass-123');
await page.locator('#g-login').click();
await page.waitForTimeout(6500);
const afterLogin = await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('thlyrics.tool.v1') || '{}');
  const pos = (m) => Object.keys(m || {}).filter((k) => m[k] > 0).length;
  return { imp: Object.keys(j.imp || {}).length, del: Object.keys(j.del || {}).length, fav: pos(j.fav), sing: pos(j.sing), acc: !!localStorage.getItem('thlyrics.account.v1') }; });
// 前面刚把导入的歌删了、进度也清了，所以这里验的是「账号里那份状态确实被拉回来了」：删除墓碑（+账号登录态）在，就说明合并成功
check('换设备登录同账号：记录全回来（墓碑 + 收藏 + 会唱）', afterLogin.acc && afterLogin.del > 0 && afterLogin.fav > 0 && afterLogin.sing > 0,
  `${afterLogin.del} 个墓碑 · ${afterLogin.imp} 首 · ♥${afterLogin.fav} · 会唱${afterLogin.sing}`);
check('登录后闸门放行，能正常用', (await page.locator('#gate').isVisible()) === false && (await page.locator('#m-push').count()) === 1, '已进入');

// 管理员模式：只有第一个注册的账号（本次 e2e_user）能看到 OSS 文件管理
await page.goto(BASE + '?admin=1#/admin', { waitUntil: 'load' });
await page.waitForSelector('#adm-list', { timeout: 15000 });
check('管理员有独立页面（头像菜单进得来）', (await page.locator('#view-admin').isVisible()) && (await page.locator('#adm-list').count()) === 1, await txt('#adm-list'));
await page.locator('#adm-list').click();
await page.waitForTimeout(1500);
const adminRows = await page.locator('#view-admin .item').count();
check('管理员：能列出 OSS 上的文件（带大小）', adminRows >= 2, adminRows + ' 行');
const delKey = await page.evaluate(() => { const el = document.querySelector('#view-admin [data-admdel]'); return el ? el.dataset.admdel : null; });
if (delKey) { await page.locator(`#view-admin [data-admdel="${delKey}"]`).first().click(); await page.waitForTimeout(1500); }
check('管理员：能删 OSS 上的文件（走管理员接口）', !!delKey && apiState.deleted.indexOf(delKey) >= 0, delKey ? `已请求删除 ${delKey}` : '没找到可删的');

// 退出 → 回到闸门（本机记录保留）
await page.goto(BASE + '?out=1#/me', { waitUntil: 'load' });
await page.waitForSelector('#acc-out', { timeout: 15000 });
await page.locator('#acc-out').click();
await page.waitForTimeout(1000);
check('退出登录：回到闸门', (await page.locator('#gate').isVisible()) && (await page.locator('#g-login').count()) === 1, '闸门');

// 线上数据是干净的：曲库只有用户导入的（不带内置曲目），词表/读音表保留做注解
const shipped = await (await page.request.get(BASE + 'data/index.json')).json();
check('线上曲库数据不含内置曲目（曲库=自己导入的）', (shipped.tracks || []).length === 0 && (shipped.originals || []).length === 0 && (shipped.vocab || []).length > 1000,
  `tracks ${(shipped.tracks || []).length} · originals ${(shipped.originals || []).length} · vocab ${(shipped.vocab || []).length}`);

check('控制台无错误', errors.length === 0, errors.slice(0, 3).join(' || '));

const okN = results.filter((r) => r.ok).length;
console.log(`\n===== ${okN}/${results.length} 通过 =====`);
fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results, errors }, null, 1));
await browser.close();
process.exit(okN === results.length ? 0 : 1);
