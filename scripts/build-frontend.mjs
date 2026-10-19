#!/usr/bin/env node
/**
 * build-frontend.mjs —— 把前端 19 个 ES 模块打成一个文件（docs/app.bundle.js）
 *
 * 为什么要打：网页版首屏原来是 HTML → app.js → platform/index.js → 12 个 platform 模块
 * 三级串行 import（每级一个往返），再才开始拿 data/index.json。国内到 GitHub Pages
 * 单次往返 0.3~1.4s，三级瀑布就是 1~2s 的纯等待。打成一个文件后首屏只有
 * index.html + app.bundle.js + data/index.json 三个请求，且后两个可以并行。
 *
 * 源码仍然是 docs/ 下那些模块（分层结构不变，`.e2e` 也还按模块 import）；
 * 这个产物只是给浏览器用的发布版。改完前端：node scripts/build-frontend.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const V = (fs.readFileSync(path.join(DOCS, 'version.js'), 'utf8').match(/V\s*=\s*'([^']+)'/) || [])[1];
const MIN = !process.argv.includes('--debug');

/** import 里带 ?v=<version> 是给浏览器破缓存的，打包时要剥掉 */
const stripVer = {
  name: 'strip-version-query',
  setup(build) {
    build.onResolve({ filter: /\?v=/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.split('?')[0]) }));
  },
};

const out = path.join(DOCS, 'app.bundle.js');
const r = await esbuild.build({
  entryPoints: [path.join(DOCS, 'app.js')],
  bundle: true,
  format: 'esm',
  target: ['chrome100', 'safari15'],
  outfile: out,
  minify: MIN,
  legalComments: 'none',
  plugins: [stripVer],
  metafile: true,
  logLevel: 'warning',
});
const kb = (n) => (n / 1024).toFixed(1) + 'KB';
const bytes = fs.statSync(out).size;
const gz = (await import('node:zlib')).gzipSync(fs.readFileSync(out)).length;
console.log(`✓ docs/app.bundle.js  ${kb(bytes)}（gzip ${kb(gz)}）· 版本 ${V}`);
