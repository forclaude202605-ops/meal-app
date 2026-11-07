// 食材の名前解決と検索(仕様書 §6)。
// 表記ゆれ(全角/半角、ひらがな/カタカナ、大文字/小文字、空白・記号)は正規化して比べる。
import type { FoodRecord, FoodTable } from './nutrients.ts';
import type { Ingredient } from './types.ts';

/** 比較用の正規化: NFKC → 小文字 → カタカナをひらがなに → 空白と区切り記号を除く */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･、。,.・「」『』()（）［］[\]【】〈〉<>"'`]/g, '');
}

// ---------- 食材マスタ ----------

/** 名前・別名が正規化して完全に一致する食材(なければ undefined。複数あれば最初のもの) */
export function resolveIngredient(name: string, ingredients: Ingredient[]): Ingredient | undefined {
  const n = normalizeName(name);
  if (!n) return undefined;
  return ingredients.find((i) => normalizeName(i.name) === n || i.aliases.some((a) => normalizeName(a) === n));
}

export interface IngredientHit {
  ingredient: Ingredient;
  score: number;
}

/**
 * 食材マスタの検索。完全一致 > 前方一致 > 部分一致(2文字以上)。同じ順位なら usage(よく使う・最近使った)の多い順。
 * query が空なら usage の順に並べる。
 */
export function searchIngredients(query: string, ingredients: Ingredient[], usage: ReadonlyMap<string, number> = new Map()): IngredientHit[] {
  const q = normalizeName(query);
  const hits: IngredientHit[] = [];
  for (const ing of ingredients) {
    const names = [ing.name, ...ing.aliases].map(normalizeName);
    let score = 0;
    if (!q) score = 1;
    else if (names.includes(q)) score = 300;
    else if (names.some((n) => n.startsWith(q))) score = 200;
    else if ((q.length >= 2 || /[一-鿿]/.test(q)) && names.some((n) => n.includes(q))) score = 100;
    if (score > 0) hits.push({ ingredient: ing, score: score + Math.min(usage.get(ing.id) ?? 0, 99) });
  }
  return hits.sort((a, b) => b.score - a.score || a.ingredient.name.localeCompare(b.ingredient.name, 'ja'));
}

// ---------- 成分表 ----------

/**
 * 成分表の検索に使う別名辞書。成分表の食品名は分類語が多く、ふだんの呼び名では見つからないため。
 * 値は成分表の食品名(小見出しを除いた表示名)。曖昧な呼び名は複数の候補を持ち、自動では1つに決めない。
 */
export const FOOD_ALIASES: Record<string, string[]> = {
  白米: ['こめ ［水稲穀粒］ 精白米 うるち米'],
  ごはん: ['こめ ［水稲めし］ 精白米 うるち米'],
  ご飯: ['こめ ［水稲めし］ 精白米 うるち米'],
  牛乳: ['普通牛乳'],
  卵: ['鶏卵 全卵 生'],
  たまご: ['鶏卵 全卵 生'],
  豚こま: ['ぶた ［大型種肉］ かた 脂身つき 生', 'ぶた ［大型種肉］ もも 脂身つき 生', 'ぶた ［大型種肉］ ばら 脂身つき 生'],
  鶏むね: ['にわとり ［若どり・主品目］ むね 皮つき 生', 'にわとり ［若どり・主品目］ むね 皮なし 生'],
  鶏もも: ['にわとり ［若どり・主品目］ もも 皮つき 生', 'にわとり ［若どり・主品目］ もも 皮なし 生'],
  納豆: ['だいず ［納豆類］ 糸引き納豆'],
  豆腐: ['だいず ［豆腐・油揚げ類］ 木綿豆腐', 'だいず ［豆腐・油揚げ類］ 絹ごし豆腐'],
  パスタ: ['こむぎ ［マカロニ・スパゲッティ類］ マカロニ・スパゲッティ 乾'],
  オートミール: ['えんばく オートミール'],
  しょうゆ: ['こいくちしょうゆ', 'うすくちしょうゆ'],
  砂糖: ['車糖 上白糖'],
  塩: ['食塩'],
};

/** 成分表の食品名を単語に分ける(空白・括弧で区切る。小見出しも単語として加え、末尾の「類」も外した形を足す) */
export function foodWords(f: FoodRecord): string[] {
  const words = f.name.split(/[\s［］[\]（）()]+/).filter(Boolean);
  if (f.head) {
    words.push(f.head);
    if (f.head.endsWith('類')) words.push(f.head.slice(0, -1));
  }
  return [...new Set(words.map(normalizeName).filter(Boolean))];
}

export interface FoodHit {
  food: FoodRecord;
  score: number;
  /** 別名辞書から出た候補 */
  viaAlias: boolean;
}

const wordCache = new WeakMap<FoodRecord, string[]>();
const wordsOf = (f: FoodRecord) => {
  let w = wordCache.get(f);
  if (!w) {
    w = foodWords(f);
    wordCache.set(f, w);
  }
  return w;
};

/**
 * 成分表の検索。単語単位で一致させる(部分文字列の一致による事故を防ぐ)。
 * 問い合わせの各語が、食品名のどれかの単語に 完全一致(3) / 前方一致(2) / 単語の中に含まれる(1、2文字以上のときだけ) のどれかで当たること。
 * 別名辞書に当たれば、その候補を先頭に出す。
 */
export function searchFoods(query: string, table: FoodTable, limit = 50): FoodHit[] {
  const raw = query.normalize('NFKC').trim();
  if (!raw) return [];
  const out: FoodHit[] = [];
  const seen = new Set<string>();
  const aliasKey = Object.keys(FOOD_ALIASES).find((k) => normalizeName(k) === normalizeName(raw));
  if (aliasKey) {
    const names = FOOD_ALIASES[aliasKey] ?? [];
    for (const f of table.all) {
      if (names.includes(f.name) && !seen.has(f.id)) {
        out.push({ food: f, score: 1000, viaAlias: true });
        seen.add(f.id);
      }
    }
  }
  const tokens = raw.split(/\s+/).map(normalizeName).filter(Boolean);
  for (const f of table.all) {
    if (seen.has(f.id)) continue;
    const words = wordsOf(f);
    let total = 0;
    let ok = true;
    for (const t of tokens) {
      let best = 0;
      for (const w of words) {
        if (w === t) best = Math.max(best, 3);
        else if (w.startsWith(t)) best = Math.max(best, 2);
        else if (t.length >= 2 && w.includes(t)) best = Math.max(best, 1);
      }
      if (best === 0) {
        ok = false;
        break;
      }
      total += best;
    }
    if (ok) out.push({ food: f, score: total * 10 - words.length * 0.01, viaAlias: false });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
