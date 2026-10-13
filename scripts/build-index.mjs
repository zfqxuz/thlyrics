#!/usr/bin/env node
/**
 * build-index.mjs —— 把 data/raw/*.lrc 解析、分词、汇总成前端可用的 JSON
 *
 * 输入：data/raw/*.lrc（由 fetch-lyrics.mjs 抓取，带 ti/al/ar/cv/re 元数据 + 歌词行）
 * 输出：data/index.json        —— 完整数据集（原曲 / 曲目 / 歌词 / 句子分词 / 词表）
 *       docs/data/index.json    —— 同一份，给静态前端直接 fetch
 *       docs/data/covers/*.jpg  —— 专辑封面（可选，--covers 时下载）
 *
 * 分词：kuromoji（IPADIC），给出 表面形 / 读音假名 / 罗马音 / 辞书形 / 词性。
 * 词表只收「值得背的词」：名词、动词、形容词、副词，过滤助词助动词与单假名虚词。
 *
 * 用法：
 *   node scripts/build-index.mjs            # 只生成 JSON（用已有封面缓存）
 *   node scripts/build-index.mjs --covers   # 顺带下载缺失的封面
 *   node scripts/build-index.mjs --stats    # 额外打印覆盖率/词表统计
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kuromoji from 'kuromoji';
import { kanaToRomaji } from './kana-romaji.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const DATA_DIR = path.join(ROOT, 'data');
const WEB_DATA = path.join(ROOT, 'docs', 'data');
const COVER_DIR = path.join(WEB_DATA, 'covers');
const DICT = path.join(ROOT, 'node_modules', 'kuromoji', 'dict');

/** 读一份可缺省的 JSON（额外词表：标日 / JLPT），坏文件不阻塞构建 */
function RELAXED_JSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

const argv = process.argv.slice(2);
const WANT_COVERS = argv.includes('--covers');
const WANT_STATS = argv.includes('--stats');

// ---------- LRC 解析 ----------
function parseLrc(text) {
  const meta = {};
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^\[([a-z]+):\s*(.*?)\]\s*$/);
    if (m) {
      const [, k, v] = m;
      if (k === 're') (meta.re ??= []).push(v);
      else meta[k] = v;
      continue;
    }
    const t = line.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (t) {
      const sec = Number(t[1]) * 60 + Number(t[2]) + (t[3] ? Number(t[3].padEnd(3, '0')) / 1000 : 0);
      lines.push({ time: Math.round(sec * 100) / 100, text: t[4].trim() });
    }
  }
  return { meta, lines };
}

/** 该文件的时间轴是否真的有信息量（不是全 0） */
function hasRealTiming(lines) {
  const set = new Set(lines.map((l) => l.time));
  return set.size > 2 && Math.max(...set) > 0;
}

