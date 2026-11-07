// 検算値(ゴールデン値)のテスト(仕様書 §12)。
// 期待値は、成分表の値(可食部100gあたり)と四則演算だけで、実装とは別に出したもの(decimal で厳密に計算)。
// 単位換算(大さじ1=17g など)はテスト用の固定値で、アプリの初期値ではない。
// 数量・日付・金額はすべて架空。
//
// 使う食品の100gあたりの値(kcal / P / F / C / 食物繊維 / 食塩 / Ca / Zn / VitD / VitC):
//   01004 オートミール        350 / 13.7 / 5.7 / 69.1 / 9.4 / 0   / 47   / 2.1 / 0   / 0
//   13010 脱脂粉乳            354 / 34   / 1   / 53.3 / 0   / 1.4 / 1100 / 3.9 / 0   / 5
//   01063 マカロニ・スパゲッティ 乾 347 / 12.9 / 1.8 / 73.1 / 5.4 / 0 / 18 / 1.5 / 0 / 0
//   01083 精白米 うるち米     342 / 6.1  / 0.9 / 77.6 / 0.5 / 0   / 5    / 1.4 / 0   / 0
//   17007 こいくちしょうゆ    76  / 7.7  / 0   / 7.9  / 0   / 14.5 / 29  / 0.9 / 0   / 0
//   14008 なたね油            887 / 0    / 100 / 0    / 0   / 0   / 0    / 0   / 0   / 0
//   03003 上白糖              391 / 0    / 0   / 99.3 / 0   / 0   / 1    / 0   / 0   / 0
//   06061 キャベツ            23  / 1.2  / 0.1 / 5.2  / 1.8 / 0   / 42   / 0.1 / 0   / 38
//   12004 鶏卵 全卵 生        142 / 12.2 / 10.2 / 0.4 / 0   / 0.4 / 46   / 1.1 / 3.8 / 0
//   06212 にんじん 皮つき 生  35  / 0.7  / 0.2 / 9.3  / 2.8 / 0.1 / 28   / 0.2 / 0   / 6   (ヨウ素は未測定)
//   06153 たまねぎ 生         33  / 1.0  / 0.1 / 8.4  / 1.5 / 0   / 17   / 0.2 / 0   / 7
//   04032 木綿豆腐            73  / 7.0  / 4.9 / 1.5  / 1.1 / 0   / 93   / 0.6 / 0   / 0
//   14001 オリーブ油          894 / 0    / 100 / 0    / 0   / 0   / 0    / 0   / 0   / 0
import { describe, expect, it } from 'vitest';
import { computeDay, computePeriod, computeRow, contributions, type Vec } from '../src/core/calc.ts';
import { weekRange, monthRange, addDays, todayLocal } from '../src/core/dates.ts';
import { energyShare, pfcRatio } from '../src/core/pfc.ts';
import { parseQuantity, toGrams } from '../src/core/quantity.ts';
import { roundHalfUp, formatNumber } from '../src/core/round.ts';
import type { Ingredient, NutrientKey } from '../src/core/types.ts';
import { movingAverage7, weightChange, weightStats } from '../src/core/weight.ts';
import { ctxOf, day, foodIng, price, row } from './helpers.ts';

const W = { slot: '朝' as const, dishIndex: 0, rowIndex: 0 };
const KEYS: NutrientKey[] = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'salt', 'ca', 'zn', 'vitd', 'vitc'];

function expectVec(v: Vec, expected: number[]) {
  KEYS.forEach((k, i) => expect(v[k], k).toBeCloseTo(expected[i] ?? NaN, 9));
}

const ings: Ingredient[] = [
  foodIng('oat', '01004'),
  foodIng('skim', '13010'),
  foodIng('pasta', '01063'),
  foodIng('rice', '01083', [{ unit: '合', qty: 1, grams: 160 }]),
  foodIng('soy', '17007', [{ unit: '大さじ', qty: 1, grams: 17 }]),
  foodIng('rapeseed', '14008', [{ unit: '小さじ', qty: 1, grams: 4.5 }]),
  foodIng('sugar', '03003', [{ unit: '小さじ', qty: 1, grams: 3.2 }]),
  foodIng('cabbage', '06061'),
  foodIng('egg', '12004'),
  foodIng('carrot', '06212'),
  foodIng('onion', '06153'),
  foodIng('tofu', '04032'),
  foodIng('olive', '14001', [{ unit: '小さじ', qty: 1, grams: 4 }]),
];

