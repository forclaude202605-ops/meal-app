// テキストから計算までの通しのテスト。期待値は、成分表の値と四則演算だけで出す(読み取りの実装の式は写さない)。
// 入力はすべて架空(食材名は実在、日付・数量・金額は架空)。
import { describe, expect, it } from 'vitest';
import { KEY_INDEX } from '../src/core/nutrients.ts';
import { buildJournal, mergeProblems, type Problem } from '../src/core/parse/journal.ts';
import { answerId, NUTRIENT_KEYS, textId, type AnswerTarget, type DayText, type Ingredient, type LineAnswer, type NutrientKey } from '../src/core/types.ts';
import { foodTable } from './helpers.ts';

const foods = foodTable();
/** 成分表の 100g あたりの値(未測定は 0) */
const v = (foodId: string, k: NutrientKey): number => foods.get(foodId)?.values[KEY_INDEX[k]] ?? 0;

const ing = (id: string, name: string, foodId: string, units: Ingredient['units'] = [], aliases: string[] = []): Ingredient => ({
  id,
  name,
  aliases,
  source: { kind: 'food', foodId },
  units,
});

/** テスト用の食材マスタ(単位の重さはテスト用の固定値) */
const INGS: Ingredient[] = [
  ing('t-oat', 'オートミール', '01004'),
  ing('t-skim', '脱脂粉乳', '13010', [{ unit: '大さじ', qty: 1, grams: 6 }], ['スキムミルク']),
  ing('t-rice', '白米', '01083', [{ unit: '合', qty: 1, grams: 150 }]),
  ing('t-pork', '豚こま', '11115'),
  ing('t-shoyu', 'しょうゆ', '17007', [{ unit: '小さじ', qty: 1, grams: 6 }]),
  ing('t-oil', 'なたね油', '14008', [{ unit: '小さじ', qty: 1, grams: 4 }]),
  ing('t-cabbage', 'キャベツ', '06061'),
  ing('t-niboshi', '煮干し', '10045', [{ unit: '尾', qty: 4, grams: 9 }]),
  ing('t-nasu', 'ナス', '06191'),
];

const text = (kind: 'meal' | 'purchase', date: string, body: string): DayText => ({ id: textId(kind, date), kind, date, text: body, updatedAt: '2024-11-30T00:00:00.000Z' });

const MEAL = [
  '体重58.2kg',
  '朝',
  'オートミール30g',
  'スキムミルク大さじ2',
  '昼',
  'サンプル料理A',
  '白米0.6合',
  '豚こま70g（100g87円）',
  'しょうゆ、なたね油小さじ1',
  '夜',
  'キャベツ120g',
  'サンプルレシピC2尾（煮干し4尾9gと同価格）',
  '日照によるビタミンD 6μg',
].join('\n');

const PURCHASE = [
  '・サンプルマート',
  'オートミール800g 356円',
  'スキムミルク200g 316円',
  '白米2kg 1060円',
  '豚こま300g 327円',
  'しょうゆ600g 214円',
  'なたね油1000g 412円',
  'キャベツ1kg 147円',
  '煮干し100g 245円',
].join('\n');

const BASE = [text('meal', '2024-11-04', MEAL), text('purchase', '2024-11-01', PURCHASE)];

