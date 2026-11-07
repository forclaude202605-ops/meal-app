// 栄養と費用の計算(仕様書 §5.1〜5.4)。純関数のみ。保存はせず、毎回ここで計算する。
import { type FoodTable } from './nutrients.ts';
import { costOf, indexPrices, pickPrice, type PricePick } from './price.ts';
import { sameUnit, toGrams } from './quantity.ts';
import {
  NUTRIENT_KEYS,
  SLOT_NAMES,
  type Day,
  type DayExtra,
  type Ingredient,
  type NutrientKey,
  type Nutrients,
  type PriceEntry,
  type Row,
  type SlotName,
} from './types.ts';

// ---------- 栄養素ベクトル ----------

export type Vec = Record<NutrientKey, number>;

export function zeroVec(): Vec {
  const v = {} as Vec;
  for (const k of NUTRIENT_KEYS) v[k] = 0;
  return v;
}

function addInto(acc: Vec, v: Vec): void {
  for (const k of NUTRIENT_KEYS) acc[k] += v[k];
}

function scale(v: Vec, f: number): Vec {
  const out = {} as Vec;
  for (const k of NUTRIENT_KEYS) out[k] = v[k] * f;
  return out;
}

/** 栄養素 → その値が未測定(成分表で「-」など)だった食材 id の一覧(昇順・重複なし) */
export type Unmeasured = Partial<Record<NutrientKey, string[]>>;

function mergeUnmeasured(into: Unmeasured, from: Unmeasured): void {
  for (const k of NUTRIENT_KEYS) {
    const add = from[k];
    if (!add || add.length === 0) continue;
    const cur = into[k];
    into[k] = cur ? [...new Set([...cur, ...add])].sort() : [...add];
  }
}

/** ラベル値(と日の手動加算)をベクトルにする。書いていない栄養素は 0(未測定扱いにしない)。 */
export function labelVec(n: Nutrients): Vec {
  const v = zeroVec();
  for (const k of NUTRIENT_KEYS) {
    const x = n[k];
    if (typeof x === 'number' && Number.isFinite(x)) v[k] = x;
  }
  // 食塩相当量がなく、ナトリウムだけが書かれているときは Na(mg) × 2.54 / 1000
  const salt = n.salt;
  const na = n.na;
  if ((salt === undefined || salt === null) && typeof na === 'number') v.salt = (na * 2.54) / 1000;
  return v;
}

// ---------- 計算の文脈 ----------

export interface CalcContext {
  foods: FoodTable;
  ingredients: Map<string, Ingredient>;
  /** 食材 id → 日付順の価格 */
  prices: Map<string, PriceEntry[]>;
}

export function createContext(foods: FoodTable, ingredients: Ingredient[], prices: PriceEntry[]): CalcContext {
  return { foods, ingredients: new Map(ingredients.map((i) => [i.id, i])), prices: indexPrices(prices) };
}

// ---------- 警告 ----------

export type IssueKind =
  | 'unresolved' // 食材マスタに未登録(または削除された食材)
  | 'no-qty' // 数量が未入力
  | 'no-unit' // 単位換算が未設定
  | 'missing-food' // 紐づけた成分表の食品が見つからない
  | 'empty-recipe' // 内訳未登録(栄養・費用は 0 として数える)
  | 'bad-recipe' // 完成重量が 0 以下など
  | 'cycle' // レシピが循環している
  | 'no-price' // 価格未登録(費用から除外)
  | 'price-unit' // 単価を確定できない(費用から除外)
  | 'partial-price' // レシピの構成食材の一部に価格がない(価格のある分だけ費用に含める)
  | 'future-price'; // 未来の価格で代用(費用には含める)

export interface Issue {
  kind: IssueKind;
  /** どの食材で起きたか(レシピの内訳の中で起きたときは、その構成食材) */
  ingredientId?: string;
}

/** 栄養から除外される警告 */
const EXCLUDES_NUTRITION: ReadonlySet<IssueKind> = new Set(['unresolved', 'no-qty', 'no-unit', 'missing-food', 'bad-recipe', 'cycle']);

// ---------- 1つの分量の計算 ----------

export interface PriceUse {
  ingredientId: string;
  entry: PriceEntry;
  future: boolean;
  /** この行(のこの食材)に割り当てた金額 */
  yen: number;
}

/** 内訳表示用の基準値: 成分表・レシピは 100g あたり、ラベルはその基準量あたり */
export type Basis =
  | { kind: 'per100g'; values: (number | null)[] | Vec }
  | { kind: 'per'; qty: number; unit: string; values: Vec };

interface Amount {
  ok: boolean;
  grams: number | null;
  nutrients: Vec;
  unmeasured: Unmeasured;
  /** null = 費用を確定できない */
  cost: number | null;
  prices: PriceUse[];
  basis: Basis | null;
  issues: Issue[];
}

