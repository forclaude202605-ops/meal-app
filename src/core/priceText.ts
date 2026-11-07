// 価格の入力文字列を読む(仕様書 §8: 重量→金額、金額→重量のどちらの順でも受け付ける)。
// 例(架空): "420g 118円" / "118円420g" / "4本 158円" / "612g 6尾 538円"(重量と個数) / "2.3kg 248円" / "¥268 1200g"
// 表記ゆれ(全角数字、ｇ、グラム、空白の有無)は正規化する。
import { normalizeUnit } from './quantity.ts';

export interface ParsedPrice {
  yen: number;
  qty: number;
  unit: string;
  /** 個数と重量の両方があるときの重量(g) */
  grams?: number;
}

export type PriceParse = { ok: true; value: ParsedPrice } | { ok: false; error: string };

const MASS = new Set(['g', 'kg', 'mg']);

export function parsePriceText(text: string): PriceParse {
  const s = text.normalize('NFKC').replace(/,(?=\d{3})/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, error: '金額と量を入れてください' };
  const yenList: number[] = [];
  const amounts: { qty: number; unit: string }[] = [];
  const re = /[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(円|[^\d\s.¥￥]+)?/g;
  let m: RegExpExecArray | null;
  let rest = s;
  while ((m = re.exec(s)) !== null) {
    rest = rest.replace(m[0], ' ');
    if (m[1] !== undefined) {
      yenList.push(Number(m[1]));
      continue;
    }
    const n = Number(m[2]);
    const u = m[3];
    if (u === '円') yenList.push(n);
    else if (u === undefined) return { ok: false, error: `「${m[2]}」の単位がありません` };
    else amounts.push({ qty: n, unit: normalizeUnit(u) });
  }
  if (rest.replace(/[\s()（）]/g, '') !== '') return { ok: false, error: `読めない部分があります: ${rest.trim()}` };
  if (yenList.length !== 1) return { ok: false, error: yenList.length === 0 ? '金額(円)がありません' : '金額が2つ以上あります' };
  const yen = yenList[0] as number;
  const mass = amounts.filter((a) => MASS.has(a.unit));
  const other = amounts.filter((a) => !MASS.has(a.unit));
  if (amounts.length === 0) return { ok: false, error: '量(g や 本など)がありません' };
  if (mass.length > 1 || other.length > 1) return { ok: false, error: '量が多すぎます(重量1つ・個数1つまで)' };
  const c = other[0];
  const w = mass[0];
  if (c && w) {
    const grams = w.unit === 'kg' ? w.qty * 1000 : w.unit === 'mg' ? w.qty / 1000 : w.qty;
    return { ok: true, value: { yen, qty: c.qty, unit: c.unit, grams } };
  }
  const a = (c ?? w) as { qty: number; unit: string };
  return { ok: true, value: { yen, qty: a.qty, unit: a.unit } };
}
