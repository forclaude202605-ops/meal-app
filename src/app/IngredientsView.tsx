// 食材の画面: 食材マスタの一覧と編集(名前、別名、成分表の紐づけ、ラベル値、レシピ、単位の重さ)。
// 価格は登録しない(食材費のメモと単価メモから作る)。ここでは、テキストから作った価格を見るだけ。
import { useMemo, useState } from 'preact/hooks';
import { searchIngredients } from '../core/search.ts';
import type { Ingredient } from '../core/types.ts';
import { IngredientEditor } from './IngredientEditor.tsx';
import { useAppState, useStore } from './store.ts';
import { Badge, Button, SearchInput, Segmented } from './ui.tsx';

const KIND_LABEL = { food: '成分表', label: 'ラベル', recipe: 'レシピ' } as const;

export function IngredientsView() {
  const { data } = useAppState();
  const store = useStore();
  const journal = store.journal();
  const [tab, setTab] = useState<'ingredients' | 'prices'>('ingredients');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const priceCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of journal.prices) m.set(p.ingredientId, (m.get(p.ingredientId) ?? 0) + 1);
    return m;
  }, [journal]);
  const hits = useMemo(() => searchIngredients(q, data.ingredients).map((h) => h.ingredient), [q, data.ingredients]);
  const nameOf = (id: string) => data.ingredients.find((i) => i.id === id)?.name ?? journal.defs.find((d) => d.id === id)?.name ?? '(削除された食材)';

  return (
    <div>
      <div class="topbar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: '8px' }}>
        <Segmented
          label="表示"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'ingredients', label: `食材(${data.ingredients.length})` },
            { value: 'prices', label: `価格(${journal.prices.length})` },
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
                    {i.unitsConfirmed === false ? <Badge tone="warn" title="単位の重さが未確認">⚠</Badge> : null}
                    {i.costFree ? <Badge tone="info">0円</Badge> : <span class="small muted num">{priceCount.get(i.id) ?? 0}件</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p class="small muted">初めて出てくる食材名は、記録の画面で貼り付けたときに、食材マスタと成分表の候補から選べます。選んだ名前は別名として覚えます。</p>
        </>
      ) : (
        <>
          <p class="small muted" style={{ marginTop: '12px' }}>
            食材費のメモと、献立の中の単価メモから作った価格です(新しい順)。費用は、食事の日付以前で最も新しい価格を使います。同じ日に両方あるときは単価メモを使います。直すときは、記録の画面でその日のテキストを書き換えてください。
          </p>
          <div class="card">
            <ul class="list">
              {[...journal.prices]
                .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1))
                .map((p) => (
                  <li class="small num">
                    <b>{nameOf(p.ingredientId)}</b> {p.date} {p.store ?? ''} {p.qty}
                    {p.unit}
                    {p.grams ? `(${p.grams}g)` : ''} {p.yen}円 {p.source === 'inline' ? <Badge tone="info">単価メモ</Badge> : <Badge tone="info">食材費</Badge>}
                    {p.note ? <span class="muted"> ・{p.note}</span> : null}
                  </li>
                ))}
              {journal.prices.length === 0 ? <li class="small muted">まだありません。記録の画面で食材費のメモを貼り付けてください。</li> : null}
            </ul>
          </div>
        </>
      )}

      {editing ? <IngredientEditor {...(editing === 'new' ? { presetName: q } : { initial: editing })} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
