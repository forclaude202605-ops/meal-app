// デモデータ(すべて架空)。動作確認用に、2025年1月の約2週間分の食事・体重・食材費を作る。
// 実データの期間と重ならない日付にしてあり、店名も「デモ商店」「サンプルマート」のような架空のもの。
// 画面で警告の見え方を確かめられるよう、未解決・数量なし・単位換算なし・内訳未登録・価格未登録の行をわざと入れている。
import type { FoodTable } from '../core/nutrients.ts';
import { addDays } from '../core/dates.ts';
import { DEFAULT_SETTINGS, type Day, type Dish, type Ingredient, type PriceEntry, type Row, type SlotName } from '../core/types.ts';
import type { AppData } from './backup.ts';
import { defaultIngredients } from './defaultIngredients.ts';

export const DEMO_START = '2025-01-06';
export const DEMO_DAYS = 14;

const food = (id: string, name: string, foodId: string, units: Ingredient['units'] = [], aliases: string[] = []): Ingredient => ({
  id,
  name,
  aliases,
  source: { kind: 'food', foodId },
  units: units.map((u) => ({ ...u, basis: 'manual' as const })),
  unitsConfirmed: false,
  memo: 'デモ用の食材(換算は架空)',
});

const label = (id: string, name: string, per: { qty: number; unit: string }, nutrients: Record<string, number>): Ingredient => ({
  id,
  name,
  aliases: [],
  source: { kind: 'label', per, nutrients },
  units: [],
  unitsConfirmed: true,
  memo: 'デモ用のラベル値(架空)',
});

export function demoIngredients(foods: FoodTable): Ingredient[] {
  return [
    ...defaultIngredients(foods),
    food('demo-oat', 'オートミール', '01004'),
    food('demo-skim', '脱脂粉乳', '13010', [{ unit: '大さじ', qty: 1, grams: 6 }], ['スキムミルク']),
    food('demo-natto', '納豆', '04046', [{ unit: 'パック', qty: 1, grams: 45 }], ['なっとう']),
    food('demo-egg', '卵', '12004', [{ unit: '個', qty: 1, grams: 55 }], ['たまご', '玉子']),
    food('demo-cabbage', 'キャベツ', '06061'),
    food('demo-carrot', 'にんじん', '06212', [{ unit: '本', qty: 1, grams: 150 }], ['人参']),
    food('demo-onion', '玉ねぎ', '06153', [{ unit: '個', qty: 1, grams: 190 }], ['たまねぎ']),
    food('demo-pork', '豚こま', '11115', [], ['豚こま切れ']),
    food('demo-chicken', '鶏むね', '11220', [], ['鶏むね肉']),
    food('demo-iwashi', 'イワシ', '10047', [{ unit: '尾', qty: 1, grams: 95 }], ['いわし', 'まいわし']),
    food('demo-pasta', 'パスタ乾麺', '01063', [], ['パスタ', 'スパゲッティ']),
    food('demo-tofu', '木綿豆腐', '04032', [{ unit: '丁', qty: 1, grams: 300 }], ['豆腐']),
    food('demo-banana', 'バナナ', '07107', [{ unit: '本', qty: 1, grams: 100 }]),
    food('demo-yogurt', 'ヨーグルト', '13025'),
    food('demo-spinach', 'ほうれん草', '06267', [], ['ほうれんそう']),
    food('demo-wakame', '乾燥わかめ', '09040', [], ['わかめ']),
    food('demo-niboshi', '煮干し', '10045', [{ unit: '尾', qty: 5, grams: 11 }]),
    // ナスは「本」の換算をわざと入れていない(単位換算が未設定の例)
    food('demo-nasu', 'ナス', '06191', [], ['なす', '茄子']),
    { id: 'demo-water', name: '水', aliases: [], source: { kind: 'label', per: { qty: 100, unit: 'g' }, nutrients: {} }, units: [], unitsConfirmed: true, costFree: true, memo: '費用に含めない' },
    {
      id: 'demo-recipe-a',
      name: 'サンプルレシピA(デモ)',
      aliases: [],
      source: { kind: 'recipe', components: [{ ingredientId: 'demo-niboshi', qty: 11, unit: 'g' }], yieldG: 11 },
      units: [{ unit: '尾', qty: 5, grams: 11, basis: 'manual' }],
      unitsConfirmed: true,
      memo: '構成食材1つのレシピ。煮干しと同じ価格・同じ栄養として扱う例',
    },
    {
      id: 'demo-recipe-b',
      name: 'サンプルレシピB(デモ)',
      aliases: [],
      source: { kind: 'recipe', components: [], yieldG: 0 },
      units: [{ unit: '枚', qty: 1, grams: 40, basis: 'manual' }],
      unitsConfirmed: true,
      memo: '内訳未登録の例(あとで材料と完成重量を登録する)',
    },
    label('demo-multi', 'デモ用マルチビタミン', { qty: 1, unit: '錠' }, { vita: 300, vitd: 5, vite: 6, b1: 1.2, b2: 1.4, nia: 12, b6: 1.4, b12: 2.4, fol: 240, pan: 5, vitc: 100 }),
    label('demo-vitc', 'デモ用ビタミンC', { qty: 1, unit: '錠' }, { vitc: 400 }),
    label('demo-snack', 'サンプル菓子A(デモ)', { qty: 1, unit: '枚' }, { kcal: 30, protein: 0.5, carb: 6.8, ca: 160, vitd: 1.2 }),
  ];
}

