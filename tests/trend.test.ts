// 集計のグラフの値(体重・7日移動平均・日ごとの値・基準の線)のテスト。値はすべて架空。
import { describe, expect, it } from 'vitest';
import { zeroVec, type DayCalc } from '../src/core/calc.ts';
import { driProfile } from '../src/core/dri.ts';
import { buildTrend, niceTicks, referenceLine } from '../src/core/trend.ts';

function calc(date: string, kcal: number | null): DayCalc {
  const n = zeroVec();
  if (kcal !== null) n.kcal = kcal;
  const t = { nutrients: n, cost: kcal === null ? 0 : 300, unmeasured: {} };
  return { date, rows: [], slots: {} as DayCalc['slots'], meals: t, extras: t, total: t, counts: {} as DayCalc['counts'], hasRecord: kcal !== null, weightKg: undefined };
}

describe('グラフの値', () => {
  const days = [
    { date: '2024-11-01', calc: calc('2024-11-01', 1500), weightKg: 63.2 },
    { date: '2024-11-03', calc: calc('2024-11-03', null), weightKg: 63.6 },
    { date: '2024-11-05', calc: calc('2024-11-05', 1700) },
    { date: '2024-11-09', calc: calc('2024-11-09', 1600), weightKg: 62.9 },
  ];
  const t = buildTrend(days, { start: '2024-11-04', end: '2024-11-10' });

  it('範囲の毎日の点を作る。記録のない日は null(0 にしない)', () => {
    expect(t.map((p) => p.date)).toEqual(['2024-11-04', '2024-11-05', '2024-11-06', '2024-11-07', '2024-11-08', '2024-11-09', '2024-11-10']);
    expect(t.map((p) => p.values.kcal)).toEqual([null, 1700, null, null, null, 1600, null]);
    expect(t[1]?.values.cost).toBe(300);
  });

  it('体重は記録した日だけ。7日移動平均は範囲より前の記録も窓に入れる', () => {
    expect(t.map((p) => p.weight)).toEqual([null, null, null, null, null, 62.9, null]);
    // 11/4 の窓は 10/29〜11/4: 63.2 と 63.6
    expect(t[0]?.weightAvg).toBeCloseTo((63.2 + 63.6) / 2, 12);
    // 11/08 の窓は 11/02〜11/08: 63.6 だけ
    expect(t[4]?.weightAvg).toBeCloseTo(63.6, 12);
    // 11/10 の窓は 11/4〜11/10: 62.9 だけ
    expect(t[6]?.weightAvg).toBeCloseTo(62.9, 12);
  });

  it('基準の線: プロフィールがあれば、推定エネルギー必要量・推奨量・目標量', () => {
    const r = driProfile({ sex: 'female', age: 50, activity: 1 });
    expect(referenceLine('kcal', r)).toEqual({ value: 1700, label: '推定エネルギー必要量' });
    expect(referenceLine('protein', r)).toEqual({ value: 50, label: '推奨量' });
    expect(referenceLine('salt', r)).toEqual({ value: 6.5, label: '目標量(未満)' });
    expect(referenceLine('cost', r)).toBeNull();
    expect(referenceLine('kcal', driProfile(undefined))).toBeNull();
  });

  it('軸の目盛りは最小と最大を含む', () => {
    const { lo, hi, ticks } = niceTicks(1387, 2050, 3);
    expect(lo).toBeLessThanOrEqual(1387);
    expect(hi).toBeGreaterThanOrEqual(2050);
    expect(ticks[0]).toBe(lo);
    expect(ticks[ticks.length - 1]).toBe(hi);
    const flat = niceTicks(62.9, 62.9);
    expect(flat.lo).toBeLessThan(62.9);
    expect(flat.hi).toBeGreaterThan(62.9);
  });
});
