// 性質テスト(仕様書 §12)。ランダムな入力でも、計算の性質が保たれることを確かめる。
// 食材マスタ・価格・日付はすべて架空。
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeDay, computePeriod, contributions, type DayCalc, type Totals } from '../src/core/calc.ts';
import { addDays, monthRange, weekRange } from '../src/core/dates.ts';
import { NUTRIENT_KEYS, SLOT_NAMES, type Day, type Ingredient, type Row, type SlotName } from '../src/core/types.ts';
import { ctxOf, foodIng, price } from './helpers.ts';

// ---- 架空の食材マスタ ----
const ings: Ingredient[] = [
  foodIng('rice', '01083', [{ unit: '合', qty: 1, grams: 155 }]),
  foodIng('soy', '17007', [{ unit: '大さじ', qty: 1, grams: 17.5 }, { unit: '小さじ', qty: 1, grams: 6 }]),
  foodIng('carrot', '06212', [{ unit: '本', qty: 1, grams: 140 }]),
  foodIng('egg', '12004', [{ unit: '個', qty: 1, grams: 55 }]),
  foodIng('niboshi', '10045', [{ unit: '尾', qty: 5, grams: 11 }]),
  foodIng('noPrice', '06153'), // 価格なし
  foodIng('noUnit', '06191'), // 本 の換算なし
  { id: 'tab', name: '錠剤', aliases: [], units: [], source: { kind: 'label', per: { qty: 1, unit: '錠' }, nutrients: { vitc: 320, na: 3 } } },
  { id: 'snack', name: '菓子', aliases: [], units: [{ unit: '枚', qty: 1, grams: 9 }], source: { kind: 'label', per: { qty: 15, unit: 'g' }, nutrients: { kcal: 72, protein: 1.2, fat: 3.1, carb: 10.4 } } },
  { id: 'bread', name: 'パン', aliases: [], units: [{ unit: '枚', qty: 1, grams: 38 }], source: { kind: 'recipe', components: [{ ingredientId: 'rice', qty: 300, unit: 'g' }, { ingredientId: 'egg', qty: 1, unit: '個' }], yieldG: 410 } },
  // 価格のない構成食材(noPrice)と、費用に含めない構成食材(water)を含むレシピ
  { id: 'nest', name: '入れ子', aliases: [], units: [], source: { kind: 'recipe', components: [{ ingredientId: 'bread', qty: 2, unit: '枚' }, { ingredientId: 'soy', qty: 1, unit: '小さじ' }, { ingredientId: 'noPrice', qty: 20, unit: 'g' }, { ingredientId: 'water', qty: 30, unit: 'g' }], yieldG: 90 } },
  { id: 'water', name: '水', aliases: [], units: [], costFree: true, source: { kind: 'label', per: { qty: 100, unit: 'g' }, nutrients: {} } },
];
const prices = [
  price('rice', '2024-12-01', 2480, 5000),
  price('rice', '2025-01-20', 2680, 5000),
  price('soy', '2024-11-15', 298, 1000),
  price('carrot', '2025-01-05', 158, 3, '本', { grams: 455 }),
  price('egg', '2024-12-10', 248, 10, '個'),
  price('niboshi', '2024-12-01', 640, 200),
  price('noUnit', '2025-01-01', 176, 4, '本'),
  price('tab', '2024-12-01', 980, 60, '錠'),
  price('snack', '2025-01-10', 176, 120),
];
const ctx = ctxOf(ings, prices);

const choices: [string | undefined, string[]][] = [
  ['rice', ['g', '合']],
  ['soy', ['g', '大さじ', '小さじ']],
  ['carrot', ['g', '本']],
  ['egg', ['g', '個']],
  ['niboshi', ['g', '尾']],
  ['noPrice', ['g']],
  ['noUnit', ['本']],
  ['tab', ['錠']],
  ['snack', ['g', '枚']],
  ['bread', ['g', '枚']],
  ['nest', ['g']],
  [undefined, ['g']], // 未解決
];

const rowArb: fc.Arbitrary<Row> = fc
  .tuple(fc.integer({ min: 0, max: choices.length - 1 }), fc.integer({ min: 0, max: 2 }), fc.double({ min: 0.05, max: 400, noNaN: true }), fc.boolean())
  .map(([ci, ui, qty, missingQty]) => {
    const [id, units] = choices[ci] ?? [undefined, ['g']];
    const unit = units[ui % units.length] ?? 'g';
    return { ...(id ? { ingredientId: id } : {}), rawName: id ?? '未登録', qty: missingQty && ci % 5 === 0 ? null : qty, unit };
  });

