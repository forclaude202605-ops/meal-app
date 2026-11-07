// 食材マスタの編集(仕様書 §8「食材」)。成分表の紐づけ、ラベル値、レシピ、単位換算、価格。
import { useMemo, useState } from 'preact/hooks';
import { foodDisplayName, KEY_INDEX, NUTRIENTS } from '../core/nutrients.ts';
import { isSuspiciousPriceUnit } from '../core/price.ts';
import { parsePriceText } from '../core/priceText.ts';
import { normalizeUnit, parseQuantity } from '../core/quantity.ts';
import { normalizeName, searchFoods, searchIngredients } from '../core/search.ts';
import { todayLocal } from '../core/dates.ts';
import { NUTRIENT_KEYS, SLOT_NAMES, type Ingredient, type NutrientKey, type PriceEntry, type RecipeComponent, type UnitConversion } from '../core/types.ts';
import { DENSITY_SOURCE, VOLUME_ML, VOLUME_SOURCE, volumeUnits } from '../data/defaultIngredients.ts';
import { fmtNutrient } from './format.ts';
import { newId, useAppState, useStore } from './store.ts';
import { Badge, Button, Field, QtyInput, SearchInput, Segmented, Sheet } from './ui.tsx';

type Kind = Ingredient['source']['kind'];
const COMMON_LABEL_KEYS: NutrientKey[] = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'salt', 'na', 'ca', 'fe', 'vitd', 'vitc', 'vitk', 'b1', 'b2', 'b12', 'fol'];
const BASIS_LABEL: Record<NonNullable<UnitConversion['basis']>, string> = { 'mext-density': '成分表の密度から計算', measured: '実測', manual: '手で入力' };

interface UnitDraft {
  unit: string;
  qty: string;
  grams: string;
  basis: NonNullable<UnitConversion['basis']>;
}

