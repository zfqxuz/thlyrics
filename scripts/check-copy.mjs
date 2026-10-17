#!/usr/bin/env node
/**
 * 交付前文案门禁：扫描 docs/ 里会呈现给用户的字符串。
 * 目标：描述性/解释性/口语化文案不许出现在用户页面上。
 *
 * 做法：先剥掉 JS 注释（注释里的中文不参与），再提取
 *   ① 单/双引号字符串  ② 模板字符串（去掉 ${} 和 HTML 标签）
 * 然后跑禁用词表 + 过长说明句判定。白名单 scripts/copy-allow.txt。
 *
 * 用法：node scripts/check-copy.mjs；失败 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const ALLOW_FILE = path.join(ROOT, 'scripts', 'copy-allow.txt');

// 用户页面禁止出现的描述性/解释性/口语化表达
const BANNED = [
  '嗓子', '教程', '科普', '其实', '也就是说', '意思是', '指的是', '说明', '解释',
  '可能', '建议', '提醒', '例如', '比如', '会自动', '会复制', '用来', '用于',
  '你可以', '如果需要', '因为', '所以', '为了', '断网也能', '放不了', '请稍',
  '系统里已装', '未检测到', '没有检测到', '词表未收录', '我们提供', '稍等',
  '听不懂', '傻瓜', '傻子', '看不懂', '别问', '废话',
];
const ALLOW = fs.existsSync(ALLOW_FILE)
  ? fs.readFileSync(ALLOW_FILE, 'utf8').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))
  : [];
const SKIP = ['docs/data/', 'docs/vendor/', 'docs/icons.js', 'docs/LICENSE-lucide.txt'];   // 第三方库不查文案
const violations = [];
const seen = new Set();

function checkText(file, where, text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!/[\u4e00-\u9fff]/.test(t)) return;
  if (/^[\w\s.,:;!?'"()\-–—/\\+*=%#@&|<>[\]{}]+$/.test(t)) return;   // 纯 ASCII/符号
  if (ALLOW.some((a) => t.includes(a))) return;
  const key = file + '|' + t;
  if (seen.has(key)) return;
  seen.add(key);
  for (const b of BANNED) {
    if (t.includes(b)) { violations.push({ file, where, text: t.slice(0, 90), why: '禁用词「' + b + '」' }); return; }
  }
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk >= 16 && /[。！？；，、]|你|我|请|会|能|可以|需要/.test(t)) {
    violations.push({ file, where, text: t.slice(0, 90), why: '疑似说明性长句（' + cjk + ' 个汉字）' });
  }
}

/** 剥掉 JS 注释，字符串里的 // 和 /* 不误伤 */
function stripJsComments(src) {
  let out = '', i = 0, q = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === q) q = '';
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

function stripExpr(s) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let d = 1; i += 2;
      while (i < s.length && d > 0) { if (s[i] === '{') d++; else if (s[i] === '}') d--; i++; }
      out += ' ';
    } else out += s[i++];
  }
  return out;
}
const looksLikeCode = (t) => /[{};]|=>|\bfunction\b|document\.|window\.|localStorage|addEventListener|return |const |let |\.js|\?v=/.test(t);

function scanJs(file, src) {
  const code = stripJsComments(src);
  let m;
  const quote = /(['"])((?:\\.|(?!\1)[^\\\n])*?)\1/g;   // 单行字符串，不跨行
  while ((m = quote.exec(code))) { if (!looksLikeCode(m[2])) checkText(file, '字符串', m[2]); }
  const tpl = /`((?:\\.|[^`\\])*)`/g;
  while ((m = tpl.exec(code))) {
    const raw = stripExpr(m[1]).replace(/<[^>]*>/g, ' ');
    if (looksLikeCode(raw)) continue;
    for (const frag of raw.split(/[\s\u00a0]+/)) if (frag.trim()) checkText(file, '模板', frag);
  }
}

function scanHtml(file, src) {
  const noCode = src.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  let m;
  const textRe = />([^<>]+)</g;
  while ((m = textRe.exec(noCode))) checkText(file, 'HTML 文本', m[1]);
  const attrRe = /(?:placeholder|title|aria-label|alt)\s*=\s*"([^"]*)"/gi;
  while ((m = attrRe.exec(noCode))) checkText(file, 'HTML 属性', m[1]);
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (SKIP.some((s) => (rel + '/').startsWith(s))) continue;
      walk(p);
      continue;
    }
    if (!/\.(js|html)$/.test(e.name)) continue;
    if (SKIP.some((s) => rel === s)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (e.name.endsWith('.html')) scanHtml(rel, src);
    else scanJs(rel, src);
  }
}

walk(DOCS);
if (violations.length) {
  console.error('✗ 文案门禁未通过（用户页面不许出现描述性/解释性/口语化文案）：');
  for (const v of violations) console.error(`  ${v.file} · ${v.where} · ${v.why}：${v.text}`);
  console.error(`\n共 ${violations.length} 处。改短、改成功能标签；功能性错误提示确实必须的，加进 scripts/copy-allow.txt。`);
  process.exit(1);
}
console.log('✓ 文案门禁通过（无描述性/解释性文案）');
