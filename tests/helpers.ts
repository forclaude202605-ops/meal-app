// テスト用の共通処理。データはすべて架空(食材名は実在、数量・日付・金額は架空)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, type CalcContext } from '../src/core/calc.ts';
import { createFoodTable, type FoodDbJson, type FoodTable } from '../src/core/nutrients.ts';
import type { Day, Dish, Ingredient, PriceEntry, Row, SlotName } from '../src/core/types.ts';

let cached: FoodTable | undefined;
export function foodTable(): FoodTable {
  if (!cached) {
    const path = fileURLToPath(new URL('../src/data/foods.json', import.meta.url));
    cached = createFoodTable(JSON.parse(readFileSync(path, 'utf8')) as FoodDbJson);
  }
  return cached;
}

export function foodIng(id: string, foodId: string, units: Ingredient['units'] = []): Ingredient {
  return { id, name: id, aliases: [], source: { kind: 'food', foodId }, units };
}

export function ctxOf(ings: Ingredient[], prices: PriceEntry[] = []): CalcContext {
  return createContext(foodTable(), ings, prices);
}

export function row(ingredientId: string | undefined, qty: number | null, unit = 'g'): Row {
  return { ...(ingredientId ? { ingredientId } : {}), rawName: ingredientId ?? '未登録の食材', qty, unit };
}

export function day(date: string, slots: Partial<Record<SlotName, Row[][]>>, extras: Day['extras'] = []): Day {
  const s: Partial<Record<SlotName, Dish[]>> = {};
  for (const [k, dishes] of Object.entries(slots) as [SlotName, Row[][]][]) s[k] = dishes.map((rows) => ({ rows }));
  return { date, slots: s, extras };
}

let seq = 0;
/** 架空の価格。登録時刻は呼んだ順に1秒ずつ進める */
export function price(ingredientId: string, date: string, yen: number, qty: number, unit = 'g', extra: Partial<PriceEntry> = {}): PriceEntry {
  seq++;
  const createdAt = new Date(Date.UTC(2025, 0, 1, 0, 0, seq)).toISOString();
  return { id: `p${String(seq).padStart(4, '0')}`, date, ingredientId, yen, qty, unit, source: 'purchase', createdAt, ...extra };
}
