// 日ごとのテキスト → 区分・料理・行(Day)と価格(PriceEntry)を作り、M1 の計算コアで計算する。純関数のみ。
// 同じテキスト・同じ食材マスタ・同じ答えからは、必ず同じ結果になる(並び順も含めて決定的)。
import { computeDay, createContext, type CalcContext, type DayCalc, type IssueKind } from '../calc.ts';
import type { FoodTable } from '../nutrients.ts';
import { isSuspiciousPriceUnit, pickPrice } from '../price.ts';
import { normalizeUnit } from '../quantity.ts';
import { normalizeName } from '../search.ts';
import {
  answerId,
  type AnswerTarget,
  type AnswerValue,
  type Day,
  type DayText,
  type Dish,
  type Ingredient,
  type LineAnswer,
  type NoteKind,
  type PriceEntry,
  type Row,
  type SlotName,
} from '../types.ts';
import { parseMealLine, parsePurchaseLine, type DefSpec, type ItemSpec, type MealLine, type PurchaseLine } from './grammar.ts';
import { normalizeLine } from './normalize.ts';

// ---------- 結果の形 ----------

export interface ProblemRef {
  kind: NoteKind;
  date: string;
  /** テキストの行番号(1始まり) */
  line: number;
  item?: number;
}

/** 解決できる問題。assign / note / unit は「一度答えれば覚える」、qty / slot / mg / purchase-qty は「毎回聞く」 */
export type Problem =
  | { type: 'assign'; key: string; name: string; note?: string; refs: ProblemRef[] }
  | { type: 'note'; key: string; name: string; note: string; plainId: string; refs: ProblemRef[] }
  | { type: 'unit'; key: string; ingredientId: string; unit: string; refs: ProblemRef[] }
  | {
      type: 'qty';
      key: string;
      ref: ProblemRef;
      target: AnswerTarget;
      name: string;
      ingredientId?: string;
      state: 'none' | 'unit-only' | 'vague' | 'no-unit';
      unit: string;
      qty: number | null;
      vague?: string;
      lineText: string;
      last?: { qty: number; unit: string };
    }
  | { type: 'slot'; key: string; ref: ProblemRef; target: AnswerTarget; lines: number[] }
  | { type: 'mg'; key: string; ref: ProblemRef; target: AnswerTarget; name: string; ingredientId: string; qty: number }
  | { type: 'purchase-qty'; key: string; ref: ProblemRef; target: AnswerTarget; name: string; ingredientId?: string; lineText: string }
  | { type: 'unread'; key: string; ref: ProblemRef; lineText: string; reason: string }
  | { type: 'calc'; key: string; issue: IssueKind; ingredientId: string; refs: ProblemRef[] };

export interface ItemRead {
  index: number;
  name: string;
  note?: string;
  ingredientId?: string;
  /** どう割り当てたか: 名前・別名 / 括弧のメモつきの別名 / その場での定義 / 数字まで含めた名前 */
  via?: 'name' | 'note' | 'def' | 'fullName';
  qty: number | null;
  unit: string;
  qtyState: ItemSpec['qtyState'];
  vague?: string;
  countQty?: { qty: number; unit: string };
  answered?: AnswerValue;
  /** 同価格: この行は、参照した食材のこの量として計算する */
  same?: { name: string; ingredientId?: string; qty: number | null; unit: string };
  /** Day の中の位置(区分を決められず計算に入れていない行にはない) */
  at?: { slot: SlotName; dish: number; row: number };
}

export type LineType = 'blank' | 'slot' | 'weight' | 'sun' | 'memo' | 'title' | 'items' | 'store' | 'purchase' | 'unread' | 'skip';

export interface ReadLine {
  no: number;
  raw: string;
  text: string;
  changes: string[];
  type: LineType;
  slot?: SlotName;
  detail: string;
  /** 推測したこと(数字に影響しない推測だけ) */
  guess?: string;
  items?: ItemRead[];
  purchase?: { name: string; ingredientId?: string; yen: number | null; qty: number | null; unit: string; grams?: number; store?: string; priceId?: string };
  target: { lineKey: string; occurrence: number };
}

export interface MealDay {
  date: string;
  text: DayText;
  lines: ReadLine[];
  day: Day;
  calc: DayCalc;
  problems: Problem[];
  /** 注意(問題ではないもの): 未来の価格で代用、一部価格未登録、一部未測定 */
  notes: string[];
}