describe('テキスト → 計算(通し)', () => {
  const j = buildJournal({ foods, ingredients: INGS, texts: BASE, answers: [] });
  const md = j.meals[0];
  if (!md) throw new Error('献立の日がない');

  // 区分ごとのグラム(成分表の食品番号 → g)
  const breakfast: [string, number][] = [
    ['01004', 30],
    ['13010', 12],
  ];
  const lunch: [string, number][] = [
    ['01083', 90],
    ['11115', 70],
    ['17007', 6],
    ['14008', 4],
  ];
  const dinner: [string, number][] = [
    ['06061', 120],
    ['10045', 9],
  ];
  const sum = (list: [string, number][], k: NutrientKey) => list.reduce((s, [f, g]) => s + (v(f, k) * g) / 100, 0);

  it('区分ごとの合計が、成分表の値と四則演算で出した値と一致する', () => {
    for (const k of ['kcal', 'protein', 'fat', 'carb', 'fiber', 'salt', 'ca', 'fe', 'vitc'] as NutrientKey[]) {
      expect(md.calc.slots['朝'].nutrients[k], `朝 ${k}`).toBeCloseTo(sum(breakfast, k), 9);
      expect(md.calc.slots['昼'].nutrients[k], `昼 ${k}`).toBeCloseTo(sum(lunch, k), 9);
      expect(md.calc.slots['夜'].nutrients[k], `夜 ${k}`).toBeCloseTo(sum(dinner, k), 9);
    }
  });

  it('日の合計 = 区分の和 + 日照のビタミンD', () => {
    const all = [...breakfast, ...lunch, ...dinner];
    expect(md.calc.total.nutrients.kcal).toBeCloseTo(sum(all, 'kcal'), 9);
    expect(md.calc.total.nutrients.vitd).toBeCloseTo(sum(all, 'vitd') + 6, 9);
    expect(md.calc.extras.nutrients.vitd).toBe(6);
    for (const k of NUTRIENT_KEYS) {
      const slots = md.calc.slots['朝'].nutrients[k] + md.calc.slots['昼'].nutrients[k] + md.calc.slots['間食'].nutrients[k] + md.calc.slots['夜'].nutrients[k] + md.calc.slots['サプリ'].nutrients[k];
      expect(md.calc.total.nutrients[k]).toBe(slots + md.calc.extras.nutrients[k]);
    }
  });

  it('費用: 購入記録と単価メモから、行ごとに 金額 × 重さ / 購入量 で出す', () => {
    const oat = (356 * 30) / 800;
    const skim = (316 * 12) / 200;
    const rice = (1060 * 90) / 2000;
    const pork = (87 * 70) / 100; // 単価メモ(食事の日の価格)を使う
    const shoyu = (214 * 6) / 600;
    const oil = (412 * 4) / 1000;
    const cabbage = (147 * 120) / 1000;
    const niboshi = (245 * 9) / 100; // 同価格: 煮干し 9g
    expect(md.calc.slots['朝'].cost).toBeCloseTo(oat + skim, 9);
    expect(md.calc.slots['昼'].cost).toBeCloseTo(rice + pork + shoyu + oil, 9);
    expect(md.calc.slots['夜'].cost).toBeCloseTo(cabbage + niboshi, 9);
    expect(md.calc.total.cost).toBeCloseTo(oat + skim + rice + pork + shoyu + oil + cabbage + niboshi, 9);
  });

  it('体重・料理名(推測と明示)・区分・複数の名前に1つの数量を読む', () => {
    expect(md.day.weightKg).toBe(58.2);
    const title = md.lines.find((l) => l.raw === 'サンプル料理A');
    expect(title?.type).toBe('title');
    expect(title?.guess).toContain('料理名とみなした');
    expect(md.day.slots['昼']?.[0]?.title).toBe('サンプル料理A');
    const shared = md.lines.find((l) => l.raw.startsWith('しょうゆ、'));
    expect(shared?.items?.map((i) => [i.ingredientId, i.qty, i.unit])).toEqual([
      ['t-shoyu', 1, '小さじ'],
      ['t-oil', 1, '小さじ'],
    ]);
    expect(shared?.detail).toContain('それぞれに同じ数量');
  });

  it('読めた行は問題にしない。価格は購入記録 8 件 + 単価メモ 1 件', () => {
    expect(mergeProblems(md.problems)).toEqual([]);
    expect(j.prices.filter((p) => p.source === 'purchase')).toHaveLength(8);
    expect(j.prices.filter((p) => p.source === 'inline')).toHaveLength(1);
    expect(j.purchases[0]?.total).toBe(356 + 316 + 1060 + 327 + 214 + 412 + 147 + 245);
  });

  it('同じテキストを2回読ませると、結果は完全に同じ', () => {
    const a = buildJournal({ foods, ingredients: INGS, texts: BASE, answers: [] });
    const b = buildJournal({ foods, ingredients: INGS, texts: [...BASE].reverse(), answers: [] });
    const pick = (x: typeof a) => JSON.stringify({ meals: x.meals.map((m) => ({ lines: m.lines, day: m.day, calc: m.calc, problems: m.problems })), purchases: x.purchases, prices: x.prices, defs: x.defs });
    expect(pick(b)).toBe(pick(a));
  });
});

describe('価格の優先: 同じ日に食材費と単価メモがあるときは単価メモ', () => {
  it('同じ日の購入記録より、献立の単価メモを使う', () => {
    const j = buildJournal({
      foods,
      ingredients: INGS,
      texts: [text('meal', '2024-11-04', '昼\n豚こま70g(100g87円)'), text('purchase', '2024-11-04', '豚こま300g 327円')],
      answers: [],
    });
    expect(j.meals[0]?.calc.total.cost).toBeCloseTo((87 * 70) / 100, 9);
    // 単価メモのない日(翌日)は、同じ日の単価メモが最新なので、それを使う
    const k = buildJournal({ foods, ingredients: INGS, texts: [text('meal', '2024-11-05', '昼\n豚こま70g'), text('meal', '2024-11-04', '昼\n豚こま10g(100g87円)'), text('purchase', '2024-11-04', '豚こま300g 327円')], answers: [] });
    expect(k.meals.find((m) => m.date === '2024-11-05')?.calc.total.cost).toBeCloseTo((87 * 70) / 100, 9);
  });
});