export function demoPrices(): PriceEntry[] {
  const list: [string, string, number, number, string, number | undefined, string, 'purchase' | 'inline'][] = [
    // [日付, 食材, 円, 量, 単位, 実重量g, 店, 種類]
    ['2024-12-28', 'demo-oat', 498, 1000, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'demo-skim', 398, 200, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'def-hakumai', 2380, 5000, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'def-shoyu', 298, 1000, 'mL', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'def-natane', 398, 600, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'def-sato', 228, 1000, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'def-miso', 298, 750, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'demo-pasta', 258, 1000, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'demo-wakame', 248, 50, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'demo-niboshi', 498, 200, 'g', undefined, 'サンプルマート', 'purchase'],
    ['2024-12-28', 'demo-multi', 1280, 90, '錠', undefined, 'サンプル薬局', 'purchase'],
    ['2024-12-28', 'demo-vitc', 598, 60, '錠', undefined, 'サンプル薬局', 'purchase'],
    ['2025-01-04', 'demo-natto', 94, 3, 'パック', undefined, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-egg', 238, 10, '個', undefined, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-cabbage', 158, 1150, 'g', undefined, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-carrot', 138, 4, '本', 590, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-onion', 188, 3, '個', 620, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-banana', 178, 5, '本', 610, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-yogurt', 158, 400, 'g', undefined, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-tofu', 68, 300, 'g', undefined, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-spinach', 158, 200, 'g', undefined, 'デモ商店', 'purchase'],
    ['2025-01-04', 'demo-snack', 12, 1, '枚', undefined, 'デモ商店', 'purchase'],
    ['2025-01-11', 'demo-pork', 368, 320, 'g', undefined, 'デモ商店', 'purchase'],
    ['2025-01-11', 'demo-chicken', 427, 610, 'g', undefined, 'デモ商店', 'purchase'],
    ['2025-01-11', 'demo-iwashi', 296, 4, '尾', 398, 'デモ商店', 'purchase'],
    ['2025-01-11', 'demo-nasu', 158, 4, '本', undefined, 'デモ商店', 'purchase'],
    ['2025-01-11', 'demo-cabbage', 138, 980, 'g', undefined, 'デモ商店', 'purchase'],
    ['2025-01-11', 'demo-natto', 94, 3, 'パック', undefined, 'デモ商店', 'purchase'],
    // 食事メモの中の単価メモ(例: 豚こま30g(100g89円))
    ['2025-01-15', 'demo-pork', 89, 100, 'g', undefined, '', 'inline'],
  ];
  return list.map(([date, ingredientId, yen, qty, unit, grams, store, source], i) => ({
    id: `demo-price-${String(i + 1).padStart(3, '0')}`,
    date,
    ingredientId,
    yen,
    qty,
    unit,
    ...(grams !== undefined ? { grams } : {}),
    ...(store ? { store } : {}),
    ...(i === 14 ? { note: 'サンプルの補足(デモ)' } : {}),
    source,
    createdAt: `${date}T${String(9 + Math.floor(i / 10)).padStart(2, '0')}:${String((i % 10) * 5).padStart(2, '0')}:00.000Z`,
  }));
}

const r = (ingredientId: string | undefined, rawName: string, qty: number | null, unit = 'g', note?: string): Row => ({
  ...(ingredientId ? { ingredientId } : {}),
  rawName,
  qty,
  unit,
  ...(note ? { note } : {}),
});

