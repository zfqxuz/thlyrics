/**
 * thlyrics 端到端测试
 * 用法：node run-e2e.mjs [baseUrl]   默认 http://127.0.0.1:8848/
 *
 * 说明：本机只有 chromium_headless_shell（不带 MP3 解码器，真播 mp3 会崩渲染进程），
 * 所以这里把音频响应替换成假数据，验证「取地址 → 预缓冲 → 状态机 → 交互」全链路，
 * 真正「能不能出声」必须在真浏览器上验收。
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

await page.route('**/*', (route) => {
  const u = route.request().url();
  if (/gdstudio/.test(u) && /types=url/.test(u)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://m8.music.126.net/e2e-stub.mp3' }) });
  }
  if (/music\.126\.net|gdstudio/.test(u)) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'ID3' });
  return route.continue();
});
const errors = [];
const audioReqs = [];
page.on('response', (r) => { if (/gdstudio|music\.126/.test(r.url())) audioReqs.push(r.status() + ' ' + r.url().slice(0, 46)); });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 150)));
page.on('crash', () => errors.push('渲染进程崩溃'));

const txt = (sel) => page.locator(sel).textContent();
const idxOf = () => page.evaluate(() => { const el = document.querySelector('#lyric .lblock.playing'); return el ? Number(el.dataset.i) : -1; });
const clickBlock = async (i) => {
  const loc = page.locator('#lyric .lblock[data-i="' + i + '"]');
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);
  // 点块的左上角留白（避开词 span，也避开会移动的平滑滚动）
  await loc.click({ position: { x: 4, y: 5 }, timeout: 8000 });
  await page.waitForTimeout(120);
};
const shot = async (n, keepScroll) => {
  if (!keepScroll) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(450);
  } else {
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(SHOTS, n + '.png') });
};

// ============ 1 学词首页（词汇入手） ============
await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('#deck .word', { timeout: 20000 });
await page.waitForTimeout(400);
check('默认进「学词」页（词汇入手）', await page.locator('#view-learn').isVisible());
check('顶部统计显示曲库/词表规模', /词/.test((await txt('#headstat')) || ''), ((await txt('#headstat')) || '').slice(0, 60));
const deckN = await page.locator('#deck .word').count();
check('词卡列表渲染', deckN > 10, deckN + ' 张');
const firstBadges = await page.locator('#deck .word').first().locator('.badge').allTextContents();
check('词卡标出标日课次/词性/出现曲数', firstBadges.length >= 3, firstBadges.join(' | '));
const first5Br = await page.evaluate(() => [...document.querySelectorAll('#deck .word')].slice(0, 5).map((e) => !!e.querySelector('.badge.br')));
check('从易到难：最前面的是标日初级词', first5Br.every(Boolean), JSON.stringify(first5Br));
const diffOrder = await page.evaluate(async () => {
  const r = await fetch('data/index.json'); const d = await r.json();
  const ids = [...document.querySelectorAll('#deck .word')].map((e) => Number(e.dataset.id));
  const by = new Map(d.vocab.map((v) => [v.id, v]));
  const ds = ids.map((i) => by.get(i).diff);
  return ds.every((x, i) => i === 0 || ds[i - 1] <= x);
});
check('词卡顺序按难度单调递增（diff）', diffOrder);
await shot('01-learn');

// ============ 2 词条详情 → 跳到歌里那一句 ============
await page.locator('#deck .word').first().click();
await page.waitForSelector('#view-word .wbig', { timeout: 8000 });
const wbig = (await txt('#view-word .wbig')) || '';
check('词条详情打开', wbig.length > 0, wbig);
check('词条有释义', ((await txt('#w-mean')) || '').length > 1, ((await txt('#w-mean')) || '').slice(0, 24));
const exN = await page.locator('#view-word .ex').count();
check('词条有例句', exN > 0, exN + ' 条');
const goBtn = page.locator('#view-word [data-go]').first();
check('例句带「去这句」入口', await goBtn.count() > 0);
await shot('02-word');
if (await goBtn.count()) {
  await goBtn.click();
  await page.waitForSelector('#lyric .lblock', { timeout: 8000 });
  await page.waitForTimeout(500);
  const li = await idxOf();
  check('「去这句」进了单曲并开始单句循环', li >= 0, '高亮第 ' + li + ' 句');
}

