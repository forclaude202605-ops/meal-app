// 集計のグラフに使う、日ごとの値の並び(仕様書 §8「集計」)。純関数のみ。
// 体重はテキストの「体重〇kg」の行から。7日移動平均は §5.4 のとおり(その日を含む暦7日の窓の平均)。
import type { DayCalc } from './calc.ts';
import { eachDate } from './dates.ts';
import type { DriReady } from './dri.ts';
import { EER, NUTRIENT_DRI } from '../data/dri2025.ts';
import { movingAverage7 } from './weight.ts';

export interface SeriesDef {
  id: 'kcal' | 'protein' | 'fat' | 'carb' | 'fiber' | 'salt' | 'cost';
  label: string;
  unit: string;
  decimals: number;
}

/** 体重の下に並べられる項目(この順で表示する) */
export const SERIES: readonly SeriesDef[] = [
  { id: 'kcal', label: 'エネルギー', unit: 'kcal', decimals: 0 },
  { id: 'protein', label: 'たんぱく質', unit: 'g', decimals: 1 },
  { id: 'fat', label: '脂質', unit: 'g', decimals: 1 },
  { id: 'carb', label: '炭水化物', unit: 'g', decimals: 1 },
  { id: 'fiber', label: '食物繊維', unit: 'g', decimals: 1 },
  { id: 'salt', label: '食塩相当量', unit: 'g', decimals: 1 },
  { id: 'cost', label: '費用', unit: '円', decimals: 0 },
];

export const DEFAULT_SERIES: SeriesDef['id'][] = ['kcal', 'protein'];

export interface TrendPoint {
  date: string;
  /** その日の体重(記録がなければ null) */
  weight: number | null;
  /** 体重の7日移動平均(窓に記録がなければ null) */
  weightAvg: number | null;
  /** 食事の記録がある日の値(記録がなければ null) */
  values: Record<SeriesDef['id'], number | null>;
}

export function seriesValue(id: SeriesDef['id'], d: DayCalc): number {
  return id === 'cost' ? d.total.cost : d.total.nutrients[id];
}

/** 範囲の日ごとの値。体重の移動平均は、範囲より前の記録も窓に入れる */
export function buildTrend(days: { date: string; calc: DayCalc; weightKg?: number | undefined }[], range: { start: string; end: string }): TrendPoint[] {
  const log = new Map<string, number>();
  for (const d of days) if (d.weightKg !== undefined) log.set(d.date, d.weightKg);
  const byDate = new Map(days.map((d) => [d.date, d.calc]));
  return eachDate(range.start, range.end).map((date) => {
    const c = byDate.get(date);
    const values = {} as TrendPoint['values'];
    for (const s of SERIES) values[s.id] = c && c.hasRecord ? seriesValue(s.id, c) : null;
    return { date, weight: log.get(date) ?? null, weightAvg: movingAverage7(log, date), values };
  });
}

export interface ReferenceLine {
  value: number;
  /** 例: 推定エネルギー必要量、推奨量、目標量(以上)、目標量(未満) */
  label: string;
}

/** グラフに引く基準の線(食事摂取基準。プロフィールが未設定なら null) */
export function referenceLine(id: SeriesDef['id'], ready: DriReady): ReferenceLine | null {
  if (!ready.ok) return null;
  const { profile: p, group: g } = ready;
  if (id === 'kcal') {
    const v = EER[p.sex][p.activity][g];
    return v === null || v === undefined ? null : { value: v, label: '推定エネルギー必要量' };
  }
  if (id === 'protein') {
    const v = NUTRIENT_DRI.protein.rda[p.sex][g];
    return v === null || v === undefined ? null : { value: v, label: '推奨量' };
  }
  if (id === 'fiber') {
    const v = NUTRIENT_DRI.fiber.dgAtLeast[p.sex][g];
    return v === null || v === undefined ? null : { value: v, label: '目標量(以上)' };
  }
  if (id === 'salt') {
    const v = NUTRIENT_DRI.salt.dgBelow[p.sex][g];
    return v === null || v === undefined ? null : { value: v, label: '目標量(未満)' };
  }
  return null;
}

/** 軸の目盛り: 最小・最大を含む、きりのよい値を3〜5個 */
export function niceTicks(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!(max > min)) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    return niceTicks(min - pad, max + pad, count);
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks };
}
