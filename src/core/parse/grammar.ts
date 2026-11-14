// 1行の読み取り(献立・食材費)。ここでは食材マスタを見ない(文字の並びだけで決める)。純関数のみ。
// 食材名の割り当て、料理名の推測、答え(補足)の反映は journal.ts で行う。
import { parsePriceText, type ParsedPrice } from '../priceText.ts';
import { normalizeUnit, parseQuantity } from '../quantity.ts';
import { NUTRIENTS } from '../nutrients.ts';
import type { NoteKind, NutrientKey, Nutrients, SlotName } from '../types.ts';

// ---------- 数量と単位 ----------

/** 数量の書き方: 2.4、1/3、2 1/3、2と1/3 */
const NUM = String.raw`(?:\d+(?:\.\d+)?(?:\s|と)\d+\/\d+|\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)`;

/** 単位として知っているもの(正規化した形) */
const KNOWN_UNITS = new Set([
  'g', 'kg', 'mg', 'μg', 'mL', 'L', '大さじ', '小さじ', '合', '個', '本', '尾', '錠', '粒', '枚', 'パック', '袋', '缶', '切れ', '片', '玉', 'カップ', '杯',
  '丁', '束', '房', '株', '膳', '皿', '斤', '包', 'カプセル', 'スティック',
]);
/** 読み取りでだけ使う単位の別表記(normalizeUnit にないもの)。大・小は数字の前に書いたときだけ */
const PRE_ALIASES: Record<string, string> = { 大: '大さじ', 小: '小さじ' };
const COUNTER_ALIASES: Record<string, string> = { つ: '個' };
const MASS_UNITS = new Set(['g', 'kg']);
/** 数字の前に書く単位(「大さじ1」「小1」) */
const PRE_UNITS = '大さじ|小さじ|大匙|小匙|大サジ|小サジ|おおさじ|こさじ|カップ|大|小';
const SPOON_ONLY = '大さじ|小さじ|大匙|小匙|大サジ|小サジ|おおさじ|こさじ|カップ';
const VAGUE = '少々|少量|適量|適宜|ひとつまみ|ひとつかみ|お好みで|好みで|ちょっと|少し';

export interface UnitRead {
  unit: string;
  /** 書いてあった形(正規化した単位と違うときだけ) */
  raw?: string;
}

/** 単位の文字列を読む。知らない単位は、3文字までなら書いたまま単位として扱う(換算は食材ごとに聞く) */
export function readUnit(raw: string, pre = false): UnitRead | null {
  const r = raw.trim();
  if (r === '') return null;
  const alias = (pre ? PRE_ALIASES[r] : undefined) ?? COUNTER_ALIASES[r];
  if (alias) return { unit: alias, raw: r };
  const n = normalizeUnit(r);
  if (KNOWN_UNITS.has(n)) return n === r ? { unit: n } : { unit: n, raw: r };
  if (r.length <= 3 && !/[\d()]/.test(r)) return { unit: r };
  return null;
}

function num(text: string): number | null {
  return parseQuantity(text.replace('と', ' '));
}

export interface ItemSpec {
  name: string;
  /** 数字の後ろに単位がないとき、数字まで含めた名前(「ビタミンB12」のような名前かもしれないため) */
  fullName?: string;
  qty: number | null;
  /** 正規化した単位('' = 書いていない) */
  unit: string;
  /** ok: 数量あり / none: 数量なし / unit-only: 数字のない単位 / vague: 少々・適量など / no-unit: 数字だけで単位なし */
  qtyState: 'ok' | 'none' | 'unit-only' | 'vague' | 'no-unit';
  vague?: string;
  /** 重さ(g)が別に書いてあるとき(「1個50g」「1個(50g)」) */
  grams?: number;
  /** 重さと一緒に書いてあった個数など(表示用) */
  countQty?: { qty: number; unit: string };
  /** 直した単位の表記(例: 大匙→大さじ) */
  unitChanges: string[];
}

