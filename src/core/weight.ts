// 体重(仕様書 §5.4)。
import { addDays } from './dates.ts';

export type WeightLog = ReadonlyMap<string, number>;

/** その日を含む暦7日の窓(date-6 〜 date)にある測定値の平均。窓に測定値がなければ null */
export function movingAverage7(log: WeightLog, date: string): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const v = log.get(addDays(date, -i));
    if (v !== undefined) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

export interface WeightStats {
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
}

/** 期間内の測定値の平均など */
export function weightStats(log: WeightLog, start: string, end: string): WeightStats {
  const vals: number[] = [];
  for (const [d, v] of log) if (d >= start && d <= end) vals.push(v);
  if (vals.length === 0) return { count: 0, average: null, min: null, max: null };
  return { count: vals.length, average: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
}

/** 増減 = この期間の平均 − 前の期間の平均(どちらかに測定値がなければ null) */
export function weightChange(current: WeightStats, previous: WeightStats): number | null {
  return current.average !== null && previous.average !== null ? current.average - previous.average : null;
}