const fail = (issues: Issue[], grams: number | null = null): Amount => ({
  ok: false,
  grams,
  nutrients: zeroVec(),
  unmeasured: {},
  cost: null,
  prices: [],
  basis: null,
  issues,
});

function priceFor(
  ctx: CalcContext,
  ing: Ingredient,
  qty: number,
  unit: string,
  grams: number | null,
  date: string,
): { cost: number | null; prices: PriceUse[]; issues: Issue[] } {
  // 「費用に含めない(0円で扱う)」食材(水など)
  if (ing.costFree) return { cost: 0, prices: [], issues: [] };
  const pick: PricePick | null = pickPrice(ctx.prices.get(ing.id), date);
  if (!pick) return { cost: null, prices: [], issues: [{ kind: 'no-price', ingredientId: ing.id }] };
  const c = costOf(pick.entry, ing, { qty, unit, grams });
  if (c === null) return { cost: null, prices: [], issues: [{ kind: 'price-unit', ingredientId: ing.id }] };
  const issues: Issue[] = pick.future ? [{ kind: 'future-price', ingredientId: ing.id }] : [];
  return { cost: c, prices: [{ ingredientId: ing.id, entry: pick.entry, future: pick.future, yen: c }], issues };
}

function evalAmount(ctx: CalcContext, ingId: string, qty: number, unit: string, date: string, stack: string[]): Amount {
  const ing = ctx.ingredients.get(ingId);
  if (!ing) return fail([{ kind: 'unresolved', ingredientId: ingId }]);
  if (stack.includes(ingId)) return fail([{ kind: 'cycle', ingredientId: ingId }]);
  const src = ing.source;

  if (src.kind === 'food') {
    const rec = ctx.foods.get(src.foodId);
    if (!rec) return fail([{ kind: 'missing-food', ingredientId: ingId }]);
    const grams = toGrams(ing, qty, unit);
    if (grams === null) return fail([{ kind: 'no-unit', ingredientId: ingId }]);
    const nutrients = zeroVec();
    const unmeasured: Unmeasured = {};
    NUTRIENT_KEYS.forEach((k, i) => {
      const v = rec.values[i];
      if (v === null || v === undefined) unmeasured[k] = [ingId];
      else nutrients[k] = (v * grams) / 100;
    });
    const p = priceFor(ctx, ing, qty, unit, grams, date);
    return { ok: true, grams, nutrients, unmeasured, cost: p.cost, prices: p.prices, basis: { kind: 'per100g', values: rec.values }, issues: p.issues };
  }

  if (src.kind === 'label') {
    const per = src.per;
    let factor: number | null = null;
    const grams = toGrams(ing, qty, unit);
    if (sameUnit(unit, per.unit) && per.qty > 0) {
      // 基準量と同じ単位(錠・枚など)なら、グラムを経由せずその単位のまま掛ける
      factor = qty / per.qty;
    } else {
      const perG = toGrams(ing, per.qty, per.unit);
      if (grams !== null && perG !== null && perG > 0) factor = grams / perG;
    }
    if (factor === null) return fail([{ kind: 'no-unit', ingredientId: ingId }], grams);
    const base = labelVec(src.nutrients);
    const p = priceFor(ctx, ing, qty, unit, grams, date);
    return { ok: true, grams, nutrients: scale(base, factor), unmeasured: {}, cost: p.cost, prices: p.prices, basis: { kind: 'per', qty: per.qty, unit: per.unit, values: base }, issues: p.issues };
  }

  // recipe
  const grams = toGrams(ing, qty, unit);
  if (grams === null) return fail([{ kind: 'no-unit', ingredientId: ingId }]);
  if (src.components.length === 0) {
    // 内訳未登録: 栄養と費用を 0 として数え、警告を出す
    return { ok: true, grams, nutrients: zeroVec(), unmeasured: {}, cost: 0, prices: [], basis: null, issues: [{ kind: 'empty-recipe', ingredientId: ingId }] };
  }
  if (!(src.yieldG > 0)) return fail([{ kind: 'bad-recipe', ingredientId: ingId }], grams);

  const total = zeroVec();
  const unmeasured: Unmeasured = {};
  const issues: Issue[] = [];
  const parts: Amount[] = [];
  let ok = true;
  for (const c of src.components) {
    const a = evalAmount(ctx, c.ingredientId, c.qty, c.unit, date, [...stack, ingId]);
    if (!a.ok) {
      // 構成食材が未解決・単位換算なしなどのときは、行ごと除外する
      issues.push(...a.issues);
      ok = false;
      continue;
    }
    // 構成食材に価格がないときは、行を除外せず「一部価格未登録」とし、価格のある分だけ費用に足す
    for (const i of a.issues) issues.push(i.kind === 'no-price' || i.kind === 'price-unit' ? { ...i, kind: 'partial-price' } : i);
    addInto(total, a.nutrients);
    mergeUnmeasured(unmeasured, a.unmeasured);
    parts.push(a);
  }
  if (!ok) return fail(issues, grams);
  const factor = grams / src.yieldG;
  let costSum = 0;
  for (const a of parts) costSum += a.cost ?? 0;
  const prices = parts.flatMap((a) => (a.cost === null ? [] : a.prices.map((p) => ({ ...p, yen: p.yen * factor }))));
  return { ok: true, grams, nutrients: scale(total, factor), unmeasured, cost: costSum * factor, prices, basis: { kind: 'per100g', values: scale(total, 100 / src.yieldG) }, issues };
}