const dayArb = (date: string): fc.Arbitrary<Day> =>
  fc
    .record({
      slots: fc.dictionary(fc.constantFrom(...SLOT_NAMES), fc.array(fc.array(rowArb, { maxLength: 4 }), { maxLength: 3 })),
      vitd: fc.option(fc.double({ min: 0, max: 20, noNaN: true }), { nil: undefined }),
    })
    .map(({ slots, vitd }) => ({
      date,
      slots: Object.fromEntries(Object.entries(slots).map(([k, dishes]) => [k, dishes.map((rows) => ({ rows }))])) as Day['slots'],
      extras: vitd === undefined ? [] : [{ label: '日照', nutrients: { vitd } }],
    }));

const dateArb = fc.integer({ min: 0, max: 120 }).map((n) => addDays('2024-11-01', n));

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function expectTotalsClose(a: Totals, b: Totals) {
  for (const k of NUTRIENT_KEYS) expect(close(a.nutrients[k], b.nutrients[k]), `${k}: ${a.nutrients[k]} vs ${b.nutrients[k]}`).toBe(true);
  expect(close(a.cost, b.cost), `cost: ${a.cost} vs ${b.cost}`).toBe(true);
}

const mapRows = (d: Day, f: (r: Row) => Row): Day => ({
  ...d,
  slots: Object.fromEntries(Object.entries(d.slots).map(([k, dishes]) => [k, (dishes ?? []).map((dish) => ({ ...dish, rows: dish.rows.map(f) }))])) as Day['slots'],
});

