#!/usr/bin/env node
/**
 * 分层门禁：防止前端再次腐化成一坨。
 *
 *   core/      纯逻辑：不许碰 DOM / 平台 API，也不许 import platform、ui
 *   platform/  平台适配：不许 import ui，不许直接操作具体 DOM 元素
 *   ui/        视图：不许直接调平台 API（localStorage / fetch / new Audio / indexedDB …）
 *   app.js     组装：同上，一律走 platform/
 *
 * 用法：node scripts/check-layers.mjs   （npm run check）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return (e.name === 'data' || e.name === 'vendor') ? [] : walk(p);   // data/ 与 vendor/（第三方）不参与分层检查
  return e.name.endsWith('.js') ? [p] : [];
});

const layerOf = (file) => {
  const rel = path.relative(DOCS, file).split(path.sep);
  if (rel.length === 1) return 'root';
  if (['core', 'platform', 'ui'].includes(rel[0])) return rel[0];
  return 'root';
};

// 各层禁止出现的 API（正则 + 说明）
const BANNED = {
  core: [
    [/\bdocument\b/, 'DOM'],
    [/\bwindow\b/, '浏览器全局'],
    [/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, '存储'],
    [/\bfetch\s*\(/, '网络'],
    [/\bnew\s+Audio\b/, '音频'],
    [/\bnavigator\b/, '浏览器能力'],
    [/\brequestAnimationFrame\b/, '渲染时序'],
    [/\balert\s*\(|\bconfirm\s*\(/, '交互弹窗'],
  ],
  platform: [
    [/\bgetElementById\b|\bquerySelector\b|\binnerHTML\b/, '具体 DOM 元素（渲染属于 ui/）'],
  ],
  ui: [
    [/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, '存储（请走 platform/kv.js）'],
    [/\bfetch\s*\(/, '网络（请走 platform/net.js）'],
    [/\bnew\s+Audio\b/, '音频（请走 platform/player.js）'],
  ],
  root: [
    [/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, '存储（请走 platform/kv.js）'],
    [/\bfetch\s*\(/, '网络（请走 platform/net.js）'],
    [/\bnew\s+Audio\b/, '音频（请走 platform/player.js）'],
  ],
};

// 允许的 import 方向
const ALLOWED = {
  core: ['core'],
  platform: ['core', 'platform'],
  ui: ['core', 'platform', 'ui'],
  root: ['core', 'platform', 'ui', 'root'],
};

const files = walk(DOCS);
const problems = [];

for (const file of files) {
  const layer = layerOf(file);
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');

  // 语法检查：用 node --check 过一遍（注释里写了 */ 这类低级错误，只有跑起来才发现——
  // 真踩过：块注释里写 ".qmc*/" 会把注释提前结束，整个前端白屏）
  try {
    const tmp = path.join(os.tmpdir(), `tl-check-${process.pid}-${path.basename(file)}.mjs`);
    fs.writeFileSync(tmp, src);
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    fs.unlinkSync(tmp);
  } catch (e) {
    const msg = String(e.stderr || e.message || '').split('\n').slice(0, 3).join(' ').slice(0, 160);
    problems.push(`${rel}: 语法错误 → ${msg}`);
    continue;
  }

  // 去掉注释（保留行号，避免误报 + 报错行号还对得上）
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  for (const [re, why] of BANNED[layer] || []) {
    const lines = code.split('\n');
    lines.forEach((l, i) => { if (re.test(l)) problems.push(`${rel}:${i + 1} 用了${why}：${l.trim().slice(0, 90)}`); });
  }

  const specs = [...code.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specs) {
    const clean = spec.split('?')[0];
    const target = path.resolve(path.dirname(file), clean);
    if (path.basename(target) === 'version.js') continue;   // 共享的版本常量，各层都可以用
    const tl = layerOf(target);
    if (!(ALLOWED[layer] || []).includes(tl)) {
      problems.push(`${rel}: 不允许 import ${layer === 'root' ? 'app' : layer}/ → ${clean}（目标层 ${tl}）`);
    }
  }
}

if (problems.length) {
  console.error(`✗ 分层检查未通过（${problems.length} 处）：\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\n规则见 docs/ 目录约定（core / platform / ui 三层）。');
  process.exit(1);
}
console.log(`✓ 分层检查通过（${files.length} 个前端文件：core / platform / ui / root）`);