export function demoDays(): Day[] {
  const weights = [66.4, 66.1, undefined, 66.3, 65.9, 66.0, undefined, 65.8, 65.7, 66.0, undefined, 65.6, 65.4, 65.5];
  const days: Day[] = [];
  for (let i = 0; i < DEMO_DAYS; i++) {
    const date = addDays(DEMO_START, i);
    const slots: Partial<Record<SlotName, Dish[]>> = {};
    // 朝
    slots['朝'] = [
      {
        rows: [
          r('demo-oat', 'オートミール', 35 + (i % 3) * 5),
          r('demo-skim', '脱脂粉乳', 2, '大さじ'),
          i % 2 === 0 ? r('demo-banana', 'バナナ', 1, '本') : r('demo-yogurt', 'ヨーグルト', 100),
          ...(i === 10 ? [r('demo-recipe-b', 'サンプルレシピB(デモ)', 2, '枚')] : []),
        ],
      },
    ];
    // 昼
    const lunch: Dish =
      i % 3 === 0
        ? { title: 'サンプル料理A', rows: [r('demo-pasta', 'パスタ乾麺', 100), r('demo-pork', '豚こま', 60), r('demo-cabbage', 'キャベツ', 80), r('def-shoyu', 'しょうゆ', 2, '小さじ'), r('def-natane', '菜種油', 0.8, '小さじ')] }
        : i % 3 === 1
          ? { title: 'サンプル料理B', rows: [r('def-hakumai', '白米', 0.6, '合'), r('demo-egg', '卵', 1, '個'), r('def-shoyu', 'しょうゆ', 0.6, '小さじ')] }
          : { title: 'サンプル料理C', rows: [r('def-hakumai', '白米', 0.6, '合'), r('demo-pork', '豚こま', 50), r('demo-cabbage', 'キャベツ', 60), r('demo-carrot', 'にんじん', 0.2, '本'), r('def-natane', '菜種油', 0.6, '大さじ'), r('def-shio', '塩', 0.3, '小さじ')] };
    slots['昼'] = [lunch];
    // 間食
    if (i % 2 === 1) slots['間食'] = [{ rows: [r('demo-recipe-a', 'サンプルレシピA(デモ)', 2, '尾'), r('demo-snack', 'サンプル菓子A(デモ)', 2, '枚')] }];
    // 夜
    const main =
      i % 3 === 0 ? r('demo-chicken', '鶏むね', 100) : i % 3 === 1 ? r('demo-iwashi', 'イワシ', 1, '尾') : r('demo-egg', '卵', 2, '個');
    const dinner: Dish[] = [
      { rows: [r('def-hakumai', '白米', 0.7, '合'), r('demo-natto', '納豆', 2, 'パック')] },
      { title: 'サンプル料理D', rows: [r('def-miso', 'みそ', i === 4 ? null : 0.8, '大さじ'), r('demo-wakame', '乾燥わかめ', 2), r('demo-tofu', '木綿豆腐', 60), r('demo-water', '水', 180)] },
      { title: 'サンプル料理E', rows: [main, r('demo-spinach', 'ほうれん草', 70), ...(i === 2 ? [r(undefined, 'サンプル未登録食材', 20)] : []), ...(i === 7 ? [r('demo-nasu', 'ナス', 2, '本')] : []), ...(i === 11 ? [r('def-mirin', 'みりん', 0.8, '小さじ')] : [])] },
    ];
    slots['夜'] = dinner;
    // サプリ
    slots['サプリ'] = [{ rows: [r('demo-multi', 'デモ用マルチビタミン', 2, '錠'), r('demo-vitc', 'デモ用ビタミンC', 1, '錠', 'サンプルメモ')] }];
    const w = weights[i];
    days.push({
      date,
      ...(w !== undefined ? { weightKg: w } : {}),
      slots,
      extras: i % 4 === 0 ? [{ label: '日照によるビタミンD', nutrients: { vitd: 7.5 } }] : [],
      ...(i % 4 === 0 ? { memo: 'サンプルメモ(デモ)' } : {}),
    });
  }
  return days;
}

export function demoData(foods: FoodTable): AppData {
  return { ingredients: demoIngredients(foods), prices: demoPrices(), days: demoDays(), settings: { ...DEFAULT_SETTINGS } };
}