describe('単品(内部の丸めなし)', () => {
  const ctx = ctxOf(ings);
  const calc = (rows: ReturnType<typeof row>[]) => computeDay(ctx, day('2025-02-12', { 朝: [rows] })).total.nutrients;

  it.each([
    ['オートミール35g + 脱脂粉乳12g', [row('oat', 35), row('skim', 12)], [164.98, 8.875, 2.115, 30.581, 3.29, 0.168, 148.45, 1.203, 0, 0.6]],
    ['パスタ乾150g', [row('pasta', 150)], [520.5, 19.35, 2.7, 109.65, 8.1, 0, 27, 2.25, 0, 0]],
    ['精白米0.6合(1合=160g)= 96g', [row('rice', 0.6, '合')], [328.32, 5.856, 0.864, 74.496, 0.48, 0, 4.8, 1.344, 0, 0]],
    ['しょうゆ大さじ2(大さじ1=17g)= 34g', [row('soy', 2, '大さじ')], [25.84, 2.618, 0, 2.686, 0, 4.93, 9.86, 0.306, 0, 0]],
    ['なたね油小さじ1.2(小さじ1=4.5g)= 5.4g', [row('rapeseed', 1.2, '小さじ')], [47.898, 0, 5.4, 0, 0, 0, 0, 0, 0, 0]],
    ['上白糖小さじ3(小さじ1=3.2g)= 9.6g', [row('sugar', 3, '小さじ')], [37.536, 0, 0, 9.5328, 0, 0, 0.096, 0, 0, 0]],
    ['キャベツ80g', [row('cabbage', 80)], [18.4, 0.96, 0.08, 4.16, 1.44, 0, 33.6, 0.08, 0, 30.4]],
    ['鶏卵60g', [row('egg', 60)], [85.2, 7.32, 6.12, 0.24, 0, 0.24, 27.6, 0.66, 2.28, 0]],
    ['にんじん70g', [row('carrot', 70)], [24.5, 0.49, 0.14, 6.51, 1.96, 0.07, 19.6, 0.14, 0, 4.2]],
  ] as const)('%s', (_name, rows, expected) => {
    expectVec(calc([...rows]), [...expected]);
  });

  it('にんじんはヨウ素が未測定になり、「一部未測定」に数えられる', () => {
    const d = computeDay(ctx, day('2025-02-12', { 朝: [[row('carrot', 70)]] }));
    expect(d.total.unmeasured.id).toEqual(['carrot']);
    expect(d.counts.unmeasured).toBe(1);
    expect(d.total.nutrients.id).toBe(0);
  });
});

