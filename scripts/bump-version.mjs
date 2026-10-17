#!/usr/bin/env node
/**
 * 推前端版本号：把所有模块 import 和 index.html 上的 `?v=<旧>` 一起改成 `<新>`。
 * 用法：node scripts/bump-version.mjs [新版本号]
 * 不带参数时自动：日期变了 → <今天>a，否则把尾字母 +1（z 之后回到 a 并把…保持同日期）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const VFILE = path.join(DOCS, 'version.js');

const readV = () => (fs.readFileSync(VFILE, 'utf8').match(/V\s*=\s*'([^']+)'/) || [])[1];
// 用本地日期（不能用 toISOString：+08 晚上会算成前一天，版本号反而变小）
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

// 后缀是「字典序递增」的：a…z, za…zz, zza…（不能 z 回绕成 a —— 那样版本号会变小）
function incSuffix(s) {
  const a = s.split('');
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] < 'z') { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); return a.join(''); }
    a[i] = 'a';
  }
  return s + 'a';
}
function next(cur) {
  const m = String(cur).match(/^(\d{8})([a-z]+)$/);
  if (!m) return today() + 'a';
  const [, date, suffix] = m;
  if (today() > date) return today() + 'a';          // 日期往后走了 → 新日期 + a
  return date + incSuffix(suffix);
}

const oldV = readV();
if (!oldV) { console.error('✗ 读不到 docs/version.js 里的 V'); process.exit(1); }
const newV = process.argv[2] || next(oldV);
if (newV === oldV) { console.log(`版本号没变（${oldV}）`); process.exit(0); }

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'data' ? [] : walk(p);
  return /\.(js|html)$/.test(e.name) ? [p] : [];
});

let touched = 0, replaced = 0;
for (const f of walk(DOCS)) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  s = s.split(`?v=${oldV}`).join(`?v=${newV}`);
  if (f === VFILE) s = s.replace(/V\s*=\s*'[^']+'/, `V = '${newV}'`);
  if (s !== before) { fs.writeFileSync(f, s); touched++; replaced += (before.match(new RegExp(`\\?v=${oldV}`, 'g')) || []).length; }
}
console.log(`✓ ${oldV} → ${newV}：改了 ${touched} 个文件、${replaced} 处引用`);
console.log('  别忘了同步 git 提交（Pages 上是按 URL 缓存的）。');
