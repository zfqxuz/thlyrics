/**
 * vocab-extras.mjs —— 词表补录（构建时应用，不要直接改生成出来的 index.json）
 *
 * 来由：分词器把一些词只切成了活用形（歪ん / 振りかざせ / 踊れる），
 * 辞书形本身反而没进词表（歪む / 振りかざす / 踊る）。学词页因此少了一批该有的词。
 *
 * 做法：拿「歌词里出现过、但词表没有」的表面形，逐个查 JMdict（EDRDG，219k 条）——
 *   收录的是辞书形的才补（另 19 个是纯活用形，不该单独收）。
 *   读音与词性取自 JMdict，中文释义据其英文释义转写。
 *
 * 新增条目请照同样格式追加，并在注释里写明依据。
 */
import { kanaToRomaji } from './kana-romaji.mjs';

/** [词形, 读音, 词性, 中文释义] —— 读音/词性来源 JMdict */
export const VOCAB_EXTRAS = [
  ['残る', 'のこる', '動詞', '留下；剩下'],
  ['向う', 'むこう', '名詞', '对面；那边'],
  ['彷徨', 'ほうこう', '名詞', '彷徨；徘徊'],
  ['映す', 'うつす', '動詞', '映出；投影'],
  ['振りかざす', 'ふりかざす', '動詞', '挥舞；高举'],
  ['歪む', 'ゆがむ', '動詞', '扭曲；歪斜'],
  ['逃れ', 'のがれ', '名詞', '逃避；逃脱'],
  ['別れ', 'わかれ', '名詞', '离别；分手'],
  ['戦慄', 'せんりつ', '名詞', '战栗；发抖'],
  ['染め', 'そめ', '名詞', '染色'],
  ['明け', 'あけ', '名詞', '黎明；天亮'],
  ['寄せ', 'よせ', '名詞', '聚集；靠拢'],
  ['感じ', 'かんじ', '名詞', '感觉；印象'],
  ['流れ', 'ながれ', '名詞', '流动；水流'],
  ['果て', 'はて', '名詞', '尽头；极限'],
  ['老い', 'おい', '名詞', '年老；衰老'],
  ['返す', 'かえす', '動詞', '归还；返回'],
  ['目覚め', 'めざめ', '名詞', '醒来；觉醒'],
  ['佇む', 'たたずむ', '動詞', '伫立；站立'],
  ['外れ', 'はずれ', '名詞', '边缘；偏离'],
  ['届け', 'とどけ', '名詞', '送达；申报'],
  ['還す', 'かえす', '動詞', '送回；归还'],
  ['放す', 'はなす', '動詞', '放开；释放'],
];

/** 把补录词并进 vocab（已存在的不动），返回新增条数 */
export function applyVocabExtras(vocab) {
  const have = new Set((vocab || []).map((v) => v.word));
  let id = (vocab || []).reduce((m, v) => Math.max(m, Number(v.id) || 0), 0);
  let n = 0;
  for (const [word, reading, pos, meaning] of VOCAB_EXTRAS) {
    if (have.has(word)) continue;
    id += 1;
    const romaji = kanaToRomaji(reading);
    vocab.push({
      word, surface: word, reading, romaji, pos,
      count: 0, tracks: [],
      forms: { [word]: { reading, readingHira: reading, romaji, tracks: [] } },
      id, diff: 131, meaning, meaningSrc: 'jmdict', hasMeaning: true,
    });
    have.add(word); n += 1;
  }
  return n;
}

export default applyVocabExtras;
