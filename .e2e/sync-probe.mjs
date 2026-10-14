import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const HOME=process.env.HOME||'/home/zfq'; const root=HOME+'/.cache/ms-playwright';
const dirs=fs.readdirSync(root).filter(d=>d.startsWith('chromium_headless_shell-')).sort();
const chrome=path.join(root,dirs[dirs.length-1],'chrome-headless-shell-linux64','chrome-headless-shell');
const HERE='/home/zfq/qqbot/thlyrics/.e2e';
const libPath=['root/usr/lib/x86_64-linux-gnu','root/lib/x86_64-linux-gnu','root/usr/lib','root/lib'].map(p=>path.join(HERE,p)).join(':');
const b=await chromium.launch({executablePath:chrome,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:libPath}});
const page=await b.newPage({viewport:{width:400,height:850}});
page.on('pageerror',e=>console.log('  [pageerror]',e.message));
page.on('console',m=>{ if(m.type()==='error') console.log('  [err]', m.text().slice(0,140)); });
page.on('response', r => { if (/oss-cn-hangzhou|oss-sync/.test(r.url())) console.log('  [net]', r.status(), r.request().method(), r.url().slice(0, 70)); });
await page.goto('http://127.0.0.1:8848/#/mine',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(900);
// 真读一次云端（GET 预签名）
await page.locator('#m-pull').click();
await page.waitForTimeout(2500);
console.log('拉取结果:', await page.evaluate(() => (document.querySelector('#p-state')||{}).textContent));
// 造一条本地导入记录再真写一次云端（PUT 预签名）
await page.evaluate(() => {
  const S = JSON.parse(localStorage.getItem('thlyrics.tool.v1')||'{}');
  S.imp = S.imp || {};
  S.imp['i123456'] = { id:'i123456', nid:'123456', title:'同步自检', artist:'test', album:'', cover:'', plId:'x', plName:'自检', at: Date.now(),
    lines:[{t:1,text:'テスト',zh:'自检'},{t:2,text:'テスト二',zh:'自检2'},{t:3,text:'テスト三',zh:'自检3'}] };
  localStorage.setItem('thlyrics.tool.v1', JSON.stringify(S));
});
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(900);
await page.locator('#m-push').click();
await page.waitForTimeout(2500);
console.log('同步结果:', await page.evaluate(() => (document.querySelector('#p-state')||{}).textContent));
await b.close();
