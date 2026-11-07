// 端末内の保存(IndexedDB)。サーバーには送らない。
// 保存するのは入力したデータだけ。栄養と費用は保存せず、毎回計算する。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Day, Ingredient, PriceEntry, Settings } from '../core/types.ts';
import { DEFAULT_SETTINGS } from '../core/types.ts';
import { summarize, type AppData, type DataSummary } from '../data/backup.ts';

export interface Meta {
  /** 最後にバックアップを書き出した時刻(ISO) */
  lastBackupAt?: string;
  /** デモデータが入っている */
  demo?: boolean;
  /** 初期値(調味料など)を入れ済み */
  initialized?: boolean;
  /** データを入れたときの成分表の版 */
  foodDbVersionId?: string;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  reason: string;
  summary: DataSummary;
  data: AppData;
}

interface MealDB extends DBSchema {
  ingredients: { key: string; value: Ingredient };
  prices: { key: string; value: PriceEntry; indexes: { byIngredient: string } };
  days: { key: string; value: Day };
  kv: { key: string; value: unknown };
  snapshots: { key: string; value: Snapshot };
}

const DB_NAME = 'meal-app';
const DB_VERSION = 1;
/** 上書き前の自動退避は直近3世代まで */
export const SNAPSHOT_LIMIT = 3;

export class MealDb {
  private readonly db: IDBPDatabase<MealDB>;
  private constructor(db: IDBPDatabase<MealDB>) {
    this.db = db;
  }

  static async open(): Promise<MealDb> {
    const db = await openDB<MealDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('ingredients', { keyPath: 'id' });
        const prices = d.createObjectStore('prices', { keyPath: 'id' });
        prices.createIndex('byIngredient', 'ingredientId');
        d.createObjectStore('days', { keyPath: 'date' });
        d.createObjectStore('kv');
        d.createObjectStore('snapshots', { keyPath: 'id' });
      },
    });
    return new MealDb(db);
  }

  async loadAll(): Promise<{ data: AppData; meta: Meta }> {
    const tx = this.db.transaction(['ingredients', 'prices', 'days', 'kv'], 'readonly');
    const [ingredients, prices, days, settings, meta] = await Promise.all([
      tx.objectStore('ingredients').getAll(),
      tx.objectStore('prices').getAll(),
      tx.objectStore('days').getAll(),
      tx.objectStore('kv').get('settings'),
      tx.objectStore('kv').get('meta'),
    ]);
    await tx.done;
    return {
      data: { ingredients, prices, days, settings: { ...DEFAULT_SETTINGS, ...((settings as Partial<Settings>) ?? {}) } },
      meta: (meta as Meta) ?? {},
    };
  }

  putIngredient(i: Ingredient) {
    return this.db.put('ingredients', i);
  }
  deleteIngredient(id: string) {
    return this.db.delete('ingredients', id);
  }
  putPrice(p: PriceEntry) {
    return this.db.put('prices', p);
  }
  deletePrice(id: string) {
    return this.db.delete('prices', id);
  }
  putDay(d: Day) {
    return this.db.put('days', d);
  }
  deleteDay(date: string) {
    return this.db.delete('days', date);
  }
  putSettings(s: Settings) {
    return this.db.put('kv', s, 'settings');
  }
  putMeta(m: Meta) {
    return this.db.put('kv', m, 'meta');
  }

  /** すべてのデータを入れ替える(1つのトランザクションで) */
  async replaceAll(data: AppData, meta: Meta): Promise<void> {
    const tx = this.db.transaction(['ingredients', 'prices', 'days', 'kv'], 'readwrite');
    await Promise.all([tx.objectStore('ingredients').clear(), tx.objectStore('prices').clear(), tx.objectStore('days').clear()]);
    await Promise.all([
      ...data.ingredients.map((i) => tx.objectStore('ingredients').put(i)),
      ...data.prices.map((p) => tx.objectStore('prices').put(p)),
      ...data.days.map((d) => tx.objectStore('days').put(d)),
      tx.objectStore('kv').put(data.settings, 'settings'),
      tx.objectStore('kv').put(meta, 'meta'),
    ]);
    await tx.done;
  }

  /** 今の状態を退避する(直近3世代まで残す) */
  async addSnapshot(reason: string, data: AppData, now: Date = new Date()): Promise<void> {
    const snap: Snapshot = { id: now.toISOString(), createdAt: now.toISOString(), reason, summary: summarize(data), data };
    await this.db.put('snapshots', snap);
    const keys = (await this.db.getAllKeys('snapshots')).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - SNAPSHOT_LIMIT))) await this.db.delete('snapshots', k);
  }

  async listSnapshots(): Promise<Snapshot[]> {
    return (await this.db.getAll('snapshots')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async clearSnapshots(): Promise<void> {
    await this.db.clear('snapshots');
  }
}
