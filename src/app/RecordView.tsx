// 記録画面(仕様書 §8)。台所でスマホを持ったまま、素早く正確に入れられること。入力のたびに自動で保存する。
import { useMemo, useState } from 'preact/hooks';
import { computeDay, createContext, type RowCalc } from '../core/calc.ts';
import { addDays, diffDays, todayLocal } from '../core/dates.ts';
import { NUTRIENTS } from '../core/nutrients.ts';
import { parseQuantity, normalizeUnit } from '../core/quantity.ts';
import { searchIngredients } from '../core/search.ts';
import { NUTRIENT_KEYS, SLOT_NAMES, type Day, type Dish, type Ingredient, type NutrientKey, type Row, type SlotName } from '../core/types.ts';
import { fmtDateJa, fmtGrams, fmtNutrient, fmtQty, fmtYen, warningChips } from './format.ts';
import { IngredientEditor } from './IngredientEditor.tsx';
import { useAppState, useStore } from './store.ts';
import { Badge, Button, Field, QtyInput, SearchInput, Sheet } from './ui.tsx';

type SheetState =
  | { kind: 'add'; slot: SlotName; dish: number }
  | { kind: 'row'; slot: SlotName; dish: number; row: number }
  | { kind: 'dish'; slot: SlotName; dish: number | null }
  | { kind: 'extra' }
  | null;

const clone = <T,>(x: T): T => structuredClone(x);

