import { firefox } from 'playwright';
import { spawn } from 'node:child_process';
const srv = spawn('node', ['scripts/serve.mjs', '8853'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));

const browser = await firefox.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem('thlyrics.account.v1', JSON.stringify({token:'x',name:'x',uid:'x'}));
});

// 把每个路由的关键元素的样式 dump 出来
const inspect = async (route, sel, label) => {
  await page.goto(`http://127.0.0.1:8853${route}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  for (const theme of ['warm', 'dark']) {
    await page.evaluate(t => document.body.classList.toggle('warm', t==='warm'), theme);
    await page.waitForTimeout(200);
    const info = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT FOUND';
      const cs = getComputedStyle(el);
      return JSON.stringify({
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        bg: cs.backgroundColor,
        color: cs.color,
        border: cs.borderTop,
        radius: cs.borderRadius,
      });
    }, sel);
    console.log(`[${theme}] ${label} (${sel}):`, info);
  }
};

await inspect('/#/home',  '.herohead .ht',   '首页大标题');
await inspect('/#/home',  '.herohead .hln button.on', '首页 tabs 文字');
await inspect('/#/home',  '.nowcard',        'NOW card');
await inspect('/#/home',  '.wordstrip button', '词条 chip');
await inspect('/#/home',  '.iconbtn',        '搜索 icon');
await inspect('/#/home',  '.brand .b1',      '品牌衬线');
await inspect('/#/learn', '.revcard .rw',    '复习词大字');
await inspect('/#/me',    '.setrow',         '设置行');
await inspect('/#/me',    '.avbtn',          '头像按钮');
await inspect('/#/mine',  '.item',           '生词本行');
await inspect('/#/songs', '.item',           '曲库行');
await inspect('/#/songs', '.albumcard .cov', '专辑封面');

await browser.close();
srv.kill();
