// アプリの状態。データはすべて端末内(IndexedDB)にあり、起動時にメモリへ読み込む。
// 記録の正は「日ごとのテキスト」。区分・料理・行、価格、栄養、費用は保存せず、テキストから毎回作る(journal)。
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { FoodTable } from '../core/nutrients.ts';
import { buildJournal, type Journal } from '../core/parse/journal.ts';
import { answerId, textId, type AnswerTarget, type AnswerValue, type DayText, type Ingredient, type LineAnswer, type NoteKind, type Settings } from '../core/types.ts';
import { mergeByDate, type AppData } from '../data/backup.ts';
import { defaultIngredients } from '../data/defaultIngredients.ts';
import { DEMO_PREFIX, DEMO_RANGE, demoIngredients, demoMealText, demoPurchaseText } from '../data/demo.ts';
import { analyzePaste, pastedTexts } from '../core/parse/paste.ts';
import type { MealDb, Meta } from '../db/db.ts';

export interface AppState {
  data: AppData;
  meta: Meta;
  /** 直近の保存エラー(なければ null) */
  saveError: string | null;
}

type Listener = () => void;

/** その日のテキストに今ある行の、答えの鍵(lineKey|occurrence)。消えた行の答えを片づけるため */
export function liveAnswerKeys(foods: FoodTable, ingredients: Ingredient[], t: DayText): Set<string> {
  const j = buildJournal({ foods, ingredients, texts: [t], answers: [] });
  const lines = t.kind === 'meal' ? (j.meals[0]?.lines ?? []) : (j.purchases[0]?.lines ?? []);
  const keys = new Set(lines.map((l) => `${l.target.lineKey}|${l.target.occurrence}`));
  keys.add('__slot__|0');
  return keys;
}

export class Store {
  readonly db: MealDb;
  readonly foods: FoodTable;
  private state: AppState;
  private listeners = new Set<Listener>();
  private journalCache: { data: AppData; journal: Journal } | null = null;

  constructor(db: MealDb, foods: FoodTable, initial: { data: AppData; meta: Meta }) {
    this.db = db;
    this.foods = foods;
    this.state = { ...initial, saveError: null };
  }

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private setData(patch: Partial<AppData>) {
    this.set({ data: { ...this.state.data, ...patch } });
  }