describe('問題と答え', () => {
  const MEAL2 = ['朝', 'しょうゆ', 'しょうゆ', '塩少々', '鶏がらスープ小さじ', 'ナス20g(サンプル調理メモ)', 'サンプル未登録食材15g'].join('\n');
  const t2 = text('meal', '2024-11-05', MEAL2);
  const problems = (answers: LineAnswer[] = [], ings = INGS) => mergeProblems(buildJournal({ foods, ingredients: ings, texts: [t2], answers }).meals[0]?.problems ?? []);
  const qtys = (ps: Problem[]) => ps.filter((p): p is Extract<Problem, { type: 'qty' }> => p.type === 'qty');

  it('数量のない行・数字のない単位・少々は、毎回聞く(同じ行が2つあっても別々に)', () => {
    const q = qtys(problems());
    expect(q.map((p) => [p.name, p.state, p.target.occurrence])).toEqual([
      ['しょうゆ', 'none', 0],
      ['しょうゆ', 'none', 1],
      ['塩', 'vague', 0],
      ['鶏がらスープ', 'unit-only', 0],
    ]);
  });

  it('未登録の食材と、括弧のメモの付いた名前は、割り当てを聞く', () => {
    const ps = problems();
    expect(ps.filter((p) => p.type === 'assign').map((p) => (p.type === 'assign' ? p.name : ''))).toEqual(expect.arrayContaining(['塩', '鶏がらスープ', 'サンプル未登録食材']));
    const note = ps.find((p) => p.type === 'note');
    expect(note).toMatchObject({ type: 'note', name: 'ナス', note: 'サンプル調理メモ', plainId: 't-nasu' });
  });

  it('答えはその行の補足として使い、同じ行の2つ目には使わない。別名を覚えれば割り当ての質問は消える', () => {
    const first = qtys(problems())[0] as Extract<Problem, { type: 'qty' }>;
    const ans: LineAnswer = { ...first.target, id: answerId(first.target), value: { type: 'qty', qty: 0.5, unit: '小さじ' }, ingredientId: 't-shoyu', answeredAt: '2024-11-05T10:00:00.000Z' };
    const j = buildJournal({ foods, ingredients: INGS, texts: [t2], answers: [ans] });
    const md = j.meals[0];
    const rows = md?.lines.filter((l) => l.raw === 'しょうゆ') ?? [];
    expect(rows[0]?.items?.[0]?.answered).toEqual({ type: 'qty', qty: 0.5, unit: '小さじ' });
    expect(rows[1]?.items?.[0]?.answered).toBeUndefined();
    expect(md?.calc.slots['朝'].nutrients.salt).toBeCloseTo((v('17007', 'salt') * 3) / 100, 9);
    // 2つ目の質問には「前回の値」が出る
    const rest = qtys(mergeProblems(md?.problems ?? []));
    expect(rest[0]).toMatchObject({ name: 'しょうゆ', last: { qty: 0.5, unit: '小さじ' } });
    // 別名を覚える(括弧のメモつき)と、割り当ての質問が消える
    const learned = INGS.map((i) => (i.id === 't-nasu' ? { ...i, aliases: ['ナス(サンプル調理メモ)'] } : i));
    expect(problems([], learned).some((p) => p.type === 'note')).toBe(false);
  });

  it('同じ日を貼り直しても、同じ行が残っていれば答えを引き継ぐ(行の位置が変わっても)', () => {
    const target: AnswerTarget = { kind: 'meal', date: '2024-11-05', lineKey: '朝|しょうゆ', occurrence: 1, item: 0 };
    const ans: LineAnswer = { ...target, id: answerId(target), value: { type: 'qty', qty: 2, unit: 'g' }, answeredAt: '2024-11-05T10:00:00.000Z' };
    const moved = text('meal', '2024-11-05', ['朝', 'オートミール30g', 'しょうゆ', '塩少々', 'しょうゆ'].join('\n'));
    const md = buildJournal({ foods, ingredients: INGS, texts: [moved], answers: [ans] }).meals[0];
    const rows = md?.lines.filter((l) => l.raw === 'しょうゆ') ?? [];
    expect(rows[0]?.items?.[0]?.answered).toBeUndefined();
    expect(rows[1]?.items?.[0]?.answered).toEqual({ type: 'qty', qty: 2, unit: 'g' });
  });

  it('区分の見出しより前の食材の行は、区分を聞き、答えるまで計算に入れない', () => {
    const t = text('meal', '2024-11-06', 'オートミール30g\n昼\nキャベツ50g');
    const j = buildJournal({ foods, ingredients: INGS, texts: [t], answers: [] });
    const md = j.meals[0];
    const slotP = md?.problems.find((p) => p.type === 'slot');
    expect(slotP).toBeDefined();
    expect(md?.calc.total.nutrients.kcal).toBeCloseTo((v('06061', 'kcal') * 50) / 100, 9);
    if (slotP?.type !== 'slot') throw new Error('slot');
    const ans: LineAnswer = { ...slotP.target, id: answerId(slotP.target), value: { type: 'slot', slot: '朝' }, answeredAt: '2024-11-06T00:00:00.000Z' };
    const k = buildJournal({ foods, ingredients: INGS, texts: [t], answers: [ans] }).meals[0];
    expect(k?.calc.slots['朝'].nutrients.kcal).toBeCloseTo((v('01004', 'kcal') * 30) / 100, 9);
    expect(k?.problems.some((p) => p.type === 'slot')).toBe(false);
  });

  it('単位の重さがない・価格がない・mg の購入は、それぞれの問題になる', () => {
    const j = buildJournal({
      foods,
      ingredients: INGS,
      texts: [text('meal', '2024-11-07', '夜\nナス2本\nキャベツ50g'), text('purchase', '2024-11-01', 'しょうゆ300mg 154円')],
      answers: [],
    });
    const ps = mergeProblems(j.meals[0]?.problems ?? []);
    expect(ps.find((p) => p.type === 'unit')).toMatchObject({ ingredientId: 't-nasu', unit: '本' });
    // ナスは単位の重さがなく計算から外れるので、価格の問題はキャベツだけ
    expect(ps.filter((p) => p.type === 'calc')).toEqual([expect.objectContaining({ issue: 'no-price', ingredientId: 't-cabbage' })]);
    expect(j.purchases[0]?.problems.find((p) => p.type === 'mg')).toMatchObject({ name: 'しょうゆ', qty: 300 });
    expect(j.prices).toHaveLength(0);
  });

  it('読めない行は黙って捨てず、問題として残す', () => {
    const j = buildJournal({ foods, ingredients: INGS, texts: [text('meal', '2024-11-08', '朝\n日照あり\n(サンプルメモ)')], answers: [] });
    const unread = j.meals[0]?.problems.filter((p) => p.type === 'unread') ?? [];
    expect(unread).toHaveLength(2);
    expect(j.meals[0]?.lines.filter((l) => l.type === 'unread')).toHaveLength(2);
  });
});