describe('ミニ1日', () => {
  const ctx = ctxOf(ings);
  const d = computeDay(
    ctx,
    day(
      '2025-02-12',
      {
        朝: [[row('oat', 35), row('skim', 12)]],
        昼: [[row('pasta', 150), row('onion', 40), row('carrot', 20), row('cabbage', 50), row('soy', 2, '大さじ'), row('olive', 2, '小さじ')]],
        夜: [[row('rice', 0.6, '合'), row('tofu', 100), row('egg', 60)]],
      },
      [{ label: '日照によるビタミンD', nutrients: { vitd: 8 } }],
    ),
  );

  it('区分ごとの小計', () => {
    expectVec(d.slots['朝'].nutrients, [164.98, 8.875, 2.115, 30.581, 3.29, 0.168, 148.45, 1.203, 0, 0.6]);
    expectVec(d.slots['昼'].nutrients, [649.56, 23.108, 10.83, 120.156, 10.16, 4.95, 70.26, 2.726, 0, 23]);
    expectVec(d.slots['夜'].nutrients, [486.52, 20.176, 11.884, 76.236, 1.58, 0.24, 125.4, 2.604, 2.28, 0]);
  });

  it('食事由来の合計と、手動加算を足した日の合計', () => {
    expectVec(d.meals.nutrients, [1301.06, 52.159, 24.829, 226.973, 15.03, 5.358, 344.11, 6.533, 2.28, 23.6]);
    expect(d.extras.nutrients.vitd).toBe(8);
    expect(d.total.nutrients.vitd).toBeCloseTo(10.28, 9);
    expect(d.total.nutrients.kcal).toBeCloseTo(1301.06, 9);
  });

  it('表示: kcal=1301、食塩=5.4、食物繊維=15.0、たんぱく質=52.2', () => {
    expect(formatNumber(d.total.nutrients.kcal, 0)).toBe('1301');
    expect(formatNumber(d.total.nutrients.salt, 1)).toBe('5.4');
    expect(formatNumber(d.total.nutrients.fiber, 1)).toBe('15.0');
    expect(formatNumber(d.total.nutrients.protein, 1)).toBe('52.2');
  });

  it('PFCの比は P 15.57% / F 16.68% / C 67.75%、PFC由来の kcal 1339.989 は成分表のエネルギーと一致しない', () => {
    const r = pfcRatio(d.total.nutrients.protein, d.total.nutrients.fat, d.total.nutrients.carb);
    if (!r) throw new Error('PFC の比が出ない');
    expect(roundHalfUp(r.p, 2)).toBe(15.57);
    expect(roundHalfUp(r.f, 2)).toBe(16.68);
    expect(roundHalfUp(r.c, 2)).toBe(67.75);
    expect(r.pfcKcal).toBeCloseTo(1339.989, 9);
    expect(r.pfcKcal).not.toBeCloseTo(d.total.nutrients.kcal, 0);
  });

  it('総エネルギーを分母にした %E は 16.04 / 17.18 / 69.78 で、合計 102.99%(仕様どおり100にならない)', () => {
    const e = energyShare(d.total.nutrients.protein, d.total.nutrients.fat, d.total.nutrients.carb, d.total.nutrients.kcal);
    if (!e) throw new Error('%E が出ない');
    expect(roundHalfUp(e.p, 2)).toBe(16.04);
    expect(roundHalfUp(e.f, 2)).toBe(17.18);
    expect(roundHalfUp(e.c, 2)).toBe(69.78);
    expect(roundHalfUp(e.sum, 2)).toBe(102.99);
  });

  it('ヨウ素は昼のにんじんが未測定', () => {
    expect(d.total.unmeasured.id).toEqual(['carrot']);
    expect(d.slots['昼'].unmeasured.id).toEqual(['carrot']);
    expect(d.slots['朝'].unmeasured.id).toBeUndefined();
  });

  it('内訳: 大きい順に並び、和が合計と一致する', () => {
    const c = contributions(d, [{ label: '日照', nutrients: { vitd: 8 } }], 'kcal');
    expect(c[0]?.kind === 'row' && c[0].row.row.ingredientId).toBe('pasta');
    const sum = c.reduce((s, x) => s + x.value, 0);
    expect(sum).toBeCloseTo(d.total.nutrients.kcal, 9);
  });
});

describe('単位換算', () => {
  const rice = foodIng('rice', '01083', [{ unit: '合', qty: 1, grams: 160 }]);
  it('精白米 0.6合、1合=160g → 96g', () => expect(toGrams(rice, 0.6, '合')).toBeCloseTo(96, 12));
  it('しょうゆ 大さじ2、大さじ1=17g → 34g', () => expect(toGrams(foodIng('s', '17007', [{ unit: '大さじ', qty: 1, grams: 17 }]), 2, '大匙')).toBe(34));
  it('"1/3錠" → 0.333…錠、"２／５" → 0.4、"０．６５" → 0.65、"1 1/4" → 1.25', () => {
    expect(parseQuantity('1/3')).toBeCloseTo(1 / 3, 15);
    expect(parseQuantity('２／５')).toBeCloseTo(0.4, 15);
    expect(parseQuantity('０．６５')).toBe(0.65);
    expect(parseQuantity('1 1/4')).toBe(1.25);
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('1/0')).toBeNull();
  });
  it('割り切れない換算(尾 4 = 9g)を丸めずに持つ: 1尾 = 2.25g、2尾 = 4.5g、4/9尾 = 1g', () => {
    const niboshi = foodIng('n', '10045', [{ unit: '尾', qty: 4, grams: 9 }]);
    expect(toGrams(niboshi, 1, '尾')).toBe(2.25);
    expect(toGrams(niboshi, 2, '尾')).toBe(4.5);
    expect(toGrams(niboshi, 4 / 9, '尾')).toBeCloseTo(1, 15);
    const other = foodIng('t', '10045', [{ unit: '尾', qty: 6, grams: 11 }]);
    expect(toGrams(other, 1, '尾')).toBeCloseTo(1.8333333333333333, 15);
  });
  it('換算がなければ、その行は計算から除外し「単位換算が未設定」を数える', () => {
    const ctx = ctxOf([foodIng('eggplant', '06191')]);
    const d = computeDay(ctx, day('2025-02-12', { 夜: [[row('eggplant', 2, '本')]] }));
    expect(d.total.nutrients.kcal).toBe(0);
    expect(d.counts.noUnit).toBe(1);
    expect(d.rows[0]?.included).toBe(false);
  });
});

