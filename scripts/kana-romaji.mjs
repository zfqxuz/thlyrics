/**
 * kana-romaji.mjs —— 假名转罗马音（按音节切分，处理拗音 / 促音 / 长音 / 拨音）
 * 为什么自己写：npm 上的 romanize 等包对日语支持不好（实测全返回空串）。
 * 输出风格：ヘボン式偏训令式折中，贴近 popipa 单词机那种跟读用罗马音。
 */

// 拗音、外来语音节等「两假名 = 一音节」的组合
const DIGRAPHS = {
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo', 'きぇ': 'kye',
  'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho', 'しぇ': 'she',
  'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo', 'じぇ': 'je',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho', 'ちぇ': 'che',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
  'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
  'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
  'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
  'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo', 'ふゅ': 'fyu',
  'てぃ': 'ti', 'てゅ': 'tyu', 'でぃ': 'di', 'でゅ': 'dyu',
  'とぅ': 'tu', 'どぅ': 'du',
  'うぃ': 'wi', 'うぇ': 'we', 'うぉ': 'wo',
  'ゔぁ': 'va', 'ゔぃ': 'vi', 'ゔぇ': 've', 'ゔぉ': 'vo', 'ゔ': 'vu',
  'きぇ': 'kye', 'くぁ': 'kwa', 'くぃ': 'kwi', 'くぇ': 'kwe', 'くぉ': 'kwo',
  'ぐぁ': 'gwa', 'すぃ': 'si', 'ずぃ': 'zi', 'つぁ': 'tsa', 'つぃ': 'tsi',
  'つぇ': 'tse', 'つぉ': 'tso', 'しぃ': 'syi', 'じぃ': 'jyi', 'ちぃ': 'cyi',
  'いぇ': 'ye',
};

// 单假名
const MONO = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o',
  ん: 'n',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
  ゔ: 'vu',
  '　': ' ', ' ': ' ', '・': ' ',
};

/** 只把假名转罗马音，汉字 / 英数原样保留 */
const KANA_RE = /[\u3041-\u309F\u30A0-\u30FF]/;

function katakanaToHiragana(s) {
  return s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 单个假名词 -> 罗马音（输入应为纯假名，片假名会自动转换） */
export function kanaToRomaji(input) {
  const s = katakanaToHiragana(String(input ?? ''));
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];

    // 促音：把下一个音节的辅音叠一次
    if (c === 'っ') {
      const pair = s.slice(i + 1, i + 3);
      const nxt = DIGRAPHS[pair] || MONO[s[i + 1]] || '';
      if (nxt) out += nxt[0] === 'c' ? 't' : nxt[0];
      i += 1;
      continue;
    }

    // 长音符：把前一个音节的元音再重复一次
    if (c === 'ー') {
      const last = out.match(/[aeiou](?!.*[aeiou])/);
      if (last) out += last[0];
      i += 1;
      continue;
    }

    const pair = s.slice(i, i + 2);
    if (DIGRAPHS[pair]) {
      out += DIGRAPHS[pair];
      i += 2;
      continue;
    }

    if (MONO[c] !== undefined) {
      out += MONO[c];
      i += 1;
      continue;
    }

    // 汉字、英文、标点等原样输出
    out += c;
    i += 1;
  }
  return out;
}

/** 句中混着汉字时用这个：只转假名（含长音符）片段，汉字/英文/标点原样保留 */
export function mixedToRomaji(text) {
  return String(text ?? '')
    .split(/([\u3041-\u309F\u30A0-\u30FF]+)/)
    .map((part) => (KANA_RE.test(part) ? kanaToRomaji(part) : part))
    .join('');
}

export default kanaToRomaji;
