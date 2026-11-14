// 端末内の保存(IndexedDB)。サーバーには送らない。
// 保存するのは、日ごとのテキスト、補足(答え)、食材マスタ、設定だけ。区分・料理・行、価格、栄養、費用は保存せず、毎回作る。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DayText, Ingredient, LineAnswer, Settings } from '../core/types.ts';
import { DEFAULT_SETTINGS } from '../core/types.ts';
import { summarize, type AppData, type DataSummary } from '../data/backup.ts';

export interface Meta {
  /** 最後にバックアップを書き出した時刻(ISO) */
  lastBackupAt?: string;
  /** デモ(架空)の食材・テキストが入っている */
  demo?: boolean;
  /** 初期値(調味料など)を入れ済み */
  initialized?: boolean;
  /** データを入れたときの成分表の版 */
  foodDbVersionId?: string;
  /** schema 2(日ごとのテキスト)への切り替えを済ませた */
  textsMigrated?: boolean;
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
  texts: { key: string; value: DayText };
  answers: { key: string; value: LineAnswer };
  kv: { key: string; value: unknown };
  snapshots: { key: string; value: Snapshot };
}

const DB_NAME = 'meal-app';
/** 1: 区分・料理・行と価格を保存(M2) / 2: 日ごとのテキストと補足を保存 */
const DB_VERSION = 2;
/** 上書き前の自動退避は直近3世代まで */
export const SNAPSHOT_LIMIT = 3;

export class MealDb {
  private readonly db: IDBPDatabase<MealDB>;
  private constructor(db: IDBPDatabase<MealDB>) {
    this.db = db;
  }

  static async open(): Promise<MealDb> {
    const db = await openDB<MealDB>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          d.createObjectStore('ingredients', { keyPath: 'id' });
          d.createObjectStore('kv');
          d.createObjectStore('snapshots', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          // 旧形式(区分・料理・行と価格)は、デモだけだったため移行せずに消す。旧形式の退避も消す。
          const names = d.objectStoreNames as unknown as DOMStringList;
          for (const old of ['days', 'prices']) if (names.contains(old)) d.deleteObjectStore(old as never);
          if (oldVersion >= 1) void tx.objectStore('snapshots').clear();
          d.createObjectStore('texts', { keyPath: 'id' });
          d.createObjectStore('answers', { keyPath: 'id' });
        }
      },
    });
    return new MealDb(db);
  }

  async loadAll(): Promise<{ data: AppData; meta: Meta }> {
    const tx = this.db.transaction(['ingredients', 'texts', 'answers', 'kv'], 'readonly');
    const [ingredients, texts, answers, settings, meta] = await Promise.all([
      tx.objectStore('ingredients').getAll(),
      tx.objectStore('texts').getAll(),
      tx.objectStore('answers').getAll(),
      tx.objectStore('kv').get('settings'),
      tx.objectStore('kv').get('meta'),
    ]);
    await tx.done;
    return {
      data: { ingredients, texts, answers, settings: { ...DEFAULT_SETTINGS, ...((settings as Partial<Settings>) ?? {}) } },
      meta: (meta as Meta) ?? {},
    };
  }

  putIngredient(i: Ingredient) {
    return this.db.put('ingredients', i);
  }
  deleteIngredient(id: string) {
    return this.db.delete('ingredients', id);
  }
  putSettings(s: Settings) {
    return this.db.put('kv', s, 'settings');
  }
  putMeta(m: Meta) {
    return this.db.put('kv', m, 'meta');
  }
  putAnswer(a: LineAnswer) {
    return this.db.put('answers', a);
  }

  /** テキストの保存・削除と、補足(答え)の削除を、1つのトランザクションで行う */
  async writeTexts(put: DayText[], removeTexts: string[], removeAnswers: string[]): Promise<void> {
    const tx = this.db.transaction(['texts', 'answers'], 'readwrite');
    await Promise.all([
      ...put.map((t) => tx.objectStore('texts').put(t)),
      ...removeTexts.map((id) => tx.objectStore('texts').delete(id)),
      ...removeAnswers.map((id) => tx.objectStore('answers').delete(id)),
    ]);
    await tx.done;
  }

  /** 食材の追加・削除をまとめて */
  async writeIngredients(put: Ingredient[], remove: string[]): Promise<void> {
    const tx = this.db.transaction('ingredients', 'readwrite');
    await Promise.all([...put.map((i) => tx.store.put(i)), ...remove.map((id) => tx.store.delete(id))]);
    await tx.done;
  }

  /** すべてのデータを入れ替える(1つのトランザクションで) */
  async replaceAll(data: AppData, meta: Meta): Promise<void> {
    const tx = this.db.transaction(['ingredients', 'texts', 'answers', 'kv'], 'readwrite');
    await Promise.all([tx.objectStore('ingredients').clear(), tx.objectStore('texts').clear(), tx.objectStore('answers').clear()]);
    await Promise.all([
      ...data.ingredients.map((i) => tx.objectStore('ingredients').put(i)),
      ...data.texts.map((t) => tx.objectStore('texts').put(t)),
      ...data.answers.map((a) => tx.objectStore('answers').put(a)),
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
