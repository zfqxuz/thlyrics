import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HOME=process.env.HOME||'/home/zfq'; const root=HOME+'/.cache/ms-playwright';
const dirs=fs.readdirSync(root).filter(d=>d.startsWith('chromium_headless_shell-')).sort();
const chrome=path.join(root,dirs[dirs.length-1],'chrome-headless-shell-linux64','chrome-headless-shell');
const HERE='/home/zfq/qqbot/thlyrics/.e2e';
const libPath=['root/usr/lib/x86_64-linux-gnu','root/lib/usr/lib/x86_64-linux-gnu','root/usr/lib','root/lib'].map(p=>path.join(HERE,p)).join(':');
const b=await chromium.launch({executablePath:chrome,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'],env:{...process.env,LD_LIBRARY_PATH:libPath}});
const page=await b.newPage({viewport:{width:400,height:850},isMobile:true,hasTouch:true});
page.on('pageerror',e=>console.log('  [pageerror]',e.message));
page.on('console',m=>{ if(m.type()==='error') console.log('  [err]', m.text().slice(0,120)); });
const snap = async (tag) => {
  const s = await page.evaluate(() => {
    const a = document.querySelector('audio');
    return { hash: location.hash, tid: a.getAttribute('data-tid'), src: (a.src||'').slice(-38), paused: a.paused, t: Math.round(a.currentTime*10)/10,
      mini: (document.querySelector('#p-now')||{}).textContent, playerOpen: document.querySelector('#player').classList.contains('on'),
      mode: document.querySelector('#m-loop').classList.contains('on') ? 'loop' : 'all', playing: document.querySelector('#plyric .lblock.playing') ? Number(document.querySelector('#plyric .lblock.playing').dataset.i) : -1 };
  });
  console.log(tag, JSON.stringify(s));
};
// 1) 先放 t1（另一首有 OSS 音频的歌），确认在播
await page.goto('http://127.0.0.1:8848/#/track/t1',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1200);
await page.locator('#playbtn').click();
await page.waitForTimeout(1500);
await snap('放了 t1：');
// 2) 去「幻想」词条页
await page.goto('http://127.0.0.1:8848/#/word/2');
await page.waitForTimeout(700);
await snap('词条页：');
// 3) 点「去这句」
const btn = page.locator('[data-goto]').first();
console.log('按钮:', await btn.textContent(), await btn.getAttribute('data-goto'));
await btn.click();
await page.waitForTimeout(2500);
await snap('点完去这句：');
await page.screenshot({path:'/tmp/goto-after.png'});
await b.close();
