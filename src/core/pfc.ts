// PFC(仕様書 §5.4)。
// 「PFCの比」(グラフ用)は P×4 : F×9 : C×4 の合計を 100% とする。
// 成分表のエネルギーは成分表独自の係数で計算されているので、PFC 由来の kcal とは一致しない。合わせようとしない。
// 食事摂取基準の「エネルギー産生栄養素バランス」と比べるときは、分母を総エネルギーにする(%E)。

export interface PfcRatio {
  p: number;
  f: number;
  c: number;
  /** P×4 + F×9 + C×4 */
  pfcKcal: number;
}

export function pfcRatio(protein: number, fat: number, carb: number): PfcRatio | null {
  const pk = protein * 4;
  const fk = fat * 9;
  const ck = carb * 4;
  const sum = pk + fk + ck;
  if (!(sum > 0)) return null;
  return { p: (pk / sum) * 100, f: (fk / sum) * 100, c: (ck / sum) * 100, pfcKcal: sum };
}

export interface EnergyShare {
  /** たんぱく質 %E */
  p: number;
  f: number;
  c: number;
  /** p + f + c(100 にならないことがある) */
  sum: number;
}

/** 総エネルギーを分母にした %E */
export function energyShare(protein: number, fat: number, carb: number, kcal: number): EnergyShare | null {
  if (!(kcal > 0)) return null;
  const p = ((protein * 4) / kcal) * 100;
  const f = ((fat * 9) / kcal) * 100;
  const c = ((carb * 4) / kcal) * 100;
  return { p, f, c, sum: p + f + c };
}
