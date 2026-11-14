// 読めなかった行を、名前と数字を伏せた形にする(持ち主が中身を確かめてから、開発側に渡すため)。純関数のみ。
// 例: 名前は〇〇、数字のかたまりは〇。単位・記号・区分名などの決まった語だけを残す → 「〇〇〇g(〇g〇円)」
import { normalizeLine } from './normalize.ts';

/** 残す語(単位、区分、読み取りの決まった語、栄養素名、曜日) */
const KEEP = new Set([
  'g', 'kg', 'mg', 'μg', 'ug', 'mcg', 'mL', 'ml', 'L', 'cc', 'kcal', '円',
  'グラム', 'キログラム', 'ミリグラム', 'マイクログラム', 'キロ',
  '大さじ', '小さじ', '大匙', '小匙', 'カップ', '合', '個', '本', '尾', '錠', '粒', '枚', 'パック', '袋', '缶', '切れ', '片', '玉', '杯', '丁', '束', '房', '株', '膳', '皿', '斤', '包', 'つ',
  '朝', '朝食', '昼', '昼食', '間食', 'おやつ', '夜', '夕食', '夕', '晩', 'サプリ', 'サプリメント',
  '体重', '日照', 'によって', 'による', 'の', 'が', 'を', '以上', 'と', '同価格', '同じ価格', '分', 'あたり', '当たり',
  '少々', '少量', '適量', '適宜', 'ひとつまみ',
  'エネルギー', 'たんぱく質', 'タンパク質', '脂質', '炭水化物', '食物繊維', '食塩相当量', '食塩', 'ナトリウム', 'カリウム', 'カルシウム', 'マグネシウム', 'リン', '鉄', '亜鉛',
  'ビタミンA', 'ビタミンD', 'ビタミンE', 'ビタミンK', 'ビタミンB', 'ビタミンC', 'ナイアシン', '葉酸',
  '日', '月', '火', '水', '木', '金', '土', '曜', '曜日', '年',
]);
const MAX_KEEP = Math.max(...[...KEEP].map((k) => k.length));
/** 数字の前に書く単位(「〇〇大さじ〇」の「大さじ」を残す) */
const PRE_UNITS = ['大さじ', '小さじ', '大匙', '小匙', 'カップ', '大', '小'];

const isLetter = (c: string) => /[\p{L}\p{M}々〆ー]/u.test(c);
const isDigit = (c: string) => /\d/.test(c);

/** 語の並びを、残す語だけで区切れるか */
function segmentable(w: string): boolean {
  const ok: boolean[] = new Array<boolean>(w.length + 1).fill(false);
  ok[0] = true;
  for (let i = 1; i <= w.length; i++) {
    for (let k = 1; k <= Math.min(MAX_KEEP, i); k++) {
      if (ok[i - k] && KEEP.has(w.slice(i - k, i))) {
        ok[i] = true;
        break;
      }
    }
  }
  return ok[w.length] as boolean;
}

function maskWord(w: string, afterDigit: boolean, beforeDigit: boolean): string {
  if (segmentable(w)) return w;
  let prefix = '';
  let rest = w;
  if (afterDigit) {
    // 数字の直後の単位(「g」「枚」など)は残す
    for (let k = Math.min(MAX_KEEP, rest.length - 1); k >= 1; k--) {
      if (KEEP.has(rest.slice(0, k))) {
        prefix = rest.slice(0, k);
        rest = rest.slice(k);
        break;
      }
    }
  }
  let suffix = '';
  if (beforeDigit) {
    const pre = PRE_UNITS.find((u) => rest.endsWith(u) && u.length < rest.length);
    if (pre) {
      suffix = pre;
      rest = rest.slice(0, rest.length - pre.length);
    }
  }
  return `${prefix}${rest ? '〇〇' : ''}${suffix}`;
}

/** 1行を伏せる。数字のかたまりは〇1つ(小数点と / は残す)、名前は〇〇、記号・空白・決まった語はそのまま */
export function maskLine(raw: string): string {
  const s = normalizeLine(raw).text;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (isDigit(c)) {
      while (i < s.length && isDigit(s[i] as string)) i++;
      out += '〇';
      continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (j < s.length && isLetter(s[j] as string)) j++;
      out += maskWord(s.slice(i, j), i > 0 && isDigit(s[i - 1] as string), j < s.length && isDigit(s[j] as string));
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function maskLines(lines: string[]): string {
  return lines.map(maskLine).join('\n');
}
