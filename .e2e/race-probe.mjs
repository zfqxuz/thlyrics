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
await page.goto('http://127.0.0.1:8848/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(800);
// 给 t4 绑一个网易云 id（t4 没有 OSS 直链，走「解析地址」路径 = 有竞态的那条）
await page.evaluate(() => { const S = JSON.parse(localStorage.getItem('thlyrics.tool.v1')||'{}'); S.audio = S.audio||{}; S.audio['t4'] = { nid: '752015' }; localStorage.setItem('thlyrics.tool.v1', JSON.stringify(S)); });
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(600);
await page.goto('http://127.0.0.1:8848/#/track/t1');
await page.waitForTimeout(1000);
await page.locator('#playbtn').click();
await page.waitForTimeout(1500);
console.log('开始跳转前:', JSON.stringify(await page.evaluate(()=>{const a=document.querySelector('audio');return {tid:a.getAttribute('data-tid'),paused:a.paused,t:+a.currentTime.toFixed(1)}})));
// 模拟「去这句」：直接改 hash
await page.evaluate(() => { location.hash = '#/track/t4@5'; });
for (let i=0;i<10;i++) {
  await page.waitForTimeout(400);
  console.log('  +'+((i+1)*0.4).toFixed(1)+'s', JSON.stringify(await page.evaluate(()=>{
    const a=document.querySelector('audio');
    return { tid:a.getAttribute('data-tid'), src:(a.src||'').slice(-24), paused:a.paused, t:+a.currentTime.toFixed(1), state:(document.querySelector('#p-state')||{}).textContent, line:(document.querySelector('#plyric .lblock.playing')||{dataset:{}}).dataset.i };
  })));
}
await b.close();