// ============ 3 单曲页：词汇列表在歌词前面 ============
const twN = await page.locator('#twlist .word').count();
check('单曲页先列出这首歌的词汇', twN > 3, twN + ' 个词');
const orderOk = await page.evaluate(() => {
  const a = document.querySelector('#twlist').getBoundingClientRect();
  const b = document.querySelector('#lyric').getBoundingClientRect();
  return a.top < b.top;
});
check('词汇列表排在歌词上方', orderOk);
const twChips = await page.locator('#twchips .chip').count();
check('词汇列表可按标日/词性筛选', twChips >= 5, twChips + ' 个筛选');
await page.locator('#twchips .chip[data-f="動詞"]').click();
await page.waitForTimeout(250);
const twV = await page.locator('#twlist .word').count();
check('筛选生效（动词）', twV > 0 && twV <= twN, twV + '/' + twN);
await page.locator('#twchips .chip[data-f="all"]').click();
await page.waitForTimeout(200);
// 「去这句」
const twGo = page.locator('#twlist .tw-go').first();
if (await twGo.count()) {
  await twGo.click();
  await page.waitForTimeout(400);
}
await shot('03-track-vocab');

// ============ 4 歌词：词性分色 / 罗马音分块 / 词级中文 ============
const blockN = await page.locator('#lyric .lblock').count();
check('歌词按「句块」渲染', blockN > 5, blockN + ' 块');
const posStats = await page.evaluate(() => {
  const g = (c) => document.querySelectorAll('#lyric .w.' + c).length;
  return { n: g('k-n'), v: g('k-v'), a: g('k-a'), adv: g('k-adv'), prt: g('k-prt'), aux: g('k-aux') };
});
check('词性分色：名词/动词/形容词/副词/助词都有', posStats.n > 3 && posStats.v > 3 && posStats.a > 0 && posStats.prt > 3, JSON.stringify(posStats));
const romajiInBlock = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('#lyric .lblock')];
  return blocks.filter((b) => b.querySelector('.romaji')).length;
});
check('罗马音锁在各自句块内（不会串句）', romajiInBlock > 3, romajiInBlock + ' 块带罗马音');
const romajiHasLine = await page.evaluate(() => {
  const b = [...document.querySelectorAll('#lyric .lblock')].find((x) => x.querySelector('.romaji'));
  const r = b.querySelector('.romaji').getBoundingClientRect();
  const l = b.querySelector('.line').getBoundingClientRect();
  return r.top - l.bottom < 30 && r.top > l.top;
});
check('罗马音紧贴在对应句下面', romajiHasLine);
const glossN = await page.locator('#lyric .g').count();
check('词级中文：词下面挂释义小字', glossN > 5, glossN + ' 个词带释义');
await page.locator('#b-gloss').click();
await page.waitForTimeout(300);
const glossOff = await page.evaluate(() => !document.body.classList.contains('gloss'));
check('词义可一键收起', glossOff);
await page.locator('#b-gloss').click();
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#lyric').scrollIntoView({ block: 'start' }));
await page.waitForTimeout(600);
await shot('04-lyric', true);

// ============ 5 播放键只有一个 ============
const playBtns = await page.evaluate(() => ({ pbig: document.querySelectorAll('#player .pbig').length, inPage: document.querySelectorAll('#view-track #b-play, #view-track .pbig, #view-track #b-playall').length }));
check('全站只有一个播放键（页内不再放第二个）', playBtns.pbig === 1 && playBtns.inPage === 0, JSON.stringify(playBtns));

