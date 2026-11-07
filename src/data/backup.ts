// バックアップの形式と、読み込み・マージ(仕様書 §3「バックアップ」)。純関数のみ。
// 形式: { app, schema, exportedAt, foodDbVersion, ingredients, prices, days, settings }。成分表本体は含めない。
import { isDateString } from '../core/dates.ts';
import type { FoodDbVersion } from '../core/nutrients.ts';
import { DEFAULT_SETTINGS, SLOT_NAMES, type Day, type Ingredient, type PriceEntry, type Settings } from '../core/types.ts';

export const APP_ID = 'meal-app';
export const SCHEMA = 1;

export interface AppData {
  ingredients: Ingredient[];
  prices: PriceEntry[];
  days: Day[];
  settings: Settings;
}

export interface BackupFile extends AppData {
  app: typeof APP_ID;
  schema: number;
  exportedAt: string;
  foodDbVersion: FoodDbVersion;
}

export function buildBackup(data: AppData, foodDbVersion: FoodDbVersion, now: Date): BackupFile {
  return {
    app: APP_ID,
    schema: SCHEMA,
    exportedAt: now.toISOString(),
    foodDbVersion,
    ingredients: data.ingredients,
    prices: data.prices,
    days: [...data.days].sort((a, b) => (a.date < b.date ? -1 : 1)),
    settings: data.settings,
  };
}

/** 書き出すファイル名(.gitignore の *backup*.json に当たる名前にする) */
export function backupFileName(date: string): string {
  return `meal-app-backup-${date}.json`;
}

export type ParseResult = { ok: true; backup: BackupFile; migratedFrom: number | null } | { ok: false; error: string };

/** 古い形式を新しい形式へ変換する。schema を1つずつ上げる関数をここに足していく */
const MIGRATIONS: Record<number, (b: Record<string, unknown>) => Record<string, unknown>> = {
  // 例: 1: (b) => ({ ...b, schema: 2, ... }),
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON として読めません' };
  }
  if (!isObj(raw) || raw.app !== APP_ID) return { ok: false, error: 'このアプリのバックアップではありません' };
  if (typeof raw.schema !== 'number' || !Number.isInteger(raw.schema) || raw.schema < 1) return { ok: false, error: '形式の番号(schema)がありません' };
  if (raw.schema > SCHEMA) return { ok: false, error: `新しい版のアプリで書き出されたファイルです(schema ${raw.schema})。アプリを更新してください` };
  const from = raw.schema;
  let b: Record<string, unknown> = raw;
  for (let s = from; s < SCHEMA; s++) {
    const f = MIGRATIONS[s];
    if (!f) return { ok: false, error: `schema ${s} からの変換がありません` };
    b = f(b);
  }
  for (const k of ['ingredients', 'prices', 'days'] as const) if (!Array.isArray(b[k])) return { ok: false, error: `${k} がありません` };
  const days = b.days as unknown[];
  for (const d of days) {
    if (!isObj(d) || typeof d.date !== 'string' || !isDateString(d.date) || !isObj(d.slots) || !Array.isArray(d.extras)) {
      return { ok: false, error: '日の記録の形が正しくありません' };
    }
  }
  const dates = days.map((d) => (d as Day).date);
  if (new Set(dates).size !== dates.length) return { ok: false, error: '同じ日付の記録が2つ以上あります' };
  for (const i of b.ingredients as unknown[]) if (!isObj(i) || typeof i.id !== 'string' || typeof i.name !== 'string' || !isObj(i.source)) return { ok: false, error: '食材の形が正しくありません' };
  for (const p of b.prices as unknown[]) if (!isObj(p) || typeof p.id !== 'string' || typeof p.ingredientId !== 'string' || typeof p.yen !== 'number' || typeof p.date !== 'string') return { ok: false, error: '価格の形が正しくありません' };
  const settings = { ...DEFAULT_SETTINGS, ...(isObj(b.settings) ? (b.settings as Partial<Settings>) : {}) };
  const backup: BackupFile = {
    app: APP_ID,
    schema: SCHEMA,
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    foodDbVersion: (isObj(b.foodDbVersion) ? (b.foodDbVersion as unknown) : { id: String(b.foodDbVersion ?? ''), retrieved: '', files: [] }) as FoodDbVersion,
    ingredients: b.ingredients as Ingredient[],
    prices: b.prices as PriceEntry[],
    days: days as Day[],
    settings,
  };
  return { ok: true, backup, migratedFrom: from < SCHEMA ? from : null };
}

export function countRows(day: Day): number {
  let n = 0;
  for (const s of SLOT_NAMES) for (const dish of day.slots[s] ?? []) n += dish.rows.length;
  return n;
}

export interface DataSummary {
  days: number;
  rows: number;
  weights: number;
  ingredients: number;
  prices: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function summarize(data: Pick<AppData, 'days' | 'ingredients' | 'prices'>): DataSummary {
  const dates = data.days.map((d) => d.date).sort();
  return {
    days: data.days.length,
    rows: data.days.reduce((s, d) => s + countRows(d), 0),
    weights: data.days.filter((d) => d.weightKg !== undefined).length,
    ingredients: data.ingredients.length,
    prices: data.prices.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()];
}

/**
 * 日付ごとにマージ: ファイルにある日付は、ファイルの内容で置き換える(ない日付は今のまま)。
 * 食材と価格は id ごとにまとめ、同じ id はファイルの内容を使う。設定は今のまま。
 */
export function mergeByDate(current: AppData, incoming: AppData): AppData {
  const days = new Map(current.days.map((d) => [d.date, d]));
  for (const d of incoming.days) days.set(d.date, d);
  return {
    ingredients: mergeById(current.ingredients, incoming.ingredients),
    prices: mergeById(current.prices, incoming.prices),
    days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    settings: current.settings,
  };
}

/** 日の記録が空(行も体重も手動加算もメモもない)か */
export function isEmptyDay(d: Day): boolean {
  return countRows(d) === 0 && d.weightKg === undefined && d.extras.length === 0 && !d.memo && SLOT_NAMES.every((s) => (d.slots[s] ?? []).every((dish) => !dish.title));
}
