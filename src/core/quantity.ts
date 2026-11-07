// 数量と単位(仕様書 §5.1)。
import type { Ingredient } from './types.ts';

/**
 * 数量の文字列を数値にする。全角数字・全角ピリオド・全角スラッシュを受け付ける。
 * 受け付ける形: "0.6" "2.4" ".4" "2/3" "1 1/4"(帯分数)。読めなければ null。
 */
export function parseQuantity(text: string): number | null {
  const s = text.normalize('NFKC').replace(/[⁄∕]/g, '/').replace(/\s+/g, ' ').trim();
  if (s === '') return null;
  let m = /^(\d+(?:\.\d+)?|\.\d+)$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const d = Number(m[2]);
    return d === 0 ? null : Number(m[1]) / d;
  }
  m = /^(\d+) (\d+)\/(\d+)$/.exec(s);
  if (m) {
    const d = Number(m[3]);
    return d === 0 ? null : Number(m[1]) + Number(m[2]) / d;
  }
  return null;
}

const UNIT_ALIASES: [string, string[]][] = [
  ['g', ['g', 'gr', 'グラム', 'ぐらむ']],
  ['kg', ['kg', 'キロ', 'キログラム', 'きろ']],
  ['mg', ['mg', 'ミリグラム']],
  ['μg', ['μg', 'µg', 'ug', 'mcg', 'マイクログラム']],
  ['mL', ['ml', 'cc', 'ミリリットル', 'ミリ']],
  ['L', ['l', 'リットル']],
  ['大さじ', ['大さじ', '大匙', '大サジ', 'おおさじ', 'tbsp']],
  ['小さじ', ['小さじ', '小匙', '小サジ', 'こさじ', 'tsp']],
  ['合', ['合']],
  ['個', ['個', 'こ', 'コ', 'ヶ', 'ケ']],
  ['本', ['本']],
  ['尾', ['尾']],
  ['錠', ['錠']],
  ['粒', ['粒']],
  ['枚', ['枚']],
  ['パック', ['パック', 'ぱっく', 'p', 'pack']],
  ['袋', ['袋']],
  ['缶', ['缶']],
  ['切れ', ['切れ', '切']],
  ['片', ['片']],
  ['玉', ['玉']],
  ['カップ', ['カップ', 'かっぷ', 'cup']],
  ['杯', ['杯']],
];
const UNIT_MAP = new Map<string, string>();
for (const [canon, list] of UNIT_ALIASES) for (const a of list) UNIT_MAP.set(a.normalize('NFKC').toLowerCase(), canon);

/** 単位の別表記を正規化する(例: グラム → g、大匙 → 大さじ、ｇ → g)。知らない単位はそのまま(NFKC・空白除去のみ) */
export function normalizeUnit(unit: string): string {
  const s = unit.normalize('NFKC').replace(/\s+/g, '');
  return UNIT_MAP.get(s.toLowerCase()) ?? s;
}

/** 質量の単位なら g に直す(g / kg / mg / μg)。それ以外は null */
export function massToGrams(qty: number, unit: string): number | null {
  switch (normalizeUnit(unit)) {
    case 'g':
      return qty;
    case 'kg':
      return qty * 1000;
    case 'mg':
      return qty / 1000;
    case 'μg':
      return qty / 1_000_000;
    default:
      return null;
  }
}

/**
 * 数量をグラムに直す。g などの質量はそのまま、それ以外は食材ごとの単位換算(units)を使う。
 * 換算が見つからなければ null(推測で埋めない)。
 */
export function toGrams(ing: Pick<Ingredient, 'units'>, qty: number, unit: string): number | null {
  const mass = massToGrams(qty, unit);
  if (mass !== null) return mass;
  const u = normalizeUnit(unit);
  const conv = ing.units.find((c) => normalizeUnit(c.unit) === u);
  if (!conv || !(conv.qty > 0)) return null;
  return (conv.grams * qty) / conv.qty;
}

export function sameUnit(a: string, b: string): boolean {
  return normalizeUnit(a) === normalizeUnit(b);
}
