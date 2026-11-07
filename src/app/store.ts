// アプリの状態。データはすべて端末内(IndexedDB)にあり、起動時にメモリへ読み込む。
// 入力のたびにメモリを更新し、IndexedDB にも保存する(保存ボタンはない)。
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { FoodTable } from '../core/nutrients.ts';
import type { Day, Ingredient, PriceEntry, Settings } from '../core/types.ts';
import { isEmptyDay, mergeByDate, type AppData } from '../data/backup.ts';
import { defaultIngredients } from '../data/defaultIngredients.ts';
import { demoData } from '../data/demo.ts';
import type { MealDb, Meta } from '../db/db.ts';

export interface AppState {
  data: AppData;
  meta: Meta;
  /** 直近の保存エラー(なければ null) */
  saveError: string | null;
}

type Listener = () => void;

export class Store {
  readonly db: MealDb;
  readonly foods: FoodTable;
  private state: AppState;
  private listeners = new Set<Listener>();

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

  /** 初回起動: 調味料などの初期値を入れる */
  async initializeIfNeeded(): Promise<void> {
    if (this.state.meta.initialized) return;
    const existing = new Set(this.state.data.ingredients.map((i) => i.id));
    const add = defaultIngredients(this.foods).filter((i) => !existing.has(i.id));
    for (const i of add) await this.db.putIngredient(i);
    const meta = { ...this.state.meta, initialized: true, foodDbVersionId: this.foods.version };
    await this.db.putMeta(meta);
    this.set({ data: { ...this.state.data, ingredients: [...this.state.data.ingredients, ...add] }, meta });
  }

  // ---- 日 ----
  getDay(date: string): Day {
    return this.state.data.days.find((d) => d.date === date) ?? { date, slots: {}, extras: [] };
  }

  setDay(input: Day) {
    // 行も料理名もない料理と、空の食事区分は残さない
    const day: Day = { ...input, slots: {} };
    for (const [slot, dishes] of Object.entries(input.slots) as [keyof Day['slots'], Day['slots'][keyof Day['slots']]][]) {
      const kept = (dishes ?? []).filter((d) => d.rows.length > 0 || d.title);
      if (kept.length > 0) day.slots[slot] = kept;
    }
    const others = this.state.data.days.filter((d) => d.date !== day.date);
    if (isEmptyDay(day)) {
      this.setData({ days: others });
      void this.persist(this.db.deleteDay(day.date));
    } else {
      this.setData({ days: [...others, day] });
      void this.persist(this.db.putDay(day));
    }
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

  // ---- 価格 ----
  upsertPrice(p: PriceEntry) {
    const list = this.state.data.prices;
    const idx = list.findIndex((x) => x.id === p.id);
    this.setData({ prices: idx >= 0 ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p] });
    void this.persist(this.db.putPrice(p));
  }

  deletePrice(id: string) {
    this.setData({ prices: this.state.data.prices.filter((x) => x.id !== id) });
    void this.persist(this.db.deletePrice(id));
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

  /** 全データ消去(初期値の調味料などは入れ直す) */
  async clearAll(): Promise<void> {
    const empty: AppData = { ingredients: defaultIngredients(this.foods), prices: [], days: [], settings: this.state.data.settings };
    await this.replaceAll(empty, '全データ消去の前', { demo: false, initialized: true, foodDbVersionId: this.foods.version });
  }

  async loadDemo(): Promise<void> {
    await this.replaceAll(demoData(this.foods), 'デモデータを読み込む前', { demo: true, initialized: true, foodDbVersionId: this.foods.version });
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