export interface PurchaseDay {
  date: string;
  text: DayText;
  lines: ReadLine[];
  prices: PriceEntry[];
  /** 金額の合計(品目の行の金額の和) */
  total: number;
  problems: Problem[];
}

export interface Journal {
  meals: MealDay[];
  purchases: PurchaseDay[];
  /** テキストから作った価格(購入記録と単価メモ) */
  prices: PriceEntry[];
  /** その場での定義から作った食材 */
  defs: Ingredient[];
  ctx: CalcContext;
}

export interface JournalInput {
  foods: FoodTable;
  ingredients: Ingredient[];
  texts: DayText[];
  answers: LineAnswer[];
}

// ---------- 名前の割り当て ----------

interface DefEntry {
  date: string;
  ing: Ingredient;
}

class Resolver {
  private readonly byName = new Map<string, Ingredient>();
  private readonly defs = new Map<string, DefEntry[]>();
  constructor(ingredients: Ingredient[]) {
    for (const ing of ingredients) {
      for (const n of [ing.name, ...ing.aliases]) {
        const k = normalizeName(n);
        if (k && !this.byName.has(k)) this.byName.set(k, ing);
      }
    }
  }
  addDef(name: string, e: DefEntry) {
    const k = normalizeName(name);
    const list = this.defs.get(k);
    if (list) list.push(e);
    else this.defs.set(k, [e]);
  }
  sortDefs() {
    for (const list of this.defs.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ing.id < b.ing.id ? -1 : 1));
  }
  /** その日以前で最も新しい定義(なければ、後で最も古い定義) */
  def(name: string, date: string): Ingredient | undefined {
    const list = this.defs.get(normalizeName(name));
    if (!list || list.length === 0) return undefined;
    let best: DefEntry | undefined;
    for (const e of list) if (e.date <= date) best = e;
    return (best ?? list[0])?.ing;
  }
  master(name: string): Ingredient | undefined {
    const k = normalizeName(name);
    return k ? this.byName.get(k) : undefined;
  }
  /** 名前(と括弧のメモ)から食材を決める。決まらなければ、その理由 */
  resolve(name: string, note: string | undefined, date: string, fullName?: string): { ing?: Ingredient; via?: ItemRead['via']; useFull?: boolean; problem?: 'assign' | 'note'; plain?: Ingredient } {
    if (note) {
      const withNote = this.master(name + note);
      if (withNote) return { ing: withNote, via: 'note' };
      const d = this.def(name, date);
      if (d) return { ing: d, via: 'def' };
      const plain = this.master(name);
      return plain ? { problem: 'note', plain } : { problem: 'assign' };
    }
    const d = this.def(name, date);
    if (d) return { ing: d, via: 'def' };
    const m = this.master(name);
    if (m) return { ing: m, via: 'name' };
    if (fullName) {
      const fd = this.def(fullName, date) ?? this.master(fullName);
      if (fd) return { ing: fd, via: 'fullName', useFull: true };
    }
    return { problem: 'assign' };
  }
}

const pad = (n: number) => String(n).padStart(5, '0');
const SLOT_KEY = '__slot__';

function fmtQ(q: number | null, unit: string): string {
  if (q === null) return unit ? `${unit}(数字なし)` : '(数量なし)';
  const s = Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000);
  return ['大さじ', '小さじ', 'カップ'].includes(unit) ? `${unit}${s}` : `${s}${unit}`;
}

/** 行ごとの答えの鍵: 区分 + 正規化した行。同じ鍵の何番目か */
function keyer() {
  const seen = new Map<string, number>();
  return (slot: SlotName | null, text: string) => {
    const lineKey = `${slot ?? ''}|${text}`;
    const occurrence = seen.get(lineKey) ?? 0;
    seen.set(lineKey, occurrence + 1);
    return { lineKey, occurrence };
  };
}

// ---------- 定義(その場での食材の定義)を先に集める ----------