describe('性質テスト', () => {
  it('数量を k 倍すると、食事由来の栄養と費用が k 倍になる', () => {
    fc.assert(
      fc.property(dateArb.chain(dayArb), fc.double({ min: 0.1, max: 8, noNaN: true }), (d, k) => {
        const base = computeDay(ctx, { ...d, extras: [] });
        const scaled = computeDay(ctx, mapRows({ ...d, extras: [] }, (r) => ({ ...r, qty: r.qty === null ? null : r.qty * k })));
        for (const key of NUTRIENT_KEYS) expect(close(scaled.total.nutrients[key], base.total.nutrients[key] * k)).toBe(true);
        expect(close(scaled.total.cost, base.total.cost * k)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('区分ごとの小計の和 + 手動加算 = 日の合計(完全に一致)', () => {
    fc.assert(
      fc.property(dateArb.chain(dayArb), (d) => {
        const c = computeDay(ctx, d);
        for (const key of NUTRIENT_KEYS) {
          let s = 0;
          for (const slot of SLOT_NAMES) s += c.slots[slot].nutrients[key];
          expect(s).toBe(c.meals.nutrients[key]);
          expect(s + c.extras.nutrients[key]).toBe(c.total.nutrients[key]);
        }
        let cost = 0;
        for (const slot of SLOT_NAMES) cost += c.slots[slot].cost;
        expect(cost + c.extras.cost).toBe(c.total.cost);
      }),
      { numRuns: 300 },
    );
  });

  it('日の合計の和 = 週・月の合計(完全に一致)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 12 }), fc.integer(), (startN, offsets, seed) => {
        const anchor = addDays('2024-12-01', startN);
        const dates = [...new Set(offsets.map((o) => addDays(anchor, o)))];
        const days: DayCalc[] = dates.map((date, i) => computeDay(ctx, fc.sample(dayArb(date), { numRuns: 1, seed: seed + i })[0] as Day));
        for (const range of [weekRange(anchor, 1), weekRange(anchor, 0), monthRange(anchor)]) {
          const p = computePeriod(days, range, 'recordedDays');
          const inRange = days.filter((d) => d.date >= range.start && d.date <= range.end).sort((a, b) => (a.date < b.date ? -1 : 1));
          for (const key of NUTRIENT_KEYS) {
            let s = 0;
            for (const d of inRange) s += d.total.nutrients[key];
            expect(s).toBe(p.total.nutrients[key]);
          }
          let cost = 0;
          for (const d of inRange) cost += d.total.cost;
          expect(cost).toBe(p.total.cost);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('行の順番を入れ替えても、合計は(浮動小数点の誤差の範囲で)変わらない', () => {
    fc.assert(
      fc.property(dateArb, fc.array(rowArb, { maxLength: 15 }), fc.integer(), (date, rows, seed) => {
        const shuffled = fc.sample(fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }), { numRuns: 1, seed })[0] ?? rows;
        const a = computeDay(ctx, { date, slots: { 昼: [{ rows }] }, extras: [] });
        const b = computeDay(ctx, { date, slots: { 昼: [{ rows: shuffled }] }, extras: [] });
        expectTotalsClose(a.total, b.total);
        expect(a.counts).toEqual(b.counts);
      }),
      { numRuns: 300 },
    );
  });

  it('内訳の寄与量の和 = 合計', () => {
    fc.assert(
      fc.property(dateArb.chain(dayArb), fc.constantFrom(...NUTRIENT_KEYS, 'cost' as const), (d, what) => {
        const c = computeDay(ctx, d);
        const sum = contributions(c, d.extras, what).reduce((s, x) => s + x.value, 0);
        const total = what === 'cost' ? c.total.cost : c.total.nutrients[what];
        expect(close(sum, total), `${what}: ${sum} vs ${total}`).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('未解決・数量なし・単位換算なしの行は栄養にも費用にも入らず、価格未登録の行は費用に入らない。どれも必ず件数に数えられる', () => {
    fc.assert(
      fc.property(dateArb.chain(dayArb), (d) => {
        const c = computeDay(ctx, d);
        let unresolved = 0;
        let noQty = 0;
        let noUnit = 0;
        let noPrice = 0;
        for (const r of c.rows) {
          const kinds = new Set(r.issues.map((i) => i.kind));
          if (kinds.has('unresolved') || kinds.has('no-qty') || kinds.has('no-unit')) {
            expect(r.included).toBe(false);
            expect(r.costIncluded).toBe(false);
            for (const k of NUTRIENT_KEYS) expect(r.nutrients[k]).toBe(0);
            expect(r.cost).toBe(0);
          }
          if (kinds.has('no-price') || kinds.has('price-unit')) {
            expect(r.costIncluded).toBe(false);
            expect(r.cost).toBe(0);
          }
          if (kinds.has('unresolved')) unresolved++;
          if (kinds.has('no-qty')) noQty++;
          if (kinds.has('no-unit')) noUnit++;
          if (kinds.has('no-price')) noPrice++;
          if (!r.row.ingredientId) expect(kinds.has('unresolved')).toBe(true);
          if (r.row.ingredientId && r.row.qty === null) expect(kinds.has('no-qty')).toBe(true);
        }
        expect(c.counts.unresolved).toBe(unresolved);
        expect(c.counts.noQty).toBe(noQty);
        expect(c.counts.noUnit).toBe(noUnit);
        expect(c.counts.noPrice).toBe(noPrice);
        // 価格のない食材(noPrice)を、数量ありで使った行は必ず「価格未登録」
        for (const r of c.rows) if (r.row.ingredientId === 'noPrice' && r.row.qty !== null) expect(r.issues.some((i) => i.kind === 'no-price')).toBe(true);
        // 本の換算がない食材(noUnit)は必ず「単位換算が未設定」
        for (const r of c.rows) if (r.row.ingredientId === 'noUnit' && r.row.qty !== null) expect(r.issues.some((i) => i.kind === 'no-unit')).toBe(true);
        // 価格のない構成食材を含むレシピは、除外されず「一部価格未登録」
        for (const r of c.rows) {
          if (r.row.ingredientId === 'nest' && r.row.qty !== null) {
            expect(r.costIncluded).toBe(true);
            expect(r.issues.some((i) => i.kind === 'partial-price')).toBe(true);
            expect(r.issues.some((i) => i.kind === 'no-price')).toBe(false);
          }
        }
        expect(c.counts.partialPrice).toBe(c.rows.filter((r) => r.issues.some((i) => i.kind === 'partial-price')).length);
      }),
      { numRuns: 300 },
    );
  });

  it('同じ入力なら必ず同じ結果(決定的)', () => {
    fc.assert(
      fc.property(dateArb.chain(dayArb), (d) => {
        expect(JSON.stringify(computeDay(ctx, d))).toBe(JSON.stringify(computeDay(ctx, structuredClone(d))));
      }),
      { numRuns: 100 },
    );
  });
});

// 区分名の型が SLOT_NAMES と一致していることの確認(コンパイル時)
const _slotCheck: SlotName[] = [...SLOT_NAMES];
void _slotCheck;
