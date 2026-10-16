import { firefox } from 'playwright';
import { spawn } from 'node:child_process';
const srv = spawn('node', ['scripts/serve.mjs', '8863'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const browser = await firefox.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem('thlyrics.account.v1', JSON.stringify({token:'demo',name:'demo',uid:'demo'}));
});
await page.route('**/data/index.json*', async (route) => {
  const r = await route.fetch(); const j = await r.json();
  j.tracks = [
    { id: 'd1', title: '幽雅に咲かせ、墨染の桜', base: '亡き王女のためのパヴァーヌ', artist: '幽閉サテライト', album: '桜', lineCount: 4, lines: [
      { text: '幽雅に咲かせ、墨染の桜', zh: '雅致地盛开，墨色的樱花', segs: [
        {s:'幽雅に',k:'adv',b:'幽雅',y:'ゆうがに',r:'yuuga ni'},{s:'咲かせ',k:'v',b:'咲かせる',y:'さかせ',r:'sakase'},
        {s:'、',k:'sym'},{s:'墨染',k:'n',b:'墨染',y:'すみぞめ',r:'sumizome'},{s:'の',k:'prt'},{s:'桜',k:'n',b:'桜',y:'さくら',r:'sakura'},
      ]},
      { text: '幻想郷に春の訪れ', zh: '幻想乡迎来了春天', segs: [
        {s:'幻想郷',k:'n',b:'幻想郷',y:'げんそうきょう',r:'gensoukyou'},{s:'に',k:'prt'},{s:'春',k:'n',b:'春',y:'はる',r:'haru'},
        {s:'の',k:'prt'},{s:'訪れ',k:'n',b:'訪れ',y:'おとずれ',r:'otozure'},
      ]},
    ]},
    { id: 'd2', title: '少女が見た日本の原風景', base: '一剣', artist: '峰月荘', album: '峰月抄', lineCount: 1, lines: [{ text: '少女が見た 日本の原風景', zh: '少女所见的 日本原风景', segs: [{s:'少女',k:'n',b:'少女',y:'しょうじょ',r:'shoujo'},{s:'が',k:'prt'},{s:'見た',k:'v',b:'見る',y:'みた',r:'mita'},{s:'日本',k:'n',b:'日本',y:'にほん',r:'nihon'},{s:'の',k:'prt'},{s:'原風景',k:'n',b:'原風景',y:'げんふうけい',r:'genfuukei'}] }] },
    { id: 'd3', title: '月に叢雲華に風', base: '一剣', artist: 'Silver Forest', album: 'Silver Forest Ⅱ', lineCount: 1, lines: [{ text: '月に叢雲華に風', zh: '月遇丛云 花遇风', segs: [{s:'月',k:'n',b:'月',y:'つき',r:'tsuki'},{s:'に',k:'prt'},{s:'叢雲',k:'n',b:'叢雲',y:'むらくも',r:'murakumo'},{s:'華',k:'n',b:'華',y:'はな',r:'hana'},{s:'に',k:'prt'},{s:'風',k:'n',b:'風',y:'かぜ',r:'kaze'}] }] },
    { id: 'd4', title: '妖々夢 〜 Lotus Land Story', base: '東方妖々夢', artist: '上海アリス幻樂団', album: '東方妖々夢', lineCount: 1, lines: [{ text: '妖麗なる夢の如く', zh: '如妖丽之梦', segs: [{s:'妖麗',k:'na',b:'妖麗',y:'ようれい',r:'yourei'},{s:'なる',k:'aux'},{s:'夢',k:'n',b:'夢',y:'ゆめ',r:'yume'},{s:'の',k:'prt'},{s:'如く',k:'n',b:'如く',y:'ごとく',r:'gotoku'}] }] },
    { id: 'd5', title: '亡き王女のためのパヴァーヌ', base: 'ラヴェルのパヴァーヌ', artist: '死音ピアノ', album: 'night of nights', lineCount: 1, lines: [{ text: '深淵に佇む王女', zh: '伫立于深渊的王女', segs: [{s:'深淵',k:'n',b:'深淵',y:'しんえん',r:'shinen'},{s:'に',k:'prt'},{s:'佇む',k:'v',b:'佇む',y:'たたずむ',r:'tatazumu'},{s:'王女',k:'n',b:'王女',y:'おうじょ',r:'oujo'}] }] },
    { id: 'd6', title: '竹取飛翔 〜 Lunatic Princess', base: '一剣', artist: '幽閉サテライト', album: '桜', lineCount: 1, lines: [{ text: '月夜の竹取の翁', zh: '月夜竹取老翁', segs: [{s:'月夜',k:'n',b:'月夜',y:'つくよ',r:'tsukuyo'},{s:'の',k:'prt'},{s:'竹取',k:'n',b:'竹取',y:'たけとり',r:'taketori'},{s:'翁',k:'n',b:'翁',y:'おきな',r:'okina'}] }] },
  ];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
});

// 5 路由 × 2 主题
for (const route of ['/#/home', '/#/songs', '/#/learn', '/#/me', '/#/mine']) {
  for (const theme of ['warm','dark']) {
    await page.goto(`http://127.0.0.1:8863${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await page.evaluate(t => document.body.classList.toggle('warm', t==='warm'), theme);
    await page.waitForTimeout(400);
    const name = route.replace('/#/','');
    await page.screenshot({ path: `.shots/demo-${theme}-${name}.png`, fullPage: true });
    console.log(`demo-${theme}-${name}.png`);
  }
}

// 单曲详情
await page.goto('http://127.0.0.1:8863/#/songs', { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.item.track').length > 0, { timeout: 8000 });
await page.waitForTimeout(800);
await page.locator('.item.track').first().click();
await page.waitForTimeout(2200);
for (const theme of ['warm','dark']) {
  await page.evaluate(t => document.body.classList.toggle('warm', t==='warm'), theme);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `.shots/demo-${theme}-track.png`, fullPage: true });
  console.log(`demo-${theme}-track.png`);
}

// 跟唱
const singBtn = page.locator('#t-sing');
console.log('sing count:', await singBtn.count());
if (await singBtn.count()) {
  await singBtn.click();
  await page.waitForTimeout(2800);
  for (const theme of ['warm','dark']) {
    await page.evaluate(t => document.body.classList.toggle('warm', t==='warm'), theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `.shots/demo-${theme}-player.png`, fullPage: false });
    console.log(`demo-${theme}-player.png`);
  }
  // 点一个词
  const w = page.locator('.line .w').first();
  console.log('word count:', await w.count());
  if (await w.count()) {
    await w.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `.shots/demo-warm-pop.png`, fullPage: false });
    console.log('demo-warm-pop.png');
  }
}

await browser.close();
srv.kill();
console.log('done');