function defIngredient(name: string, def: DefSpec, date: string, line: number): Ingredient | null {
  if (def.error || !def.per) return null;
  return {
    id: `def:${date}:${pad(line)}`,
    name,
    aliases: [],
    source: { kind: 'label', per: { qty: def.per.qty, unit: normalizeUnit(def.per.unit) }, nutrients: def.nutrients },
    units: [],
    unitsConfirmed: true,
    memo: `テキストでの定義(${date} の ${line} 行目)`,
  };
}

interface ParsedText {
  text: DayText;
  lines: { no: number; raw: string; norm: ReturnType<typeof normalizeLine> }[];
}

function splitLines(t: DayText): ParsedText {
  return { text: t, lines: t.text.split('\n').map((raw, i) => ({ no: i + 1, raw, norm: normalizeLine(raw) })) };
}

// ---------- 献立 ----------

function buildMeal(
  p: ParsedText,
  r: Resolver,
  answers: Map<string, LineAnswer>,
  lastByIng: Map<string, { qty: number; unit: string }>,
  defsOut: Ingredient[],
  pricesOut: PriceEntry[],
): { lines: ReadLine[]; day: Day; problems: Problem[] } {
  const date = p.text.date;
  const kind: NoteKind = 'meal';
  const parsed: { src: ParsedText['lines'][number]; ml: MealLine }[] = [];
  for (const src of p.lines) for (const ml of parseMealLine(src.norm.text)) parsed.push({ src, ml });

  const day: Day = { date, slots: {}, extras: [] };
  const memos: string[] = [];
  const problems: Problem[] = [];
  const lines: ReadLine[] = [];
  const key = keyer();
  let slot: SlotName | null = null;
  let dish: Dish | null = null;
  /** 区分の見出しより前の食材の行(区分が決まるまで計算に入れない) */
  const noSlot: { item: ItemRead; row: Row; line: number }[] = [];
  const slotAnswer = answers.get(answerId({ kind, date, lineKey: SLOT_KEY, occurrence: 0, item: 0 }));
  const forcedSlot = slotAnswer?.value.type === 'slot' ? slotAnswer.value.slot : null;

  const addRow = (row: Row, item: ItemRead, line: number) => {
    const s = slot ?? forcedSlot;
    if (!s) {
      noSlot.push({ item, row, line });
      return;
    }
    const list = (day.slots[s] ??= []);
    if (!dish || !list.includes(dish)) {
      dish = { rows: [] };
      list.push(dish);
    }
    dish.rows.push(row);
    item.at = { slot: s, dish: list.indexOf(dish), row: dish.rows.length - 1 };
  };

  const nextItems = (k: number): MealLine | undefined => {
    for (let j = k + 1; j < parsed.length; j++) {
      const ml = (parsed[j] as { ml: MealLine }).ml;
      if (ml.t === 'blank') continue;
      return ml;
    }
    return undefined;
  };

  parsed.forEach(({ src, ml }, k) => {
    const base = { no: src.no, raw: src.raw, text: src.norm.text, changes: [...src.norm.changes], target: key(slot, src.norm.text) };
    const ref = (item?: number): ProblemRef => ({ kind, date, line: src.no, ...(item !== undefined ? { item } : {}) });
    const tgt = (item: number): AnswerTarget => ({ kind, date, lineKey: base.target.lineKey, occurrence: base.target.occurrence, item });
    switch (ml.t) {
      case 'blank':
        dish = null;
        lines.push({ ...base, type: 'blank', detail: '' });
        return;
      case 'slot':
        slot = ml.slot;
        dish = null;
        lines.push({ ...base, type: 'slot', slot, detail: `区分: ${ml.slot}${ml.label !== ml.slot ? `(「${ml.label}」)` : ''}` });
        return;
      case 'weight':
        day.weightKg = ml.kg;
        lines.push({ ...base, type: 'weight', detail: `体重 ${ml.kg}kg${ml.note ? `(メモ: ${ml.note})` : ''}` });
        if (ml.note) memos.push(ml.note);
        return;
      case 'sun':
        day.extras.push({ label: `日照によるビタミンD${ml.atLeast ? '(以上)' : ''}`, nutrients: { vitd: ml.ug } });
        lines.push({ ...base, type: 'sun', detail: `日照によるビタミンD ${ml.ug}μg を日の合計に足す${ml.atLeast ? '(「以上」の記録。数値はそのまま)' : ''}` });
        return;
      case 'memo':
        memos.push(ml.text);
        lines.push({ ...base, type: 'memo', detail: `メモ: ${ml.text}` });
        return;
      case 'title':
        dish = { title: ml.title, rows: [] };
        if (slot ?? forcedSlot) (day.slots[(slot ?? forcedSlot) as SlotName] ??= []).push(dish);
        lines.push({ ...base, type: 'title', slot: slot ?? undefined, detail: `料理名: ${ml.title}` });
        return;
      case 'unread':
        lines.push({ ...base, type: 'unread', detail: `読めない: ${ml.reason}` });
        problems.push({ type: 'unread', key: `unread|${date}|${src.no}`, ref: ref(), lineText: src.raw, reason: ml.reason });
        return;
    }
    // ---- 食材の行 ----
    const asAnswer = answers.get(answerId(tgt(0)));
    if (asAnswer?.value.type === 'as') {
      if (asAnswer.value.as === 'skip') {
        lines.push({ ...base, type: 'skip', detail: '読み飛ばす(答えによる)' });
        return;
      }
      const title = ml.items.map((i) => i.name).join('、');
      dish = { title, rows: [] };
      if (slot ?? forcedSlot) (day.slots[(slot ?? forcedSlot) as SlotName] ??= []).push(dish);
      lines.push({ ...base, type: 'title', slot: slot ?? undefined, detail: `料理名: ${title}(答えによる)` });
      return;
    }
    const note = ml.notes.length > 0 && !ml.shared ? ml.notes.join(' ') : undefined;
    // その場での定義
    let defIng: Ingredient | null = null;
    if (ml.def) {
      if (ml.def.error) problems.push({ type: 'unread', key: `unread|${date}|${src.no}`, ref: ref(), lineText: src.raw, reason: `食材の定義: ${ml.def.error}` });
      else {
        defIng = defIngredient((ml.items[0] as ItemSpec).name, ml.def, date, src.no);
        if (defIng) {
          defsOut.push(defIng);
          if (ml.def.yen !== null && ml.def.per) {
            pricesOut.push({ id: `def:${date}:${pad(src.no)}`, date, ingredientId: defIng.id, yen: ml.def.yen, qty: ml.def.per.qty, unit: normalizeUnit(ml.def.per.unit), source: 'inline', note: '定義の価格', createdAt: `${date} q${pad(src.no)}` });
          }
        }
      }
    }
    const items: ItemRead[] = [];
    const resolvedFirst = ml.items.map((spec) => (defIng ? { ing: defIng, via: 'def' as const } : r.resolve(spec.name, note, date, spec.fullName)));
    // 料理名の推測: 食材として登録がなく、数量もなく、下に数量のある食材の行が続く
    const single = ml.items.length === 1 ? (ml.items[0] as ItemSpec) : null;
    if (single && single.qtyState === 'none' && !ml.price && !ml.same && !ml.def && !resolvedFirst[0]?.ing) {
      const nx = nextItems(k);
      if (nx?.t === 'items' && nx.items.some((i) => i.qtyState !== 'none')) {
        const title = note ? `${single.name}(${note})` : single.name;
        dish = { title, rows: [] };
        if (slot ?? forcedSlot) (day.slots[(slot ?? forcedSlot) as SlotName] ??= []).push(dish);
        lines.push({ ...base, type: 'title', slot: slot ?? undefined, detail: `料理名: ${title}`, guess: '食材として登録がなく、数量もなく、下に食材の行が続くので、料理名とみなした' });
        return;
      }
    }
    const descs: string[] = [];
    ml.items.forEach((spec, i) => {
      const res = resolvedFirst[i] as ReturnType<Resolver['resolve']>;
      const it: ItemRead = { index: i, name: res.useFull && spec.fullName ? spec.fullName : spec.name, qty: spec.qty, unit: spec.unit, qtyState: spec.qtyState };
      if (note) it.note = note;
      if (spec.vague) it.vague = spec.vague;
      if (spec.countQty) it.countQty = spec.countQty;
      if (res.useFull) {
        it.qty = null;
        it.unit = '';
        it.qtyState = 'none';
      }
      if (res.ing) {
        it.ingredientId = res.ing.id;
        if (res.via) it.via = res.via;
      } else if (ml.same) {
        // 同価格の行は、行の名前ではなく参照先で計算するので、行の名前の割り当ては問わない
      } else if (res.problem === 'note' && res.plain && note) {
        const k2 = normalizeName(spec.name + note);
        problems.push({ type: 'note', key: `note|${k2}`, name: spec.name, note, plainId: res.plain.id, refs: [ref(i)] });
      } else {
        const k2 = normalizeName(note ? spec.name + note : spec.name);
        problems.push({ type: 'assign', key: `assign|${k2}`, name: spec.name, ...(note ? { note } : {}), refs: [ref(i)] });
      }
      // 毎回聞く: 数量のない行・数字のない単位・少々など・数字だけで単位なし
      let qty = it.qty;
      let unit = it.unit;
      if (it.qtyState !== 'ok') {
        const a = answers.get(answerId(tgt(i)));
        if (a?.value.type === 'qty') {
          qty = a.value.qty;
          unit = a.value.unit;
          it.answered = a.value;
        } else if (!ml.same || ml.same.qtyState !== 'ok') {
          const last = it.ingredientId ? lastByIng.get(it.ingredientId) : undefined;
          problems.push({
            type: 'qty',
            key: `qty|${answerId(tgt(i))}`,
            ref: ref(i),
            target: tgt(i),
            name: it.name,
            ...(it.ingredientId ? { ingredientId: it.ingredientId } : {}),
            state: it.qtyState as 'none' | 'unit-only' | 'vague' | 'no-unit',
            unit: it.unit,
            qty: it.qty,
            ...(it.vague ? { vague: it.vague } : {}),
            lineText: src.raw,
            ...(last ? { last } : {}),
          });
          qty = null;
        }
      }
      // 同価格: 参照した食材のその量として計算する
      let row: Row;
      if (ml.same) {
        const sres = r.resolve(ml.same.name, undefined, date);
        const sq = ml.same.qtyState === 'ok' ? ml.same.qty : qty;
        const su = ml.same.qtyState === 'ok' ? ml.same.unit : unit;
        it.same = { name: ml.same.name, ...(sres.ing ? { ingredientId: sres.ing.id } : {}), qty: sq, unit: su };
        if (!sres.ing) problems.push({ type: 'assign', key: `assign|${normalizeName(ml.same.name)}`, name: ml.same.name, refs: [ref(i)] });
        row = { ...(sres.ing ? { ingredientId: sres.ing.id } : {}), rawName: it.name, qty: sq, unit: su || 'g', note: `${ml.same.name}と同価格` };
      } else {
        row = { ...(it.ingredientId ? { ingredientId: it.ingredientId } : {}), rawName: it.name, qty, unit: unit || 'g', ...(note ? { note } : {}) };
      }
      // 単価メモ(その食事の日付の価格として登録する)
      if (ml.price && it.ingredientId && !ml.same) {
        pricesOut.push({
          id: `inline:${date}:${pad(src.no)}`,
          date,
          ingredientId: it.ingredientId,
          yen: ml.price.yen,
          qty: ml.price.qty,
          unit: ml.price.unit,
          ...(ml.price.grams !== undefined ? { grams: ml.price.grams } : {}),
          source: 'inline',
          note: '単価メモ',
          createdAt: `${date} q${pad(src.no)}`,
        });
      }
      addRow(row, it, src.no);
      items.push(it);
      const shown = it.answered?.type === 'qty' ? `${fmtQ(it.answered.qty, it.answered.unit)}(答え)` : fmtQ(it.qty, it.unit);
      descs.push(`${it.name}${note ? `(${note})` : ''} ${it.qtyState === 'vague' && !it.answered ? `${it.vague}(数量なし)` : shown}${it.countQty ? ` ※${fmtQ(it.countQty.qty, it.countQty.unit)}の重さ` : ''}`);
    });
    const extra: string[] = [];
    if (ml.shared) extra.push('複数の名前に1つの数量 → それぞれに同じ数量');
    if (ml.price) extra.push(`単価メモ ${fmtQ(ml.price.qty, ml.price.unit)} ${ml.price.yen}円`);
    if (ml.same) extra.push(`同価格: ${ml.same.name} ${fmtQ(ml.same.qtyState === 'ok' ? ml.same.qty : null, ml.same.unit)} として計算`);
    if (defIng && ml.def?.per) extra.push(`その場での定義(${fmtQ(ml.def.per.qty, ml.def.per.unit)}あたり${ml.def.yen !== null ? `、${ml.def.yen}円` : ''})`);
    for (const ch of ml.items.flatMap((i) => i.unitChanges)) if (!base.changes.includes(ch)) base.changes.push(ch);
    lines.push({ ...base, type: 'items', slot: slot ?? forcedSlot ?? undefined, detail: descs.join(' / ') + (extra.length ? ` ・${extra.join(' ・')}` : ''), items });
  });

  if (noSlot.length > 0) {
    problems.push({
      type: 'slot',
      key: `slot|${date}`,
      ref: { kind, date, line: (noSlot[0] as { line: number }).line },
      target: { kind, date, lineKey: SLOT_KEY, occurrence: 0, item: 0 },
      lines: [...new Set(noSlot.map((n) => n.line))],
    });
  }
  if (memos.length > 0) day.memo = memos.join('\n');
  return { lines, day, problems };
}

