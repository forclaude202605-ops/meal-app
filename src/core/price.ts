// 価格の選び方と単価(仕様書 §5.3)。
import { massToGrams, normalizeUnit, sameUnit, toGrams } from './quantity.ts';
import type { Ingredient, PriceEntry } from './types.ts';

export interface PricePick {
  entry: PriceEntry;
  /** 食事の日付より後の記録で代用した */
  future: boolean;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 食材ごとに、日付 → 登録時刻 → id の順に並べた価格の索引を作る */
export function indexPrices(prices: PriceEntry[]): Map<string, PriceEntry[]> {
  const map = new Map<string, PriceEntry[]>();
  for (const p of prices) {
    const list = map.get(p.ingredientId);
    if (list) list.push(p);
    else map.set(p.ingredientId, [p]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => cmp(a.date, b.date) || cmp(a.createdAt ?? '', b.createdAt ?? '') || cmp(a.id, b.id));
  }
  return map;
}

/**
 * 食事の日付以前で最も新しい記録(同じ日を含む)。なければ、日付より後で最も古い記録(future)。
 * 同じ日に複数あるときは、登録順(createdAt)で最後のもの。
 */
export function pickPrice(sorted: PriceEntry[] | undefined, date: string): PricePick | null {
  if (!sorted || sorted.length === 0) return null;
  let best: PriceEntry | undefined;
  for (const p of sorted) {
    if (p.date <= date) best = p;
    else break;
  }
  if (best) return { entry: best, future: false };
  const first = sorted[0];
  return first ? { entry: first, future: true } : null;
}

/** 購入量をグラムで。grams があればそれ、質量の単位ならそれ、食材の単位換算があればそれ。直せなければ null */
export function purchaseGrams(entry: PriceEntry, ing: Pick<Ingredient, 'units'>): number | null {
  if (entry.grams !== undefined && entry.grams > 0) return entry.grams;
  return massToGrams(entry.qty, entry.unit) ?? toGrams(ing, entry.qty, entry.unit);
}

/**
 * 1行ぶんの費用。両方グラムに直せるならグラム基準、直せず単位が同じならその単位基準。
 * どちらでもなければ null(単価を確定できない)。
 */
export function costOf(
  entry: PriceEntry,
  ing: Pick<Ingredient, 'units'>,
  row: { qty: number; unit: string; grams: number | null },
): number | null {
  const pg = purchaseGrams(entry, ing);
  if (pg !== null && pg > 0 && row.grams !== null) return (entry.yen * row.grams) / pg;
  if (sameUnit(entry.unit, row.unit) && entry.qty > 0) return (entry.yen * row.qty) / entry.qty;
  return null;
}

/** 購入記録の単位が mg で、食材が成分表の食品のとき(入力ミスの可能性が高い。取り込み時に確認する) */
export function isSuspiciousPriceUnit(entry: Pick<PriceEntry, 'unit'>, ing: Pick<Ingredient, 'source'>): boolean {
  return normalizeUnit(entry.unit) === 'mg' && ing.source.kind === 'food';
}
