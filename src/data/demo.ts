// デモ(すべて架空)。持ち主のメモの書き方に似せた、2025年1月の約2週間分の献立と食材費のテキスト。
// 実データの期間と重ならない日付にしてあり、店名も「サンプルマート」「デモ商店」のような架空のもの。
// 読み取りの問題の見え方を確かめられるよう、未登録の食材・数量のない行・数字のない単位・少々・単位の重さが未登録・
// 内訳未登録・括弧の調理メモ・価格未登録の行をわざと入れている。
import { addDays } from '../core/dates.ts';
import type { Ingredient } from '../core/types.ts';

export const DEMO_START = '2025-01-06';
export const DEMO_DAYS = 14;
/** デモの日付の範囲(食材費は開始より前の日もある) */
export const DEMO_RANGE = { start: '2024-12-28', end: '2025-01-19' } as const;
/** デモの食材の id の頭(設定の「デモを消す」で消す対象) */
export const DEMO_PREFIX = 'demo-';

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

/** デモ用の食材(初期値の調味料・白米は含まない。それらは食材マスタの初期値にある) */
export function demoIngredients(): Ingredient[] {
  return [
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
    food('demo-niboshi', '煮干し', '10045', [{ unit: '尾', qty: 4, grams: 9 }]),
    // ナスは「本」の重さをわざと入れていない(単位の重さが未登録の例)
    food('demo-nasu', 'ナス', '06191', [], ['なす', '茄子']),
    { id: 'demo-water', name: '水', aliases: [], source: { kind: 'label', per: { qty: 100, unit: 'g' }, nutrients: {} }, units: [], unitsConfirmed: true, costFree: true, memo: '費用に含めない' },
    {
      id: 'demo-recipe-b',
      name: 'サンプルレシピB',
      aliases: [],
      source: { kind: 'recipe', components: [], yieldG: 0 },
      units: [{ unit: '枚', qty: 1, grams: 40, basis: 'manual' }],
      unitsConfirmed: true,
      memo: '内訳未登録の例(あとで材料と完成重量を登録する)',
    },
    label('demo-multi', 'デモ用マルチビタミン', { qty: 1, unit: '錠' }, { vita: 300, vitd: 5, vite: 6, b1: 1.2, b2: 1.4, nia: 12, b6: 1.4, b12: 2.4, fol: 240, pan: 5, vitc: 100 }),
    label('demo-vitc', 'デモ用ビタミンC', { qty: 1, unit: '錠' }, { vitc: 400 }),
  ];
}

const slash = (date: string) => date.replace(/-/g, '/');

/** 献立のテキスト(14日分)。日付の行は「2025/01/06」の形 */
export function demoMealText(): string {
  const weights = ['65.8', '66.1', null, '66.3', '65.9', '66.0', null, '65.7', '65.6', '66.0', null, '65.6', '65.4', '65.5'];
  const out: string[] = [];
  for (let i = 0; i < DEMO_DAYS; i++) {
    const date = addDays(DEMO_START, i);
    out.push(slash(date));
    const w = weights[i];
    if (w) out.push(`体重${w}kg`);
    out.push('朝');
    out.push(`オートミール${35 + (i % 3) * 5}g`);
    out.push('スキムミルク大さじ2');
    out.push(i % 2 === 0 ? 'バナナ1本' : 'ヨーグルト100g');
    if (i === 10) out.push('サンプルレシピB2枚');
    out.push('昼');
    if (i % 3 === 0) {
      out.push('サンプル料理A', 'パスタ乾麺100g', i === 9 ? '豚こま60g（100g89円）' : '豚こま60g', 'キャベツ80g', 'しょうゆ小さじ2', '菜種油小さじ0.8');
    } else if (i % 3 === 1) {
      out.push('サンプル料理B', '白米0.6合', '卵1個', i === 4 ? 'しょうゆ' : 'しょうゆ小さじ0.6');
    } else {
      out.push('サンプル料理C', '白米0.6合', '豚こま50g', 'キャベツ60g', 'にんじん0.2本', '菜種油大さじ0.6', i === 8 ? '塩少々' : '塩小さじ0.3');
    }
    if (i % 2 === 1) {
      out.push('間食');
      out.push(i === 1 ? 'サンプル菓子A2枚（1枚カルシウム160mgビタミンD1.2μg 12円）' : 'サンプル菓子A2枚');
      out.push('サンプルレシピC2尾（煮干し4尾9gと同価格）');
    }
    out.push('夜');
    out.push('白米0.7合', '納豆2パック', '');
    out.push('サンプル料理D', i === 12 ? 'みそ小さじ' : 'みそ大さじ0.8', '乾燥わかめ2g', '木綿豆腐60g', '水180g', '');
    out.push('サンプル料理E');
    out.push(i % 3 === 0 ? '鶏むね100g' : i % 3 === 1 ? 'イワシ1尾' : '卵2個');
    out.push('ほうれん草70g');
    if (i === 2) out.push('サンプル未登録食材20g');
    if (i === 7) out.push('ナス2本');
    if (i === 5) out.push('ナス20g（サンプル調理メモ）');
    if (i === 11) out.push('しょうゆ、みりん小さじ0.5');
    out.push('サプリ');
    out.push('デモ用マルチビタミン2錠', i % 2 === 0 ? 'デモ用ビタミンC1/3錠' : 'デモ用ビタミンC1錠');
    if (i % 4 === 0) out.push('日照によるビタミンD 7.5μg');
    if (i % 4 === 2) out.push('※サンプルメモ');
    out.push('');
  }
  return out.join('\n');
}

/** 食材費のテキスト(購入日ごと)。店名の行は「・」で始める */
export function demoPurchaseText(): string {
  return [
    '2024/12/28',
    '・サンプルマート',
    'オートミール1kg 478円',
    'スキムミルク200g 388円',
    '白米5kg 2380円',
    'しょうゆ1000mL 288円',
    '菜種油600g 378円',
    '砂糖1kg 228円',
    'みそ750g 288円',
    'パスタ乾麺1kg 248円',
    '乾燥わかめ50g 238円',
    '煮干し200g 478円',
    '塩1kg 154円',
    '・サンプル薬局',
    'デモ用マルチビタミン90錠 1280円',
    'デモ用ビタミンC60錠 588円',
    '',
    '2025/01/04',
    '・デモ商店',
    '納豆3パック 94円',
    '卵10個 238円',
    'キャベツ158円1150g',
    'にんじん4本590g 138円',
    'バナナ5本610g 178円',
    'ヨーグルト400g 158円',
    '木綿豆腐300g 68円',
    'ほうれん草200g 158円',
    '',
    '2025/01/11',
    '・デモ商店',
    '豚こま320g 368円',
    '鶏むね610g 427円',
    'イワシ4尾398g 296円',
    'ナス4本 158円',
    'キャベツ138円980g',
    '納豆3パック 94円',
    '',
  ].join('\n');
}

/** 「デモを貼り付ける」で貼り付け欄に入れるテキスト(献立と食材費) */
export function demoPasteText(): string {
  return `${demoPurchaseText()}\n${demoMealText()}`;
}
