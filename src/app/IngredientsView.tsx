// 食材の画面: 食材マスタの一覧と編集、価格の一覧と登録。
import { useMemo, useState } from 'preact/hooks';
import { searchIngredients } from '../core/search.ts';
import type { Ingredient } from '../core/types.ts';
import { IngredientEditor, IngredientPicker, PriceForm } from './IngredientEditor.tsx';
import { useAppState, useStore } from './store.ts';
import { Badge, Button, SearchInput, Segmented, Sheet } from './ui.tsx';

const KIND_LABEL = { food: '成分表', label: 'ラベル', recipe: 'レシピ' } as const;

export function IngredientsView() {
  const { data } = useAppState();
  const store = useStore();
  const [tab, setTab] = useState<'ingredients' | 'prices'>('ingredients');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [priceFor, setPriceFor] = useState<Ingredient | 'pick' | null>(null);
  const priceCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.prices) m.set(p.ingredientId, (m.get(p.ingredientId) ?? 0) + 1);
    return m;
  }, [data.prices]);
  const hits = useMemo(() => searchIngredients(q, data.ingredients).map((h) => h.ingredient), [q, data.ingredients]);
  const nameOf = (id: string) => data.ingredients.find((i) => i.id === id)?.name ?? '(削除された食材)';

  return (
    <div>
      <div class="topbar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: '8px' }}>
        <Segmented
          label="表示"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'ingredients', label: `食材(${data.ingredients.length})` },
            { value: 'prices', label: `価格(${data.prices.length})` },
          ]}
        />
      </div>

      {tab === 'ingredients' ? (
        <>
          <div class="row-flex" style={{ marginTop: '12px' }}>
            <div class="grow">
              <SearchInput label="食材を絞り込む" value={q} onSearch={setQ} placeholder="名前・別名で絞り込む" />
            </div>
            <Button kind="primary" onClick={() => setEditing('new')}>
              ＋ 登録
            </Button>
          </div>
          <div class="card">
            <ul class="list">
              {hits.map((i) => (
                <li>
                  <button type="button" class="list-btn" onClick={() => setEditing(i)}>
                    <span class="grow">
                      {i.name}
                      {i.aliases.length > 0 ? <span class="small muted"> ({i.aliases.slice(0, 3).join('、')})</span> : null}
                    </span>
                    <Badge tone="info">{KIND_LABEL[i.source.kind]}</Badge>
                    {i.source.kind === 'recipe' && i.source.components.length === 0 ? <Badge tone="warn">内訳未登録</Badge> : null}
                    {i.unitsConfirmed === false ? <Badge tone="warn" title="単位換算が未確認">⚠</Badge> : null}
                    {i.costFree ? <Badge tone="info">0円</Badge> : <span class="small muted num">{priceCount.get(i.id) ?? 0}件</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div class="card">
            <h3>確認キュー</h3>
            <p class="small muted">メモ帳からの移行(M4)で、食材ごとの候補を1件ずつ承認する場所です。</p>
          </div>
        </>
      ) : (
        <>
          <div class="row-flex" style={{ marginTop: '12px' }}>
            <span class="grow small muted">新しい順。「費用」は食事の日付以前で最も新しい記録を使います。</span>
            <Button kind="primary" onClick={() => setPriceFor('pick')}>
              ＋ 価格
            </Button>
          </div>
          <div class="card">
            <ul class="list">
              {[...data.prices]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1))
                .map((p) => (
                  <li class="row-flex small">
                    <span class="grow num">
                      <b>{nameOf(p.ingredientId)}</b> {p.date} {p.store ?? ''} {p.qty}
                      {p.unit}
                      {p.grams ? `(${p.grams}g)` : ''} {p.yen}円 {p.source === 'inline' ? <Badge tone="info">単価メモ</Badge> : null}
                    </span>
                    <Button kind="ghost" class="small" aria-label="この価格を削除" onClick={() => confirm('この価格を削除しますか?') && store.deletePrice(p.id)}>
                      削除
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}

      {editing ? <IngredientEditor {...(editing === 'new' ? { presetName: q } : { initial: editing })} onClose={() => setEditing(null)} /> : null}
      {priceFor === 'pick' ? <IngredientPicker onClose={() => setPriceFor(null)} onPick={(i) => setPriceFor(i)} /> : null}
      {priceFor && priceFor !== 'pick' ? (
        <Sheet title={`${priceFor.name}の価格`} onClose={() => setPriceFor(null)}>
          <PriceForm ingredient={priceFor} onDone={() => setPriceFor(null)} />
        </Sheet>
      ) : null}
    </div>
  );
}