describe('費用(価格は架空)', () => {
  const pork = foodIng('pork', '11130');
  const eggplant = foodIng('eggplant', '06191');
  const chicken = foodIng('chicken', '11220');
  const labelA: Ingredient = { id: 'labelA', name: 'サンプル菓子A', aliases: [], units: [], source: { kind: 'label', per: { qty: 1, unit: '枚' }, nutrients: { ca: 180, vitd: 1.8 } } };
  const ctx = ctxOf(
    [pork, eggplant, chicken, labelA],
    [
      price('pork', '2025-02-12', 78, 100, 'g', { source: 'inline' }),
      price('eggplant', '2025-02-01', 158, 820),
      price('chicken', '2025-02-01', 1260, 1500),
      price('labelA', '2025-02-01', 11, 1, '枚'),
    ],
  );
  const cost = (r: ReturnType<typeof row>, date = '2025-02-12') => computeRow(ctx, r, date, W);

  it('豚こま 30g、単価メモ 100g 78円 → 23.4円', () => expect(cost(row('pork', 30)).cost).toBeCloseTo(23.4, 12));
  it('ナス 45g、820g で 158円 → 8.6707…円(行の表示は 8.7)', () => {
    const c = cost(row('eggplant', 45)).cost;
    expect(c).toBeCloseTo((158 * 45) / 820, 12);
    expect(formatNumber(c, 1)).toBe('8.7');
  });
  it('鶏むね 120g、1500g で 1260円 → 100.8円', () => expect(cost(row('chicken', 120)).cost).toBeCloseTo(100.8, 12));
  it('ラベル型 1枚 11円 → 1枚で11円、0.4枚で4.4円(グラムを経由しない)', () => {
    expect(cost(row('labelA', 1, '枚')).cost).toBe(11);
    expect(cost(row('labelA', 0.4, '枚')).cost).toBeCloseTo(4.4, 12);
    expect(cost(row('labelA', 0.4, '枚')).nutrients.ca).toBeCloseTo(72, 12);
  });
  it('合計は、丸めていない値を足してから丸める', () => {
    const d = computeDay(ctx, day('2025-02-12', { 昼: [[row('pork', 30), row('eggplant', 45), row('chicken', 120)]] }));
    expect(d.total.cost).toBeCloseTo(23.4 + (158 * 45) / 820 + 100.8, 9);
    expect(formatNumber(d.total.cost, 0)).toBe('133');
  });
});

