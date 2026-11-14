// バックアップの形式と、読み込み・マージ(仕様書 §3「バックアップ」)。純関数のみ。
// 形式(schema 2): { app, schema, exportedAt, foodDbVersion, texts, answers, ingredients, settings }。成分表本体は含めない。
// 記録の正は「日ごとのテキスト」(texts)。区分・料理・行、価格、栄養、費用は保存せず、テキストから毎回作る。
import { isDateString } from '../core/dates.ts';
import type { FoodDbVersion } from '../core/nutrients.ts';
import { DEFAULT_SETTINGS, type DayText, type Ingredient, type LineAnswer, type Settings } from '../core/types.ts';

export const APP_ID = 'meal-app';
export const SCHEMA = 2;

export interface AppData {
  ingredients: Ingredient[];
  /** 日ごとのテキスト(献立・食材費) */
  texts: DayText[];
  /** 毎回聞く項目への答え(その日のその行の補足) */
  answers: LineAnswer[];
  settings: Settings;
}

export interface BackupFile extends AppData {
  app: typeof APP_ID;
  schema: number;
  exportedAt: string;
  foodDbVersion: FoodDbVersion;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildBackup(data: AppData, foodDbVersion: FoodDbVersion, now: Date): BackupFile {
  return {
    app: APP_ID,
    schema: SCHEMA,
    exportedAt: now.toISOString(),
    foodDbVersion,
    texts: [...data.texts].sort(byId),
    answers: [...data.answers].sort(byId),
    ingredients: data.ingredients,
    settings: data.settings,
  };
}

/** 書き出すファイル名(.gitignore の *backup*.json に当たる名前にする) */
export function backupFileName(date: string): string {
  return `meal-app-backup-${date}.json`;
}

export type ParseResult =
  | { ok: true; backup: BackupFile; migratedFrom: number | null; dropped: { days: number; prices: number } | null }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 古い形式を新しい形式へ変換する。schema を1つずつ上げる関数をここに足していく。
 * 1 → 2: 記録の正が「区分・料理・行の構造」から「日ごとのテキスト」に変わった。schema 1 の時期のデータはデモだけだったため、
 * 日と価格は変換せずに捨て(件数は画面に出す)、食材マスタと設定だけを引き継ぐ。
 */
const MIGRATIONS: Record<number, (b: Record<string, unknown>) => Record<string, unknown>> = {
  1: (b) => ({
    ...b,
    schema: 2,
    texts: [],
    answers: [],
    droppedV1: { days: Array.isArray(b.days) ? b.days.length : 0, prices: Array.isArray(b.prices) ? b.prices.length : 0 },
  }),
};

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
  for (const k of ['ingredients', 'texts', 'answers'] as const) if (!Array.isArray(b[k])) return { ok: false, error: `${k} がありません` };
  const texts = b.texts as unknown[];
  for (const t of texts) {
    if (!isObj(t) || typeof t.id !== 'string' || (t.kind !== 'meal' && t.kind !== 'purchase') || typeof t.date !== 'string' || !isDateString(t.date) || typeof t.text !== 'string' || t.id !== `${t.kind}:${t.date}`) {
      return { ok: false, error: '日ごとのテキストの形が正しくありません' };
    }
  }
  const ids = texts.map((t) => (t as DayText).id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: '同じ日・同じ種類のテキストが2つ以上あります' };
  for (const a of b.answers as unknown[]) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.date !== 'string' || typeof a.lineKey !== 'string' || typeof a.occurrence !== 'number' || typeof a.item !== 'number' || !isObj(a.value)) {
      return { ok: false, error: '補足(答え)の形が正しくありません' };
    }
  }
  for (const i of b.ingredients as unknown[]) if (!isObj(i) || typeof i.id !== 'string' || typeof i.name !== 'string' || !isObj(i.source)) return { ok: false, error: '食材の形が正しくありません' };
  const settings = { ...DEFAULT_SETTINGS, ...(isObj(b.settings) ? (b.settings as Partial<Settings>) : {}) };
  const backup: BackupFile = {
    app: APP_ID,
    schema: SCHEMA,
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    foodDbVersion: (isObj(b.foodDbVersion) ? (b.foodDbVersion as unknown) : { id: String(b.foodDbVersion ?? ''), retrieved: '', files: [] }) as FoodDbVersion,
    texts: texts as DayText[],
    answers: b.answers as LineAnswer[],
    ingredients: b.ingredients as Ingredient[],
    settings,
  };
  const dropped = isObj(b.droppedV1) ? (b.droppedV1 as { days: number; prices: number }) : null;
  return { ok: true, backup, migratedFrom: from < SCHEMA ? from : null, dropped };
}

export interface DataSummary {
  /** 献立のある日数 */
  mealDays: number;
  /** 食材費のある日数 */
  purchaseDays: number;
  /** テキストの行数(空行を除く) */
  lines: number;
  answers: number;
  ingredients: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function summarize(data: Pick<AppData, 'texts' | 'answers' | 'ingredients'>): DataSummary {
  const dates = data.texts.map((t) => t.date).sort();
  return {
    mealDays: data.texts.filter((t) => t.kind === 'meal').length,
    purchaseDays: data.texts.filter((t) => t.kind === 'purchase').length,
    lines: data.texts.reduce((s, t) => s + t.text.split('\n').filter((l) => l.trim() !== '').length, 0),
    answers: data.answers.length,
    ingredients: data.ingredients.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()].sort(byId);
}

/**
 * 日付ごとにマージ: ファイルにある日(献立・食材費のそれぞれ)は、ファイルの内容で置き換える(ない日は今のまま)。
 * 置き換えた日の補足(答え)はファイルのものにする。食材は id ごとにまとめ、同じ id はファイルの内容を使う。設定は今のまま。
 */
export function mergeByDate(current: AppData, incoming: AppData): AppData {
  const replaced = new Set(incoming.texts.map((t) => `${t.kind}|${t.date}`));
  const keptAnswers = current.answers.filter((a) => !replaced.has(`${a.kind}|${a.date}`));
  return {
    ingredients: mergeById(current.ingredients, incoming.ingredients),
    texts: mergeById(current.texts, incoming.texts),
    answers: mergeById(keptAnswers, incoming.answers),
    settings: current.settings,
  };
}