describe('その場での定義', () => {
  it('1枚あたりの栄養と価格を、その日以降(なければ前の日)の同じ名前の行に使う', () => {
    const j = buildJournal({
      foods,
      ingredients: INGS,
      texts: [text('meal', '2024-11-04', '間食\nサンプル菓子A2枚(1枚カルシウム160mgビタミンD1.2μg 12円)'), text('meal', '2024-11-05', '間食\nサンプル菓子A3枚'), text('meal', '2024-11-03', '間食\nサンプル菓子A1枚')],
      answers: [],
    });
    const byDate = new Map(j.meals.map((m) => [m.date, m]));
    expect(byDate.get('2024-11-04')?.calc.total.nutrients.ca).toBeCloseTo(320, 9);
    expect(byDate.get('2024-11-04')?.calc.total.cost).toBeCloseTo(24, 9);
    expect(byDate.get('2024-11-05')?.calc.total.nutrients.ca).toBeCloseTo(480, 9);
    expect(byDate.get('2024-11-05')?.calc.total.nutrients.vitd).toBeCloseTo(3.6, 9);
    expect(byDate.get('2024-11-05')?.calc.total.cost).toBeCloseTo(36, 9);
    // 定義より前の日は、後の定義を使い、価格は「未来の価格で代用」
    expect(byDate.get('2024-11-03')?.calc.total.nutrients.ca).toBeCloseTo(160, 9);
    expect(byDate.get('2024-11-03')?.calc.counts.futurePrice).toBe(1);
  });
});