// ---------- 食材費 ----------

function buildPurchase(p: ParsedText, r: Resolver, answers: Map<string, LineAnswer>, pricesOut: PriceEntry[]): { lines: ReadLine[]; prices: PriceEntry[]; total: number; problems: Problem[] } {
  const date = p.text.date;
  const kind: NoteKind = 'purchase';
  const key = keyer();
  const lines: ReadLine[] = [];
  const prices: PriceEntry[] = [];
  const problems: Problem[] = [];
  let store: string | undefined;
  let total = 0;
  for (const src of p.lines) {
    const pl: PurchaseLine = parsePurchaseLine(src.norm.text);
    const base = { no: src.no, raw: src.raw, text: src.norm.text, changes: [...src.norm.changes], target: key(null, src.norm.text) };
    const ref: ProblemRef = { kind, date, line: src.no };
    const tgt: AnswerTarget = { kind, date, lineKey: base.target.lineKey, occurrence: base.target.occurrence, item: 0 };
    if (pl.t === 'blank') {
      lines.push({ ...base, type: 'blank', detail: '' });
      continue;
    }
    if (pl.t === 'store') {
      store = pl.name;
      lines.push({ ...base, type: 'store', detail: `店: ${pl.name}`, guess: '数字のない行なので、店名とみなした' });
      continue;
    }
    if (pl.t === 'memo') {
      lines.push({ ...base, type: 'memo', detail: `メモ: ${pl.text}` });
      continue;
    }
    if (pl.t === 'unread') {
      lines.push({ ...base, type: 'unread', detail: `読めない: ${pl.reason}` });
      problems.push({ type: 'unread', key: `unread|p|${date}|${src.no}`, ref, lineText: src.raw, reason: pl.reason });
      continue;
    }
    for (const ch of pl.unitChanges) if (!base.changes.includes(ch)) base.changes.push(ch);
    if (pl.yen !== null) total += pl.yen;
    const res = r.resolve(pl.name, undefined, date);
    const info: NonNullable<ReadLine['purchase']> = { name: pl.name, yen: pl.yen, qty: pl.qty, unit: pl.unit, ...(pl.grams !== undefined ? { grams: pl.grams } : {}), ...(store ? { store } : {}) };
    if (res.ing) info.ingredientId = res.ing.id;
    else problems.push({ type: 'assign', key: `assign|${normalizeName(pl.name)}`, name: pl.name, refs: [ref] });
    if (pl.error === 'no-yen' || pl.error === 'too-many') {
      const reason = pl.error === 'no-yen' ? '金額(円)がない' : '金額か量が多すぎる(金額1つ、重さ1つ、個数1つまで)';
      lines.push({ ...base, type: 'unread', detail: `読めない: ${reason}`, purchase: info });
      problems.push({ type: 'unread', key: `unread|p|${date}|${src.no}`, ref, lineText: src.raw, reason });
      continue;
    }
    let qty = pl.qty;
    let unit = pl.unit;
    if (pl.error === 'no-amount') {
      const a = answers.get(answerId(tgt));
      if (a?.value.type === 'qty') {
        qty = a.value.qty;
        unit = a.value.unit;
      } else {
        problems.push({ type: 'purchase-qty', key: `pq|${answerId(tgt)}`, ref, target: tgt, name: pl.name, ...(res.ing ? { ingredientId: res.ing.id } : {}), lineText: src.raw });
      }
    }
    if (res.ing && qty !== null && isSuspiciousPriceUnit({ unit }, res.ing)) {
      const a = answers.get(answerId(tgt));
      if (a?.value.type === 'unit') unit = a.value.unit;
      else {
        problems.push({ type: 'mg', key: `mg|${answerId(tgt)}`, ref, target: tgt, name: pl.name, ingredientId: res.ing.id, qty });
        qty = null;
      }
    }
    info.qty = qty;
    info.unit = unit;
    if (res.ing && qty !== null && pl.yen !== null) {
      const entry: PriceEntry = {
        id: `buy:${date}:${pad(src.no)}`,
        date,
        ingredientId: res.ing.id,
        yen: pl.yen,
        qty,
        unit,
        ...(pl.grams !== undefined ? { grams: pl.grams } : {}),
        ...(store ? { store } : {}),
        ...(pl.notes.length ? { note: pl.notes.join(' ') } : {}),
        source: 'purchase',
        createdAt: `${date} p${pad(src.no)}`,
      };
      prices.push(entry);
      pricesOut.push(entry);
      info.priceId = entry.id;
    }
    const q = qty === null ? '(量なし)' : `${fmtQ(qty, unit)}${pl.grams !== undefined ? `(${pl.grams}g)` : ''}`;
    lines.push({ ...base, type: 'purchase', detail: `${pl.name} ${q} ${pl.yen}円${pl.notes.length ? ` ・補足: ${pl.notes.join(' ')}` : ''}${store ? ` ・店: ${store}` : ''}`, purchase: info });
  }
  return { lines, prices, total, problems };
}