/** 曲名去噪，用于把同一首歌的多个版本归到一组 */
function baseTitle(title) {
  return title
    .replace(/\s*[-–—]?\s*(vocal|inst(?:rumental)?|off vocal|カラオケ|インスト)\s*(ver\.?|version)?\s*[-–—]?\s*/gi, '')
    .replace(/\s*\(.*?\)\s*$/, '')  // 去掉结尾的（社团）
    .replace(/\s+ver\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从 mm:ss 行里挑出「歌词行」：去掉纯音乐符号、纯英文行也保留（合唱/rap 里常见） */
function isJapanese(text) {
  return /[\u3041-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
}
// ---------- 辞书形还原 ----------
// kuromoji(IPADIC) 的坑：動詞 的 base_form 对五段动词常常给活用形（知ら / 待っ / 咲い），
// 对一段动词给词干（消え / 見せ），只有本身就等于辞书形时才准。
// 解法：用 conjugated_type / conjugated_form 判断活用类型，自己拼回辞书形。
// 约束：只有「词干带汉字」时才用 kuromoji 的活用信息；纯假名词另有保守规则，
// 否则会把 オド（おどれ 的词干）误判成 オドる 这种不存在的词。

// い段 <-> う段（判断词尾是否同一行时用）
const I_TO_U = { い: 'う', き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', み: 'む', び: 'ぶ', り: 'る' };
const U_TO_I = Object.fromEntries(Object.entries(I_TO_U).map(([i, u]) => [u, i]));
const U_ROW = 'うくすつぬむぶぐ';
const IROW_TO_EROW = { い: 'え', き: 'け', ぎ: 'げ', し: 'せ', じ: 'ぜ', ち: 'て', に: 'ね', ひ: 'へ', び: 'べ', ぴ: 'ぺ', み: 'め', り: 'れ' };

const toHira = (s) => s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const ROW_I = {
  カ: 'き', ガ: 'ぎ', サ: 'し', タ: 'ち', ナ: 'に', バ: 'び',
  マ: 'み', ラ: 'り', ワ: 'い', ハ: 'ひ',
};
const ROW_U = { カ: 'く', ガ: 'ぐ', サ: 'す', タ: 'つ', ナ: 'ぬ', バ: 'ぶ', マ: 'む', ラ: 'る', ワ: 'う' };

/** 纯假名词：这些活用形词尾在日语里足够确定，才敢还原（宁可漏，不可错） */
const KANA_ENDINGS = [
  [/って$/, (s) => (s.endsWith('っ') ? s.slice(0, -1) + 'う' : null)],
  [/った$/, (s) => (s.endsWith('っ') ? s.slice(0, -1) + 'う' : null)],
  [/いた$/, (s) => s + 'く'], [/いて$/, (s) => s + 'く'],
  [/いだ$/, (s) => s + 'ぐ'], [/いで$/, (s) => s + 'ぐ'],
  [/んだ$/, (s) => s + 'む'], [/んで$/, (s) => s + 'む'],
  [/した$/, (s) => (s.endsWith('し') ? s.slice(0, -1) + 'する' : null)],
  [/して$/, (s) => (s.endsWith('し') ? s.slice(0, -1) + 'する' : null)],
  [/き$/, (s) => s + 'く'], [/ぎ$/, (s) => s + 'ぐ'], [/ち$/, (s) => s + 'つ'],
  [/に$/, (s) => s + 'ぬ'], [/み$/, (s) => s + 'む'], [/び$/, (s) => s + 'ぶ'],
  [/り$/, (s) => s + 'る'],
];

// 纯假名动词的不规则/易错词干 -> 辞书形（规则还原会把 なっ 算成 なう，这类必须查表）
const KANA_VERB_FIX = {
  なっ: 'なる', なり: 'なる', なら: 'なる', なれ: 'なる',
  あり: 'ある', あっ: 'ある', あれ: 'ある',
  いら: 'いる', いれ: 'いる', いよ: 'いる',
  いえ: 'いう', いい: 'いう', いっ: 'いう', いわ: 'いう',
  おっ: 'おる', おら: 'おる', おり: 'おる',
  くれ: 'くれる', くれれ: 'くれる',
  しまい: 'しまう', しまっ: 'しまう', しまえ: 'しまう', しまお: 'しまう',
  でき: 'できる', すれ: 'する', しよ: 'する', しろ: 'する',
  こい: 'くる', きま: 'くる',
  わかっ: 'わかる', わから: 'わかる', わかり: 'わかる', わかん: 'わかる', わかれ: 'わかる',
  のぼっ: 'のぼる', のぼり: 'のぼる', のぼれ: 'のぼる',
  まわし: 'まわす', まわっ: 'まわす', かくし: 'かくす', つなご: 'つなぐ',
  とっ: 'とる', とれ: 'とる', はらっ: 'はらう', へこん: 'へこむ',
  やろ: 'やる', やり: 'やる', すい: 'すう', ひい: 'ひく', まどい: 'まどう',
  かみ: 'かむ', どき: 'どく', うっ: 'うつ', おか: 'おく', こぼし: 'こぼす', つい: 'つく',
};

function hiraLemmaFromReading(readingHira) {
  if (KANA_VERB_FIX[readingHira]) return KANA_VERB_FIX[readingHira];
  for (const [re, build] of KANA_ENDINGS) {
    const m = readingHira.match(re);
    if (!m) continue;
    const stem = readingHira.slice(0, -m[0].length);
    if (!stem) continue;
    const dict = build(stem);
    if (dict && dict.length >= 3) return dict;   // 至少 3 拍，免得把 2 拍词切碎
  }
  return null;
}

/**
 * 动词 -> 辞书形。surface/reading 是表面形与读音，info 是 kuromoji token。
 * 拿不准时返回能查到词典的形态（一段动词给词干如「消え」，五段动词给辞书形如「知る」）。
 */
function resolveVerbLemma(surface, reading, info) {
  const base = info.base_form || surface;
  const ct = info.conjugated_type || '';
  const cf = info.conjugated_form || '';
  const readingHira = reading && reading !== '*' ? toHira(reading) : '';
  const hasKanji = /[一-龯]/.test(base);

  if (ct.startsWith('下二') || ct.startsWith('下ー')) {          // 下二段（捧げよ 这类文语残留）
    return cf && cf.startsWith('命令') ? base.slice(0, -1) + 'る' : base;
  }
  if (ct.startsWith('一段')) {
    // 一段动词的活用形：连用形是词干（消え/見せ），命令形是词干+ろ/よ（垂れろ/告げよ）
    if (cf.startsWith('命令')) return base.slice(0, -1) + 'る';
    if (base.endsWith('る')) return base;
    return base + 'る';
  }
  if (ct.startsWith('サ変')) return base.endsWith('する') ? base : base + 'する';
  if (ct.startsWith('カ変')) return base.endsWith('くる') ? base : base + 'くる';

  if (ct.startsWith('五段')) {
    if (cf === '基本形' || cf === '*') return base;                            // 本来就是辞书形
    const row = (ct.split('・')[1] || '').slice(0, 1);
    const uEnd = ROW_U[row];
    if (uEnd && base.length >= 2) {
      // 活用形词尾合法才敢换：五段活用形只可能是 う段 / い段 / あ段 / え段 / お段 / っ
      // （这样 告げよ 的 よ、垂れろ 的 ろ 就不会被当成活用尾，而是当成「词干里本来就有假名」）
      const last = base.slice(-1);
      const legit = (I_TO_U[last] || A2U[last] || O2U[last] || last === uEnd || last === 'っ');
      if (legit && last !== uEnd) return base.slice(0, -1) + uEnd;             // 縫っ -> 縫う / 知ら -> 知る
    }
  }

  // 纯假名（或没有活用信息）：按读音保守还原
  return hiraLemmaFromReading(readingHira || toHira(surface)) || base;
}
/** 纯假名动词（なっ / いら 之类）用读音还原辞书形，比 ler 表面形更靠谱 */
function baseFromKana(lemma, reading) {
  if (!lemma || /[一-龯]/.test(lemma)) return null;
  const r = reading && reading !== '*' ? toHira(reading) : toHira(lemma);
  return hiraLemmaFromReading(r) || null;
}

/** 词表键：动词按「去掉最后一个假名」合并词干形与辞书形，其余用原词形 */
function vocabKey(seg) {
  // 带汉字的动词按「去掉最后一个假名」合并词干形与辞书形；纯假名不切，避免碎片条目
  if (seg.p !== '動詞') return seg.b;
  return /[一-龯]/.test(seg.b) ? seg.b.replace(/[ぁ-ゖー]$/, '') : seg.b;
}


// ---------- 词表过滤（决定哪些词值得做成卡片） ----------
const KEEP_POS = new Set(['名詞', '動詞', '形容詞', '副詞']);
const DROP_POS1 = new Set(['助詞', '助動詞', '記号', '接続詞', '感動詞', 'フィラー', '接頭詞']);
const DROP_WORDS = new Set([
  'こと', 'もの', 'とき', 'ため', 'よう', 'ところ', 'わけ', 'はず', 'つもり', 'まま',
  'それ', 'これ', 'あれ', 'どれ', 'ここ', 'そこ', 'あそこ', 'どこ', 'こんな', 'そんな', 'あんな', 'どんな',
  'いる', 'ある', 'なる', 'する', 'やる', 'くる', 'いく', 'れる', 'られる', 'せる', 'させる', 'くれる', 'あげる', 'もらう',
  'です', 'ます', 'ない', 'たい', 'だ', 'の', 'ん', 'ほう', 'うち', 'とこ',
  'する', 'しする', 'みる', 'るる', 'どー', 'られる', 'させる', 'してる', 'して', 'した', 'すれ',
]);

/** 词性分桶：前端按这个给歌词里的词上色（k 存在每个分词上，不只是词表里的词） */
function posKind(t) {
  switch (t.pos) {
    case '名詞': return t.pos_detail_1 === '形容動詞語幹' ? 'na' : 'n';
    case '動詞': return 'v';
    case '形容詞': return 'a';
    case '副詞': return 'adv';
    case '助詞': return 'prt';
    case '助動詞': return 'aux';
    case '接続詞': return 'conj';
    case '連体詞': return 'rent';
    case '感動詞': return 'int';
    case '接頭詞': return 'pref';
    case '記号': return 'sym';
    default: return 'oth';
  }
}

/** 这个词要不要做进词表 */
function isWorthLearning(t, lemma) {
  if (!KEEP_POS.has(t.pos)) return false;
  if (DROP_POS1.has(t.pos)) return false;
  if (t.pos === '名詞' && ['非自立', '代名詞', '数', '接尾'].includes(t.pos_detail_1)) return false;
  if (['非自立', '接尾', '特殊'].includes(t.pos_detail_1)) return false;
  const base = lemma || t.base_form || t.surface_form;
  if (!base) return false;
  if (DROP_WORDS.has(base)) return false;
  if (base.length <= 1) return false;
  if (!/[ぁ-ゖァ-ヺ一-龯]/.test(base)) return false;                 // 纯英文/数字不要
  if (/^[ぁ-ゖァ-ヺ]$/.test(base)) return false;                     // 单假名不要
  if (/^[ァ-ヺー]+$/.test(base)) return false;                       // 纯片假名外来语先不收
  if (!/[ぁ-ゖ一-龯]/.test(base)) return false;                        // 不含平假名/汉字的不收
  return true;
}

// 表面形读音 -> 词条形读音 的活用规则（先长后短，顺序重要）
const READING_RULES = [
  ['って', (s) => s.slice(0, -1) + 'う'], ['った', (s) => s.slice(0, -1) + 'う'],
  ['いで', (s) => s + 'ぐ'], ['いた', (s) => s + 'く'],
  ['んで', (s) => s + 'む'], ['んだ', (s) => s + 'む'],
  ['して', (s) => s.slice(0, -1) + 'する'], ['した', (s) => s.slice(0, -1) + 'する'],
  ['れて', (s) => s + 'れる'], ['れた', (s) => s + 'れる'],
  ['えて', (s) => s + 'える'], ['えた', (s) => s + 'える'],
  ['けて', (s) => s + 'ける'], ['けた', (s) => s + 'ける'],
  ['せて', (s) => s + 'せる'], ['せた', (s) => s + 'せる'],
  ['てて', (s) => s + 'てる'], ['てた', (s) => s + 'てる'],
];
const IROW_TO_EROW_FULL = { い: 'え', き: 'け', ぎ: 'げ', し: 'せ', じ: 'ぜ', ち: 'て', に: 'ね', ひ: 'へ', び: 'べ', ぴ: 'ぺ', み: 'め', り: 'れ' };

/** 动词读音推导用的常量 */
const KANA = (s) => (s.match(/[ぁ-ゖー]+$/) || [''])[0];
const VRULES = [ // [表面形读音词尾, 辞书形词尾]（按长度降序）
  ['って', 'う'], ['った', 'う'], ['って', 'つ'], ['って', 'る'],
  ['いた', 'く'], ['いで', 'ぐ'], ['いだ', 'ぐ'],
  ['んで', 'む'], ['んだ', 'む'], ['んで', 'ぶ'], ['んだ', 'ぶ'], ['んで', 'ぬ'], ['んだ', 'ぬ'],
  ['して', 'する'], ['した', 'する'], ['する', 'する'], ['し', 'する'],
  ['きて', 'くる'], ['きた', 'くる'], ['くる', 'くる'], ['き', 'くる'],
  ['えた', 'える'], ['えて', 'える'], ['ける', 'ける'], ['せた', 'せる'], ['せて', 'せる'],
  ['れた', 'れる'], ['れて', 'れる'], ['てた', 'てる'], ['てて', 'てる'],
];

/** 五段：い段 -> う段（词尾拧回） */
const I2U = { い: 'う', き: 'く', ぎ: 'ぐ', し: 'す', ち: 'つ', に: 'ぬ', み: 'む', び: 'ぶ', り: 'る' };
const WA2U = { わ: 'う', た: 'つ', ら: 'る', ま: 'む', な: 'ぬ', ば: 'ぶ', か: 'く', が: 'ぐ', さ: 'す' };
const A2U = { あ: 'う', か: 'く', が: 'ぐ', さ: 'す', た: 'つ', な: 'ぬ', ば: 'ぶ', ま: 'む', ら: 'る', わ: 'う' };
const O2U = { お: 'う', こ: 'く', ご: 'ぐ', そ: 'す', と: 'つ', の: 'ぬ', ぼ: 'ぶ', も: 'む', ろ: 'る', を: 'う' };

/**
 * 动词：由 token 推辞书形读音。
 * 规则：
 *   - 表面形已是辞书形（基本形）-> 读音直接用
 *   - 读音词尾是 っ（促音便）-> 促音前的元音决定行（つたわっ -> つたう / ぬっ -> ぬう）
 *   - 读音词尾是 い段 -> 拧回う段（しら -> しる / おどり -> おどる）
 *   - 读音词尾是 え段 -> 一段，补 る（とどけ -> とどける）
 *   - 其余按活用形规则表补（きこえ -> きこえる）
 */
function verbLemmaReading(tk, lemma) {
  const sr = tk.reading && tk.reading !== '*' ? toHira(tk.reading) : '';
  if (!sr) return '';
  const base = tk.base_form || tk.surface_form || '';
  const stemKana = KANA(base);
  const w = lemma.slice(-1);

  if ((tk.conjugated_form || '') === '基本形') return sr;
  // 促音便最优先（伝わっ -> つたう、縫っ -> ぬう）：促音前一拍的元音决定行，但要和词条尾对得上
  if (sr.slice(-1) === 'っ') {
    const prev = sr.slice(-2, -1);
    const d = I2U[prev] || A2U[prev] || WA2U[prev] || O2U[prev];
    // 词条形是「汉字 + 那个假名」（縫う / 経つ）时直接砍掉促音前的假名；
    // 词条形以多假名结尾（伝わる / 想う 的词干含假名）时，只砍促音、保留假名
    if (d === w) return sr.slice(0, -2) + d;
    // 促音前一拍的元音其实要由词条尾决定（縫っ + 詞条 縫う -> ぬう）
    if (stemKana.length === 1) {
      const lemmaKana = KANA(lemma);
      const lEnd = lemmaKana.slice(-1);
      const prevRows = { う: A2U, く: I2U, す: I2U, つ: I2U, ぬ: I2U, む: I2U, ぶ: I2U, る: I2U };
      const tbl = prevRows[lEnd] || A2U;
      if (tbl[prev]) return sr.slice(0, -2) + tbl[prev];
      return sr.slice(0, -1);
    }
  }
  if (stemKana && sr.endsWith(stemKana) && stemKana.length > 1) return sr;

  // 词条形 = 汉字 + 单个假名（知る / 壊す / 咲く / 縫う）
  if (stemKana.length === 1) {
    const t = sr.slice(-1);
    if (w === 'る') {
      if (t === 'る') return sr;
      if (sr.length === 1) return sr + 'る';                 // 見 -> みる
      if (I2U[t]) return sr.slice(0, -1) + I2U[t];           // しら -> しる / おどり -> おどる
      return sr + 'る';                                      // とどけ -> とどける
    }
    if (t === 'っ') return sr.slice(0, -2) + (WA2U[sr.slice(-2, -1)] || A2U[sr.slice(-2, -1)] || I2U[sr.slice(-2, -1)] || 'う');
    if (I2U[t]) return sr.slice(0, -1) + I2U[t];             // 壊そ -> こわす
    if (A2U[t]) return sr.slice(0, -1) + A2U[t];
    if (O2U[t]) return sr.slice(0, -1) + O2U[t];
    return sr.slice(0, -1) + w;
  }

  // 词条形以整段假名结尾（伝わる / 消える / 見せる / 咲き誇る）
  for (const [form, dict] of VRULES) {
    if (sr.endsWith(form)) return sr.slice(0, -form.length) + dict;
  }
  const t = sr.slice(-1);
  if (t === 'っ') return sr.slice(0, -2) + (WA2U[sr.slice(-2, -1)] || A2U[sr.slice(-2, -1)] || I2U[sr.slice(-2, -1)] || 'う');
  if (I2U[t] && I2U[t] === w) return sr.slice(0, -1) + w;
  if (sr.slice(-1) !== w && sr.length > 1) return sr.slice(0, -1) + w;
  return sr;
}

/**
 * 由「词条形 + 表面形读音」推词条读音。
 * 三档处理（用「词条形最后一段假名」当依据）：
 *   读音比词条形少一拍 -> 补上词条形的假名尾巴（とどけ -> とどける、縫っ -> ぬう）
 *   两边长度一致       -> 只把最后一个音节的元音拧成词条形的（知ら -> しる、壊そ -> こわす）
 *   读音多一拍         -> 砍掉活用尾巴（わらっ -> わらう）
 */
function lemmaReadingFor(lemma, surfaceReading) {
  if (!lemma) return surfaceReading || '';
  if (/^[ぁ-ゖー]+$/.test(lemma)) return lemma;                 // 词条本身就是假名
  if (!surfaceReading) return '';

  const m = lemma.match(/[ぁ-ゖー]+$/);
  const tail = m ? m[0] : '';
  if (!tail) return surfaceReading;

  const wEnd = tail.slice(-1);
  const smoothVowel = (r) => {
    const t = r.slice(-1);
    if (t === wEnd) return r;
    if (I_TO_U[t] && I_TO_U[t] === wEnd) return r.slice(0, -1) + wEnd;
    if (U_TO_I[t] && U_TO_I[t] === wEnd) return r.slice(0, -1) + wEnd;
    if (I_TO_U[wEnd] && I_TO_U[wEnd] === t) return r.slice(0, -1) + I_TO_U[t];
    return r;
  };
  const diff = tail.length - surfaceReading.length;   // 只看假名段的长度差，不能拿汉字算
  let out = surfaceReading;
  if (diff === 1) out = surfaceReading + tail;                 // 少一拍：补词条尾
  else if (diff === 0) out = smoothVowel(surfaceReading);      // 同长：拧元音
  else if (diff === -1) out = smoothVowel(surfaceReading.slice(0, -1));  // 多一拍：砍活用尾
  else {
    for (const [form, build] of READING_RULES) {
      if (surfaceReading.endsWith(form)) { out = build(surfaceReading); break; }
    }
    if (out === surfaceReading) out = smoothVowel(surfaceReading);
  }
  return out;
}

/** 从若干个「表面形读音」里挑出与词条主形匹配、并尽量还原成辞书形读音的那一个 */
function pickReading(word, readings) {
  if (!word || !readings.length) return '';
  const w = word.slice(-1);
  const sameRow = (a, b) => a === b || I_TO_U[a] === b || (a === 'っ' && U_TO_I[b]);

  const out = [];
  for (const r of readings) {
    // ⓪ 词条以 る 结尾、读音却是「词干」（とどけ / かんじ / わすり）：
    // 一段动词补 る；五段动词把词尾拧回同一行（とどか -> とどく）
    if (w === 'る' && r.slice(-1) !== 'る' && r.length + 1 === word.length) {
      const t = r.slice(-1);
      // え段结尾（とどけ）或 い段结尾（かんじ / わすり）：一段动词，补 る（い段先把词尾拧回え段）
      if (IROW_TO_EROW[t]) out.push(r.slice(0, -1) + IROW_TO_EROW[t] + 'る');
      else if ('えけげせぜてでべぺめねれ'.includes(t)) out.push(r + 'る');
      // あ段结尾（とどか / ひか）：五段动词，拧回う段
      else if (I_TO_U[t]) out.push(r.slice(0, -1) + I_TO_U[t]);
    }
    const tail = r.slice(-1);
    // ① 读音长度和词形一致：词尾同行就算匹配（知ら/知る、咲い/咲く、まっ/待つ）
    if (r.length === word.length && sameRow(tail, w)) { out.push(r); continue; }
    // ② 词条以 る 结尾、读音少一拍：补 る（とどけ/届ける、ひか/光る）
    if (w === 'る' && r.length + 1 === word.length) { out.push(r + 'る'); continue; }
    // ③ 读音本身和词形一样（かえる/帰る）
    if (r === word) out.push(r);
  }

  let best = out.sort((a, b) => b.length - a.length).find((x) => x.length === word.length)
    || out.sort((a, b) => b.length - a.length)[0]
    || readings.slice().sort((a, b) => b.length - a.length)[0];

  // 收尾：词尾不同行就拧一次（まっ/待つ -> まつ、わらわ/笑う -> わらう）
  if (best.length === word.length && best.slice(-1) !== w) {
    const t = best.slice(-1);
    if (I_TO_U[t]) best = best.slice(0, -1) + I_TO_U[t];
    else if (t === 'っ') best = best.slice(0, -1) + (U_TO_I[w] || 'う');
    else if (U_TO_I[w]) best = best.slice(0, -1) + U_TO_I[w];
  }
  return best;
}

/** い形容词的辞书形：い / かっ / く / けれ / さ / そう 等活用形都收回来 */
function adjDictForm(word) {
  if (!word) return word;
  if (/い$/.test(word)) return word;
  if (/[かきくけこし]っ$/.test(word)) return word.slice(0, -1) + 'い';
  if (/[くき]$/.test(word)) return word.slice(0, -1) + 'い';
  if (/[けれ]$/.test(word)) return word.slice(0, -1) + 'い';
  if (/さ$/.test(word)) return word.slice(0, -1) + 'い';
  return word;
}

// ---------- 主流程 ----------
async function main() {
  if (!fs.existsSync(RAW_DIR)) throw new Error(`没有找到 ${RAW_DIR}，先跑 fetch-lyrics.mjs`);
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.lrc'));
  if (!files.length) throw new Error('data/raw 里没有 .lrc');

  const tokenizer = await new Promise((resolve, reject) =>
    kuromoji.builder({ dicPath: DICT }).build((err, t) => (err ? reject(err) : resolve(t)))
  );

  const tracks = [];
  const seenText = new Map(); // 去重：同一份歌词的多个条目（-Vocal- 等）
  const vocabMap = new Map();

  for (const file of files.sort()) {
    const full = path.join(RAW_DIR, file);
    const { meta, lines } = parseLrc(fs.readFileSync(full, 'utf8'));
    if (!lines.length) continue;

    const title = (meta.ti || file.replace(/\.lrc$/, '')).trim();
    const body = lines.map((l) => l.text);
    const fingerprint = body.join('\n');
    if (seenText.has(fingerprint)) continue;
    seenText.set(fingerprint, title);

    const artist = (meta.ar || '').trim();
    const album = (meta.al || '').trim();
    const timing = hasRealTiming(lines);

    // 逐行分词
    const outLines = lines.map((l) => {
      if (!l.text) return { t: l.time, text: '', segs: [] };
      const tokens = tokenizer.tokenize(l.text);
      const segs = [];
      let cursor = 0;
      for (const tk of tokens) {
        const surf = tk.surface_form;
        const idx = l.text.indexOf(surf, cursor);
        if (idx < 0) continue;
        if (idx > cursor) segs.push({ s: l.text.slice(cursor, idx), w: false });
        cursor = idx + surf.length;
        const reading = tk.reading && tk.reading !== '*' ? tk.reading : '';
        // 词表键：动词/形容词用辞书形（kuromoji 的 base_form 对五段常给表面形、对一段给词干，靠不住）
        let lemma = tk.base_form || surf;
        if (tk.pos === '動詞') {
          // kuromoji 认得活用类型时直接信它（一段/サ変/カ変 的 base_form 就是词干，补上词尾即可），
          // 只有认不出（conjugated_type 是 '*'）才自己按活用形拼辞书形。
          const ct0 = tk.conjugated_type || '';
          if (ct0 && ct0 !== '*') lemma = resolveVerbLemma(surf, reading, tk) || lemma;
          else lemma = baseFromKana(lemma, reading) || lemma;
        } else if (tk.pos === '形容詞') {
          lemma = adjDictForm(tk.base_form || surf) || lemma;
        }
        // 词条读音：用「表面形读音 + 词条形」推。kuromoji 的 reading 是表面形的读音
        // （咲い -> サイ、縫っ -> ヌッ），要按词条形的词尾把结尾拧到同一行（-> さく / ぬう）
        const surfaceReading = reading ? toHira(reading) : '';
        // 一段/五段动词的读音一律由「表面形读音」推，不能用已经变形过的读音
        // 词条读音一律由「表面形读音 + 活用信息」推（lemmaReadingFor 只作兜底）
        const lemmaReading = /^[ぁ-ゖー]+$/.test(lemma)
          ? lemma
          : (tk.pos === '動詞'
            ? (verbLemmaReading(tk, lemma) || lemmaReadingFor(lemma, surfaceReading))
            : (surfaceReading || lemmaReadingFor(lemma, surfaceReading)));
        // 段级最终校验：读音短得不像话（缝っ 只抓到促音前一拍）时，按词条形补全
        let fixedReading = lemmaReading;
        if (tk.pos === '動詞' && fixedReading.length < 2 && lemma.length >= 2) {
          const lKana = (lemma.match(/[ぁ-ゖー]+$/) || [''])[0];
          if (lKana.length === 1) {
            const wEnd = lKana;
            const tbl = { う: A2U, く: I2U, す: I2U, つ: I2U, ぬ: I2U, む: I2U, ぶ: I2U, る: I2U }[wEnd] || A2U;
            const prev = fixedReading.slice(0, -1).slice(-1) || fixedReading.slice(-1);
            fixedReading = fixedReading.slice(0, -1) + (tbl[prev] || wEnd);
          }
        }
        const learn = isWorthLearning(tk, lemma);
        segs.push({
          s: surf,
          k: posKind(tk),
          w: learn,
          b: learn ? lemma : undefined,
          l: learn ? fixedReading || undefined : undefined,
          r: reading || undefined,
          y: fixedReading ? kanaToRomaji(fixedReading) : undefined,
          p: learn ? tk.pos : undefined,
        });
      }
      if (cursor < l.text.length) segs.push({ s: l.text.slice(cursor), w: false });
      // 整行罗马音：词用词典读音转写，空格/标点原样
      const lineRomaji = segs
        .map((sg) => (sg.w || sg.r ? sg.y || kanaToRomaji(sg.s) : kanaToRomaji(sg.s)))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      return { t: l.time, text: l.text, jp: isJapanese(l.text), romaji: lineRomaji, segs };
    });

    const id = `t${tracks.length + 1}`;
    tracks.push({
      id,
      title,
      base: baseTitle(title),
      artist,
      album,
      cover: meta.cv || '',
      timing,
      lineCount: outLines.filter((l) => l.text).length,
      raw: path.relative(ROOT, full),
      source: (meta.re || []).find((r) => r.startsWith('THBWiki')) || '',
      lines: outLines,
    });

    // 汇总词表
    for (const line of outLines) {
      for (const seg of line.segs) {
        if (!seg.w) continue;

        // 动词会出现两种形态：还原到辞书形（知る）和只还原到词干（知ら）。
        // 用「去掉最后一个假名」当合并键，把两者并成一张卡；带汉字的形态优先。
        if (!seg.b) continue;                 // 被词表过滤掉的分词不参与合并
        const key = vocabKey(seg);

        let v = vocabMap.get(key);
        if (!v) {
          v = {
            word: seg.b,
            surface: seg.s,
            reading: seg.l || seg.r || '',
            romaji: seg.l ? kanaToRomaji(seg.l) : seg.y || '',
            pos: seg.p || '',
            count: 0, tracks: [], forms: {},
          };
          vocabMap.set(key, v);
        }
        // 主形统一在合并后重算（见循环结束后的 finalize），这里先记下候选
        v._cands = v._cands || [];
        v._cands.push({ b: seg.b, s: seg.s, l: seg.l || '', r: seg.r || '' });
        v.count++;
        if (v.tracks[v.tracks.length - 1] !== id) v.tracks.push(id);
        const fk = seg.s;
        const fReading = seg.l || seg.r || '';
        if (!v.forms[fk]) v.forms[fk] = { reading: seg.r || '', readingHira: seg.l || '', romaji: fReading ? kanaToRomaji(fReading) : '', tracks: [id] };
        else if (!v.forms[fk].tracks.includes(id)) v.forms[fk].tracks.push(id);
      }
    }
    }

  // 词条主形与读音（最后一道工序）
  // 动词：同一词有多个活用形（縫っ/縫う、知ら/知る），挑汉字最多最长的当主形，读音用「段上算好的读音」投票；
  // 非动词（名词/形容词/副词）：段上的读音本来就是对的，直接取出现最多的那个，不做任何「拧词尾」的加工。
  for (const v of vocabMap.values()) {
    const cands = v._cands || [];
    delete v._cands;
    if (!cands.length) continue;

    let best = null;
    for (const c of cands) {
      const score = (/[一-龯]/.test(c.b) ? 10 : 0) + Math.min(c.b.length, 9);
      if (!best || score > best.score) best = { ...c, score };
    }
    const word = best.b;
    v.word = word;
    v.surface = best.s;

    const tally = new Map();
    for (const c of cands) {
      const r = toHira(c.l || '');
      if (!r) continue;
      const t = tally.get(r) || { r, n: 0 };
      t.n++;
      tally.set(r, t);
    }
    const list = [...tally.values()].sort((a, b) => b.n - a.n);

    if (v.pos === '動詞') {
      let winner = null;
      for (const t of list) {
        const tail = t.r.slice(-1), wEnd = word.slice(-1);
        const score = (t.r.length === word.length ? 3 : 0) + (tail === wEnd ? 4 : 0) + (!(tail === wEnd) && I_TO_U[tail] === wEnd ? 2 : 0) + Math.min(t.n, 5) / 10;
        if (!winner || score > winner.score) winner = { ...t, score };
      }
      let reading = toHira((winner && winner.r) || best.l || best.r || '');
      // 只是最后一道保险：词尾读不出来时，至少和词形同字
      if (reading && reading.slice(-1) !== word.slice(-1) && reading.length === word.length && I_TO_U[reading.slice(-1)] === word.slice(-1)) {
        reading = reading.slice(0, -1) + word.slice(-1);
      }
      if (reading.length < 2 && word.length >= 2 && !/[一-龯]/.test(word.slice(-1))) reading = reading.slice(0, -1) + word.slice(-1);
      v.reading = reading;
    } else {
      let r = toHira((list[0] && list[0].r) || best.l || best.r || '');
      // 形容词一定是 い 结尾（優しく -> やさしい），词尾不同就按 い 收尾
      if (v.pos === '形容詞' && /い$/.test(word) && !/い$/.test(r) && /[一-龯]/.test(word)) r = r.slice(0, -1) + 'い';
      v.reading = r;
    }
    // 读音一致性修复：动词/形容词的词尾读音必须和词形尾部假名对得上，
    // 否则（老いる -> おう、分かる -> わから）用「同汉字前缀的形态」把词干读音抠出来拼回去。
    if (v.pos === '動詞' || v.pos === '形容詞') {
      const wm = /^([一-龯]+)([ぁ-ゖー]+)$/.exec(v.word);
      if (wm && v.reading && !v.reading.endsWith(wm[2])) {
        for (const c of cands) {
          const sm = /^([一-龯]+)([ぁ-ゖー]*)$/.exec(c.s || '');
          if (!sm || sm[1] !== wm[1]) continue;
          const cr = toHira(c.r || c.l || '');
          if (!cr) continue;
          if (sm[2] && !cr.endsWith(sm[2])) continue;
          const stemRead = sm[2] ? cr.slice(0, cr.length - sm[2].length) : cr;
          if (!stemRead) continue;
          v.reading = stemRead + wm[2];
          break;
        }
      }
    }
    v.romaji = v.reading ? kanaToRomaji(v.reading) : '';
  }

  // 收尾清理：命令形残留（告げよ / くれよ 被当成词条）和明显读不通的碎片
  for (const [k, v] of [...vocabMap.entries()]) {
    if (v.pos === '動詞') {
      // 命令形（告げよ/くれよ/捧げよ）被当成词条：把词形和形态表都改成辞书形
      const fixYo = (x) => (/よ$/.test(x) && !/よう$/.test(x) ? x.slice(0, -1) + 'る' : x);
      const nw = fixYo(v.word);
      if (nw !== v.word) { v.word = nw; v.reading = fixYo(v.reading || ''); v.romaji = kanaToRomaji(v.reading); }
      const nf = {};
      for (const [k2, val] of Object.entries(v.forms || {})) nf[fixYo(k2)] = val;
      v.forms = nf;
      // 一段命令形残留（垂れろ -> 垂れる）
      const fixRo = (x) => (/[\u3041-\u3096\u4e00-\u9faf]ろ$/.test(x) && !/いろ$|ころ$|しろ$/.test(x) ? x.slice(0, -1) + 'る' : x);
      const nw2 = fixRo(v.word);
      if (nw2 !== v.word) { v.word = nw2; v.reading = fixRo(v.reading || ''); v.romaji = kanaToRomaji(v.reading); }
      const nf2 = {};
      for (const [k2, val] of Object.entries(v.forms || {})) nf2[fixRo(k2)] = val;
      v.forms = nf2;
      // 读音也要一起清（垂れる / たれろ）
      const fixRoR = (x) => (/[\u3041-\u3096]ろ$/.test(x) ? x.slice(0, -1) + 'る' : x);
      const nr = fixRoR(v.reading || '');
      if (nr !== v.reading) { v.reading = nr; v.romaji = kanaToRomaji(nr); }
      const nf3 = {};
      for (const [k2, val] of Object.entries(v.forms || {})) {
        nf3[k2] = Object.assign({}, val, { readingHira: fixRoR(val.readingHira || ''), romaji: kanaToRomaji(fixRoR(val.readingHira || '')) });
      }
      v.forms = nf3;
      if (/よる$/.test(v.word) && !/[一-龯]/.test(v.word)) { /* 纯假名残留，下面单独删 */ }
    }
    if (v.word === 'よる' && v.pos === '動詞') { vocabMap.delete(k); continue; }
    if (v.word === 'げろ') { vocabMap.delete(k); continue; }
  }

  // 词表排序：出现曲数多的优先，其次总频次
  const vocab = [...vocabMap.values()].sort(
    (a, b) => b.tracks.length - a.tracks.length || b.count - a.count || a.word.localeCompare(b.word, 'ja')
  );
  vocab.forEach((v, i) => (v.id = i + 1));

  // ---- 难度标注：标日课次（最优先）→ JLPT 等级 → 曲库常见度 ----
  const brTable = RELAXED_JSON(path.join(DATA_DIR, 'biaori.json'));
  const jlptTable = RELAXED_JSON(path.join(DATA_DIR, 'jlpt.json'));
  let withBr = 0, withJl = 0;
  const HAS_KANJI = /[一-龯]/;
  for (const v of vocab) {
    // 只认「词形完全一致」，或用读音对齐且至少有一边是纯假名写法。
    // 不加这个护栏会撞音误配：老いる(おう) 会撞上《标日》第一课的「王(おう)」。
    const bw = brTable.words && brTable.words[v.word];
    let b = bw || null;
    if (!b && v.reading && !HAS_KANJI.test(v.word)) {
      // 只用读音对齐、而且我们这边是纯假名写法（こそあど类）。
      // 汉字词绝不用读音对齐：はやし(林) 会撞上同音的囃子，标成「第一课」就是误导。
      b = brTable.words[v.reading] || null;
    }
    if (b) { v.br = { c: b.course, bk: b.book, l: b.lesson }; if (b.zh) v.brZh = b.zh; withBr++; }
    const jw = jlptTable.words && jlptTable.words[v.word];
    let j = jw || null;
    if (!j && v.reading && !HAS_KANJI.test(v.word)) j = jlptTable.words[v.reading] || null;
    if (j) { v.jl = j.level; withJl++; }
  }
  // diff 是「从易到难」的排序键：越小越简单。
  //   1-80     标日课次（初级上 1-24 / 初级下 25-48 / 中级上 49-64 / 中级下 65-80）
  //   81-130   标日没收的：按 JLPT 等级分层（N5 最前，N1 最后）
  //   131+     既没进标日也没进 JLPT 的：按在曲库里的常见度排（越常见越靠前）
  const tiers = new Map();
  for (const v of vocab) {
    const t = v.br ? v.br.c : v.jl ? 80 + (5 - v.jl) * 10 : 131;
    if (!tiers.has(t)) tiers.set(t, []);
    tiers.get(t).push(v);
  }
  for (const [t, list] of tiers) {
    list.sort((a, b) => b.count - a.count || b.tracks.length - a.tracks.length || a.word.localeCompare(b.word, 'ja'));
    list.forEach((v, i) => { v.diff = Math.round((t + i / Math.max(1, list.length)) * 1000) / 1000; });
  }
  console.log(`难度标注：标日 ${withBr} 词 · JLPT ${withJl} 词 · 共 ${vocab.length} 词`);

  // 曲目里带上这首歌的词表 id，方便歌词模式查词
  for (const tr of tracks) {
    const ids = new Set();
    for (const line of tr.lines) {
      for (const seg of line.segs) {
        if (!seg.w) continue;
        const v = vocabMap.get(vocabKey(seg));
        if (v && v.id) ids.add(v.id);
      }
    }
    tr.vocabIds = [...ids].sort((a, b) => a - b);
  }

  // 按原曲分组
  const byBase = new Map();
  for (const tr of tracks) {
    if (!byBase.has(tr.base)) byBase.set(tr.base, []);
    byBase.get(tr.base).push(tr.id);
  }
  const originals = [...byBase.entries()]
    .map(([name, ids]) => ({ name, tracks: ids }))
    .sort((a, b) => b.tracks.length - a.tracks.length);

  const index = {
    generatedAt: new Date().toISOString(),
    source: 'THBWiki歌词服务 https://lyrics.thwiki.cc （仅供个人学习）',
    stats: {
      tracks: tracks.length,
      withTiming: tracks.filter((t) => t.timing).length,
      lines: tracks.reduce((n, t) => n + t.lineCount, 0),
      vocab: vocab.length,
      withBiaori: withBr,
      withJlpt: withJl,
      originals: originals.length,
    },
    originals,
    tracks,
    vocab,
  };

  fs.mkdirSync(WEB_DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index), 'utf8');
  fs.writeFileSync(path.join(WEB_DATA, 'index.json'), JSON.stringify(index), 'utf8');

  // 封面（可选）
  if (WANT_COVERS) {
    fs.mkdirSync(COVER_DIR, { recursive: true });
    let got = 0;
    for (const tr of tracks) {
      if (!tr.cover) continue;
      const name = tr.id + '.jpg';
      const dest = path.join(COVER_DIR, name);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
        tr.coverFile = 'covers/' + name;
        continue;
      }
      try {
        const res = await fetch(tr.cover, { headers: { 'User-Agent': 'thlyrics-learning-tool/0.1' } });
        if (res.ok) {
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
          tr.coverFile = 'covers/' + name;
          got++;
        }
      } catch { /* 封面失败不影响主流程 */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    fs.writeFileSync(path.join(WEB_DATA, 'index.json'), JSON.stringify(index), 'utf8');
    console.log(`封面：本次下载 ${got} 张 -> ${path.relative(ROOT, COVER_DIR)}`);
  } else {
    for (const tr of tracks) {
      if (tr.cover && fs.existsSync(path.join(COVER_DIR, tr.id + '.jpg'))) tr.coverFile = `covers/${tr.id}.jpg`;
    }
    fs.writeFileSync(path.join(WEB_DATA, 'index.json'), JSON.stringify(index), 'utf8');
  }

  const s = index.stats;
  console.log(`曲目 ${s.tracks}（有时间轴 ${s.withTiming}）· 歌词行 ${s.lines} · 词表 ${s.vocab} · 原曲组 ${s.originals}`);
  console.log(`输出：${path.relative(ROOT, path.join(DATA_DIR, 'index.json'))} + docs/data/index.json`);

  if (WANT_STATS) {
    console.log('\n出现最广的 15 个词：');
    vocab.slice(0, 15).forEach((v) => console.log(`  ${v.word}（${v.reading} / ${v.romaji}）${v.pos} · ${v.tracks.length} 首歌 · ${v.count} 次`));
    console.log('\n原曲分组（前 10）：');
    originals.slice(0, 10).forEach((o) => console.log(`  ${o.name} -> ${o.tracks.length} 个版本`));
  }
}

main().catch((e) => {
  console.error('构建失败:', e);
  process.exit(1);
});
