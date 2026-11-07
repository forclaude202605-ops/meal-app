// 起動: 同梱の成分表を読み、端末内のデータ(IndexedDB)を開いて画面を出す。外部には通信しない。
import { render } from 'preact';
import { App } from './app/App.tsx';
import { registerServiceWorker, isStandalone, requestPersist } from './app/pwa.ts';
import { Store, StoreContext } from './app/store.ts';
import './app/styles.css';
import { createFoodTable, type FoodDbJson } from './core/nutrients.ts';
import foodsUrl from './data/foods.json?url';
import { MealDb } from './db/db.ts';

let pendingUpdate: ((apply: () => void) => void) | null = null;
let waitingApply: (() => void) | null = null;
registerServiceWorker((apply) => {
  if (pendingUpdate) pendingUpdate(apply);
  else waitingApply = apply;
});

async function boot() {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app がありません');
  const [foodsJson, db] = await Promise.all([fetch(foodsUrl).then((r) => r.json() as Promise<FoodDbJson>), MealDb.open()]);
  const foods = createFoodTable(foodsJson);
  const store = new Store(db, foods, await db.loadAll());
  await store.initializeIfNeeded();
  // ホーム画面のアプリとして開いたときは、保存の永続化を要求する(結果は設定画面に出す)
  if (isStandalone()) void requestPersist().catch(() => undefined);
  render(
    <StoreContext.Provider value={store}>
      <App
        registerUpdate={(cb) => {
          pendingUpdate = cb;
          if (waitingApply) cb(waitingApply);
        }}
      />
    </StoreContext.Provider>,
    root,
  );
}

boot().catch((e: unknown) => {
  const root = document.getElementById('app');
  if (root) root.innerHTML = `<div style="padding:24px"><h1>起動できませんでした</h1><p>${String(e instanceof Error ? e.message : e).replace(/[<>&]/g, '')}</p></div>`;
});
