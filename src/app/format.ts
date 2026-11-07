// 表示用の整形。丸めるのは表示のときだけ(四捨五入、0.5 は切り上げ)。
import { NUTRIENTS } from '../core/nutrients.ts';
import { formatNumber } from '../core/round.ts';
import type { NutrientKey } from '../core/types.ts';
import type { IssueCounts } from '../core/calc.ts';

export function fmtNutrient(key: NutrientKey, v: number): string {
  return formatNumber(v, NUTRIENTS[key].decimals);
}

export function fmtNutrientWithUnit(key: NutrientKey, v: number): string {
  return `${fmtNutrient(key, v)}${NUTRIENTS[key].unit}`;
}

/** 費用: 行は小数1位、区分・日・週・月の合計は整数円 */
export function fmtYen(v: number, kind: 'row' | 'total'): string {
  return `${formatNumber(v, kind === 'row' ? 1 : 0)}円`;
}

/** 小数点以下の末尾の0を外す("3.40" → "3.4"、"2.00" → "2"。整数の0は外さない) */
export function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function fmtGrams(g: number | null): string {
  if (g === null) return '—';
  const abs = Math.abs(g);
  return `${trimZeros(formatNumber(g, abs >= 100 ? 0 : abs >= 10 ? 1 : 2))}g`;
}

/** 数量の表示(小数の末尾の0を外す) */
export function fmtQty(q: number | null): string {
  if (q === null) return '(数量なし)';
  return trimZeros(formatNumber(q, 3));
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtDateJa(date: string, withYear = false): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withYear ? `${y}年` : ''}${m}月${d}日(${dow})`;
}

export function fmtDateTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

export interface WarningChip {
  key: keyof IssueCounts;
  label: string;
  count: number;
  /** 合計から外れている(true)か、注意だけ(false)か */
  excluded: boolean;
}

const LABELS: [keyof IssueCounts, string, boolean][] = [
  ['unresolved', '未解決', true],
  ['noQty', '数量なし', true],
  ['noUnit', '単位換算なし', true],
  ['missingFood', '成分表の食品なし', true],
  ['cycle', 'レシピの循環', true],
  ['badRecipe', 'レシピの完成重量なし', true],
  ['emptyRecipe', '内訳未登録', false],
  ['unmeasured', '一部未測定', false],
  ['noPrice', '価格未登録', true],
  ['priceUnit', '単価を確定できない', true],
  ['partialPrice', '一部価格未登録', false],
  ['futurePrice', '未来の価格で代用', false],
];

export function warningChips(c: IssueCounts): WarningChip[] {
  return LABELS.filter(([k]) => c[k] > 0).map(([key, label, excluded]) => ({ key, label, count: c[key], excluded }));
}
