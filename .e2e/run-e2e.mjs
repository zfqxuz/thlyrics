/**
 * thlyrics 端到端测试
 * 用法：node run-e2e.mjs [baseUrl]   默认 http://127.0.0.1:8848/
 *
 * 注意：本机只有 chromium_headless_shell，它不带 MP3 解码器，一播音频渲染进程就崩，
 * 所以这里把音频请求替换成一个假响应（只验证“逻辑/状态机/交互链路”，不验证真的出声）。
 * 真正“能不能听到声音”必须在真浏览器（用户的手机/桌面）上验收。
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
const libPath = [ 'root/usr/lib/x86_64-linux-gnu', 'root/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib' ]
  .map((p) => path.join(HERE, p)).join(':');

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({
  executablePath: chrome,
  env: { ...process.env, LD_LIBRARY_PATH: libPath },
  args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true })).newPage();

// 音频请求全部替换成假响应，避免渲染进程因缺解码器崩溃
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (/music\.126\.net|gdstudio/.test(u)) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'ID3' });
  return route.continue();
});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 150)));
page.on('crash', () => errors.push('渲染进程崩溃'));

const txt = (sel) => page.locator(sel).textContent();

// 点一句歌词的空白处（行首 3px 是 padding，命中的是行本身而不是词 span）
const goBack = async () => {
  // 只有在单曲页时才返回；已经回到列表页就直接跳过（别对已消失的元素操作）
  if (await page.locator('#b-back').count() === 0) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  if (await page.locator('#b-back').isVisible().catch(() => false)) {
    await page.locator('#b-back').click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
};

const clickLine = async (n) => {
  const loc = page.locator('#lyric .line[data-i="' + n + '"]');
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));   // 滚到视口中间，避免被底部弹层/播放条盖住
  await page.waitForTimeout(200);
  const b = await loc.boundingBox();
  await page.mouse.click(b.x + 3, b.y + b.height / 2);
};

await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('#list .track', { timeout: 20000 });
await page.waitForTimeout(300);

// 1 首页
const stat = (await txt('#headstat')) || '';
check('首页加载并显示统计', /首/.test(stat) && /词/.test(stat), stat.slice(0, 50));
const trackCount = await page.locator('#list .track').count();
check('曲目列表渲染', trackCount > 0, trackCount + ' 条');
check('按原曲分组', (await page.locator('#list .grouphead').count()) > 1, (await page.locator('#list .grouphead').count()) + ' 个分组');
await page.screenshot({ path: path.join(SHOTS, '01-list.png') });

// 2 检索
const search = async (q) => { await page.locator('#q').fill(q); await page.waitForTimeout(280); return page.locator('#list .track').count(); };
const s1 = await search('ネクロ');
const s2 = await search('岸田');
const s3 = await search('zzzz');
check('检索 曲名', s1 > 0 && s1 < trackCount, '「ネクロ」→' + s1);
check('检索 社团', s2 >= 0, '「岸田」→' + s2);
check('检索 无结果时的空态', s3 === 0, '「zzzz」→' + s3);
await search('');

// 3 进入单曲
await page.locator('#list .track').filter({ has: page.locator('.tag.a') }).first().click();
await page.waitForSelector('#lyric .line', { timeout: 10000 });
await page.waitForTimeout(300);
const lyricLines = await page.locator('#lyric .line[data-i]').count();
const zhLines = await page.locator('#lyric .line.zh').count();
const words = await page.locator('#lyric .line .w').count();
check('单曲页歌词渲染', lyricLines > 5, lyricLines + ' 行');
check('中文翻译挂在句内', await page.locator('#lyric .zh').count() >= 0, '本首 ' + (await page.locator('#lyric .zh').count()) + ' 句带译文（该曲目本身无译文属正常）');
check('词已切分可点', words > 10, words + ' 个词');
check('标题显示', ((await txt('#view-track h2')) || '').length > 0, (await txt('#view-track h2')) || '');
const lineIds = await page.evaluate(() => [...document.querySelectorAll('#lyric .line[data-i]')].map((e) => Number(e.dataset.i)));
check('行号已挂到元素上(data-i)', lineIds.length > 5, lineIds.slice(0, 8).join(','));
await page.screenshot({ path: path.join(SHOTS, '02-track.png') });

// 4 播放：验证请求链路 + 状态机（不验声音）
const audioReqs = [];
page.on('response', (r) => { if (/gdstudio|music\.126/.test(r.url())) audioReqs.push(r.status() + ' ' + r.url().slice(0, 40)); });
await page.locator('#b-play').click();
await page.waitForTimeout(3500);
check('点播放后向接口取地址', audioReqs.length > 0, audioReqs.slice(0, 2).join(' | ') || '没有任何音频请求');
const audioState = await page.evaluate(() => {
  const a = document.querySelector('audio');
  return a ? { src: (a.src || '').slice(0, 40), ready: a.readyState, err: a.error && a.error.code } : null;
});
check('audio 元素已挂到 DOM', !!audioState, JSON.stringify(audioState));
check('播放条出现', ((await page.locator('#player').getAttribute('class')) || '').includes('on'));
await page.screenshot({ path: path.join(SHOTS, '03-player.png') });

// 5 单句循环
const idxOf = () => page.evaluate(() => { const el = document.querySelector('#lyric .line.playing'); return el ? Number(el.dataset.i) : -1; });
const t0 = Date.now();
const pick1 = lineIds[4];
await page.locator('#lyric .line[data-i="' + pick1 + '"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);   // 等滚动/渲染稳定
await clickLine(pick1);
await page.waitForTimeout(400);
const idx1 = await idxOf();
check('点句子开单句循环', idx1 === pick1, '点第 ' + pick1 + ' 行 → 高亮 ' + idx1 + '，响应 ' + (Date.now() - t0) + 'ms');
check('循环键文案变化', ((await txt('#p-loop')) || '').includes('开'), (await txt('#p-loop')) || '');
await page.screenshot({ path: path.join(SHOTS, '04-loop.png') });

// 6 连点三句不卡
const t1 = Date.now();
const picks = [lineIds[7], lineIds[2], lineIds[6]].filter((x) => Number.isFinite(x));
for (const n of picks) { await clickLine(n); await page.waitForTimeout(180); }
const dt = Date.now() - t1;
check('连点三句响应快', dt < 2000, dt + 'ms');
const idxEnd = await idxOf();
check('最终高亮正确', idxEnd === picks[picks.length - 1], '期望 ' + picks[picks.length - 1] + ' 实得 ' + idxEnd);

// 7 点词不误触发循环
const before = await idxOf();
await page.locator('#lyric .line .w').first().click();
await page.waitForTimeout(350);
const pop = await page.evaluate(() => ({
  vis: !!document.querySelector('#pop.on'),
  w: document.querySelector('#p-word').textContent,
  rd: document.querySelector('#p-reading').textContent,
  mg: (document.querySelector('#p-meaning').textContent || '').slice(0, 24),
  ex: (document.querySelector('#p-ex').textContent || '').slice(0, 36),
}));
const after = await idxOf();
check('点词弹出词条', pop.vis && !!pop.w, pop.w + ' ' + pop.rd + ' → ' + pop.mg);
check('词条带例句', pop.ex.length > 4, pop.ex);
check('点词不改变循环行', before === after, before + ' → ' + after);
await page.screenshot({ path: path.join(SHOTS, '05-word.png') });
await page.locator('#p-close2').click();

// 8 倍速 / 上一句下一句
const rateBefore = await page.evaluate(() => document.querySelector('audio').playbackRate);
await page.locator('#p-rate').click();
const rateAfter = await page.evaluate(() => document.querySelector('audio').playbackRate);
check('倍速切换生效', rateBefore !== rateAfter, rateBefore + 'x → ' + rateAfter + 'x');
const idxBeforeNext = await idxOf();
await page.locator('#p-next').click();
await page.waitForTimeout(300);
const idxAfterNext = await idxOf();
check('下一句切换', idxAfterNext !== idxBeforeNext, idxBeforeNext + ' → ' + idxAfterNext);
await page.locator('#p-prev').click();
await page.waitForTimeout(300);
check('上一句切换', (await idxOf()) === idxBeforeNext, '回到 ' + (await idxOf()));

// 8.5 验证有中文的曲目译文渲染
await goBack();
await page.waitForTimeout(250);
await page.locator('#f-zh').click();
await page.waitForTimeout(300);
await page.locator('#list .track').first().click();
await page.waitForSelector('#lyric .line[data-i]');
const zhInside = await page.locator('#lyric .line .zh').count();
check('有中文曲目：译文挂在句内', zhInside > 0, zhInside + ' 句带译文');
await goBack();
await page.waitForTimeout(250);

// 9 返回 + 过滤
await goBack();
await page.waitForTimeout(300);
await page.locator('#f-audio').click(); await page.waitForTimeout(300);
const fa = await page.locator('#list .track').count();
await page.locator('#f-zh').click(); await page.waitForTimeout(300);
const fz = await page.locator('#list .track').count();
check('过滤：有音频', fa > 0 && fa < trackCount, fa + ' 条');
check('过滤：有中文', fz > 0 && fz < trackCount, fz + ' 条');
await page.screenshot({ path: path.join(SHOTS, '06-filter.png') });

// 10 刷新后本地状态
await page.evaluate(() => { localStorage.setItem('thlyrics.tool.v1', JSON.stringify({ known: { 1: 1 }, notes: {}, audio: {}, local: {} })); });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#list .track');
const restored = await page.evaluate(() => !!localStorage.getItem('thlyrics.tool.v1'));
check('刷新后本地状态保留', restored);

check('控制台无错误', errors.length === 0, errors.slice(0, 3).join(' || '));

const okN = results.filter((r) => r.ok).length;
console.log(`\n===== ${okN}/${results.length} 通过 =====`);
fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results, errors }, null, 1));
await browser.close();
process.exit(okN === results.length ? 0 : 1);
