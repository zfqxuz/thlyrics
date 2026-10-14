#!/usr/bin/env node
/**
 * gen-sync-urls.mjs —— 生成「导入的歌单云端同步」用的预签名地址
 *
 * 纯静态页面没有后端，所以同步走「预签名 URL」：给一个固定对象
 * （sync/imports.json）签一个长期有效的 GET 和一个 PUT 地址，页面拿它直接读写。
 * ⚠️ 这两个地址会写进公开的 docs/，等于任何人拿到都能读写那一个对象（内容只是歌单元数据）。
 *
 * 用法：node scripts/gen-sync-urls.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire('/home/zfq/dev/dsh-plugins/aliyun-oss/');
const OSS = require('ali-oss');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const credPath = process.env.HOME + '/.dsh/aliyun.credentials.yml';
const cred = Object.fromEntries(fs.readFileSync(credPath, 'utf8')
  .split('\n').filter((l) => l.includes(':') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const region = 'oss-cn-hangzhou';
const bucket = 'thlyrics-audio';
const EXPIRES = 315360000;   // 10 年
const client = new OSS({ region, bucket, accessKeyId: cred.accessKeyId, accessKeySecret: cred.accessKeySecret, secure: true });
// PUT 必须把 Content-Type 一起签进去（V1/V4 都是这样），前端上传时要带一样的头
const pair = (key) => ({
  key,
  get: client.signatureUrl(key, { expires: EXPIRES }),
  put: client.signatureUrl(key, { method: 'PUT', expires: EXPIRES, 'Content-Type': 'application/json' }),
});
// 拆成两份：progress 很小（标词/改释义每次都传），imports 很大（只有歌单变了才传）
const imports = pair('sync/imports.json');
const progress = pair('sync/progress.json');
const out = {
  _note: '导入歌单 / 学习记录的云端同步：预签名地址让静态页面直接读写自己 OSS 上的两个对象。由 scripts/gen-sync-urls.mjs 生成，10 年有效。',
  region, bucket,
  expiresAt: new Date(Date.now() + EXPIRES * 1000).toISOString().slice(0, 10),
  imports, progress,
  // 老版本前端用的（指向 imports），保留兼容
  get: imports.get,
  put: imports.put,
};
const dest = path.join(ROOT, 'docs', 'data', 'oss-sync.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1), 'utf8');
console.log('已写', path.relative(ROOT, dest));
for (const [k, v] of [['imports.get', imports.get], ['imports.put', imports.put], ['progress.get', progress.get], ['progress.put', progress.put]]) {
  console.log(k.padEnd(13), v.slice(0, 96) + '…');
}