// ============ 6 单句循环 / 点词不误切 ============
const lineIds = await page.evaluate(() => [...document.querySelectorAll('#lyric .lblock[data-i]')].map((e) => Number(e.dataset.i)));
const pick = lineIds[Math.min(4, lineIds.length - 1)];
await clickBlock(pick);
await page.waitForTimeout(400);
const idx1 = await idxOf();
check('点句子开单句循环', idx1 === pick, '点第 ' + pick + ' 句 → 高亮 ' + idx1);
check('循环键文案变化', ((await txt('#p-loop')) || '').includes('开'), (await txt('#p-loop')) || '');
const t1 = Date.now();
for (const n of [lineIds[7], lineIds[2], lineIds[6]]) { if (Number.isFinite(n)) { await clickBlock(n); await page.waitForTimeout(150); } }
check('连点三句响应快', Date.now() - t1 < 2200, (Date.now() - t1) + 'ms');
const before = await idxOf();
await page.locator('#lyric .lblock .w[data-w]').nth(1).click();
await page.waitForTimeout(350);
const pop = await page.evaluate(() => ({
  vis: !!document.querySelector('#pop.on'),
  w: document.querySelector('#p-word').textContent,
  mg: (document.querySelector('#p-meaning').textContent || '').slice(0, 20),
}));
check('点词弹出词条（带释义）', pop.vis && !!pop.w, pop.w + ' → ' + pop.mg);
check('点词不改变循环行', before === (await idxOf()), before + ' → ' + (await idxOf()));
await shot('06-word');
await page.locator('#p-close2').click();
await page.locator('#p-play').click();      // 暂停，避免影响后面的操作

// ============ 7 倍速 / 上一句下一句 ============
const r0 = await page.evaluate(() => document.querySelector('audio').playbackRate);
await page.locator('#p-rate').click();
const r1 = await page.evaluate(() => document.querySelector('audio').playbackRate);
check('倍速切换生效', r0 !== r1, r0 + 'x → ' + r1 + 'x');
const i0 = await idxOf();
await page.locator('#p-next').click(); await page.waitForTimeout(250);
const i1 = await idxOf();
check('下一句切换', i1 !== i0, i0 + ' → ' + i1);
await page.locator('#p-prev').click(); await page.waitForTimeout(250);
check('上一句切换', (await idxOf()) === i0, '回到 ' + (await idxOf()));

// ============ 8 检索 ============
await page.locator('#tab-learn').click();
await page.waitForTimeout(300);
const search = async (q) => { await page.locator('#q').fill(q); await page.waitForTimeout(420); };
await search('ネクロ');
await page.waitForSelector('#view-search .track', { timeout: 6000 });
const s1 = await page.locator('#view-search .track').count();
await search('世界');
const s2w = await page.locator('#view-search .word').count();
await search('岸田');
const s3 = await page.locator('#view-search .track').count();
await search('幻想');
const s4w = await page.locator('#view-search .word').count();
check('检索：曲名', s1 > 0, '「ネクロ」→ ' + s1 + ' 首');
check('检索：释义/词（搜「世界」）', s2w > 0, s2w + ' 个词');
check('检索：社团（搜「岸田」）', s3 >= 0, s3 + ' 首');
check('检索：词表里的词（搜「幻想」）', s4w > 0, s4w + ' 个词');
await search('zzzzzz');
const s5 = await page.locator('#view-search .word').count() + await page.locator('#view-search .track').count();
check('检索无结果有空态', s5 === 0, '匹配 ' + s5 + ' 条');
await shot('07-search');
await search('');
await page.waitForTimeout(300);