/** 括弧を除いた「名前 + 数量」の部分を読む(名前は1つとして読む) */
export function readNameQty(s: string): ItemSpec {
  const text = s.trim();
  const changes: string[] = [];
  const mark = (u: UnitRead) => {
    if (u.raw && u.raw !== u.unit) changes.push(`${u.raw}→${u.unit}`);
    return u.unit;
  };
  // 少々・適量
  let m = new RegExp(`^(.*?)\\s*(${VAGUE})$`).exec(text);
  if (m && (m[1] as string).trim()) return { name: (m[1] as string).trim(), qty: null, unit: '', qtyState: 'vague', vague: m[2] as string, unitChanges: changes };
  // 個数 + 重さ(1個50g)
  m = new RegExp(`^(.*?)(${NUM})\\s*([^\\d\\s./()]{1,5})\\s*(${NUM})\\s*(g|kg|グラム)$`).exec(text);
  if (m && (m[1] as string).trim()) {
    const cu = readUnit(m[3] as string);
    const c = num(m[2] as string);
    const w = num(m[4] as string);
    if (cu && !MASS_UNITS.has(cu.unit) && KNOWN_UNITS.has(cu.unit) && c !== null && w !== null) {
      const wu = normalizeUnit(m[5] as string);
      const grams = wu === 'kg' ? w * 1000 : w;
      return { name: (m[1] as string).trim(), qty: grams, unit: 'g', qtyState: 'ok', grams, countQty: { qty: c, unit: mark(cu) }, unitChanges: changes };
    }
  }
  // 大さじ1、小1/2(単位が数字の前)
  m = new RegExp(`^(.*?)(${PRE_UNITS})\\s*(${NUM})$`).exec(text);
  if (m && (m[1] as string).trim()) {
    const u = readUnit(m[2] as string, true);
    const q = num(m[3] as string);
    if (u && q !== null) {
      if ((m[3] as string).includes('と')) changes.push('「と」の付いた分数');
      return { name: (m[1] as string).trim(), qty: q, unit: mark(u), qtyState: 'ok', unitChanges: changes };
    }
  }
  // 名前 + 数字 + 単位(単位がないこともある)
  m = new RegExp(`^(.*?)(${NUM})\\s*([^\\d\\s./]*)$`).exec(text);
  if (m && (m[1] as string).trim()) {
    const name = (m[1] as string).trim();
    const q = num(m[2] as string);
    const tail = m[3] as string;
    if (q !== null) {
      if (tail === '') return { name, fullName: text, qty: q, unit: '', qtyState: 'no-unit', unitChanges: changes };
      const u = readUnit(tail);
      if (u) {
        if ((m[2] as string).includes('と')) changes.push('「と」の付いた分数');
        return { name, qty: q, unit: mark(u), qtyState: 'ok', unitChanges: changes };
      }
    }
  }
  // 数字のない単位(しょうゆ小さじ)
  m = new RegExp(`^(.*?)(${SPOON_ONLY})$`).exec(text);
  if (m && (m[1] as string).trim() && !/\d$/.test((m[1] as string).trim())) {
    const u = readUnit(m[2] as string, true);
    if (u) return { name: (m[1] as string).trim(), qty: null, unit: mark(u), qtyState: 'unit-only', unitChanges: changes };
  }
  return { name: text, qty: null, unit: '', qtyState: 'none', unitChanges: changes };
}

// ---------- 括弧 ----------

export interface DefSpec {
  per: { qty: number; unit: string } | null;
  nutrients: Nutrients;
  yen: number | null;
  /** 読めなかった部分 */
  error?: string;
}

export type Paren =
  | { t: 'price'; price: ParsedPrice; text: string }
  | { t: 'same'; spec: ItemSpec; text: string }
  | { t: 'def'; def: DefSpec; text: string }
  | { t: 'grams'; grams: number; text: string }
  | { t: 'note'; text: string };

/** 括弧の外と中を分ける。括弧の中身は外側から順に */
export function splitParens(s: string): { outside: string; parens: string[] } {
  const parens: string[] = [];
  let out = '';
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') {
      if (depth > 0) cur += ch;
      depth++;
      if (depth === 1) out += ' ';
    } else if (ch === ')' && depth > 0) {
      depth--;
      if (depth === 0) {
        parens.push(cur.trim());
        cur = '';
      } else cur += ch;
    } else if (depth > 0) cur += ch;
    else out += ch;
  }
  if (depth > 0 && cur.trim()) parens.push(cur.trim());
  return { outside: out.replace(/\s+/g, ' ').trim(), parens: parens.filter((p) => p !== '') };
}

