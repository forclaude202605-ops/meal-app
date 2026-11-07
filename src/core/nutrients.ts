// 栄養素の名前・単位・表示桁と、同梱する成分表データの読み込み。
import { NUTRIENT_KEYS, type NutrientKey } from './types.ts';

export interface NutrientInfo {
  key: NutrientKey;
  label: string;
  unit: string;
  /** 表示の小数桁(内部は丸めない) */
  decimals: number;
  /** 成分表と食事摂取基準で定義が違うときの注記 */
  note?: string;
}

const INFO: [NutrientKey, string, string, number, string?][] = [
  ['kcal', 'エネルギー', 'kcal', 0],
  ['protein', 'たんぱく質', 'g', 1],
  ['fat', '脂質', 'g', 1],
  ['carb', '炭水化物', 'g', 1, '食物繊維を含む'],
  ['fiber', '食物繊維', 'g', 1, '食物繊維総量'],
  ['salt', '食塩相当量', 'g', 1],
  ['chol', 'コレステロール', 'mg', 0],
  ['na', 'ナトリウム', 'mg', 0],
  ['k', 'カリウム', 'mg', 0],
  ['ca', 'カルシウム', 'mg', 0],
  ['mg', 'マグネシウム', 'mg', 0],
  ['p', 'リン', 'mg', 0],
  ['fe', '鉄', 'mg', 1],
  ['zn', '亜鉛', 'mg', 1],
  ['cu', '銅', 'mg', 2],
  ['mn', 'マンガン', 'mg', 2],
  ['id', 'ヨウ素', 'μg', 0],
  ['se', 'セレン', 'μg', 0],
  ['cr', 'クロム', 'μg', 0],
  ['mo', 'モリブデン', 'μg', 0],
  ['vita', 'ビタミンA', 'μgRAE', 0, 'レチノール活性当量'],
  ['vitd', 'ビタミンD', 'μg', 1],
  ['vite', 'ビタミンE', 'mg', 1, 'α-トコフェロール'],
  ['vitk', 'ビタミンK', 'μg', 0],
  ['b1', 'ビタミンB1', 'mg', 2],
  ['b2', 'ビタミンB2', 'mg', 2],
  ['nia', 'ナイアシン', 'mgNE', 1, 'ナイアシン当量'],
  ['b6', 'ビタミンB6', 'mg', 2],
  ['b12', 'ビタミンB12', 'μg', 1],
  ['fol', '葉酸', 'μg', 0],
  ['pan', 'パントテン酸', 'mg', 2],
  ['bio', 'ビオチン', 'μg', 1],
  ['vitc', 'ビタミンC', 'mg', 0],
  ['satfat', '飽和脂肪酸', 'g', 2],
  ['n3', 'n-3系脂肪酸', 'g', 2],
  ['n6', 'n-6系脂肪酸', 'g', 2],
];

export const NUTRIENTS: Record<NutrientKey, NutrientInfo> = Object.fromEntries(
  INFO.map(([key, label, unit, decimals, note]) => [key, { key, label, unit, decimals, ...(note ? { note } : {}) }]),
) as Record<NutrientKey, NutrientInfo>;

// ---- 成分表データ ----

export interface FoodDbFile {
  role: 'main' | 'fattyAcid';
  /** 使った Excel のファイル名 */
  name: string;
  /** 版の日付(ファイル名の先頭から) */
  date: string | null;
  sha256: string;
}

/** バックアップに記録する成分表の版 */
export interface FoodDbVersion {
  id: string;
  retrieved: string;
  files: FoodDbFile[];
}

/** scripts/build-food-db.mjs の出力形式 */
export interface FoodDbJson {
  format: number;
  version: string;
  source: string;
  sourceUrl: string;
  retrieved: string;
  files: FoodDbFile[];
  keys: string[];
  /** [食品番号, 食品名, 小見出し, 値の配列(keys の順、null = 未測定), 100mLあたりの重さg(備考欄。なければ null)] */
  foods: [string, string, string, (number | null)[], number | null][];
}

export interface FoodRecord {
  id: string;
  name: string;
  /** 成分表の小見出し(例: だいこん類)。ないときは '' */
  head: string;
  /** NUTRIENT_KEYS の順。null = 未測定 */
  values: (number | null)[];
  /** 成分表の備考欄にある「100 mL：○ g」。容量(大さじ等)の重さ換算の出典。なければ null */
  gPer100mL: number | null;
}

export interface FoodTable {
  version: string;
  versionInfo: FoodDbVersion;
  source: string;
  sourceUrl: string;
  all: FoodRecord[];
  get(id: string): FoodRecord | undefined;
}

export const KEY_INDEX: Record<NutrientKey, number> = Object.fromEntries(
  NUTRIENT_KEYS.map((k, i) => [k, i]),
) as Record<NutrientKey, number>;

export function createFoodTable(json: FoodDbJson): FoodTable {
  if (json.keys.length !== NUTRIENT_KEYS.length || json.keys.some((k, i) => k !== NUTRIENT_KEYS[i])) {
    throw new Error('成分表データの栄養素の並びが、アプリの想定と違います');
  }
  const all = json.foods.map(([id, name, head, values, gPer100mL]) => ({ id, name, head, values, gPer100mL: gPer100mL ?? null }));
  const byId = new Map(all.map((f) => [f.id, f]));
  return {
    version: json.version,
    versionInfo: { id: json.version, retrieved: json.retrieved, files: json.files ?? [] },
    source: json.source,
    sourceUrl: json.sourceUrl,
    all,
    get: (id) => byId.get(id),
  };
}

/** 表示用の食品名(小見出しがあれば添える) */
export function foodDisplayName(f: FoodRecord): string {
  return f.head ? `${f.name}(${f.head})` : f.name;
}
