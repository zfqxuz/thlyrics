/**
 * 前端版本号（唯一来源）。
 * 改前端后跑一次 `node scripts/bump-version.mjs`，它会把所有模块 import 上的 `?v=` 一起推一位，
 * 同时更新 index.html 与这里的 V —— 用来绕过 GitHub Pages 的 10 分钟静态缓存。
 * DATA_V（data/*.json 的版本）也取自这里，保证两边永远一致。
 */
export const V = '20261019zd';
