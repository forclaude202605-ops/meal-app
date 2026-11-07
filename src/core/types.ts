// データモデル(仕様書 §4)。栄養と費用は保存せず、毎回ここから計算する。

export const NUTRIENT_KEYS = [
  'kcal', 'protein', 'fat', 'carb', 'fiber', 'salt',
  'chol', 'na', 'k', 'ca', 'mg', 'p', 'fe', 'zn', 'cu', 'mn',
  'id', 'se', 'cr', 'mo',
  'vita', 'vitd', 'vite', 'vitk', 'b1', 'b2', 'nia', 'b6', 'b12', 'fol', 'pan', 'bio', 'vitc',
  'satfat', 'n3', 'n6',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
/** null = 未測定 */
export type Nutrients = Partial<Record<NutrientKey, number | null>>;

export interface UnitConversion {
  /** 「qty unit = grams g」 例: 大さじ 1 = 17g、尾 4 = 9g(割り切れない換算も丸めずに持つ) */
  unit: string;
  qty: number;
  grams: number;
  /** 換算の根拠: 成分表の密度から計算 / 自分の計量スプーンなどで実測 / 手で入力 */
  basis?: 'mext-density' | 'measured' | 'manual';
}

export interface RecipeComponent {
  ingredientId: string;
  qty: number;
  unit: string;
}

export type IngredientSource =
  /** 成分表の食品(可食部100gあたり)に紐づく */
  | { kind: 'food'; foodId: string }
  /** 包装ラベルの値(例: per 1錠, per 15g, per 100g)。書いていない栄養素は 0 として扱う */
  | { kind: 'label'; per: { qty: number; unit: string }; nutrients: Nutrients }
  /** レシピ(材料から作る食品)。完成重量(焼成・加熱後)を持つ。components が空なら「内訳未登録」 */
  | { kind: 'recipe'; components: RecipeComponent[]; yieldG: number };

/** 食材マスタ(メモ上の呼び名ごとに1件) */
export interface Ingredient {
  id: string;
  name: string;
  aliases: string[];
  source: IngredientSource;
  units: UnitConversion[];
  /** 単位換算を持ち主が確認済みか。推定の初期値は false(画面に ⚠) */
  unitsConfirmed?: boolean;
  /** 費用に含めない(0円で扱う)。水など、価格を記録しない食材 */
  costFree?: boolean;
  memo?: string;
}

/** 価格(購入記録と、メモ中の単価メモを同じ形で扱う) */
export interface PriceEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  ingredientId: string;
  yen: number;
  /** 購入量。例: 420 g / 4 本 / 2 パック */
  qty: number;
  unit: string;
  /** qty が g 以外でも、実重量がわかるときの値(例: 6尾 612g) */
  grams?: number;
  store?: string;
  note?: string;
  source: 'purchase' | 'inline';
  /** 登録した時刻(ISO 8601)。同じ食材・同じ日の記録が複数あるときは、これが最も新しいものを使う */
  createdAt: string;
}

export interface Row {
  /** 未解決(食材マスタに未登録)なら省略し、rawName だけ残す */
  ingredientId?: string;
  rawName: string;
  /** 数量未入力は null(警告を出し、集計から除外) */
  qty: number | null;
  unit: string;
  note?: string;
}

export interface Dish {
  title?: string;
  rows: Row[];
}

export const SLOT_NAMES = ['朝', '昼', '間食', '夜', 'サプリ'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export interface DayExtra {
  label: string;
  nutrients: Nutrients;
  yen?: number;
}

export interface Day {
  /** YYYY-MM-DD(端末のローカル日付) */
  date: string;
  weightKg?: number;
  slots: Partial<Record<SlotName, Dish[]>>;
  /** 日単位の手動加算。例: 日照によるビタミンD */
  extras: DayExtra[];
  memo?: string;
}

/** プロフィール。どの項目も、持ち主が設定画面で選ぶまで空(既定値を入れない) */
export interface Profile {
  sex?: 'male' | 'female';
  age?: number;
  activity?: 1 | 2 | 3;
}

export interface Settings {
  profile?: Profile;
  /** 0 = 日曜、1 = 月曜(既定) */
  weekStartsOn: 0 | 1;
  averageMode: 'recordedDays' | 'calendarDays';
  backupReminderDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  weekStartsOn: 1,
  averageMode: 'recordedDays',
  backupReminderDays: 7,
};
