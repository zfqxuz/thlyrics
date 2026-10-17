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
    if (verb || adj) {
      if (w.endsWith('다') && w.length > 1) {
        const s = w.slice(0, -1);
        if (/하$/.test(s)) {
          // 하다 类：하 + 아 → 해（사랑해 / 해요 / 했어 / 한 / 할）
          const b = s.slice(0, -1);
          out.push(b + '해', b + '해요', b + '하고', b + '해서', b + '하면', b + '하니까', b + '하지', b + '하는', b + '한',
            b + '할', b + '하게', b + '하겠', b + '했', b + '했어', b + '하네', b + '하죠', b + '하지만', b + '하는데',
            b + '하면서', b + '합니다', b + '하자', b + '하려고', b + '하러');
        } else {
          const eo = koJoin(s, '아/어');
          out.push(eo, eo + '요', eo + '서', eo + '도', s + '고', s + '면', s + '니까', s + '지', s + '는', s + '은',
            s + '을', s + 'ㄹ', s + '게', s + '겠', s + '었', s + '았', s + '네', s + '죠', s + '지만', s + '는데', s + '면서',
            s + '습니다', s + 'ㅂ니다', s + '자', s + '려고', s + '러');
        }
      }
    }
    if (noun) {
      out.push(w + '은', w + '는', w + '이', w + '가', w + '을', w + '를', w + '에', w + '에서', w + '에게', w + '의',
        w + '도', w + '만', w + '과', w + '와', w + '로', w + '으로', w + '부터', w + '까지', w + '보다', w + '처럼', w + '들');
    }
  }
  return uniq(out).filter((f) => f !== w && f.length >= 2 && f.length <= w.length + 5);
}
