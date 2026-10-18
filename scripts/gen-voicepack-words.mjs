#!/usr/bin/env node
/**
 * 生成「词音频包」：把一批单词用在线 TTS 念一遍，存成 mp3 + index.json，打成 zip。
 *
 * 这是**一次性构建**，不是运行时。运行时 App 只从 OSS 下这个包，之后完全离线发音。
 *
 * 用法：node scripts/gen-voicepack-words.mjs <lang> <count> [outdir]
 *   lang   en | ja | fr | de | es | pt | ru | ko
 *   count  取词库里词频最高的多少个词
 *
 * 产出：<outdir>/audio/<sha1>.mp3 · index.json · manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANG = process.argv[2] || 'en';
const COUNT = Number(process.argv[3] || 6000);
const OUT = process.argv[4] || path.join('/tmp', `vp-${LANG}`);
const AUDIO = path.join(OUT, 'audio');
fs.mkdirSync(AUDIO, { recursive: true });

const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const YOUDAO = { en: 'en', ja: 'jap', zh: 'zh', fr: 'fr', de: 'de', es: 'es', pt: 'pt', ru: 'ru', ko: 'ko' };
const BAIDU = { en: 'en', ja: 'jp', zh: 'zh', fr: 'fr', de: 'de', es: 'es', pt: 'pt', ru: 'ru', ko: 'kor' };
// 有道单条更小、且带重音的西文也能出音；百度只作兜底
const PROVIDERS = Object.fromEntries(Object.keys(YOUDAO).map((k) => [k, [
  `https://dict.youdao.com/dictvoice?audio=__T__&le=${YOUDAO[k]}`,
  `https://fanyi.baidu.com/gettts?lan=${BAIDU[k]}&text=__T__&spd=3&source=web`,
]]));

const words = (() => {
  if (LANG === 'ja') {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'index.json'), 'utf8'));
    return [...new Set((idx.vocab || []).map((v) => v.reading || v.word).filter(Boolean))].slice(0, COUNT);
  }
  const lex = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', LANG, 'lexicon.json'), 'utf8'));
  return (lex.entries || []).slice()
    .sort((a, b) => (a.freq || 9e9) - (b.freq || 9e9))
    .map((e) => e.word)
    .filter((w) => w && w.length <= 30)
    .slice(0, COUNT);
})();
console.log(`· ${LANG}：${words.length} 个词 → ${OUT}`);

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FC = 'https://thlyrics-auth-bybvhpggbp.cn-hangzhou.fcapp.run/api/tts';
/** 走自家 FC 代理（对端出网被限流时用；返回 data URL） */
async function ttsViaFc(word, attempt = 0) {
  try {
    const r = await fetch(`${FC}?lang=${encodeURIComponent(LANG)}&text=${encodeURIComponent(word)}`);
    const j = await r.json().catch(() => null);
    const m = /^data:audio\/[a-z0-9.+-]+;base64,(.*)$/i.exec(String(j && j.url || ''));
    if (m) {
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > 800) return buf;
    }
  } catch { /* 重试 */ }
  // 上游限流时 502 很常见：退避重试两次
  if (attempt < 2) {
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    return await ttsViaFc(word, attempt + 1);
  }
  return null;
}

async function tts(word) {
  if (process.env.USE_FC) return await ttsViaFc(word);
  const enc = encodeURIComponent(word);
  for (const tpl of (PROVIDERS[LANG] || [])) {
    const url = tpl.replace('__T__', enc);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://fanyi.baidu.com/' } });
        const type = r.headers.get('content-type') || '';
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && buf.length > 800 && /audio|mpeg|octet/i.test(type)) return buf;
      } catch { /* 换下一个源 */ }
      await sleep(200);
    }
  }
  return null;
}

const files = {};
let ok = 0, fail = 0, done = 0;
const queue = [...words];
const CONC = Number(process.env.CONC || (process.env.USE_FC ? 3 : 6));
const workers = new Array(CONC).fill(0).map(async () => {
  while (queue.length) {
    const w = queue.shift();
    const buf = await tts(w);
    done++;
    if (done % 500 === 0) console.log(`  ${done}/${words.length} 成功 ${ok} 失败 ${fail}`);
    if (!buf) { fail++; continue; }
    const name = sha1(w) + '.mp3';
    fs.writeFileSync(path.join(AUDIO, name), buf);
    files[w] = name;
    ok++;
  }
});
await Promise.all(workers);

const version = new Date().toISOString().slice(0, 10).replace(/-/g, '');
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ files }));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  id: `aliyun-${LANG}`, lang: LANG, kind: 'audio', version,
  engine: 'baidu/youdao tts (one-off build)', count: Object.keys(files).length,
}));
console.log(`✓ ${LANG} 包完成：${Object.keys(files).length} 条音频（失败 ${fail}）→ ${OUT}`);
