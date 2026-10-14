import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HOME=process.env.HOME||'/home/zfq'; const root=HOME+'/.cache/ms-playwright';
const dirs=fs.readdirSync(root).filter(d=>d.startsWith('chromium_headless_shell-')).sort();
const chrome=path.join(root,dirs[dirs.length-1],'chrome-headless-shell-linux64','chrome-headless-shell');
const HERE='/home/zfq/qqbot/thlyrics/.e2e';
const libPath=['root/usr/lib/x86_64-linux-gnu','root/lib/x86_64-linux-gnu','root/usr/lib','root/lib'].map(p=>path.join(HERE,p)).join(':');
const b=await chromium.launch({executablePath:chrome,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:libPath}});
const page=await b.newPage({viewport:{width:400,height:850},isMobile:true,hasTouch:true,deviceScaleFactor:2});
page.on('pageerror',e=>console.log('  [pageerror]',e.message));
const band={code:200,playlist:{id:1,name:'東方',tracks:[{id:22645196,name:'Bad Apple!!',ar:[{name:'のみこ'}],al:{name:'東方'}}]}};
await page.route('**/api.php?*', r => r.request().url().includes('types=playlist')
  ? r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(band)}) : r.continue());
await page.goto('http://127.0.0.1:8848/#/songs',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1000);
await page.locator('.impbox summary').click();
await page.locator('#plinput').fill('https://music.163.com/playlist?id=999000123');
await page.locator('#plgo').click();
await page.waitForFunction(()=>!document.querySelector('#plgo').disabled,null,{timeout:120000});
await page.goto('http://127.0.0.1:8848/#/track/i22645196');
await page.waitForTimeout(900);
await page.locator('#t-sing').click();
await page.waitForTimeout(1600);
const res = await page.evaluate(() => {
  const bad = [], all = [];
  for (const line of document.querySelectorAll('#plyric .line')) {
    const kids = [...line.children];
    if (kids.length < 4) continue;
    const tops = kids.map((sp) => {
      const node = [...sp.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!node) return null;
      const rg = document.createRange(); rg.selectNodeContents(node);
      return { s: sp.textContent.trim().slice(0, 5), r: !!(sp.querySelector('.r') || {}).textContent?.trim(), top: Math.round(rg.getBoundingClientRect().top * 100) / 100 };
    }).filter(Boolean);
    const vals = tops.map((x) => x.top);
    const spread = Math.round((Math.max(...vals) - Math.min(...vals)) * 100) / 100;
    all.push(spread);
    if (spread > 1) bad.push({ spread, tops });
  }
  return { lines: all.length, maxSpread: Math.max(...all), bad: bad.slice(0, 2) };
});
console.log('行内日文行高度差：句数', res.lines, '最大偏差', res.maxSpread, 'px');
if (res.bad.length) console.log(JSON.stringify(res.bad, null, 1).slice(0, 900));
await page.evaluate(() => { const b=[...document.querySelectorAll('#plyric .lblock')].find(x=>/揺/.test(x.textContent)); const box=document.querySelector('#plyric'); if(b){ b.classList.add('playing'); box.scrollTop = box.scrollTop + b.getBoundingClientRect().top - box.getBoundingClientRect().top - 40; } });
await page.waitForTimeout(400);
await page.screenshot({path:'/tmp/align-probe.png'});
await b.close();
