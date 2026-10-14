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
const E2E_PLAYLIST = {
  code: 200,
  playlist: { id: 999000123, name: 'E2E 测试歌单', tracks: [
    { id: 737955, name: 'Thank you for dears.', ar: [{ name: 'GET IN THE RING' }], al: { name: 'E2E', picUrl: '' } },
    { id: 22645196, name: 'Bad Apple!!', ar: [{ name: 'のみこ' }], al: { name: 'E2E', picUrl: '' } },
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
const baseRoute = (route) => {
  const u = route.request().url();
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
  if (/r\.jina\.ai/.test(u)) {   // 短链解析中转的桩：带 no-id 的返回一个没有歌单 ID 的页面
    const body = /no-id/.test(u) ? 'Title: 网易云音乐\n\nMarkdown Content:\n# 网易云音乐\n首页' : 'Title: 网易云音乐\n\nMarkdown Content:\n[歌单](https://music.163.com/playlist?id=999000123)\n';
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body });
  }
  if (/gdstudio/.test(u) && /types=url/.test(u)) {
    const id = (u.match(/[?&]id=(\d+)/) || [])[1];
    if (id === '888888888') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });   // 取不到音频 = 真失败
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://m8.music.126.net/e2e-stub.mp3' }) });
  }
  if (/music\.126\.net/.test(u)) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'ID3' });
  return route.continue();
};
await page.route('**/*', baseRoute);
page.on('dialog', (d) => d.accept());   // 删除导入曲目要确认
const errors = [];
const netReqs = [];
page.on('response', (r) => { if (/gdstudio|music\.126/.test(r.url())) netReqs.push(r.status() + ' ' + r.url().slice(0, 50)); });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 140)); });
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
await page.waitForSelector('#deck .word', { timeout: 20000 });
await page.waitForTimeout(400);
check('默认进学词页', await page.locator('#view-learn').isVisible());
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
await page.locator('#b-gloss').click();
await page.waitForTimeout(250);
const g1 = await page.evaluate(() => document.body.classList.contains('gloss'));
check('词义开关能切换（默认关：跟唱时只有当前句干净）', g0 !== g1, `默认 ${g0} → 点一下 ${g1}`);
if (g1) await page.locator('#b-gloss').click();
await page.waitForTimeout(250);
await shot('05-lyric', true);

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
await page.locator('#p-rate').click();
const r1 = await page.evaluate(() => document.querySelector('audio').playbackRate);
check('倍速切换生效', r0 !== r1, r0 + 'x → ' + r1 + 'x');
await page.locator('#p-loop').click();
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

// ═══════ 10 自建对象存储直链 ═══════
const beforeOss = netReqs.length;
await page.goto(BASE + '#/track/t1', { waitUntil: 'load' });
await page.waitForSelector('#view-track', { timeout: 10000 });
await page.waitForTimeout(1400);
const oss = await page.evaluate(() => { const a = document.querySelector('audio'); return { src: a ? a.src.slice(0, 56) : '', tid: a && a.getAttribute('data-tid'), ready: a ? a.readyState : -1 }; });
check('OSS 曲目：audio.src 指向对象存储', /aliyuncs\.com/.test(oss.src), oss.src);
check('OSS 曲目：不再调用第三方解析接口', netReqs.length === beforeOss, '新增 ' + (netReqs.length - beforeOss) + ' 次');
const ossHttp = await page.evaluate(async () => {
  try {
    const d = await (await fetch('data/index.json')).json();
    const t = d.tracks.find((x) => x.id === 't1');
    const r = await fetch(t.audioOss, { headers: { Range: 'bytes=0-1023' } });
    return { status: r.status, type: r.headers.get('content-type') };
  } catch (e) { return { why: String(e).slice(0, 90) }; }
});
check('OSS 直链真请求可达（206 + audio/mpeg）', ossHttp.status === 206 && /audio\/mpeg/.test(ossHttp.type || ''), JSON.stringify(ossHttp));

// ═══════ 11 生词本 + 刷新恢复 ═══════
await page.locator('#tab-mine').click();
await page.waitForTimeout(400);
check('生词本能列出已掌握词', await page.locator('#view-mine .chip').count() > 0, (await page.locator('#view-mine .chip').count()) + ' 个');
check('生词本有导出/导入', await page.locator('#m-export').count() > 0 && await page.locator('#m-import').count() > 0);
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
check('曲库页有「导入网易云歌单」入口', (await page.locator('.impbox summary').count()) === 1, await txt('.impbox summary'));
await page.locator('.impbox summary').click();
await page.waitForTimeout(250);
await page.locator('#plinput').fill('随便写点什么');
await page.locator('#plgo').click();
await page.waitForTimeout(400);
check('非法输入 → 直接报「没识别出歌单 ID」', /没识别出歌单\s*ID/.test(await txt('#plstat')), (await txt('#plstat')).slice(0, 40));
await page.locator('#plinput').fill('https://163cn.tv/no-id-xxxx');
await page.locator('#plgo').click();
await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 90000 });
const shortFail = await txt('#plstat');
check('解析不了的短链：说清怎么办（不空转）', /短链里没有歌单\s*ID/.test(shortFail) && /地址栏/.test(shortFail), shortFail.slice(0, 56));
await page.locator('#plinput').fill('https://163cn.tv/abc123');   // 短链 → 中转解析出 ID
await page.locator('#plgo').click();
await page.waitForFunction(() => !document.querySelector('#plgo').disabled, null, { timeout: 90000 });
await page.waitForTimeout(500);
const impStat = await txt('#plstat');
check('163cn.tv 短链能自动解析出歌单 ID', /可用 2 首/.test(impStat), impStat.slice(0, 40));
check('整张歌单一次导完：可用 2 · 跳过 1 · 失败 1', /可用 2 首/.test(impStat) && /跳过 1 首/.test(impStat) && /失败 1 首/.test(impStat), impStat.slice(0, 80));
check('纯音乐/无歌词只算跳过，不算失败', /纯音乐/.test(impStat), impStat.slice(0, 80));
const impFails = await page.locator('#pllist').textContent();
check('真失败逐首给原因', /取不到音频/.test(impFails) && !/纯音乐/.test(impFails), impFails.replace(/\s+/g, ' ').slice(0, 60));
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
check('可以按专辑分组', (await page.locator('#view-songs .grp').count()) > 5, (await page.locator('#view-songs .grp').count()) + ' 张专辑');
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
await shot('09-import', true);

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
await page.locator('#view-word [data-goto]').first().click();
await page.waitForTimeout(3000);
const jumped = await page.evaluate(() => {
  const a = document.querySelector('audio');
  const el = document.querySelector('#plyric .lblock.playing');
  return { hash: location.hash, tid: a.getAttribute('data-tid'), src: !!a.src, paused: a.paused, open: document.querySelector('#player').classList.contains('on'), line: el ? Number(el.dataset.i) : -1 };
});
check('去这句：跳到对应那句', jumped.hash === `#/track/${gtid}@${gli}` && jumped.open && jumped.line === Number(gli), JSON.stringify(jumped));
check('去这句：音频换成这首歌并开始播', jumped.tid === gtid && jumped.src && !jumped.paused, `tid=${jumped.tid} paused=${jumped.paused}`);
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

check('控制台无错误', errors.length === 0, errors.slice(0, 3).join(' || '));

const okN = results.filter((r) => r.ok).length;
console.log(`\n===== ${okN}/${results.length} 通过 =====`);
fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results, errors }, null, 1));
await browser.close();
process.exit(okN === results.length ? 0 : 1);