const NUTRIENT_WORDS: [string, NutrientKey][] = (
  [
    ['エネルギー', 'kcal'], ['熱量', 'kcal'], ['カロリー', 'kcal'],
    ['たんぱく質', 'protein'], ['タンパク質', 'protein'], ['蛋白質', 'protein'], ['たんぱく', 'protein'], ['タンパク', 'protein'],
    ['脂質', 'fat'], ['炭水化物', 'carb'], ['食物繊維', 'fiber'], ['食塩相当量', 'salt'], ['食塩', 'salt'], ['塩分', 'salt'],
    ['ナトリウム', 'na'], ['カリウム', 'k'], ['カルシウム', 'ca'], ['マグネシウム', 'mg'], ['リン', 'p'], ['鉄', 'fe'], ['亜鉛', 'zn'], ['銅', 'cu'],
    ['マンガン', 'mn'], ['ヨウ素', 'id'], ['セレン', 'se'], ['クロム', 'cr'], ['モリブデン', 'mo'],
    ['ビタミンA', 'vita'], ['ビタミンD', 'vitd'], ['ビタミンE', 'vite'], ['ビタミンK', 'vitk'], ['ビタミンB1', 'b1'], ['ビタミンB2', 'b2'],
    ['ナイアシン', 'nia'], ['ビタミンB6', 'b6'], ['ビタミンB12', 'b12'], ['葉酸', 'fol'], ['パントテン酸', 'pan'], ['ビオチン', 'bio'], ['ビタミンC', 'vitc'],
    ['飽和脂肪酸', 'satfat'], ['n-3系脂肪酸', 'n3'], ['n-6系脂肪酸', 'n6'],
  ] as [string, NutrientKey][]
).sort((a, b) => b[0].length - a[0].length);

const MASS_SCALE: Record<string, number> = { g: 1, mg: 1e-3, μg: 1e-6 };
const nutrientScale = (key: NutrientKey): number | null => {
  const u = NUTRIENTS[key].unit;
  if (u === 'kcal') return null;
  if (u.startsWith('μg')) return 1e-6;
  if (u.startsWith('mg')) return 1e-3;
  return 1;
};

/** 栄養素名 + 数値 + 単位を、その栄養素の単位の値に直す。単位が合わなければ null */
function nutrientValue(key: NutrientKey, v: number, unitRaw: string): number | null {
  const u = normalizeUnit(unitRaw);
  if (NUTRIENTS[key].unit === 'kcal') return u === 'kcal' ? v : null;
  const from = MASS_SCALE[u];
  const to = nutrientScale(key);
  if (from === undefined || to === null) return null;
  return (v * from) / to;
}

const looksLikeDef = (s: string) => /\d\s*kcal/i.test(s) || NUTRIENT_WORDS.some(([w]) => new RegExp(`${w}\\s*\\d`).test(s));

/** その場での食材の定義(例: 1枚 カルシウム〇mg ビタミンD〇μg 〇円) */
export function parseDefinition(s: string): DefSpec {
  let rest = s.trim();
  const nutrients: Nutrients = {};
  let per: DefSpec['per'] = null;
  let yen: number | null = null;
  const p = new RegExp(`^(${NUM})\\s*([^\\d\\s]+?)(?:あたり|当たり|につき)?(?=[\\s、,]|${NUTRIENT_WORDS.map(([w]) => w).join('|')}|\\d|$)`).exec(rest);
  if (p) {
    const q = num(p[1] as string);
    const u = readUnit(p[2] as string);
    if (q !== null && u && u.unit !== '円') {
      per = { qty: q, unit: u.unit };
      rest = rest.slice(p[0].length);
    }
  }
  const errors: string[] = [];
  while ((rest = rest.replace(/^[\s、,・/:]+/, '')) !== '') {
    let hit = false;
    for (const [w, key] of NUTRIENT_WORDS) {
      if (!rest.startsWith(w)) continue;
      const m = new RegExp(`^\\s*(${NUM})\\s*(kcal|g|mg|μg|ug|mcg|マイクログラム|ミリグラム|グラム)`, 'i').exec(rest.slice(w.length));
      if (!m) break;
      const v = num(m[1] as string);
      const val = v === null ? null : nutrientValue(key, v, m[2] as string);
      if (val === null) errors.push(`${w}の単位(${m[2]})`);
      else nutrients[key] = (nutrients[key] ?? 0) + val;
      rest = rest.slice(w.length + m[0].length);
      hit = true;
      break;
    }
    if (hit) continue;
    let m = new RegExp(`^(${NUM})\\s*円`).exec(rest);
    if (m) {
      yen = num(m[1] as string);
      rest = rest.slice(m[0].length);
      continue;
    }
    m = new RegExp(`^(${NUM})\\s*kcal`, 'i').exec(rest);
    if (m) {
      nutrients.kcal = num(m[1] as string) ?? 0;
      rest = rest.slice(m[0].length);
      continue;
    }
    errors.push(rest);
    break;
  }
  const def: DefSpec = { per, nutrients, yen };
  if (!per) errors.unshift('基準量(1枚・1錠など)');
  if (errors.length > 0) def.error = `読めない部分: ${errors.join('、')}`;
  return def;
}