export function RecordView(props: { date: string; setDate: (d: string) => void; goSettings: () => void; isStandalone: boolean }) {
  const store = useStore();
  const { data, meta } = useAppState();
  const { date } = props;
  const day = useMemo(() => data.days.find((d) => d.date === date) ?? { date, slots: {}, extras: [] }, [data.days, date]);
  const ctx = useMemo(() => createContext(store.foods, data.ingredients, data.prices), [store.foods, data.ingredients, data.prices]);
  const calc = useMemo(() => computeDay(ctx, day), [ctx, day]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [weightText, setWeightText] = useState<string | null>(null);

  const update = (fn: (d: Day) => void) => {
    const d = clone(store.getDay(date));
    fn(d);
    store.setDay(d);
  };

  const rowCalc = (slot: SlotName, dish: number, row: number): RowCalc | undefined =>
    calc.rows.find((r) => r.slot === slot && r.dishIndex === dish && r.rowIndex === row);

  const today = todayLocal();
  const t = calc.total;
  const chips = warningChips(calc.counts);
  const backupDue =
    data.days.length > 0 && (!meta.lastBackupAt || diffDays(meta.lastBackupAt.slice(0, 10), today) >= data.settings.backupReminderDays);

  const commitWeight = (text: string) => {
    const s = text.normalize('NFKC').trim();
    const v = s === '' ? undefined : Number(s);
    if (v !== undefined && !(Number.isFinite(v) && v > 0 && v < 500)) return;
    update((d) => {
      if (v === undefined) delete d.weightKg;
      else d.weightKg = v;
    });
    setWeightText(null);
  };

  return (
    <div>
      <div class="topbar">
        <div class="datebar">
          <Button kind="ghost" aria-label="前の日" onClick={() => props.setDate(addDays(date, -1))}>
            ‹
          </Button>
          <div class="date-label">
            <span aria-live="polite">{fmtDateJa(date, true)}</span>
            <input type="date" aria-label="日付を選ぶ" value={date} onChange={(e) => e.currentTarget.value && props.setDate(e.currentTarget.value)} />
          </div>
          <Button kind="ghost" aria-label="次の日" onClick={() => props.setDate(addDays(date, 1))}>
            ›
          </Button>
          <Button kind="plain" class="small" disabled={date === today} onClick={() => props.setDate(today)}>
            今日
          </Button>
        </div>
        <div class="totals" aria-label="この日の合計">
          <div class="t">
            <b>{fmtNutrient('kcal', t.nutrients.kcal)}</b>
            <span>kcal</span>
          </div>
          <div class="t">
            <b>
              {fmtNutrient('protein', t.nutrients.protein)}/{fmtNutrient('fat', t.nutrients.fat)}/{fmtNutrient('carb', t.nutrients.carb)}
            </b>
            <span>P/F/C g</span>
          </div>
          <div class="t">
            <b>{fmtNutrient('salt', t.nutrients.salt)}</b>
            <span>食塩 g</span>
          </div>
          <div class="t">
            <b>{fmtYen(t.cost, 'total')}</b>
            <span>費用</span>
          </div>
        </div>
      </div>

      {!props.isStandalone ? (
        <div class="banner info">
          ホーム画面に追加してから使ってください。Safari のタブで入れたデータは、ホーム画面のアプリからは見えません。
          <Button kind="ghost" class="small" onClick={props.goSettings}>
            追加の手順
          </Button>
        </div>
      ) : null}
      {meta.demo ? <div class="banner warn">デモデータ(架空)を表示しています。設定の「全データ消去」で消せます。</div> : null}
      {backupDue ? (
        <div class="banner info">
          {meta.lastBackupAt ? `最後のバックアップから ${diffDays(meta.lastBackupAt.slice(0, 10), today)} 日たちました。` : 'まだバックアップを書き出していません。'}
          <Button kind="ghost" class="small" onClick={props.goSettings}>
            バックアップへ
          </Button>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div class="chips" aria-label="この日の注意">
          {chips.map((c) => (
            <Badge tone={c.excluded ? 'bad' : 'warn'} title={c.excluded ? '合計から外れています' : '合計には入っています'}>
              {c.label} {c.count}
            </Badge>
          ))}
        </div>
      ) : null}

      <div class="card">
        <div class="row-flex">
          <label class="grow" for="weight">
            体重
          </label>
          <input
            id="weight"
            class="input weight-input"
            type="text"
            inputMode="decimal"
            placeholder="kg"
            autoComplete="off"
            value={weightText ?? (day.weightKg !== undefined ? String(day.weightKg) : '')}
            onInput={(e) => setWeightText(e.currentTarget.value)}
            onBlur={(e) => commitWeight(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitWeight(e.currentTarget.value)}
          />
          <span>kg</span>
        </div>
      </div>

      {SLOT_NAMES.map((slot) => {
        const dishes = day.slots[slot] ?? [];
        const st = calc.slots[slot];
        return (
          <section class="card" aria-label={slot}>
            <div class="slot-head">
              <h2>{slot}</h2>
              <span class="small muted num">
                {fmtNutrient('kcal', st.nutrients.kcal)} kcal ・ {fmtYen(st.cost, 'total')}
              </span>
            </div>
            {dishes.map((dish, di) => (
              <div class="dish">
                {dish.title ? (
                  <button type="button" class="dish-title list-btn" onClick={() => setSheet({ kind: 'dish', slot, dish: di })}>
                    {dish.title}
                  </button>
                ) : null}
                {dish.rows.map((row, ri) => (
                  <RowLine row={row} rc={rowCalc(slot, di, ri)} onTap={() => setSheet({ kind: 'row', slot, dish: di, row: ri })} />
                ))}
                <div class="row-flex">
                  <Button kind="ghost" class="small" onClick={() => setSheet({ kind: 'add', slot, dish: di })}>
                    ＋ 食材{dishes.length > 1 && dish.title ? `(${dish.title})` : ''}
                  </Button>
                  {!dish.title ? (
                    <Button kind="ghost" class="small" onClick={() => setSheet({ kind: 'dish', slot, dish: di })}>
                      料理名
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            <div class="row-flex">
              {dishes.length === 0 ? (
                <Button kind="ghost" class="small" onClick={() => setSheet({ kind: 'add', slot, dish: 0 })}>
                  ＋ 食材
                </Button>
              ) : null}
              <Button kind="ghost" class="small" onClick={() => setSheet({ kind: 'dish', slot, dish: null })}>
                ＋ 料理
              </Button>
            </div>
          </section>
        );
      })}

      <section class="card" aria-label="日の手動加算">
        <div class="slot-head">
          <h2>手動加算</h2>
          <Button kind="ghost" class="small" onClick={() => setSheet({ kind: 'extra' })}>
            ＋ 追加
          </Button>
        </div>
        <p class="small muted">日照によるビタミンDなど。食事由来とは分けて、日の合計に足します。</p>
        {day.extras.map((e, i) => (
          <div class="food-row">
            <span class="name">{e.label}</span>
            <span class="vals">
              {(Object.entries(e.nutrients) as [NutrientKey, number][]).map(([k, v]) => `${NUTRIENTS[k].label} ${fmtNutrient(k, v)}${NUTRIENTS[k].unit}`).join(' ')}
            </span>
            <Button
              kind="ghost"
              class="small"
              aria-label={`${e.label}を削除`}
              onClick={() =>
                update((d) => {
                  d.extras.splice(i, 1);
                })
              }
            >
              削除
            </Button>
          </div>
        ))}
      </section>

      <section class="card">
        <Field label="メモ">
          <textarea
            class="input"
            rows={2}
            value={day.memo ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              update((d) => {
                if (v) d.memo = v;
                else delete d.memo;
              });
            }}
          />
        </Field>
      </section>

      {sheet?.kind === 'add' ? <AddRowSheet date={date} slot={sheet.slot} dish={sheet.dish} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'row' ? <RowSheet date={date} slot={sheet.slot} dish={sheet.dish} row={sheet.row} rc={rowCalc(sheet.slot, sheet.dish, sheet.row)} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'dish' ? <DishSheet date={date} slot={sheet.slot} dish={sheet.dish} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'extra' ? <ExtraSheet date={date} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

function RowLine(props: { row: Row; rc: RowCalc | undefined; onTap: () => void }) {
  const { row, rc } = props;
  const unresolved = !rc?.ingredient;
  const issues = rc?.issues ?? [];
  const has = (k: string) => issues.some((i) => i.kind === k);
  return (
    <button type="button" class={`food-row${unresolved ? ' unresolved' : ''}`} onClick={props.onTap}>
      <span class="name">
        {rc?.ingredient?.name ?? row.rawName}
        <span class="sub">
          {fmtQty(row.qty)}
          {row.qty !== null ? row.unit : ''}
          {row.unit !== 'g' && rc?.grams !== null && rc?.grams !== undefined ? ` = ${fmtGrams(rc.grams)}` : ''}
          {row.note ? ` ・${row.note}` : ''}
        </span>
      </span>
      <span class="vals">
        {rc?.included ? `${fmtNutrient('kcal', rc.nutrients.kcal)} kcal` : ''}
        <br />
        {rc?.costIncluded ? fmtYen(rc.cost, 'row') : ''}
        {has('no-qty') ? <Badge tone="bad">数量なし</Badge> : null}
        {has('no-unit') ? <Badge tone="bad">単位換算なし</Badge> : null}
        {has('missing-food') || has('cycle') || has('bad-recipe') ? <Badge tone="bad">計算できない</Badge> : null}
        {has('empty-recipe') ? <Badge tone="warn">内訳未登録</Badge> : null}
        {has('no-price') ? <Badge tone="warn">価格未登録</Badge> : null}
        {has('price-unit') ? <Badge tone="warn">単価未確定</Badge> : null}
        {has('partial-price') ? <Badge tone="warn">一部価格未登録</Badge> : null}
        {has('future-price') ? <Badge tone="info">未来の価格</Badge> : null}
        {rc?.ingredient && rc.ingredient.unitsConfirmed === false && row.unit !== 'g' ? <Badge tone="warn">⚠換算未確認</Badge> : null}
      </span>
    </button>
  );
}

/** 単位の候補: g と、その食材に登録された単位(ラベル型は基準量の単位も) */
function unitOptions(ing: Ingredient): string[] {
  const list = ['g', ...ing.units.map((u) => normalizeUnit(u.unit))];
  if (ing.source.kind === 'label') list.unshift(normalizeUnit(ing.source.per.unit));
  return [...new Set(list)];
}

/** よく使う・最近使った食材の点数(過去60日) */
function useUsage(date: string): Map<string, number> {
  const { data } = useAppState();
  return useMemo(() => {
    const m = new Map<string, number>();
    const from = addDays(date, -60);
    for (const d of data.days) {
      if (d.date < from || d.date > date) continue;
      const recency = 1 + (60 - Math.max(0, diffDays(d.date, date))) / 60;
      for (const s of SLOT_NAMES) for (const dish of d.slots[s] ?? []) for (const r of dish.rows) if (r.ingredientId) m.set(r.ingredientId, (m.get(r.ingredientId) ?? 0) + recency);
    }
    return m;
  }, [data.days, date]);
}

/** その食材で前回使った単位 */
function lastUnit(days: Day[], ingId: string): string | undefined {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const d of sorted) for (const s of SLOT_NAMES) for (const dish of d.slots[s] ?? []) for (const r of [...dish.rows].reverse()) if (r.ingredientId === ingId) return r.unit;
  return undefined;
}

function AddRowSheet(props: { date: string; slot: SlotName; dish: number; onClose: () => void }) {
  const store = useStore();
  const { data } = useAppState();
  const usage = useUsage(props.date);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Ingredient | { raw: string } | null>(null);
  const [qtyText, setQtyText] = useState('');
  const [unit, setUnit] = useState('g');
  const [registering, setRegistering] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  const hits = useMemo(() => searchIngredients(query, data.ingredients, usage).slice(0, 30), [query, data.ingredients, usage]);

  const pick = (ing: Ingredient) => {
    setPicked(ing);
    const opts = unitOptions(ing);
    const last = lastUnit(data.days, ing.id);
    setUnit(last && opts.includes(normalizeUnit(last)) ? normalizeUnit(last) : (opts[0] ?? 'g'));
    setQtyText('');
  };

  const add = () => {
    if (!picked) return;
    const qty = parseQuantity(qtyText);
    const row: Row =
      'raw' in picked ? { rawName: picked.raw, qty, unit } : { ingredientId: picked.id, rawName: picked.name, qty, unit };
    const d = structuredClone(store.getDay(props.date));
    const dishes = d.slots[props.slot] ?? [{ rows: [] }];
    const dish = dishes[props.dish] ?? (dishes[dishes.length] = { rows: [] });
    dish.rows.push(row);
    d.slots[props.slot] = dishes;
    store.setDay(d);
    setAdded((a) => [...a, `${row.rawName} ${fmtQty(qty)}${qty !== null ? unit : ''}`]);
    setPicked(null);
    setQuery('');
    setQtyText('');
  };

  if (registering !== null) {
    return (
      <IngredientEditor
        presetName={registering}
        onClose={() => setRegistering(null)}
        onSaved={(ing) => {
          setRegistering(null);
          pick(ing);
        }}
      />
    );
  }

  const title = `${props.slot}に食材を追加`;
  if (picked) {
    const opts = 'raw' in picked ? ['g'] : unitOptions(picked);
    const name = 'raw' in picked ? picked.raw : picked.name;
    const qty = parseQuantity(qtyText);
    return (
      <Sheet
        key="qty"
        title={title}
        onClose={props.onClose}
        footer={
          <>
            <Button onClick={() => setPicked(null)}>戻る</Button>
            <Button kind="primary" onClick={add} disabled={qtyText.trim() !== '' && qty === null}>
              {qtyText.trim() === '' ? '数量なしで追加' : '追加'}
            </Button>
          </>
        }
      >
        <p>
          <b>{name}</b>
          {'raw' in picked ? <Badge tone="bad">未解決(食材マスタに未登録)</Badge> : null}
        </p>
        <div class="row-flex">
          <QtyInput label="数量" value={qtyText} autofocus onChange={(t) => setQtyText(t)} placeholder="例: 120、0.6、2/3" />
          <span>{unit}</span>
        </div>
        <div class="unit-chips" role="radiogroup" aria-label="単位" style={{ marginTop: '8px' }}>
          {opts.map((u) => (
            <button type="button" role="radio" aria-checked={u === unit} class={`chip-btn${u === unit ? ' on' : ''}`} onClick={() => setUnit(u)}>
              {u}
            </button>
          ))}
        </div>
        {!('raw' in picked) && picked.unitsConfirmed === false && unit !== 'g' ? <p class="small"><Badge tone="warn">⚠ この単位換算は未確認です(食材の画面で確認・実測値に直せます)</Badge></p> : null}
        {qtyText.trim() === '' ? <p class="small muted">数量を入れないと「数量なし」として残り、集計から外れます。</p> : null}
      </Sheet>
    );
  }

  return (
    <Sheet key="search" title={title} onClose={props.onClose}>
      <SearchInput label="食材を検索" placeholder="食材の名前(ひらがな・カタカナ・漢字)" value={query} onSearch={setQuery} autofocus />
      {added.length > 0 ? <p class="small muted">追加しました: {added.join('、')}</p> : null}
      <ul class="list result-list">
        {hits.map((h) => (
          <li>
            <button type="button" class="list-btn" onClick={() => pick(h.ingredient)}>
              <span class="grow">
                {h.ingredient.name}
                {h.ingredient.aliases.length > 0 ? <span class="meta"> ({h.ingredient.aliases.slice(0, 3).join('、')})</span> : null}
              </span>
              {h.ingredient.unitsConfirmed === false ? <Badge tone="warn">⚠</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
      {query.trim() ? (
        <div class="row-flex wrap" style={{ marginTop: '8px' }}>
          <Button onClick={() => setRegistering(query.trim())}>「{query.trim()}」を食材に登録</Button>
          <Button kind="ghost" onClick={() => { setPicked({ raw: query.trim() }); setUnit('g'); }}>
            未登録のまま追加
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

function RowSheet(props: { date: string; slot: SlotName; dish: number; row: number; rc: RowCalc | undefined; onClose: () => void }) {
  const store = useStore();
  const { data } = useAppState();
  const day = store.getDay(props.date);
  const row = day.slots[props.slot]?.[props.dish]?.rows[props.row];
  const [qtyText, setQtyText] = useState(row && row.qty !== null ? String(row.qty) : '');
  const [unit, setUnit] = useState(row?.unit ?? 'g');
  const [note, setNote] = useState(row?.note ?? '');
  const [mode, setMode] = useState<'edit' | 'register' | 'link'>('edit');
  const [query, setQuery] = useState(row?.rawName ?? '');
  if (!row) return null;
  const ing = row.ingredientId ? data.ingredients.find((i) => i.id === row.ingredientId) : undefined;
  const opts = ing ? unitOptions(ing) : ['g'];
  if (!opts.includes(normalizeUnit(unit))) opts.push(unit);

  const save = (patch: Partial<Row>) => {
    const d = structuredClone(store.getDay(props.date));
    const r = d.slots[props.slot]?.[props.dish]?.rows[props.row];
    if (!r) return;
    Object.assign(r, patch);
    if (!r.note) delete r.note;
    store.setDay(d);
  };

  if (mode === 'register') {
    return (
      <IngredientEditor
        presetName={row.rawName}
        onClose={() => setMode('edit')}
        onSaved={(i) => {
          save({ ingredientId: i.id });
          props.onClose();
        }}
      />
    );
  }
  if (mode === 'link') {
    const hits = searchIngredients(query, data.ingredients).slice(0, 30);
    return (
      <Sheet title="既存の食材に結びつける" onClose={() => setMode('edit')}>
        <SearchInput label="食材を検索" value={query} onSearch={setQuery} autofocus />
        <ul class="list result-list">
          {hits.map((h) => (
            <li>
              <button
                type="button"
                class="list-btn"
                onClick={() => {
                  save({ ingredientId: h.ingredient.id });
                  props.onClose();
                }}
              >
                {h.ingredient.name}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }

  const rc = props.rc;
  return (
    <Sheet
      title={ing?.name ?? row.rawName}
      onClose={props.onClose}
      footer={
        <>
          <Button
            kind="danger"
            onClick={() => {
              const d = structuredClone(store.getDay(props.date));
              d.slots[props.slot]?.[props.dish]?.rows.splice(props.row, 1);
              store.setDay(d);
              props.onClose();
            }}
          >
            削除
          </Button>
          <Button
            kind="primary"
            disabled={qtyText.trim() !== '' && parseQuantity(qtyText) === null}
            onClick={() => {
              save({ qty: parseQuantity(qtyText), unit, note: note.trim() });
              props.onClose();
            }}
          >
            保存
          </Button>
        </>
      }
    >
      {!ing ? (
        <div class="banner bad">
          未解決: 食材マスタに「{row.rawName}」がありません。集計から外れています。
          <div class="row-flex wrap">
            <Button onClick={() => setMode('register')}>食材を登録</Button>
            <Button kind="ghost" onClick={() => setMode('link')}>
              既存の食材に結びつける
            </Button>
          </div>
        </div>
      ) : null}
      <div class="row-flex">
        <QtyInput label="数量" value={qtyText} autofocus onChange={(t) => setQtyText(t)} />
        <span>{unit}</span>
      </div>
      <div class="unit-chips" role="radiogroup" aria-label="単位" style={{ marginTop: '8px' }}>
        {opts.map((u) => (
          <button type="button" role="radio" aria-checked={u === unit} class={`chip-btn${u === unit ? ' on' : ''}`} onClick={() => setUnit(u)}>
            {u}
          </button>
        ))}
      </div>
      <Field label="メモ(例: サンプルメモ)">
        <input class="input" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </Field>
      {rc ? (
        <dl class="kv small">
          <dt>グラム換算</dt>
          <dd>{fmtGrams(rc.grams)}</dd>
          <dt>エネルギー</dt>
          <dd>{rc.included ? `${fmtNutrient('kcal', rc.nutrients.kcal)} kcal` : '集計から除外'}</dd>
          {Object.keys(rc.unmeasured).length > 0 ? (
            <>
              <dt>未測定</dt>
              <dd>
                {(Object.keys(rc.unmeasured) as NutrientKey[]).map((k) => NUTRIENTS[k].label).join('、')}(成分表で「-」。合計では 0 として数える)
              </dd>
            </>
          ) : null}
          <dt>費用</dt>
          <dd>
            {rc.costIncluded ? fmtYen(rc.cost, 'row') : '費用から除外'}
            {rc.prices.map((p) => (
              <div class="muted">
                {p.entry.date} {p.entry.store ?? ''} {p.entry.qty}
                {p.entry.unit}
                {p.entry.grams ? `(${p.entry.grams}g)` : ''} {p.entry.yen}円{p.future ? '(未来の価格で代用)' : ''}
              </div>
            ))}
          </dd>
        </dl>
      ) : null}
    </Sheet>
  );
}

function DishSheet(props: { date: string; slot: SlotName; dish: number | null; onClose: () => void }) {
  const store = useStore();
  const day = store.getDay(props.date);
  const current: Dish | undefined = props.dish !== null ? day.slots[props.slot]?.[props.dish] : undefined;
  const [title, setTitle] = useState(current?.title ?? '');
  const save = () => {
    const d = structuredClone(store.getDay(props.date));
    const dishes = d.slots[props.slot] ?? [];
    if (props.dish === null) dishes.push({ ...(title.trim() ? { title: title.trim() } : {}), rows: [] });
    else {
      const dish = dishes[props.dish];
      if (dish) {
        if (title.trim()) dish.title = title.trim();
        else delete dish.title;
      }
    }
    d.slots[props.slot] = dishes;
    store.setDay(d);
    props.onClose();
  };
  return (
    <Sheet
      title={props.dish === null ? `${props.slot}に料理を追加` : '料理名'}
      onClose={props.onClose}
      footer={
        <>
          {props.dish !== null ? (
            <Button
              kind="danger"
              onClick={() => {
                if (current && current.rows.length > 0 && !confirm(`この料理の ${current.rows.length} 行も削除します。よろしいですか?`)) return;
                const d = structuredClone(store.getDay(props.date));
                d.slots[props.slot]?.splice(props.dish as number, 1);
                store.setDay(d);
                props.onClose();
              }}
            >
              料理を削除
            </Button>
          ) : null}
          <Button kind="primary" onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <Field label="料理名(例: サンプル料理A)。空でもよい">
        <input class="input" value={title} data-autofocus onInput={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
    </Sheet>
  );
}

const EXTRA_KEYS: NutrientKey[] = ['vitd', ...NUTRIENT_KEYS.filter((k) => k !== 'vitd')];

function ExtraSheet(props: { date: string; onClose: () => void }) {
  const store = useStore();
  const [label, setLabel] = useState('日照によるビタミンD');
  const [key, setKey] = useState<NutrientKey>('vitd');
  const [text, setText] = useState('10');
  const v = parseQuantity(text);
  return (
    <Sheet
      title="日の手動加算"
      onClose={props.onClose}
      footer={
        <Button
          kind="primary"
          disabled={v === null}
          onClick={() => {
            if (v === null) return;
            const d = structuredClone(store.getDay(props.date));
            d.extras.push({ label: label.trim() || NUTRIENTS[key].label, nutrients: { [key]: v } });
            store.setDay(d);
            props.onClose();
          }}
        >
          追加
        </Button>
      }
    >
      <Field label="名前">
        <input class="input" value={label} onInput={(e) => setLabel(e.currentTarget.value)} />
      </Field>
      <Field label="栄養素">
        <select class="input" value={key} onChange={(e) => setKey(e.currentTarget.value as NutrientKey)}>
          {EXTRA_KEYS.map((k) => (
            <option value={k}>
              {NUTRIENTS[k].label}({NUTRIENTS[k].unit})
            </option>
          ))}
        </select>
      </Field>
      <div class="row-flex">
        <QtyInput label="量" value={text} onChange={(t) => setText(t)} />
        <span>{NUTRIENTS[key].unit}</span>
      </div>
      <p class="small muted">「〜以上」のような記録は、その数値で入れ、必要ならメモ欄に「以上」と残してください。</p>
    </Sheet>
  );
}