describe('価格の選び方', () => {
  const x = foodIng('x', '06061');
  const none = foodIng('none', '06061');
  const p1 = price('x', '2025-02-03', 136, 1200);
  const p2 = price('x', '2025-03-02', 118, 450);
  const ctx = ctxOf([x, none], [p2, p1]);

  it('3/1 の食事 40g → 2/3 の価格 → 4.5333…円', () => {
    const r = computeRow(ctx, row('x', 40), '2025-03-01', W);
    expect(r.cost).toBeCloseTo(4.533333333333333, 12);
    expect(r.prices[0]?.entry.id).toBe(p1.id);
    expect(r.prices[0]?.future).toBe(false);
  });
  it('3/2 の食事 40g → 同じ日の記録を使う → 10.4888…円', () => {
    const r = computeRow(ctx, row('x', 40), '2025-03-02', W);
    expect(r.cost).toBeCloseTo(10.488888888888889, 12);
    expect(r.prices[0]?.entry.id).toBe(p2.id);
  });
  it('1/15 の食事 → 2/3 の価格で代用し、「未来の価格で代用」を数える', () => {
    const d = computeDay(ctx, day('2025-01-15', { 朝: [[row('x', 40)]] }));
    expect(d.total.cost).toBeCloseTo(4.533333333333333, 12);
    expect(d.rows[0]?.prices[0]?.future).toBe(true);
    expect(d.counts.futurePrice).toBe(1);
  });
  it('記録がまったくない食材 → 「価格未登録」で費用から除外(栄養には入る)', () => {
    const d = computeDay(ctx, day('2025-03-02', { 朝: [[row('none', 100), row('x', 40)]] }));
    expect(d.counts.noPrice).toBe(1);
    expect(d.total.cost).toBeCloseTo(10.488888888888889, 12);
    expect(d.total.nutrients.kcal).toBeCloseTo(23 + 9.2, 9);
  });
  it('同じ食材・同じ日の記録が複数あるときは、登録順で最後のもの(id の順ではない)', () => {
    const z = foodIng('z', '06061');
    const later = price('z', '2025-02-05', 200, 1000, 'g', { id: 'aaa', createdAt: '2025-02-05T12:00:00.000Z' });
    const earlier = price('z', '2025-02-05', 120, 1000, 'g', { id: 'zzz', createdAt: '2025-02-05T08:00:00.000Z' });
    const r = computeRow(ctxOf([z], [later, earlier]), row('z', 100), '2025-02-10', W);
    expect(r.prices[0]?.entry.id).toBe('aaa');
    expect(r.cost).toBeCloseTo(20, 12);
  });

  it('「費用に含めない」食材は 0円で、価格未登録に数えない', () => {
    const w: Ingredient = { ...foodIng('w', '06061'), costFree: true };
    const d = computeDay(ctxOf([w]), day('2025-02-12', { 朝: [[row('w', 100)]] }));
    expect(d.total.cost).toBe(0);
    expect(d.counts.noPrice).toBe(0);
    expect(d.rows[0]?.costIncluded).toBe(true);
  });

  it('グラムに直せず単位も違うときは「単価を確定できない」', () => {
    const y = foodIng('y', '06191');
    const c = ctxOf([y], [price('y', '2025-02-01', 144, 4, '本')]);
    const d = computeDay(c, day('2025-02-12', { 夜: [[row('y', 50)]] }));
    expect(d.counts.priceUnit).toBe(1);
    expect(d.total.cost).toBe(0);
  });
  it('購入記録に実重量(grams)があれば、それを購入量にする: 4尾 360g 300円 → 50g で 41.66…円', () => {
    const fish = foodIng('fish', '10047');
    const c = ctxOf([fish], [price('fish', '2025-02-01', 300, 4, '尾', { grams: 360 })]);
    expect(computeRow(c, row('fish', 50), '2025-02-12', W).cost).toBeCloseTo((300 * 50) / 360, 12);
  });
});

