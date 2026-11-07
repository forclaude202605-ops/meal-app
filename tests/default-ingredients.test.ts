// 食材マスタの初期値(調味料など)のテスト。換算は成分表の備考欄の密度から計算したもの。
import { describe, expect, it } from 'vitest';
import { toGrams } from '../src/core/quantity.ts';
import { defaultIngredients } from '../src/data/defaultIngredients.ts';
import { foodTable } from './helpers.ts';

const list = defaultIngredients(foodTable());
const byName = (n: string) => {
  const i = list.find((x) => x.name === n);
  if (!i) throw new Error(`初期値に ${n} がない`);
  return i;
};

describe('食材マスタの初期値', () => {
  it('すべて成分表の食品に紐づき、id と名前・別名が重複しない', () => {
    expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
    const names = list.flatMap((i) => [i.name, ...i.aliases]);
    expect(new Set(names).size).toBe(names.length);
    for (const i of list) expect(i.source.kind).toBe('food');
  });

  it('大さじ・小さじは、成分表の「100 mL：○ g」× 15 mL / 5 mL', () => {
    // こいくちしょうゆ 100 mL：118.1 g → 大さじ1 = 17.715 g、小さじ1 = 5.905 g
    expect(toGrams(byName('しょうゆ'), 1, '大さじ')).toBeCloseTo(17.715, 12);
    expect(toGrams(byName('しょうゆ'), 1, '小さじ')).toBeCloseTo(5.905, 12);
    // 上白糖 100 mL：65 g → 小さじ1 = 3.25 g
    expect(toGrams(byName('砂糖'), 1, '小さじ')).toBeCloseTo(3.25, 12);
    // 食塩 100 mL：120 g → 小さじ1 = 6 g
    expect(toGrams(byName('塩'), 1, '小さじ')).toBeCloseTo(6, 12);
  });

  it('推定の換算は未確認(⚠)。白米 1合=150g だけの食材は確認済み', () => {
    expect(byName('しょうゆ').unitsConfirmed).toBe(false);
    expect(byName('白米').unitsConfirmed).toBe(true);
    expect(toGrams(byName('白米'), 0.4, '合')).toBeCloseTo(60, 12);
  });

  it('成分表に容量換算がない食材には、換算を入れない(推測で埋めない)', () => {
    expect(byName('鶏がらスープ顆粒').units).toEqual([]);
    expect(toGrams(byName('鶏がらスープ顆粒'), 1, '小さじ')).toBeNull();
  });
});