export function classifyParen(text: string): Paren {
  const same = /^(.*?)(?:と)?(?:同価格|同じ価格|同額)$/.exec(text);
  if (same && (same[1] as string).trim()) return { t: 'same', spec: readNameQty(same[1] as string), text };
  if (looksLikeDef(text)) return { t: 'def', def: parseDefinition(text), text };
  const g = new RegExp(`^(${NUM})\\s*(g|kg|グラム)$`).exec(text);
  if (g) {
    const v = num(g[1] as string);
    if (v !== null) return { t: 'grams', grams: normalizeUnit(g[2] as string) === 'kg' ? v * 1000 : v, text };
  }
  if (/円|¥/.test(text) && /\d/.test(text)) {
    const r = parsePriceText(text.replace(/あたり|当たり|につき|[/:]/g, ' '));
    if (r.ok) return { t: 'price', price: r.value, text };
  }
  return { t: 'note', text };
}

// ---------- 献立の行 ----------

const SLOT_WORDS: [RegExp, SlotName][] = [
  [/^(朝|朝食|朝ごはん|朝ご飯|朝御飯|朝飯)/, '朝'],
  [/^(昼|昼食|昼ごはん|昼ご飯|昼御飯|昼飯|ランチ)/, '昼'],
  [/^(間食|おやつ|補食)/, '間食'],
  [/^(夜|夕|夕食|夕飯|夕ごはん|夕ご飯|晩|晩ごはん|晩ご飯|晩御飯|夜ごはん|夜ご飯|夕御飯|夜食)/, '夜'],
  [/^(サプリ|サプリメント)/, 'サプリ'],
];

export function matchSlot(s: string): { slot: SlotName; label: string; rest: string } | null {
  const inner = s.replace(/^\(\s*/, '');
  const bracketed = inner !== s;
  for (const [re, slot] of SLOT_WORDS) {
    const m = new RegExp(`${re.source}(?=$|[\\s:)])`).exec(inner);
    if (!m) continue;
    let rest = inner.slice(m[0].length);
    if (bracketed) rest = rest.replace(/^\s*\)/, '');
    rest = rest.replace(/^[\s:]+/, '').trim();
    return { slot, label: m[0], rest };
  }
  return null;
}

export interface MealItemsLine {
  t: 'items';
  items: ItemSpec[];
  /** 複数の名前に1つの数量を付けた行 */
  shared: boolean;
  price?: ParsedPrice;
  same?: ItemSpec;
  def?: DefSpec;
  gramsParen?: number;
  /** 括弧の中の調理メモなど */
  notes: string[];
  /** 括弧の中身(表示用) */
  parens: Paren[];
}

export type MealLine =
  | { t: 'blank' }
  | { t: 'slot'; slot: SlotName; label: string }
  | { t: 'weight'; kg: number; note?: string }
  | { t: 'sun'; ug: number; atLeast: boolean }
  | { t: 'memo'; text: string }
  | { t: 'title'; title: string }
  | MealItemsLine
  | { t: 'unread'; reason: string };