// ---------- 全体 ----------

const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function buildJournal(input: JournalInput): Journal {
  const texts = [...input.texts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const answers = new Map(input.answers.map((a) => [a.id, a]));
  // 「前回の値」: 食材ごとに、最後に答えた数量
  const lastByIng = new Map<string, { qty: number; unit: string; at: string }>();
  for (const a of [...input.answers].sort((x, y) => (x.answeredAt < y.answeredAt ? -1 : x.answeredAt > y.answeredAt ? 1 : x.id < y.id ? -1 : 1))) {
    if (a.value.type === 'qty' && a.ingredientId) lastByIng.set(a.ingredientId, { qty: a.value.qty, unit: a.value.unit, at: a.answeredAt });
  }
  const resolver = new Resolver(input.ingredients);
  const parsed = texts.map(splitLines);

  // 1) その場での定義を、すべての献立から先に集める(ほかの日の同じ名前にも使うため)
  for (const p of parsed) {
    if (p.text.kind !== 'meal') continue;
    for (const src of p.lines) {
      for (const ml of parseMealLine(src.norm.text)) {
        if (ml.t !== 'items' || !ml.def) continue;
        const ing = defIngredient((ml.items[0] as ItemSpec).name, ml.def, p.text.date, src.no);
        if (ing) resolver.addDef(ing.name, { date: p.text.date, ing });
      }
    }
  }
  resolver.sortDefs();

  // 2) 食材費と献立を読む
  const prices: PriceEntry[] = [];
  const defs: Ingredient[] = [];
  const purchases: PurchaseDay[] = [];
  const mealParts: { p: ParsedText; built: ReturnType<typeof buildMeal> }[] = [];
  for (const p of parsed) {
    if (p.text.kind === 'purchase') {
      const b = buildPurchase(p, resolver, answers, prices);
      purchases.push({ date: p.text.date, text: p.text, lines: b.lines, prices: b.prices, total: b.total, problems: b.problems });
    } else {
      mealParts.push({ p, built: buildMeal(p, resolver, answers, lastByIng, defs, prices) });
    }
  }

  // 3) 計算(M1 の計算コア)
  const ctx = createContext(input.foods, [...input.ingredients, ...defs], prices);
  const meals: MealDay[] = mealParts.map(({ p, built }) => {
    const calc = computeDay(ctx, built.day);
    const problems = [...built.problems, ...calcProblems(ctx, built, calc, p.text.date)];
    const notes: string[] = [];
    if (calc.counts.futurePrice > 0) notes.push(`未来の価格で代用 ${calc.counts.futurePrice} 行`);
    if (calc.counts.partialPrice > 0) notes.push(`一部価格未登録 ${calc.counts.partialPrice} 行`);
    if (calc.counts.unmeasured > 0) notes.push(`一部未測定 ${calc.counts.unmeasured} 行(成分表で「-」。0 として数える)`);
    return { date: p.text.date, text: p.text, lines: built.lines, day: built.day, calc, problems, notes };
  });
  meals.sort(byDate);
  purchases.sort(byDate);
  return { meals, purchases, prices, defs, ctx };
}

/** 計算で出た警告を、解決できる問題にする(未解決・数量なしは、読み取りの問題として出し済み) */
function calcProblems(ctx: CalcContext, built: ReturnType<typeof buildMeal>, calc: DayCalc, date: string): Problem[] {
  const out: Problem[] = [];
  const lineOf = new Map<string, { line: number; item: number }>();
  for (const l of built.lines) for (const it of l.items ?? []) if (it.at) lineOf.set(`${it.at.slot}|${it.at.dish}|${it.at.row}`, { line: l.no, item: it.index });
  for (const rc of calc.rows) {
    const where = lineOf.get(`${rc.slot}|${rc.dishIndex}|${rc.rowIndex}`);
    const ref: ProblemRef = { kind: 'meal', date, line: where?.line ?? 0, ...(where ? { item: where.item } : {}) };
    const seen = new Set<string>();
    for (const is of rc.issues) {
      const ingId = is.ingredientId;
      if (!ingId || is.kind === 'unresolved' || is.kind === 'no-qty' || is.kind === 'future-price' || is.kind === 'partial-price') continue;
      let p: Problem | null = null;
      if (is.kind === 'no-unit') {
        const ing = ctx.ingredients.get(ingId);
        let unit = rc.row.unit;
        if (ingId !== rc.row.ingredientId) {
          p = { type: 'calc', key: `calc|no-unit|${ingId}`, issue: 'no-unit', ingredientId: ingId, refs: [ref] };
        } else {
          if (ing?.source.kind === 'label' && ['g', 'kg', 'mg'].includes(normalizeUnit(unit))) unit = ing.source.per.unit;
          p = { type: 'unit', key: `unit|${ingId}|${normalizeUnit(unit)}`, ingredientId: ingId, unit: normalizeUnit(unit), refs: [ref] };
        }
      } else if (is.kind === 'price-unit') {
        const pick = pickPrice(ctx.prices.get(ingId), date);
        if (pick) p = { type: 'unit', key: `unit|${ingId}|${normalizeUnit(pick.entry.unit)}`, ingredientId: ingId, unit: normalizeUnit(pick.entry.unit), refs: [ref] };
      } else {
        p = { type: 'calc', key: `calc|${is.kind}|${ingId}`, issue: is.kind, ingredientId: ingId, refs: [ref] };
      }
      if (p && !seen.has(p.key)) {
        seen.add(p.key);
        out.push(p);
      }
    }
  }
  return out;
}

/** 同じ問題(同じ食材の割り当てなど)を1つにまとめる。参照(どの日のどの行か)はまとめて持つ */
export function mergeProblems(list: Problem[]): Problem[] {
  const map = new Map<string, Problem>();
  for (const p of list) {
    const cur = map.get(p.key);
    if (!cur) {
      map.set(p.key, 'refs' in p ? { ...p, refs: [...p.refs] } : p);
      continue;
    }
    if ('refs' in cur && 'refs' in p) cur.refs.push(...p.refs);
  }
  return [...map.values()];
}

/** 問題の並び: 一度答えれば覚えるもの → 毎回聞くもの → 読めない行 → そのほか */
const ORDER: Record<Problem['type'], number> = { assign: 0, note: 1, unit: 2, slot: 3, qty: 4, 'purchase-qty': 5, mg: 6, unread: 7, calc: 8 };
export function sortProblems(list: Problem[]): Problem[] {
  return [...list].sort((a, b) => ORDER[a.type] - ORDER[b.type] || ('refs' in b && 'refs' in a ? b.refs.length - a.refs.length : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** 問題の参照の日付(一覧の件数を日ごとに数えるため) */
export function problemDates(p: Problem): string[] {
  if ('refs' in p) return [...new Set(p.refs.map((r) => r.date))];
  return [p.ref.date];
}