  private async persist(p: Promise<unknown>) {
    try {
      await p;
      if (this.state.saveError) this.set({ saveError: null });
    } catch (e) {
      this.set({ saveError: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 保存済みのテキストから作った記録(データが変わるまで使い回す) */
  journal(): Journal {
    const data = this.state.data;
    if (this.journalCache?.data !== data) {
      this.journalCache = { data, journal: buildJournal({ foods: this.foods, ingredients: data.ingredients, texts: data.texts, answers: data.answers }) };
    }
    return this.journalCache.journal;
  }

  /** 初回起動: 調味料などの初期値を入れる。schema 2 への切り替え(旧形式のデモの食材を消す)も1回だけ行う */
  async initializeIfNeeded(): Promise<void> {
    let meta = this.state.meta;
    let ingredients = this.state.data.ingredients;
    if (!meta.textsMigrated) {
      const remove = ingredients.filter((i) => i.id.startsWith(DEMO_PREFIX)).map((i) => i.id);
      if (remove.length > 0) await this.db.writeIngredients([], remove);
      ingredients = ingredients.filter((i) => !remove.includes(i.id));
      meta = { ...meta, textsMigrated: true, demo: false };
    }
    if (!meta.initialized) {
      const existing = new Set(ingredients.map((i) => i.id));
      const add = defaultIngredients(this.foods).filter((i) => !existing.has(i.id));
      if (add.length > 0) await this.db.writeIngredients(add, []);
      ingredients = [...ingredients, ...add];
      meta = { ...meta, initialized: true, foodDbVersionId: this.foods.version };
    }
    if (meta !== this.state.meta) {
      await this.db.putMeta(meta);
      this.set({ data: { ...this.state.data, ingredients }, meta });
    }
  }

  // ---- 日ごとのテキスト ----

  getText(kind: NoteKind, date: string): DayText | undefined {
    return this.state.data.texts.find((t) => t.id === textId(kind, date));
  }

  /**
   * テキストを保存する(同じ日・同じ種類は置き換え)。保存した日の答えのうち、もうない行への答えは片づける
   * (同じ行が残っていれば、答えは引き継ぐ)。
   */
  saveTexts(list: DayText[]) {
    if (list.length === 0) return;
    const ids = new Set(list.map((t) => t.id));
    const texts = [...this.state.data.texts.filter((t) => !ids.has(t.id)), ...list];
    const removeAnswers: string[] = [];
    for (const t of list) {
      const live = liveAnswerKeys(this.foods, this.state.data.ingredients, t);
      for (const a of this.state.data.answers) if (a.kind === t.kind && a.date === t.date && !live.has(`${a.lineKey}|${a.occurrence}`)) removeAnswers.push(a.id);
    }
    const gone = new Set(removeAnswers);
    this.setData({ texts, answers: this.state.data.answers.filter((a) => !gone.has(a.id)) });
    void this.persist(this.db.writeTexts(list, [], removeAnswers));
  }

  deleteText(kind: NoteKind, date: string) {
    const id = textId(kind, date);
    const removeAnswers = this.state.data.answers.filter((a) => a.kind === kind && a.date === date).map((a) => a.id);
    const gone = new Set(removeAnswers);
    this.setData({ texts: this.state.data.texts.filter((t) => t.id !== id), answers: this.state.data.answers.filter((a) => !gone.has(a.id)) });
    void this.persist(this.db.writeTexts([], [id], removeAnswers));
  }

  // ---- 答え(毎回聞く項目) ----

  setAnswer(target: AnswerTarget, value: AnswerValue, ingredientId?: string) {
    const a: LineAnswer = { ...target, id: answerId(target), value, ...(ingredientId ? { ingredientId } : {}), answeredAt: new Date().toISOString() };
    const list = this.state.data.answers;
    const idx = list.findIndex((x) => x.id === a.id);
    this.setData({ answers: idx >= 0 ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a] });
    void this.persist(this.db.putAnswer(a));
  }

  // ---- 食材 ----
  upsertIngredient(i: Ingredient) {
    const list = this.state.data.ingredients;
    const idx = list.findIndex((x) => x.id === i.id);
    this.setData({ ingredients: idx >= 0 ? list.map((x) => (x.id === i.id ? i : x)) : [...list, i] });
    void this.persist(this.db.putIngredient(i));
  }

  deleteIngredient(id: string) {
    this.setData({ ingredients: this.state.data.ingredients.filter((x) => x.id !== id) });
    void this.persist(this.db.deleteIngredient(id));
  }

  /** 食材に別名を足す(一度答えれば覚える: 食材名の割り当て) */
  addAlias(ingredientId: string, alias: string) {
    const ing = this.state.data.ingredients.find((i) => i.id === ingredientId);
    if (!ing || ing.name === alias || ing.aliases.includes(alias)) return;
    this.upsertIngredient({ ...ing, aliases: [...ing.aliases, alias] });
  }

  /** 食材に単位の重さを足す(一度答えれば覚える: 1パック = 何g など) */
  addUnit(ingredientId: string, unit: string, grams: number) {
    const ing = this.state.data.ingredients.find((i) => i.id === ingredientId);
    if (!ing) return;
    const units = [...ing.units.filter((u) => u.unit !== unit), { unit, qty: 1, grams, basis: 'manual' as const }];
    this.upsertIngredient({ ...ing, units });
  }

  // ---- 設定・メタ ----
  setSettings(s: Settings) {
    this.setData({ settings: s });
    void this.persist(this.db.putSettings(s));
  }

  setMeta(patch: Partial<Meta>) {
    const meta = { ...this.state.meta, ...patch };
    this.set({ meta });
    void this.persist(this.db.putMeta(meta));
  }

  // ---- まとめての入れ替え(いずれも、上書きの前に今の状態を自動で退避する) ----
  async replaceAll(data: AppData, reason: string, meta: Partial<Meta> = {}): Promise<void> {
    await this.db.addSnapshot(reason, this.state.data);
    const nextMeta: Meta = { ...this.state.meta, ...meta };
    await this.db.replaceAll(data, nextMeta);
    this.set({ data, meta: nextMeta });
  }

  async mergeByDate(incoming: AppData, reason: string): Promise<void> {
    await this.replaceAll(mergeByDate(this.state.data, incoming), reason);
  }

  /** 全データ消去(初期値の調味料などは入れ直す。設定は残す) */
  async clearAll(): Promise<void> {
    const empty: AppData = { ingredients: defaultIngredients(this.foods), texts: [], answers: [], settings: this.state.data.settings };
    await this.replaceAll(empty, '全データ消去の前', { demo: false, initialized: true, foodDbVersionId: this.foods.version });
  }

  /** デモ用の食材を食材マスタに足す(すでにあるものは足さない) */
  addDemoIngredients(): number {
    const have = new Set(this.state.data.ingredients.map((i) => i.id));
    const add = demoIngredients().filter((i) => !have.has(i.id));
    if (add.length === 0) return 0;
    this.setData({ ingredients: [...this.state.data.ingredients, ...add] });
    this.setMeta({ demo: true });
    void this.persist(this.db.writeIngredients(add, []));
    return add.length;
  }

  /** デモを消す: デモの食材と、デモのテキストと同じ内容の日(とその答え) */
  async removeDemo(today: string): Promise<{ ingredients: number; texts: number }> {
    const data = this.state.data;
    const a = analyzePaste(`${demoPurchaseText()}\n${demoMealText()}`, { today, saved: [] });
    const demoTexts = new Map(pastedTexts(a, {}, '').map((t) => [t.id, t.text]));
    const removeTexts = data.texts.filter((t) => t.date >= DEMO_RANGE.start && t.date <= DEMO_RANGE.end && demoTexts.get(t.id) === t.text).map((t) => t.id);
    const removeIngs = data.ingredients.filter((i) => i.id.startsWith(DEMO_PREFIX)).map((i) => i.id);
    const goneTexts = new Set(removeTexts);
    const next: AppData = {
      ...data,
      ingredients: data.ingredients.filter((i) => !removeIngs.includes(i.id)),
      texts: data.texts.filter((t) => !goneTexts.has(t.id)),
      answers: data.answers.filter((x) => !goneTexts.has(textId(x.kind, x.date))),
    };
    await this.replaceAll(next, 'デモを消す前', { demo: false });
    return { ingredients: removeIngs.length, texts: removeTexts.length };
  }
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('Store がありません');
  return s;
}

export function useAppState(): AppState {
  const store = useStore();
  const [state, setState] = useState(store.get());
  useEffect(() => store.subscribe(() => setState(store.get())), [store]);
  return state;
}

export function newId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}