describe('レシピ', () => {
  const flour = foodIng('flour', '01018');
  // 水は栄養 0 のラベル型で、「費用に含めない(0円で扱う)」
  const water: Ingredient = { id: 'water', name: '水', aliases: [], units: [], costFree: true, source: { kind: 'label', per: { qty: 100, unit: 'g' }, nutrients: {} } };
  const bread: Ingredient = {
    id: 'bread',
    name: 'サンプルレシピC',
    aliases: [],
    units: [],
    source: { kind: 'recipe', components: [{ ingredientId: 'flour', qty: 350, unit: 'g' }, { ingredientId: 'water', qty: 230, unit: 'g' }], yieldG: 520 },
  };
  it('費用: 中力粉 1200g=312円 から 350g(91円)、水 230g(費用に含めない)、完成 520g → 60g 分は 91×60/520 = 10.5円', () => {
    const ctx = ctxOf([flour, water, bread], [price('flour', '2025-01-01', 312, 1200)]);
    const r = computeRow(ctx, row('bread', 60), '2025-02-12', W);
    expect(r.cost).toBeCloseTo((91 * 60) / 520, 12);
    expect(r.costIncluded).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('構成食材に価格のないもの(塩)があっても行は除外せず、価格のある分だけ足して「一部価格未登録」を数える', () => {
    const salt = foodIng('salt', '17012');
    const bread2: Ingredient = {
      ...bread,
      id: 'bread2',
      source: { kind: 'recipe', components: [{ ingredientId: 'flour', qty: 350, unit: 'g' }, { ingredientId: 'water', qty: 230, unit: 'g' }, { ingredientId: 'salt', qty: 6, unit: 'g' }], yieldG: 520 },
    };
    const ctx = ctxOf([flour, water, salt, bread2], [price('flour', '2025-01-01', 312, 1200)]);
    const d = computeDay(ctx, day('2025-02-12', { 朝: [[row('bread2', 60)]] }));
    expect(d.total.cost).toBeCloseTo((91 * 60) / 520, 12);
    expect(d.rows[0]?.costIncluded).toBe(true);
    expect(d.counts.partialPrice).toBe(1);
    expect(d.counts.noPrice).toBe(0);
    // 栄養には塩も入る(食塩 6g × 60/520)
    expect(d.total.nutrients.salt).toBeCloseTo((6 * 99.5) / 100 * (60 / 520), 9);
  });

  it('構成食材が未解決のときは、行ごと除外する', () => {
    const broken: Ingredient = { ...bread, id: 'broken', source: { kind: 'recipe', components: [{ ingredientId: 'flour', qty: 350, unit: 'g' }, { ingredientId: 'deleted', qty: 10, unit: 'g' }], yieldG: 300 } };
    const d = computeDay(ctxOf([flour, broken], [price('flour', '2025-01-01', 312, 1200)]), day('2025-02-12', { 朝: [[row('broken', 60)]] }));
    expect(d.rows[0]?.included).toBe(false);
    expect(d.rows[0]?.costIncluded).toBe(false);
    expect(d.counts.unresolved).toBe(1);
  });

  it('構成食材1つのレシピ(同価格の表現): 煮干し 500g=1150円、尾 4 = 9g → 4尾 = 20.7円、栄養は煮干し 9g と同じ', () => {
    const niboshi = foodIng('niboshi', '10045');
    const recipeA: Ingredient = {
      id: 'recipeA',
      name: 'サンプルレシピA',
      aliases: [],
      units: [{ unit: '尾', qty: 4, grams: 9 }],
      source: { kind: 'recipe', components: [{ ingredientId: 'niboshi', qty: 9, unit: 'g' }], yieldG: 9 },
    };
    const ctx = ctxOf([niboshi, recipeA], [price('niboshi', '2025-01-01', 1150, 500)]);
    const r = computeRow(ctx, row('recipeA', 4, '尾'), '2025-02-12', W);
    expect(r.cost).toBeCloseTo(20.7, 12);
    const direct = computeRow(ctx, row('niboshi', 9), '2025-02-12', W);
    for (const k of KEYS) expect(r.nutrients[k]).toBeCloseTo(direct.nutrients[k], 12);
  });

  it('栄養: A(100gあたり 360kcal)240g + B(0kcal)160g、完成 320g → 100gあたり 270kcal、45g で 121.5kcal', () => {
    const a: Ingredient = { id: 'a', name: 'A', aliases: [], units: [], source: { kind: 'label', per: { qty: 100, unit: 'g' }, nutrients: { kcal: 360 } } };
    const b: Ingredient = { id: 'b', name: 'B', aliases: [], units: [], source: { kind: 'label', per: { qty: 100, unit: 'g' }, nutrients: { kcal: 0 } } };
    const r: Ingredient = { id: 'r', name: 'R', aliases: [], units: [], source: { kind: 'recipe', components: [{ ingredientId: 'a', qty: 240, unit: 'g' }, { ingredientId: 'b', qty: 160, unit: 'g' }], yieldG: 320 } };
    const ctx = ctxOf([a, b, r]);
    const rc = computeRow(ctx, row('r', 45), '2025-02-12', W);
    expect(rc.nutrients.kcal).toBeCloseTo(121.5, 12);
    expect(rc.basis?.kind === 'per100g' && (rc.basis.values as Vec).kcal).toBeCloseTo(270, 12);
  });

  it('レシピの中のレシピも再帰して解け、循環はエラーにする', () => {
    const a: Ingredient = { id: 'a', name: 'A', aliases: [], units: [], source: { kind: 'label', per: { qty: 100, unit: 'g' }, nutrients: { kcal: 200 } } };
    const inner: Ingredient = { id: 'inner', name: '内', aliases: [], units: [], source: { kind: 'recipe', components: [{ ingredientId: 'a', qty: 100, unit: 'g' }], yieldG: 50 } };
    const outer: Ingredient = { id: 'outer', name: '外', aliases: [], units: [], source: { kind: 'recipe', components: [{ ingredientId: 'inner', qty: 50, unit: 'g' }], yieldG: 25 } };
    const c1: Ingredient = { id: 'c1', name: '循環1', aliases: [], units: [], source: { kind: 'recipe', components: [{ ingredientId: 'c2', qty: 10, unit: 'g' }], yieldG: 10 } };
    const c2: Ingredient = { id: 'c2', name: '循環2', aliases: [], units: [], source: { kind: 'recipe', components: [{ ingredientId: 'c1', qty: 10, unit: 'g' }], yieldG: 10 } };
    const ctx = ctxOf([a, inner, outer, c1, c2]);
    // a 100g = 200kcal → inner 50g に凝縮 → outer は inner 50g を 25g に → outer 10g = 200 × 10/25 = 80kcal
    expect(computeRow(ctx, row('outer', 10), '2025-02-12', W).nutrients.kcal).toBeCloseTo(80, 12);
    const d = computeDay(ctx, day('2025-02-12', { 朝: [[row('c1', 10)]] }));
    expect(d.counts.cycle).toBe(1);
    expect(d.total.nutrients.kcal).toBe(0);
  });

  it('内訳が空のレシピは 0 として数え、「内訳未登録」の件数に入る。内訳を登録すれば同じ日の集計が直る', () => {
    const empty: Ingredient = { id: 'pan', name: 'サンプルレシピB', aliases: [], units: [{ unit: '枚', qty: 1, grams: 40 }], source: { kind: 'recipe', components: [], yieldG: 0 } };
    const dayData = day('2025-02-12', { 朝: [[row('pan', 2, '枚')]] });
    const d1 = computeDay(ctxOf([empty, flour]), dayData);
    expect(d1.counts.emptyRecipe).toBe(1);
    expect(d1.total.nutrients.kcal).toBe(0);
    const filled: Ingredient = { ...empty, source: { kind: 'recipe', components: [{ ingredientId: 'flour', qty: 100, unit: 'g' }], yieldG: 100 } };
    const d2 = computeDay(ctxOf([filled, flour]), dayData);
    expect(d2.counts.emptyRecipe).toBe(0);
    expect(d2.total.nutrients.kcal).toBeGreaterThan(0);
  });
});

describe('ラベル型', () => {
  it('ナトリウムだけが書かれていれば 食塩 = Na(mg) × 2.54 / 1000。1錠 Na 400mg → 1/4錠で 0.254g', () => {
    const s: Ingredient = { id: 's', name: 'S', aliases: [], units: [], source: { kind: 'label', per: { qty: 1, unit: '錠' }, nutrients: { na: 400 } } };
    const r = computeRow(ctxOf([s]), row('s', parseQuantity('1/4'), '錠'), '2025-02-12', W);
    expect(r.nutrients.salt).toBeCloseTo(0.254, 12);
  });
  it('書いていない栄養素は未測定ではなく 0(警告しない)', () => {
    const s: Ingredient = { id: 's', name: 'S', aliases: [], units: [], source: { kind: 'label', per: { qty: 15, unit: 'g' }, nutrients: { kcal: 60 } } };
    const d = computeDay(ctxOf([s]), day('2025-02-12', { 間食: [[row('s', 30)]] }));
    expect(d.total.nutrients.kcal).toBe(120);
    expect(d.total.nutrients.vitc).toBe(0);
    expect(d.counts.unmeasured).toBe(0);
  });
});

describe('丸め', () => {
  it.each([
    [0.25, 1, 0.3],
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [1.45, 1, 1.5],
    [0.35, 1, 0.4],
    [-1.005, 2, -1.01],
    [-0.25, 1, -0.3],
    [1402.5, 0, 1403],
    [0.1 + 0.2, 1, 0.3],
    [(158 * 45) / 820, 1, 8.7],
    [1e-7, 2, 0],
  ])('%d を小数第%d位で → %d', (x, d, expected) => {
    expect(roundHalfUp(x, d)).toBe(expected);
  });
  it('桁を揃えた文字列', () => {
    expect(formatNumber(1.1, 2)).toBe('1.10');
    expect(formatNumber(15.03, 1)).toBe('15.0');
    expect(formatNumber(-0.04, 1)).toBe('0.0');
  });
});

describe('移動平均と平均', () => {
  it('体重 2/1=63.2、2/4=63.8、2/7=64.1 のとき、2/7 の7日移動平均 = 63.7、2/8 = 63.95(窓は 2/2〜2/8)', () => {
    const log = new Map([
      ['2025-02-01', 63.2],
      ['2025-02-04', 63.8],
      ['2025-02-07', 64.1],
    ]);
    expect(movingAverage7(log, '2025-02-07')).toBeCloseTo(63.7, 12);
    expect(movingAverage7(log, '2025-02-08')).toBeCloseTo(63.95, 12);
    expect(movingAverage7(log, '2025-02-20')).toBeNull();
  });
  it('連続7日 62.0, 62.3, 62.1, 62.6, 62.4, 62.9, 62.7 のとき、7日目の移動平均 = 62.428571…', () => {
    const vals = [62.0, 62.3, 62.1, 62.6, 62.4, 62.9, 62.7];
    const log = new Map(vals.map((v, i) => [addDays('2025-03-01', i), v]));
    expect(movingAverage7(log, '2025-03-07')).toBeCloseTo(437 / 7, 12);
  });
  it('週・月の平均と増減', () => {
    const log = new Map([
      ['2025-02-03', 64.0],
      ['2025-02-05', 64.4],
      ['2025-02-10', 63.5],
      ['2025-02-12', 63.9],
    ]);
    const w1 = weightStats(log, '2025-02-03', '2025-02-09');
    const w2 = weightStats(log, '2025-02-10', '2025-02-16');
    expect(w1.average).toBeCloseTo(64.2, 12);
    expect(w2.average).toBeCloseTo(63.7, 12);
    expect(weightChange(w2, w1)).toBeCloseTo(-0.5, 12);
  });

  it('週に4日だけ記録(2140, 1750, 1980, 2230 kcal)のとき、記録日平均 = 2025(記録 4/7日)、暦日平均 = 1157.142…', () => {
    const unit: Ingredient = { id: 'u', name: '100kcal', aliases: [], units: [], source: { kind: 'label', per: { qty: 1, unit: '個' }, nutrients: { kcal: 100 } } };
    const ctx = ctxOf([unit]);
    const kcal = { '2025-02-10': 21.4, '2025-02-11': 17.5, '2025-02-13': 19.8, '2025-02-15': 22.3 };
    const days = Object.entries(kcal).map(([date, q]) => computeDay(ctx, day(date, { 夜: [[row('u', q, '個')]] })));
    // 手動加算だけの日は「記録のある日」に数えない
    days.push(computeDay(ctx, day('2025-02-16', {}, [{ label: '日照', nutrients: { vitd: 5 } }])));
    const range = weekRange('2025-02-13', 1);
    expect(range).toEqual({ start: '2025-02-10', end: '2025-02-16', calendarDays: 7 });
    const rec = computePeriod(days, range, 'recordedDays');
    expect(rec.recordedDays).toBe(4);
    expect(rec.denominator).toBe(4);
    expect(rec.average?.nutrients.kcal).toBeCloseTo(2025, 9);
    const cal = computePeriod(days, range, 'calendarDays');
    expect(cal.average?.nutrients.kcal).toBeCloseTo(8100 / 7, 9);
  });
});

describe('日付', () => {
  it('週の始まり(月曜/日曜)', () => {
    expect(weekRange('2025-02-16', 1).start).toBe('2025-02-10'); // 日曜 → その週の月曜
    expect(weekRange('2025-02-16', 0).start).toBe('2025-02-16');
    expect(weekRange('2025-02-10', 1).start).toBe('2025-02-10');
  });
  it('暦月(うるう年)', () => {
    expect(monthRange('2024-02-15')).toEqual({ start: '2024-02-01', end: '2024-02-29', calendarDays: 29 });
    expect(monthRange('2025-12-31')).toEqual({ start: '2025-12-01', end: '2025-12-31', calendarDays: 31 });
  });
  it('ローカル時刻の深夜でも日付がずれない', () => {
    expect(todayLocal(new Date(2025, 0, 31, 23, 59))).toBe('2025-01-31');
    expect(todayLocal(new Date(2025, 1, 1, 0, 1))).toBe('2025-02-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});