/** 献立の1行(normalizeLine 済み)を読む。区分の見出しの後ろに続きがあるときは2つ返す */
export function parseMealLine(s: string): MealLine[] {
  if (s === '') return [{ t: 'blank' }];
  const slot = matchSlot(s);
  if (slot) return [{ t: 'slot', slot: slot.slot, label: slot.label }, ...(slot.rest ? parseMealLine(slot.rest) : [])];
  if (/^(※|メモ|memo|#)/i.test(s)) return [{ t: 'memo', text: s.replace(/^(※|メモ|memo|#)\s*[:]?\s*/i, '') }];
  const w = new RegExp(`^体重\\s*[:]?\\s*(${NUM})\\s*(kg|キロ|キログラム)?\\s*(.*)$`).exec(s);
  if (w) {
    const kg = num(w[1] as string);
    if (kg !== null && kg > 0 && kg < 500) return [{ t: 'weight', kg, ...(w[3] ? { note: w[3] } : {}) }];
  }
  if (/^体重/.test(s)) return [{ t: 'unread', reason: '体重の数値が読めない' }];
  if (/日照|日光浴|日光/.test(s)) {
    const v = new RegExp(`(${NUM})\\s*(μg|ug|mcg|マイクログラム)`, 'i').exec(s);
    if (v) {
      const ug = num(v[1] as string);
      if (ug !== null) return [{ t: 'sun', ug, atLeast: /以上/.test(s) }];
    }
    return [{ t: 'unread', reason: '日照の行に、ビタミンDの量(μg)がない' }];
  }
  const { outside, parens: rawParens } = splitParens(s);
  if (outside === '') return [{ t: 'unread', reason: '括弧の中だけで、名前がない' }];
  // 末尾の「:」は料理名の見出し
  if (/[:]$/.test(outside) && rawParens.length === 0) {
    const title = outside.replace(/[:]+$/, '').trim();
    if (title && !/\d/.test(title)) return [{ t: 'title', title }];
  }
  const parens = rawParens.map(classifyParen);
  const head = readNameQty(outside);
  const names = head.name.split(/[、,]/).map((n) => n.trim());
  if (names.some((n) => n === '')) return [{ t: 'unread', reason: '名前の区切り(、)の前後が空' }];
  const items: ItemSpec[] =
    names.length === 1
      ? [head]
      : names.map((name) => {
          const copy: ItemSpec = { ...head, name };
          delete copy.fullName;
          return copy;
        });
  const line: MealItemsLine = { t: 'items', items, shared: names.length > 1, notes: [], parens };
  for (const p of parens) {
    if (p.t === 'note') line.notes.push(p.text);
    else if (names.length > 1) return [{ t: 'unread', reason: `複数の名前に「${p.text}」は付けられない(1行に1つの食材にしてください)` }];
    else if (p.t === 'price') line.price = p.price;
    else if (p.t === 'same') line.same = p.spec;
    else if (p.t === 'def') line.def = p.def;
    else line.gramsParen = p.grams;
  }
  if (line.gramsParen !== undefined) {
    const it = items[0] as ItemSpec;
    if (it.qtyState === 'ok' && !MASS_UNITS.has(it.unit) && it.qty !== null) {
      items[0] = { ...it, countQty: { qty: it.qty, unit: it.unit }, qty: line.gramsParen, unit: 'g', grams: line.gramsParen };
    } else if (it.qtyState !== 'ok') {
      items[0] = { ...it, qty: line.gramsParen, unit: 'g', qtyState: 'ok', grams: line.gramsParen };
    }
  }
  return [line];
}

// ---------- 食材費の行 ----------

export type PurchaseLine =
  | { t: 'blank' }
  | { t: 'store'; name: string }
  | { t: 'memo'; text: string }
  | { t: 'item'; name: string; yen: number | null; qty: number | null; unit: string; grams?: number; notes: string[]; error?: 'no-yen' | 'no-amount' | 'too-many'; unitChanges: string[] }
  | { t: 'unread'; reason: string };

/** 食材費の1行(normalizeLine 済み)を読む。金額と量は、どの順でもよい(キャベツ〇円〇g / しめじ〇g〇円 / 〇本〇円 / 〇g〇尾〇円) */
export function parsePurchaseLine(s: string): PurchaseLine {
  if (s === '') return { t: 'blank' };
  if (/^(※|メモ|memo|#|合計|小計|計\s|総計|税込|税抜|消費税|ポイント|お釣り|おつり|支払|レシート)/i.test(s)) return { t: 'memo', text: s };
  const { outside, parens } = splitParens(s);
  if (!/\d/.test(outside)) {
    if (/円|¥/.test(outside)) return { t: 'unread', reason: '金額の数字が読めない' };
    return { t: 'store', name: outside };
  }
  let rest = outside;
  let yen: number | null = null;
  const amounts: { qty: number; unit: string; raw: string }[] = [];
  let tooMany = false;
  const changes: string[] = [];
  for (let k = 0; k < 4; k++) {
    rest = rest.replace(/[\s、,:]+$/, '');
    let m = new RegExp(`(${NUM})\\s*円$`).exec(rest) ?? new RegExp(`[¥]\\s*(${NUM})$`).exec(rest);
    if (m) {
      if (yen !== null) tooMany = true;
      yen = num(m[1] as string);
      rest = rest.slice(0, m.index);
      continue;
    }
    m = new RegExp(`(${NUM})\\s*([^\\d\\s./円¥]{1,6})$`).exec(rest);
    if (m) {
      const u = readUnit(m[2] as string);
      const q = num(m[1] as string);
      if (!u || q === null || !KNOWN_UNITS.has(u.unit)) break;
      if (u.raw && u.raw !== u.unit) changes.push(`${u.raw}→${u.unit}`);
      amounts.unshift({ qty: q, unit: u.unit, raw: m[0] });
      rest = rest.slice(0, m.index);
      continue;
    }
    break;
  }
  const name = rest.replace(/[\s、,:]+$/, '').trim();
  if (!name) return { t: 'unread', reason: '品名がない' };
  if (/[、,]/.test(name)) return { t: 'unread', reason: '1行に複数の品名がある(1行に1つにしてください)' };
  const notes = parens;
  const mass = amounts.filter((a) => a.unit === 'g' || a.unit === 'kg' || a.unit === 'mg');
  const other = amounts.filter((a) => !(a.unit === 'g' || a.unit === 'kg' || a.unit === 'mg'));
  const base = { t: 'item' as const, name, notes, unitChanges: changes };
  if (tooMany || mass.length > 1 || other.length > 1) return { ...base, yen, qty: null, unit: '', error: 'too-many' };
  if (yen === null) {
    const a = other[0] ?? mass[0];
    return { ...base, yen: null, qty: a ? a.qty : null, unit: a ? a.unit : '', error: 'no-yen' };
  }
  if (amounts.length === 0) return { ...base, yen, qty: null, unit: '', error: 'no-amount' };
  const c = other[0];
  const w = mass[0];
  if (c && w) {
    const grams = w.unit === 'kg' ? w.qty * 1000 : w.unit === 'mg' ? w.qty / 1000 : w.qty;
    return { ...base, yen, qty: c.qty, unit: c.unit, grams };
  }
  const a = (c ?? w) as { qty: number; unit: string };
  return { ...base, yen, qty: a.qty, unit: a.unit };
}

// ---------- 献立か食材費か ----------

/** ブロックが献立か食材費かを、中身から決める(画面で切り替えられる) */
export function classifyLines(lines: string[]): { kind: NoteKind; reason: string } {
  let meal = 0;
  let purchase = 0;
  let slots = 0;
  let yenLines = 0;
  for (const s of lines) {
    if (s === '') continue;
    if (matchSlot(s)) {
      meal += 3;
      slots++;
      continue;
    }
    if (/^体重|日照/.test(s)) {
      meal += 3;
      continue;
    }
    const outside = splitParens(s).outside;
    if (/\d\s*円|¥\s*\d/.test(outside) && /\d\s*[^\d\s円¥]/.test(outside.replace(/\d+(?:\.\d+)?\s*円/g, ''))) {
      purchase += 2;
      yenLines++;
    } else if (/\d/.test(outside)) meal += 1;
  }
  if (purchase > meal) return { kind: 'purchase', reason: `金額(円)と量のある行が ${yenLines} 行` };
  return { kind: 'meal', reason: slots > 0 ? `食事区分の見出しが ${slots} 個` : '金額(円)の行が少ない' };
}