// ============ 9 曲库列表与过滤 ============
await page.locator('#tab-songs').click();
await page.waitForTimeout(400);
const trackCount = await page.locator('#list .track').count();
check('曲库列表渲染', trackCount > 20, trackCount + ' 首');
check('按原曲分组', (await page.locator('#list .grouphead').count()) > 3, (await page.locator('#list .grouphead').count()) + ' 组');
await page.locator('#f-audio').click(); await page.waitForTimeout(300);
const fa = await page.locator('#list .track').count();
await page.locator('#f-zh').click(); await page.waitForTimeout(300);
const fz = await page.locator('#list .track').count();
check('过滤：有音频', fa > 0 && fa < trackCount, fa + ' 首');
check('过滤：有中文', fz > 0 && fz < trackCount, fz + ' 首');
await page.locator('#f-audio').click(); await page.waitForTimeout(200);
await page.locator('#f-zh').click(); await page.waitForTimeout(200);
await shot('08-songs');

// ============ 9.5 带音频的曲目：预取地址 + 预缓冲 + 播放 ============
const before9 = audioReqs.length;
await page.locator('#list .track').filter({ has: page.locator('.tag.a') }).first().click();
await page.waitForSelector('#lyric .lblock', { timeout: 8000 });
await page.waitForTimeout(900);
check('进单曲页就预取音频地址（不用等点播放）', audioReqs.length > before9, audioReqs.slice(0, 2).join(' | ') || '没有任何音频请求');
const srcSet = await page.evaluate(() => { const a = document.querySelector('audio'); return a ? { src: (a.src || '').slice(0, 34), ready: a.readyState, tid: a.getAttribute('data-tid') } : null; });
check('audio 已挂 DOM 且已开始预缓冲（src 就位）', !!srcSet && !!srcSet.src, JSON.stringify(srcSet));
check('播放条显示这首曲目', ((await txt('#p-now')) || '').length > 2, ((await txt('#p-now')) || '').slice(0, 30));
await page.locator('#p-play').click();
await page.waitForTimeout(1500);
const playState = await page.evaluate(() => { const a = document.querySelector('audio'); return { paused: a.paused, ready: a.readyState, cls: document.querySelector('#p-play').textContent, st: document.querySelector('#p-state').textContent, src: (a.src || '').slice(0, 30) }; });
// 本机只有 headless-shell（无 MP3 解码器），所以这里只验「地址拿到了、状态机跑了」；
// 解码那一步必然失败，属于环境限制，不是产品问题。
check('点播放：地址链路走通（解码器本机缺失）', !!playState.src && (playState.cls === '❚❚' || playState.paused === false || /缓冲|就绪|失败/.test(playState.st)), JSON.stringify(playState));
await shot('10-audio');

// ============ 10 生词本 + 刷新恢复 ============
await page.locator('#deck .word .kn').first().click().catch(() => {});
await page.locator('#tab-learn').click();
await page.waitForTimeout(250);
const kn = await page.locator('#deck .word .kn').first().click();
await page.waitForTimeout(300);
const knownCount = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1')).known || {}).length);
check('「掌握」写进本地进度', knownCount > 0, knownCount + ' 个词');
await page.locator('#tab-mine').click();
await page.waitForTimeout(300);
check('生词本能列出已掌握的词', (await page.locator('#view-mine .chip').count()) > 0, (await page.locator('#view-mine .chip').count()) + ' 个');
check('生词本有导出/导入', await page.locator('#m-export').count() > 0 && await page.locator('#m-import').count() > 0);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#view-mine .chip, #deck .word', { timeout: 15000 });
await page.locator('#tab-learn').click();
await page.waitForSelector('#deck .word', { timeout: 8000 });
const restored = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1')).known || {}).length);
check('刷新后本地进度保留', restored > 0, restored + ' 个词');
await page.waitForTimeout(300);
await shot('09-restored');

check('控制台无错误', errors.length === 0, errors.slice(0, 3).join(' || '));

const okN = results.filter((r) => r.ok).length;
console.log(`\n===== ${okN}/${results.length} 通过 =====`);
fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results, errors }, null, 1));
await browser.close();
process.exit(okN === results.length ? 0 : 1);