// ---------- 行 ----------

export interface RowCalc {
  slot: SlotName;
  dishIndex: number;
  rowIndex: number;
  row: Row;
  ingredient: Ingredient | undefined;
  grams: number | null;
  /** 栄養に入ったか */
  included: boolean;
  nutrients: Vec;
  unmeasured: Unmeasured;
  /** 費用に入ったか */
  costIncluded: boolean;
  cost: number;
  prices: PriceUse[];
  basis: Basis | null;
  issues: Issue[];
}

export function computeRow(ctx: CalcContext, row: Row, date: string, where: { slot: SlotName; dishIndex: number; rowIndex: number }): RowCalc {
  const ingredient = row.ingredientId ? ctx.ingredients.get(row.ingredientId) : undefined;
  let a: Amount;
  if (!row.ingredientId || !ingredient) a = fail([{ kind: 'unresolved', ...(row.ingredientId ? { ingredientId: row.ingredientId } : {}) }]);
  else if (row.qty === null || !Number.isFinite(row.qty)) a = fail([{ kind: 'no-qty', ingredientId: row.ingredientId }]);
  else a = evalAmount(ctx, row.ingredientId, row.qty, row.unit, date, []);
  const included = a.ok && !a.issues.some((i) => EXCLUDES_NUTRITION.has(i.kind));
  const costIncluded = included && a.cost !== null;
  return {
    ...where,
    row,
    ingredient,
    grams: a.grams,
    included,
    nutrients: included ? a.nutrients : zeroVec(),
    unmeasured: included ? a.unmeasured : {},
    costIncluded,
    cost: costIncluded ? (a.cost ?? 0) : 0,
    prices: costIncluded ? a.prices : [],
    basis: a.basis,
    issues: a.issues,
  };
}

// ---------- 合計 ----------

export interface Totals {
  nutrients: Vec;
  cost: number;
  unmeasured: Unmeasured;
}

function emptyTotals(): Totals {
  return { nutrients: zeroVec(), cost: 0, unmeasured: {} };
}

function addTotals(acc: Totals, t: Totals): void {
  addInto(acc.nutrients, t.nutrients);
  acc.cost += t.cost;
  mergeUnmeasured(acc.unmeasured, t.unmeasured);
}

export interface IssueCounts {
  unresolved: number;
  noQty: number;
  noUnit: number;
  missingFood: number;
  emptyRecipe: number;
  badRecipe: number;
  cycle: number;
  noPrice: number;
  priceUnit: number;
  partialPrice: number;
  futurePrice: number;
  /** 未測定の栄養素を含む行 */
  unmeasured: number;
}

const COUNT_OF: Record<IssueKind, keyof IssueCounts> = {
  unresolved: 'unresolved',
  'no-qty': 'noQty',
  'no-unit': 'noUnit',
  'missing-food': 'missingFood',
  'empty-recipe': 'emptyRecipe',
  'bad-recipe': 'badRecipe',
  cycle: 'cycle',
  'no-price': 'noPrice',
  'price-unit': 'priceUnit',
  'partial-price': 'partialPrice',
  'future-price': 'futurePrice',
};

export function emptyCounts(): IssueCounts {
  return { unresolved: 0, noQty: 0, noUnit: 0, missingFood: 0, emptyRecipe: 0, badRecipe: 0, cycle: 0, noPrice: 0, priceUnit: 0, partialPrice: 0, futurePrice: 0, unmeasured: 0 };
}

/** 行ごとに、警告の種類を1回ずつ数える */
export function countIssues(rows: RowCalc[]): IssueCounts {
  const c = emptyCounts();
  for (const r of rows) {
    const kinds = new Set(r.issues.map((i) => COUNT_OF[i.kind]));
    for (const k of kinds) c[k]++;
    if (Object.keys(r.unmeasured).length > 0) c.unmeasured++;
  }
  return c;
}