export function IngredientEditor(props: { initial?: Ingredient; presetName?: string; onClose: () => void; onSaved?: (ing: Ingredient) => void }) {
  const store = useStore();
  const { data } = useAppState();
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? props.presetName ?? '');
  const [aliases, setAliases] = useState(init?.aliases.join('、') ?? '');
  const [kind, setKind] = useState<Kind>(init?.source.kind ?? 'food');
  const [foodId, setFoodId] = useState(init?.source.kind === 'food' ? init.source.foodId : '');
  const [perQty, setPerQty] = useState(init?.source.kind === 'label' ? String(init.source.per.qty) : '1');
  const [perUnit, setPerUnit] = useState(init?.source.kind === 'label' ? init.source.per.unit : '錠');
  const [labelVals, setLabelVals] = useState<Partial<Record<NutrientKey, string>>>(() => {
    if (init?.source.kind !== 'label') return {};
    const out: Partial<Record<NutrientKey, string>> = {};
    for (const [k, v] of Object.entries(init.source.nutrients)) if (typeof v === 'number') out[k as NutrientKey] = String(v);
    return out;
  });
  const [showAllLabel, setShowAllLabel] = useState(false);
  const [components, setComponents] = useState<{ ingredientId: string; qty: string; unit: string }[]>(
    init?.source.kind === 'recipe' ? init.source.components.map((c) => ({ ingredientId: c.ingredientId, qty: String(c.qty), unit: c.unit })) : [],
  );
  const [yieldG, setYieldG] = useState(init?.source.kind === 'recipe' && init.source.yieldG > 0 ? String(init.source.yieldG) : '');
  const [units, setUnits] = useState<UnitDraft[]>(init?.units.map((u) => ({ unit: u.unit, qty: String(u.qty), grams: String(u.grams), basis: u.basis ?? 'manual' })) ?? []);
  const [unitsConfirmed, setUnitsConfirmed] = useState(init?.unitsConfirmed ?? true);
  const [costFree, setCostFree] = useState(init?.costFree ?? false);
  const [memo, setMemo] = useState(init?.memo ?? '');
  const [picking, setPicking] = useState<null | 'food' | number>(null);
  const [error, setError] = useState<string | null>(null);

  const food = foodId ? store.foods.get(foodId) : undefined;
  const id = init?.id;

  const usedRows = useMemo(() => {
    if (!id) return 0;
    let n = 0;
    for (const d of data.days) for (const s of SLOT_NAMES) for (const dish of d.slots[s] ?? []) n += dish.rows.filter((r) => r.ingredientId === id).length;
    return n;
  }, [data.days, id]);

  if (picking === 'food') {
    return (
      <FoodPicker
        initialQuery={name}
        onClose={() => setPicking(null)}
        onPick={(fid) => {
          setFoodId(fid);
          setPicking(null);
        }}
      />
    );
  }
  if (typeof picking === 'number') {
    return (
      <IngredientPicker
        exclude={id}
        onClose={() => setPicking(null)}
        onPick={(ing) => {
          setComponents((cs) => cs.map((c, i) => (i === picking ? { ...c, ingredientId: ing.id, unit: c.unit || 'g' } : c)));
          setPicking(null);
        }}
      />
    );
  }

  const build = (): Ingredient | string => {
    const nm = name.trim();
    if (!nm) return '名前を入れてください';
    const al = aliases
      .split(/[、,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const taken = data.ingredients.filter((i) => i.id !== id).flatMap((i) => [i.name, ...i.aliases].map((n) => [normalizeName(n), i.name] as const));
    for (const n of [nm, ...al]) {
      const hit = taken.find(([k]) => k === normalizeName(n));
      if (hit) return `「${n}」は、すでに「${hit[1]}」の名前か別名です`;
    }
    let source: Ingredient['source'];
    if (kind === 'food') {
      if (!foodId) return '成分表の食品を選んでください';
      source = { kind: 'food', foodId };
    } else if (kind === 'label') {
      const pq = parseQuantity(perQty);
      if (pq === null || pq <= 0) return '基準量(例: 1錠、15g)を入れてください';
      const nutrients: Partial<Record<NutrientKey, number>> = {};
      for (const [k, t] of Object.entries(labelVals)) {
        if (!t || !t.trim()) continue;
        const v = parseQuantity(t);
        if (v === null) return `${NUTRIENTS[k as NutrientKey].label} の値が読めません`;
        nutrients[k as NutrientKey] = v;
      }
      source = { kind: 'label', per: { qty: pq, unit: normalizeUnit(perUnit) || 'g' }, nutrients };
    } else {
      const comps: RecipeComponent[] = [];
      for (const c of components) {
        if (!c.ingredientId) return '構成食材を選んでください';
        const q = parseQuantity(c.qty);
        if (q === null) return '構成食材の量が読めません';
        comps.push({ ingredientId: c.ingredientId, qty: q, unit: normalizeUnit(c.unit) || 'g' });
      }
      const y = yieldG.trim() ? parseQuantity(yieldG) : 0;
      if (y === null) return '完成重量が読めません';
      if (comps.length > 0 && !(y > 0)) return '完成重量(焼成・加熱後の重さ)を入れてください';
      source = { kind: 'recipe', components: comps, yieldG: y };
    }
    const unitList: UnitConversion[] = [];
    for (const u of units) {
      if (!u.unit.trim()) continue;
      const q = parseQuantity(u.qty);
      const g = parseQuantity(u.grams);
      if (q === null || q <= 0 || g === null || g <= 0) return `単位「${u.unit}」の換算が読めません`;
      unitList.push({ unit: normalizeUnit(u.unit), qty: q, grams: g, basis: u.basis });
    }
    return {
      id: id ?? newId('ing'),
      name: nm,
      aliases: al,
      source,
      units: unitList,
      unitsConfirmed,
      ...(costFree ? { costFree: true } : {}),
      ...(memo.trim() ? { memo: memo.trim() } : {}),
    };
  };

  const save = () => {
    const r = build();
    if (typeof r === 'string') {
      setError(r);
      return;
    }
    store.upsertIngredient(r);
    props.onSaved?.(r);
    props.onClose();
  };

  const setUnit = (i: number, patch: Partial<UnitDraft>) => setUnits((us) => us.map((u, j) => (j === i ? { ...u, ...patch } : u)));

  return (
    <Sheet
      title={init ? '食材を編集' : '食材を登録'}
      onClose={props.onClose}
      footer={
        <>
          {init ? (
            <Button
              kind="danger"
              onClick={() => {
                const msg = usedRows > 0 ? `この食材は ${usedRows} 行で使われています。削除すると、それらの行は「未解決」になります。削除しますか?` : 'この食材を削除しますか?';
                if (!confirm(msg)) return;
                store.deleteIngredient(init.id);
                props.onClose();
              }}
            >
              削除
            </Button>
          ) : null}
          <Button kind="primary" onClick={save}>
            保存
          </Button>
        </>
      }
    >
      {error ? <div class="banner bad">{error}</div> : null}
      <Field label="名前(メモでの表記)">
        <input class="input" value={name} data-autofocus onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
      <Field label="別名(「、」で区切る)" hint="ひらがな・カタカナ・漢字・略称など。表記ゆれは自動で揃えて比べます">
        <input class="input" value={aliases} onInput={(e) => setAliases(e.currentTarget.value)} />
      </Field>
      <Segmented
        label="栄養の出どころ"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'food', label: '成分表' },
          { value: 'label', label: 'ラベル' },
          { value: 'recipe', label: 'レシピ' },
        ]}
      />

      {kind === 'food' ? (
        <div class="card">
          {food ? (
            <>
              <p>
                <b>{foodDisplayName(food)}</b> <span class="muted small">({food.id})</span>
              </p>
              <p class="small muted num">
                100gあたり {fmtNutrient('kcal', food.values[KEY_INDEX.kcal] ?? 0)}kcal ・ P {fmtNutrient('protein', food.values[KEY_INDEX.protein] ?? 0)} ・ F{' '}
                {fmtNutrient('fat', food.values[KEY_INDEX.fat] ?? 0)} ・ C {fmtNutrient('carb', food.values[KEY_INDEX.carb] ?? 0)} ・ 食塩 {fmtNutrient('salt', food.values[KEY_INDEX.salt] ?? 0)}
              </p>
            </>
          ) : (
            <p class="muted">成分表の食品が未選択です</p>
          )}
          <Button onClick={() => setPicking('food')}>成分表から選ぶ</Button>
        </div>
      ) : null}

      {kind === 'label' ? (
        <div class="card">
          <p class="small muted">包装のラベルの値。基準量は「1錠」「1枚」「15g」「100g」など。書いていない栄養素は 0 として扱います。</p>
          <div class="row-flex">
            <span>基準量</span>
            <QtyInput label="基準量" value={perQty} onChange={(t) => setPerQty(t)} />
            <input class="input" style={{ width: '6em' }} aria-label="基準量の単位" value={perUnit} onInput={(e) => setPerUnit(e.currentTarget.value)} />
            <span>あたり</span>
          </div>
          <table class="tbl" style={{ marginTop: '8px' }}>
            <tbody>
              {(showAllLabel ? NUTRIENT_KEYS : COMMON_LABEL_KEYS).map((k) => (
                <tr>
                  <td>
                    {NUTRIENTS[k].label}
                    {NUTRIENTS[k].note ? <span class="small muted">({NUTRIENTS[k].note})</span> : null}
                  </td>
                  <td class="r">
                    <input
                      class="input"
                      style={{ width: '7em', textAlign: 'right' }}
                      inputMode="decimal"
                      aria-label={NUTRIENTS[k].label}
                      value={labelVals[k] ?? ''}
                      onInput={(e) => setLabelVals((v) => ({ ...v, [k]: e.currentTarget.value }))}
                    />
                  </td>
                  <td>{NUTRIENTS[k].unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button kind="ghost" class="small" onClick={() => setShowAllLabel((s) => !s)}>
            {showAllLabel ? '主な栄養素だけ表示' : 'すべての栄養素を表示'}
          </Button>
          <p class="small muted">食塩相当量がなくナトリウムだけ書かれているときは、Na(mg) × 2.54 / 1000 で食塩相当量(g)にします。</p>
        </div>
      ) : null}

      {kind === 'recipe' ? (
        <div class="card">
          <p class="small muted">材料から作る食品。構成食材の合計を、完成重量(焼成・加熱後の重さ)で割って計算します。内訳が空なら「内訳未登録」として 0 で数えます。</p>
          {components.map((c, i) => {
            const ci = data.ingredients.find((x) => x.id === c.ingredientId);
            return (
              <div class="row-flex wrap" style={{ marginBottom: '6px' }}>
                <Button class="grow" onClick={() => setPicking(i)}>
                  {ci?.name ?? (c.ingredientId ? '(削除された食材)' : '食材を選ぶ')}
                </Button>
                <QtyInput label="量" value={c.qty} onChange={(t) => setComponents((cs) => cs.map((x, j) => (j === i ? { ...x, qty: t } : x)))} />
                <input class="input" style={{ width: '4.5em' }} aria-label="単位" value={c.unit} onInput={(e) => setComponents((cs) => cs.map((x, j) => (j === i ? { ...x, unit: e.currentTarget.value } : x)))} />
                <Button kind="ghost" class="small" aria-label="この構成食材を削除" onClick={() => setComponents((cs) => cs.filter((_, j) => j !== i))}>
                  ×
                </Button>
              </div>
            );
          })}
          <Button onClick={() => setComponents((cs) => [...cs, { ingredientId: '', qty: '', unit: 'g' }])}>＋ 構成食材</Button>
          <div class="row-flex" style={{ marginTop: '8px' }}>
            <span class="grow">完成重量</span>
            <QtyInput label="完成重量" value={yieldG} onChange={(t) => setYieldG(t)} placeholder="g" />
            <span>g</span>
          </div>
        </div>
      ) : null}

      <div class="card">
        <h3>単位換算</h3>
        <p class="small muted">「数量 単位 = 重さ g」。g は登録しなくても使えます。自分の計量スプーンで量った重さに直すときは、根拠を「実測」にしてください。</p>
        {units.map((u, i) => (
          <div class="unit-row">
            <QtyInput label="数量" value={u.qty} onChange={(t) => setUnit(i, { qty: t })} />
            <input class="input" aria-label="単位" value={u.unit} onInput={(e) => setUnit(i, { unit: e.currentTarget.value })} />
            <span>=</span>
            <QtyInput label="重さ(g)" value={u.grams} onChange={(t) => setUnit(i, { grams: t, basis: u.basis === 'mext-density' ? 'measured' : u.basis })} placeholder="g" />
            <span>g</span>
            <Button kind="ghost" class="small" aria-label={`単位 ${u.unit} を削除`} onClick={() => setUnits((us) => us.filter((_, j) => j !== i))}>
              ×
            </Button>
            <select class="input basis" aria-label="換算の根拠" value={u.basis} onChange={(e) => setUnit(i, { basis: e.currentTarget.value as UnitDraft['basis'] })}>
              {(Object.keys(BASIS_LABEL) as UnitDraft['basis'][]).map((b) => (
                <option value={b}>根拠: {BASIS_LABEL[b]}</option>
              ))}
            </select>
          </div>
        ))}
        <div class="row-flex wrap">
          <Button onClick={() => setUnits((us) => [...us, { unit: '', qty: '1', grams: '', basis: 'manual' }])}>＋ 単位</Button>
          {kind === 'food' && food?.gPer100mL ? (
            <Button
              kind="ghost"
              onClick={() => {
                const add = volumeUnits(food.gPer100mL as number, ['大さじ', '小さじ', 'mL']).filter((v) => !units.some((u) => normalizeUnit(u.unit) === v.unit));
                setUnits((us) => [...us, ...add.map((v) => ({ unit: v.unit, qty: String(v.qty), grams: String(Math.round(v.grams * 1000) / 1000), basis: 'mext-density' as const }))]);
                setUnitsConfirmed(false);
              }}
            >
              成分表の密度から大さじ・小さじを作る
            </Button>
          ) : null}
        </div>
        {kind === 'food' && food?.gPer100mL ? (
          <p class="small muted">
            成分表の備考: 100 mL = {food.gPer100mL} g(大さじ {VOLUME_ML['大さじ']} mL、小さじ {VOLUME_ML['小さじ']} mL として計算)。出典: {DENSITY_SOURCE}。{VOLUME_SOURCE}
          </p>
        ) : null}
        <label class="row-flex" style={{ marginTop: '8px' }}>
          <input type="checkbox" checked={unitsConfirmed} onChange={(e) => setUnitsConfirmed(e.currentTarget.checked)} style={{ width: '24px', height: '24px' }} />
          <span>単位換算を確認した{!unitsConfirmed ? <Badge tone="warn">⚠ 未確認</Badge> : null}</span>
        </label>
      </div>

      <div class="card">
        <label class="row-flex">
          <input type="checkbox" checked={costFree} onChange={(e) => setCostFree(e.currentTarget.checked)} style={{ width: '24px', height: '24px' }} />
          <span>費用に含めない(0円で扱う)。水など、価格を記録しない食材</span>
        </label>
        <Field label="メモ">
          <textarea class="input" rows={2} value={memo} onInput={(e) => setMemo(e.currentTarget.value)} />
        </Field>
      </div>

      {init ? <PriceSection ingredient={init} /> : <p class="small muted">価格は、保存したあとに登録できます。</p>}
    </Sheet>
  );
}

function PriceSection(props: { ingredient: Ingredient }) {
  const store = useStore();
  const { data } = useAppState();
  const list = data.prices.filter((p) => p.ingredientId === props.ingredient.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  return (
    <div class="card">
      <h3>価格</h3>
      {props.ingredient.costFree ? <p class="small muted">「費用に含めない」食材です。</p> : null}
      <ul class="list">
        {list.map((p) => (
          <li class="row-flex small">
            <span class="grow num">
              {p.date} {p.store ?? ''} {p.qty}
              {p.unit}
              {p.grams ? `(${p.grams}g)` : ''} {p.yen}円 {p.source === 'inline' ? <Badge tone="info">単価メモ</Badge> : null}
              {p.note ? <span class="muted"> ・{p.note}</span> : null}
            </span>
            <Button kind="ghost" class="small" aria-label="この価格を削除" onClick={() => confirm('この価格を削除しますか?') && store.deletePrice(p.id)}>
              削除
            </Button>
          </li>
        ))}
      </ul>
      <PriceForm ingredient={props.ingredient} />
    </div>
  );
}

/** 価格の登録。「420g 118円」「118円 420g」「4本 158円」「612g 6尾 538円」のどれでも受け付ける(例は架空) */
export function PriceForm(props: { ingredient: Ingredient; onDone?: () => void }) {
  const store = useStore();
  const [date, setDate] = useState(todayLocal());
  const [store_, setStore] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const parsed = text.trim() ? parsePriceText(text) : null;
  const add = () => {
    if (!parsed || !parsed.ok) {
      setErr(parsed && !parsed.ok ? parsed.error : '量と金額を入れてください');
      return;
    }
    const v = parsed.value;
    if (isSuspiciousPriceUnit(v, props.ingredient) && !confirm('単位が mg になっています。mL か g の入力ミスではありませんか?このまま登録しますか?')) return;
    const p: PriceEntry = {
      id: newId('price'),
      date,
      ingredientId: props.ingredient.id,
      yen: v.yen,
      qty: v.qty,
      unit: v.unit,
      ...(v.grams !== undefined ? { grams: v.grams } : {}),
      ...(store_.trim() ? { store: store_.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      source: 'purchase',
      createdAt: new Date().toISOString(),
    };
    store.upsertPrice(p);
    setText('');
    setNote('');
    setErr(null);
    props.onDone?.();
  };
  return (
    <div style={{ marginTop: '8px' }}>
      <div class="row-flex wrap">
        <input class="input" type="date" aria-label="購入日" value={date} onChange={(e) => setDate(e.currentTarget.value)} style={{ width: 'auto' }} />
        <input class="input grow" aria-label="店名" placeholder="店名" value={store_} onInput={(e) => setStore(e.currentTarget.value)} />
      </div>
      <Field label="量と金額" hint="例: 420g 118円 / 118円 420g / 4本 158円 / 612g 6尾 538円">
        <input class="input" value={text} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      </Field>
      {parsed ? (
        parsed.ok ? (
          <p class="small muted">
            → {parsed.value.qty}
            {parsed.value.unit}
            {parsed.value.grams !== undefined ? `(${parsed.value.grams}g)` : ''} で {parsed.value.yen}円
          </p>
        ) : (
          <p class="small" style={{ color: 'var(--bad-text)' }}>
            {parsed.error}
          </p>
        )
      ) : null}
      <Field label="補足(例: サンプルメモ)">
        <input class="input" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </Field>
      {err ? <div class="banner bad">{err}</div> : null}
      <Button kind="primary" onClick={add}>
        価格を登録
      </Button>
    </div>
  );
}

export function FoodPicker(props: { initialQuery: string; onClose: () => void; onPick: (foodId: string) => void }) {
  const store = useStore();
  const [q, setQ] = useState(props.initialQuery);
  const hits = useMemo(() => searchFoods(q, store.foods, 60), [q, store.foods]);
  return (
    <Sheet title="成分表から選ぶ" onClose={props.onClose}>
      <SearchInput label="成分表を検索" value={q} onSearch={setQ} autofocus placeholder="例: キャベツ 生、白米、ぶた もも" />
      <p class="small muted">単語ごとに探します。複数の語は空白で区切ると、すべてを含む食品だけを出します。候補が複数あるときは自分で選んでください。</p>
      <ul class="list result-list">
        {hits.map((h) => (
          <li>
            <button type="button" class="list-btn" onClick={() => props.onPick(h.food.id)}>
              <span class="grow">
                {foodDisplayName(h.food)}
                <span class="meta">
                  {' '}
                  {h.food.id} ・ {fmtNutrient('kcal', h.food.values[KEY_INDEX.kcal] ?? 0)}kcal/100g
                </span>
              </span>
              {h.viaAlias ? <Badge tone="info">候補</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
      {q.trim() && hits.length === 0 ? <p class="muted">見つかりません。別の言い方(例: ひらがな、部位名)で試してください。</p> : null}
    </Sheet>
  );
}

export function IngredientPicker(props: { exclude?: string; onClose: () => void; onPick: (ing: Ingredient) => void }) {
  const { data } = useAppState();
  const [q, setQ] = useState('');
  const hits = searchIngredients(q, data.ingredients.filter((i) => i.id !== props.exclude)).slice(0, 40);
  return (
    <Sheet title="食材を選ぶ" onClose={props.onClose}>
      <SearchInput label="食材を検索" value={q} onSearch={setQ} autofocus />
      <ul class="list result-list">
        {hits.map((h) => (
          <li>
            <button type="button" class="list-btn" onClick={() => props.onPick(h.ingredient)}>
              {h.ingredient.name}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
