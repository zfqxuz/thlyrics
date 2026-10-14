import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HOME=process.env.HOME||'/home/zfq'; const root=HOME+'/.cache/ms-playwright';
const dirs=fs.readdirSync(root).filter(d=>d.startsWith('chromium_headless_shell-')).sort();
const chrome=path.join(root,dirs[dirs.length-1],'chrome-headless-shell-linux64','chrome-headless-shell');
const HERE='/home/zfq/qqbot/thlyrics/.e2e';
const libPath=['root/usr/lib/x86_64-linux-gnu','root/lib/x86_64-linux-gnu','root/usr/lib','root/lib'].map(p=>path.join(HERE,p)).join(':');
const SONG = process.argv[2] || '737966';
const b=await chromium.launch({executablePath:chrome,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:libPath}});
const page=await b.newPage({viewport:{width:400,height:850},isMobile:true,hasTouch:true,deviceScaleFactor:2});
page.on('pageerror',e=>console.log('  [pageerror]',e.message));
page.on('console',m=>{ if(m.type()==='error') console.log('  [err]', m.text().slice(0,140)); });
const band={code:200,playlist:{id:1,name:'東方',tracks:[{id:Number(SONG),name:'x',ar:[{name:'y'}],al:{name:'東方'}}]}};
await page.route('**/api.php?*', r => {
  const u=r.request().url();
  if (u.includes('types=playlist')) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(band)});
  if (u.includes('types=url')) return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:'https://m8.music.126.net/e2e-stub.mp3'})});
  return r.continue();
});
await page.goto('http://127.0.0.1:8848/?v=test',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(800);
await page.goto('http://127.0.0.1:8848/#/songs');
await page.waitForTimeout(800);
await page.locator('.impbox summary').click();
await page.locator('#plinput').fill('https://music.163.com/playlist?id=999000123');
await page.locator('#plgo').click();
await page.waitForFunction(()=>!document.querySelector('#plgo').disabled,null,{timeout:90000});
console.log('导入状态:', (await page.locator('#plstat').textContent()).slice(0,80));
console.log('导入后 localStorage keys:', await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('thlyrics.tool.v1')||'{}').imp||{})));
await page.goto(`http://127.0.0.1:8848/#/track/i${SONG}`);
await page.waitForTimeout(900);
await page.locator('#t-sing').click();
await page.waitForTimeout(1500);
const res = await page.evaluate(() => {
  const rows=[];
  for (const block of document.querySelectorAll('#plyric .lblock')) {
    const line = block.querySelector('.line'); if (!line) continue;
    const kids=[...line.children];
    if (kids.length<3) continue;
    const info = kids.map((sp)=>{
      const node=[...sp.childNodes].find(n=>n.nodeType===3 && n.textContent.trim());
      if(!node) return null;
      const rg=document.createRange(); rg.selectNodeContents(node);
      return { s: sp.textContent.trim().slice(0,6), r:(sp.querySelector('.r')||{}).textContent||'', top: Math.round(rg.getBoundingClientRect().top*100)/100 };
    }).filter(Boolean);
    const tops=info.map(x=>x.top);
    const spread=Math.round((Math.max(...tops)-Math.min(...tops))*100)/100;
    rows.push({ text: block.textContent.replace(/\s+/g,' ').slice(0,26), spread, info });
  }
  return rows;
});
const bad = res.filter(r=>r.spread>1);
const cov = await page.evaluate(() => {
  const all=[...document.querySelectorAll('#plyric .w')];
  const w=all.filter(x=>/[\u3041-\u30ff\u4e00-\u9fff]/.test(x.dataset.s || ''));   // 只算真词，空格标点不算
  const noR=w.filter(x=>!(x.querySelector('.r')||{}).textContent?.trim());
  return { n:w.length, no:noR.length, sample:noR.slice(0,18).map(x=>x.dataset.s) };
});
console.log(`罗马音覆盖：${cov.n-cov.no}/${cov.n} = ${Math.round((cov.n-cov.no)/cov.n*100)}%，缺读音的词：${cov.sample.join(' / ')}`);
console.log(`句数 ${res.length}，不齐 ${bad.length} 句`);
bad.slice(0,2).forEach(r=>{ console.log('✗', r.text, r.spread+'px'); console.log('   ', JSON.stringify(r.info)); });
console.log('样例(前 2 句):'); res.slice(0,2).forEach(r=>console.log('  ', r.spread+'px', r.text));
await page.evaluate(() => { const b=[...document.querySelectorAll('#plyric .lblock')].find(x=>/孤独に/.test(x.textContent)); if(b){ b.classList.add('playing'); } });
await page.waitForTimeout(300);
await page.screenshot({path:`/tmp/song-${SONG}.png`});
await b.close();
