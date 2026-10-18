/**
 * 屈折形生成：给词条补“歌词里真正出现的活用形/复数/格变化”，
 * 生成出来的形只在词库里没有独立词条时才挂成别名，避免把真实词条盖掉。
 *
 * 只做规则明确、错误率低的形态：动词变位、名词复数、形容词性数格、韩语助词。
 * 不规则形（être→suis、ir→voy、идти→шёл）不在这里编；那些由词库自带的活用条目补。
 */
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

/** 韩文音节：拆出元音，决定 아/어 的连接 */
function koJoin(stem, end) {
  const last = stem[stem.length - 1];
  const code = last ? last.codePointAt(0) : 0;
  if (code < 0xac00 || code > 0xd7a3) return stem + end;
  const vowel = Math.floor(((code - 0xac00) % 588) / 28);
  const hasJong = (code - 0xac00) % 28 !== 0;
  // ㅏ(0) ㅗ(8) → 아，其余 → 어
  const harmony = (vowel === 0 || vowel === 8) ? '아' : '어';
  const pick = end === '아/어' ? harmony : end;
  if (pick === harmony) return hasJong ? stem + harmony : stem + harmony;
  return stem + pick;
}

export function genForms(lang, v) {
  const w = String(v.word || '').toLowerCase();
  const pos = String(v.pos || '');
  if (!w || w.length < 2) return [];
  const out = [];
  const verb = /動詞|verb/.test(pos);
  const noun = /名詞|noun/.test(pos);
  const adj = /形容詞|形容|adj/.test(pos);
  if (lang === 'fr') {
    if (verb) {
      if (w.endsWith('er') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'e', s + 'es', s + 'ons', s + 'ez', s + 'ent', s + 'ais', s + 'ait', s + 'ions', s + 'iez', s + 'aient',
          s + 'ai', s + 'as', s + 'a', s + 'âmes', s + 'âtes', s + 'èrent', s + 'é', s + 'ée', s + 'és', s + 'ées',
          s + 'ant', s + 'erai', s + 'eras', s + 'era', s + 'erons', s + 'erez', s + 'eront');
      } else if (w.endsWith('ir') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'is', s + 'it', s + 'issons', s + 'issez', s + 'issent', s + 'issais', s + 'issait', s + 'i', s + 'ie', s + 'issant', s + 'irai', s + 'ira');
      } else if (w.endsWith('re') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 's', s + 't', s + 'ons', s + 'ez', s + 'ent', s + 'ais', s + 'ait', s + 'u', s + 'ue', s + 'us', s + 'ues', s + 'ant', s + 'rai', s + 'ra');
      }
    }
    if (noun || adj) out.push(w + 's');
    if (adj) out.push(w + 'e', w + 'es');
  } else if (lang === 'de') {
    if (verb && w.endsWith('en') && w.length > 3) {
      const s = w.slice(0, -2);
      out.push(s + 'e', s + 'st', s + 't', s + 'en', s + 'te', s + 'test', s + 'ten', s + 'tet', s + 'end');
    }
    if (noun) {
      out.push(w + 'e', w + 'en', w + 'n', w + 'er', w + 's', w + 'nen', w + 'es');
      // 变音复数（Haus→Häuser、Mutter→Mütter）
      if (/[aou]/.test(w)) out.push(w.replace(/a/, 'ä') + 'er', w.replace(/o/, 'ö') + 'er', w.replace(/u/, 'ü') + 'er');
    }
    if (adj) out.push(w + 'e', w + 'en', w + 'er', w + 'es', w + 'em');
  } else if (lang === 'es') {
    if (verb) {
      if (w.endsWith('ar') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'o', s + 'as', s + 'a', s + 'amos', s + 'áis', s + 'an', s + 'é', s + 'aste', s + 'ó', s + 'asteis', s + 'aron',
          s + 'aba', s + 'abas', s + 'ábamos', s + 'aban', s + 'aré', s + 'ará', s + 'aremos', s + 'arán', s + 'ando', s + 'ado', s + 'ada', s + 'ados', s + 'adas');
      } else if (w.endsWith('er') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'o', s + 'es', s + 'e', s + 'emos', s + 'éis', s + 'en', s + 'í', s + 'iste', s + 'ió', s + 'ieron',
          s + 'ía', s + 'ías', s + 'ían', s + 'eré', s + 'erá', s + 'iendo', s + 'ido');
      } else if (w.endsWith('ir') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'o', s + 'es', s + 'e', s + 'imos', s + 'ís', s + 'en', s + 'í', s + 'ió', s + 'ieron', s + 'ía',
          s + 'iendo', s + 'ido', s + 'iré', s + 'irá');
      }
    }
    if (noun) out.push(w + 's', w + 'es');
    if (adj) out.push(w + 'a', w + 'os', w + 'as', w + 's');
  } else if (lang === 'pt') {
    if (verb) {
      if (w.endsWith('ar') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'o', s + 'as', s + 'a', s + 'amos', s + 'ais', s + 'am', s + 'ei', s + 'ou', s + 'aram',
          s + 'ava', s + 'avas', s + 'avam', s + 'arei', s + 'ará', s + 'ando', s + 'ado', s + 'ada');
      } else if (w.endsWith('er') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'o', s + 'es', s + 'e', s + 'emos', s + 'eis', s + 'em', s + 'i', s + 'eu', s + 'eram', s + 'ia', s + 'iam', s + 'erei', s + 'erá', s + 'endo', s + 'ido');
      } else if (w.endsWith('ir') && w.length > 3) {
        const s = w.slice(0, -2);
        out.push(s + 'o', s + 'es', s + 'e', s + 'imos', s + 'is', s + 'em', s + 'i', s + 'iu', s + 'iram', s + 'ia', s + 'irei', s + 'irá', s + 'indo', s + 'ido');
      }
    }
    if (noun || adj) out.push(w + 's');
    if (adj) out.push(w + 'a', w + 'os', w + 'as');
  } else if (lang === 'ru') {
    if (verb && w.endsWith('ть') && w.length > 3) {
      const s = w.slice(0, -2);
      out.push(s + 'ю', s + 'ешь', s + 'ет', s + 'ем', s + 'ете', s + 'ют', s + 'л', s + 'ла', s + 'ло', s + 'ли',
        s + 'й', s + 'йте', s + 'я', s + 'ишь', s + 'ит', s + 'им', s + 'ите', s + 'ят', s + 'а', s + 'ал', s + 'ала');
    }
    if (noun) {
      // 按词尾分性数格，不做通用后缀堆叠（машином / машинов 这种就是错的）
      if (/[а]$/.test(w)) { const st = w.slice(0, -1); out.push(st + 'ы', st + 'е', st + 'у', st + 'ой', st + 'ам', st + 'ами', st + 'ах', st); }
      else if (/[я]$/.test(w)) { const st = w.slice(0, -1); out.push(st + 'и', st + 'е', st + 'ю', st + 'ей', st + 'ям', st + 'ями', st + 'ях'); }
      else if (/[оеё]$/.test(w)) { const st = w.slice(0, -1); out.push(st + 'а', st + 'у', st + 'ом', st + 'е', st + 'ы', st + 'ам', st + 'ами', st + 'ах'); }
      else if (/[ь]$/.test(w)) { const st = w.slice(0, -1); out.push(st + 'я', st + 'ю', st + 'ем', st + 'е', st + 'и', st + 'ей', st + 'ям', st + 'ями', st + 'ях'); }
      else if (/[й]$/.test(w)) { const st = w.slice(0, -1); out.push(st + 'я', st + 'ю', st + 'ем', st + 'е', st + 'и', st + 'ев', st + 'ям', st + 'ями', st + 'ях'); }
      else { out.push(w + 'а', w + 'у', w + 'ом', w + 'е', w + 'ы', w + 'и', w + 'ов', w + 'ам', w + 'ами', w + 'ах'); }
    }
    if (adj) {
      const stem = /[ыйойаяое]$/.test(w) ? w.replace(/(ый|ой|ая|ое)$/, '') : w;
      out.push(stem + 'ая', stem + 'ое', stem + 'ые', stem + 'ого', stem + 'ому', stem + 'ую', stem + 'ых', stem + 'ым', stem + 'ыми', stem + 'ой');
    }
  } else if (lang === 'ko') {
    // 韩语活用/助词：词典收原形，歌词里几乎全是变形 + 助词，所以这里生成得比别人宽
    if (verb || adj) {
      if (w.endsWith('다') && w.length > 1) {
        const s = w.slice(0, -1);
        if (/하$/.test(s)) {
          // 하다 类：하 + 아 → 해（사랑해 / 해요 / 했어 / 한 / 할）
          const b = s.slice(0, -1);
          out.push(b + '해', b + '해요', b + '해서', b + '해도', b + '해야', b + '하고', b + '하면', b + '하니까', b + '하지',
            b + '하는', b + '한', b + '할', b + '하게', b + '하겠', b + '했', b + '했어', b + '했어요', b + '하네', b + '하죠',
            b + '하지만', b + '하는데', b + '하면서', b + '합니다', b + '해요', b + '하자', b + '하려고', b + '하러', b + '해라');
        } else {
          const eo = koJoin(s, '아/어');
          const j = (end) => {                       // 은/는、을/를 这种要看有没有收音
            const code = s.codePointAt(s.length - 1) || 0;
            const hasJong = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
            if (end === '은') return s + (hasJong ? '은' : 'ㄴ');
            if (end === '을') return s + (hasJong ? '을' : 'ㄹ');
            return s + end;
          };
          out.push(eo, eo + '요', eo + '서', eo + '도', eo + '야', eo + '라', s + '고', s + '면', s + '니까', s + '지',
            s + '는', j('은'), j('을'), s + '게', s + '겠', s + '었', s + '았', s + '네', s + '죠', s + '지만', s + '는데',
            s + '면서', s + '습니다', s + 'ㅂ니다', s + '자', s + '려고', s + '러', s + '시', eo + '요?');
        }
      }
    }
    if (noun) {
      out.push(w + '은', w + '는', w + '이', w + '가', w + '을', w + '를', w + '에', w + '에서', w + '에게', w + '의',
        w + '도', w + '만', w + '과', w + '와', w + '로', w + '으로', w + '부터', w + '까지', w + '보다', w + '처럼',
        w + '들', w + '들이', w + '들은', w + '들을', w + '들도', w + '들의',
        // 名词 + 이다（系词）：书面上最常见的几种
        w + '이에요', w + '예요', w + '이야', w + '야', w + '입니다', w + '이고', w + '이면', w + '이니까', w + '인', w + '일');
    }
    const IRREG = {
      '이다': ['이에요', '예요', '이야', '야', '입니다', '이고', '이면', '이니까', '인', '일', '이었다', '였어', '이란', '이라는'],
      '아니다': ['아니야', '아니에요', '아닙니다', '아닌', '아니고', '아니면', '아니라', '아니었다'],
      '있다': ['있어', '있어요', '있습니다', '있는', '있을', '있고', '있지', '있는데', '있잖아', '있으면', '있다고', '있어서', '있죠', '있네', '있겠'],
      '없다': ['없어', '없어요', '없습니다', '없는', '없을', '없고', '없지', '없는데', '없으면', '없다', '없어서', '없죠'],
      '되다': ['돼', '돼요', '되는', '될', '되고', '되지', '되면', '됐어', '됐어요', '됩니다', '되어', '돼서'],
      '주다': ['줘', '줘요', '주는', '줄', '주고', '주지', '주면', '줬어', '줬어요', '주세요'],
      '보다': ['봐', '봐요', '보는', '볼', '보고', '보지', '보면', '봤어', '봤어요', '보세요'],
      '가다': ['가', '가요', '가는', '갈', '가고', '가지', '가면', '갔어', '갔어요', '가서', '갑니다'],
      '오다': ['와', '와요', '오는', '올', '오고', '오지', '오면', '왔어', '왔어요', '와서', '옵니다'],
      '것': ['거', '게', '걸', '건', '것은', '것이', '것을', '것도', '것만', '것과', '것의'],
      '나': ['나는', '내가', '나를', '나의', '나도', '나한테', '날', '내', '나에게', '나랑'],
      '너': ['너는', '네가', '너를', '너의', '너도', '너한테', '널', '너에게', '너랑', '니가'],
      '저': ['저는', '제가', '저를', '저의', '저도', '저한테', '절', '저에게'],
      '우리': ['우리는', '우리가', '우리를', '우리의', '우리도', '우릴', '우리에게', '우리랑'],
      '당신': ['당신은', '당신이', '당신을', '당신의', '당신도', '당신에게'],
      '이것': ['이게', '이건', '이걸', '이것은', '이것이', '이것을', '이것도'],
      '그것': ['그게', '그건', '그걸', '그것은', '그것이', '그것을', '그것도'],
      '저것': ['저게', '저건', '저걸', '저것은', '저것이', '저것을'],
      '무엇': ['뭐', '무슨', '무엇을', '무엇이', '무엇인지'],
      '아무': ['아무도', '아무것도', '아무런', '아무거나'],
      '사람': ['사람이', '사람을', '사람은', '사람들', '사람들이', '사람들의', '사람에게', '사람도'],
      '말': ['말을', '말이', '말은', '말도', '말로', '말씀'],
      '집': ['집에', '집을', '집이', '집은', '집에서'],
      '일': ['일을', '일이', '일은', '일도'],
      '때': ['때문에', '때에', '때는', '때가'],
      '수': ['수가', '수를', '수는', '수도'],
      '줄': ['줄을', '줄이', '줄은'],
    };
    if (IRREG[w]) out.push(...IRREG[w]);
  }
  return uniq(out).filter((f) => f !== w && f.length >= 2 && f.length <= w.length + 5);
}