export function addCounts(a: IssueCounts, b: IssueCounts): IssueCounts {
  const out = emptyCounts();
  for (const k of Object.keys(out) as (keyof IssueCounts)[]) out[k] = a[k] + b[k];
  return out;
}

// ---------- 日 ----------

export interface DayCalc {
  date: string;
  rows: RowCalc[];
  /** 食事区分ごとの小計(手動加算は含まない) */
  slots: Record<SlotName, Totals>;
  /** 食事由来の合計(= 区分ごとの小計の和) */
  meals: Totals;
  /** 日単位の手動加算 */
  extras: Totals;
  /** 日の合計 = 区分ごとの小計の和 + 手動加算 */
  total: Totals;
  counts: IssueCounts;
  /** 食材行が1件以上ある日(平均の分母に数える) */
  hasRecord: boolean;
  weightKg: number | undefined;
}

export function extraTotals(extras: DayExtra[]): Totals {
  const t = emptyTotals();
  for (const e of extras) addTotals(t, { nutrients: labelVec(e.nutrients), cost: e.yen ?? 0, unmeasured: {} });
  return t;
}

export function computeDay(ctx: CalcContext, day: Day): DayCalc {
  const rows: RowCalc[] = [];
  const slots = {} as Record<SlotName, Totals>;
  for (const slot of SLOT_NAMES) {
    const st = emptyTotals();
    (day.slots[slot] ?? []).forEach((dish, dishIndex) => {
      dish.rows.forEach((row, rowIndex) => {
        const rc = computeRow(ctx, row, day.date, { slot, dishIndex, rowIndex });
        rows.push(rc);
        addTotals(st, { nutrients: rc.nutrients, cost: rc.cost, unmeasured: rc.unmeasured });
      });
    });
    slots[slot] = st;
  }
  // 日の合計は「区分ごとの小計を、決まった順に足したもの + 手動加算」。
  // 同じ順で足すので、小計の和と日の合計は完全に一致する。
  const meals = emptyTotals();
  for (const slot of SLOT_NAMES) addTotals(meals, slots[slot]);
  const extras = extraTotals(day.extras);
  const total = emptyTotals();
  addTotals(total, meals);
  addTotals(total, extras);
  return {
    date: day.date,
    rows,
    slots,
    meals,
    extras,
    total,
    counts: countIssues(rows),
    hasRecord: rows.length > 0,
    weightKg: day.weightKg,
  };
}

// ---------- 期間(週・月) ----------

export interface PeriodCalc {
  start: string;
  end: string;
  /** 範囲内の日(日付順) */
  days: DayCalc[];
  /** 日の合計を日付順に足したもの */
  total: Totals;
  counts: IssueCounts;
  recordedDays: number;
  calendarDays: number;
  mode: 'recordedDays' | 'calendarDays';
  /** 平均の分母(mode による)。0 なら平均は出さない */
  denominator: number;
  average: { nutrients: Vec; cost: number } | null;
}

export function computePeriod(
  days: DayCalc[],
  range: { start: string; end: string; calendarDays: number },
  mode: 'recordedDays' | 'calendarDays',
): PeriodCalc {
  const inRange = days.filter((d) => d.date >= range.start && d.date <= range.end).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = emptyTotals();
  let counts = emptyCounts();
  for (const d of inRange) {
    addTotals(total, d.total);
    counts = addCounts(counts, d.counts);
  }
  const recordedDays = inRange.filter((d) => d.hasRecord).length;
  const denominator = mode === 'recordedDays' ? recordedDays : range.calendarDays;
  const average = denominator > 0 ? { nutrients: scale(total.nutrients, 1 / denominator), cost: total.cost / denominator } : null;
  return { start: range.start, end: range.end, days: inRange, total, counts, recordedDays, calendarDays: range.calendarDays, mode, denominator, average };
}

// ---------- 内訳(合計の根拠) ----------

export type Contribution =
  | { kind: 'row'; row: RowCalc; value: number }
  | { kind: 'extra'; extra: DayExtra; value: number };

/** 合計に寄与している行と手動加算を、大きい順に並べる(同じ値なら元の順) */
export function contributions(day: DayCalc, extras: DayExtra[], what: NutrientKey | 'cost'): Contribution[] {
  const list: Contribution[] = [];
  for (const r of day.rows) {
    if (what === 'cost' ? !r.costIncluded : !r.included) continue;
    list.push({ kind: 'row', row: r, value: what === 'cost' ? r.cost : r.nutrients[what] });
  }
  for (const e of extras) {
    const value = what === 'cost' ? (e.yen ?? 0) : labelVec(e.nutrients)[what];
    if (value !== 0) list.push({ kind: 'extra', extra: e, value });
  }
  return list.map((c, i) => ({ c, i })).sort((a, b) => b.c.value - a.c.value || a.i - b.i).map(({ c }) => c);
}
