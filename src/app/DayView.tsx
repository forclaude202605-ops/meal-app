// 日ごとの結果(仕様書 §8「記録」): 日の合計、区分ごとの栄養の表、費用の内訳、読み取りの結果、問題の一覧。
// どの数字も、保存したテキスト(または貼ったばかりのテキスト)から毎回計算したもの。
import { useMemo, useState } from 'preact/hooks';
import type { RowCalc } from '../core/calc.ts';
import { NUTRIENTS } from '../core/nutrients.ts';
import { buildJournal, mergeProblems, type Journal, type MealDay, type PurchaseDay, type ReadLine } from '../core/parse/journal.ts';
import { normalizeLine } from '../core/parse/normalize.ts';
import { overlay } from '../core/parse/paste.ts';
import { matchDateLine } from '../core/parse/split.ts';
import { energyShare } from '../core/pfc.ts';
import { NUTRIENT_KEYS, SLOT_NAMES, textId, type NoteKind, type NutrientKey } from '../core/types.ts';
import { fmtAmount, fmtDateJa, fmtGrams, fmtNutrient, fmtYen } from './format.ts';
import { ProblemList } from './Problems.tsx';
import { toast } from './pwa.ts';
import { useAppState, useStore } from './store.ts';
import { Badge, Button, Segmented, Sheet } from './ui.tsx';

/** 先に見せる栄養素(残りは「すべて表示」で) */
const MAIN_KEYS: NutrientKey[] = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'salt', 'ca', 'fe', 'zn', 'vita', 'vitd', 'b1', 'b2', 'vitc', 'fol'];
const OTHER_KEYS = NUTRIENT_KEYS.filter((k) => !MAIN_KEYS.includes(k));

const LINE_LABEL: Record<ReadLine['type'], string> = {
  blank: '',
  slot: '区分',
  weight: '体重',
  sun: '日照VD',
  memo: 'メモ',
  title: '料理名',
  items: '食材',
  store: '店',
  purchase: '購入',
  unread: '読めない',
  skip: '読み飛ばし',
};

function pct(v: number | undefined): string {
  return v === undefined ? '' : `${fmtNutrient('protein', v)}%`;
}

export function MealDetail(props: { md: MealDay; journal: Journal }) {
  const { md, journal } = props;
  const c = md.calc;
  const t = c.total.nutrients;
  const share = energyShare(t.protein, t.fat, t.carb, t.kcal);
  const problems = mergeProblems(md.problems);
  const [all, setAll] = useState(false);
  const rowsAt = useMemo(() => new Map(c.rows.map((r) => [`${r.slot}|${r.dishIndex}|${r.rowIndex}`, r])), [c]);
  const usedSlots = SLOT_NAMES.filter((s) => (md.day.slots[s] ?? []).some((d) => d.rows.length > 0));
  const hasExtras = md.day.extras.length > 0;
  const nameOf = (id: string | undefined) => (id ? (journal.ctx.ingredients.get(id)?.name ?? id) : undefined);

  return (
    <div>
      {problems.length > 0 ? (
        <a class="banner warn block-link" href={`#problems-${md.date}`}>
          問題 {problems.length} 件(下の一覧で解決できます)
        </a>
      ) : null}

      <section class="card" aria-label="日の合計">
        <h3>日の合計</h3>
        <dl class="kv">
          <dt>エネルギー</dt>
          <dd class="num">
            <b>{fmtNutrient('kcal', t.kcal)}</b> kcal
          </dd>
          <dt>たんぱく質</dt>
          <dd class="num">
            {fmtNutrient('protein', t.protein)} g <span class="muted">{pct(share?.p)}</span>
          </dd>
          <dt>脂質</dt>
          <dd class="num">
            {fmtNutrient('fat', t.fat)} g <span class="muted">{pct(share?.f)}</span>
          </dd>
          <dt>炭水化物</dt>
          <dd class="num">
            {fmtNutrient('carb', t.carb)} g <span class="muted">{pct(share?.c)}</span>
          </dd>
          <dt>食物繊維</dt>
          <dd class="num">{fmtNutrient('fiber', t.fiber)} g</dd>
          <dt>食塩相当量</dt>
          <dd class="num">{fmtNutrient('salt', t.salt)} g</dd>
          <dt>費用</dt>
          <dd class="num">
            <b>{fmtYen(c.total.cost, 'total')}</b>
            {c.counts.noPrice + c.counts.priceUnit > 0 ? <span class="muted"> (価格のない {c.counts.noPrice + c.counts.priceUnit} 行を除く)</span> : null}
          </dd>
          <dt>体重</dt>
          <dd class="num">{md.day.weightKg !== undefined ? `${md.day.weightKg} kg` : '—'}</dd>
        </dl>
        <p class="small muted">
          % はエネルギー比(総エネルギーが分母。合計が100%にならないことがあります)。
          {hasExtras ? ` 日照によるビタミンD(${md.day.extras.map((e) => fmtNutrient('vitd', e.nutrients.vitd ?? 0)).join('+')}μg)を日の合計に含みます。` : ''}
        </p>
        {md.notes.length > 0 ? <p class="small">注意: {md.notes.join(' ・ ')}</p> : null}
      </section>

      <section class="card" aria-label="区分ごとの栄養">
        <h3>区分ごとの栄養</h3>
        <div class="table-scroll">
          <table class="tbl nutr">
            <thead>
              <tr>
                <th>栄養素</th>
                {usedSlots.map((s) => (
                  <th class="r">{s}</th>
                ))}
                {hasExtras ? <th class="r">日照</th> : null}
                <th class="r">合計</th>
              </tr>
            </thead>
            <tbody>
              {(all ? [...MAIN_KEYS, ...OTHER_KEYS] : MAIN_KEYS).map((k) => (
                <tr>
                  <th>
                    {NUTRIENTS[k].label}
                    <span class="muted small"> {NUTRIENTS[k].unit}</span>
                  </th>
                  {usedSlots.map((s) => (
                    <td class="r num">
                      {fmtNutrient(k, c.slots[s].nutrients[k])}
                      {c.slots[s].unmeasured[k] ? <sup title="一部未測定">※</sup> : null}
                    </td>
                  ))}
                  {hasExtras ? <td class="r num">{c.extras.nutrients[k] ? fmtNutrient(k, c.extras.nutrients[k]) : ''}</td> : null}
                  <td class="r num">
                    <b>{fmtNutrient(k, c.total.nutrients[k])}</b>
                    {c.total.unmeasured[k] ? <sup title="一部未測定">※</sup> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button kind="ghost" class="small" onClick={() => setAll(!all)}>
          {all ? '主な栄養素だけ表示' : `すべて表示(ほか ${OTHER_KEYS.length} 項目)`}
        </Button>
        <p class="small muted">※ 成分表で未測定(「-」)の値を含む(0 として数える)。表示は丸めているので、区分の和と合計が表示上ずれることがあります。</p>
      </section>

      <section class="card" aria-label="費用の内訳">
        <h3>費用の内訳</h3>
        {usedSlots.map((s) => (
          <div class="cost-slot">
            <div class="slot-head">
              <b>{s}</b>
              <span class="num">{fmtYen(c.slots[s].cost, 'total')}</span>
            </div>
            {(md.day.slots[s] ?? []).map((dish, di) => {
              const rows = dish.rows.map((_, ri) => rowsAt.get(`${s}|${di}|${ri}`)).filter((r): r is RowCalc => r !== undefined);
              const sub = rows.reduce((a, r) => a + r.cost, 0);
              return (
                <div class="dish">
                  <div class="row-flex small">
                    <span class="grow">{dish.title ?? '(料理名なし)'}</span>
                    <span class="num muted">小計 {fmtYen(sub, 'total')}</span>
                  </div>
                  {rows.map((r) => (
                    <CostRow r={r} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        <div class="slot-head">
          <b>日の合計</b>
          <b class="num">{fmtYen(c.total.cost, 'total')}</b>
        </div>
        <p class="small muted">行の費用は小数1位、小計と合計は丸める前の値を足してから整数円に丸めています。</p>
      </section>

      <section class="card" aria-label="読み取りの結果">
        <h3>読み取りの結果</h3>
        <ReadLines lines={md.lines} nameOf={nameOf} rowsAt={rowsAt} />
      </section>

      <section class="card" aria-label="問題の一覧" id={`problems-${md.date}`}>
        <h3>問題の一覧({problems.length} 件)</h3>
        <ProblemList problems={problems} />
      </section>
    </div>
  );
}

function CostRow(props: { r: RowCalc }) {
  const r = props.r;
  const has = (k: string) => r.issues.some((i) => i.kind === k);
  return (
    <div class="cost-row">
      <span class="grow">
        {r.ingredient?.name ?? r.row.rawName}
        <span class="muted small"> {r.grams !== null ? fmtGrams(r.grams) : fmtAmount(r.row.qty, r.row.unit)}</span>
        {r.prices.map((p) => (
          <div class="small muted">
            {p.entry.source === 'inline' ? '単価メモ' : '食材費'} {p.entry.date} {p.entry.store ?? ''} {p.entry.qty}
            {p.entry.unit}
            {p.entry.grams ? `(${p.entry.grams}g)` : ''} {p.entry.yen}円{p.future ? '(未来の価格で代用)' : ''}
          </div>
        ))}
      </span>
      <span class="num">
        {r.costIncluded ? fmtYen(r.cost, 'row') : null}
        {!r.included ? <Badge tone="bad">計算から除外</Badge> : null}
        {r.included && has('no-price') ? <Badge tone="warn">価格未登録</Badge> : null}
        {r.included && has('price-unit') ? <Badge tone="warn">単価未確定</Badge> : null}
        {has('partial-price') ? <Badge tone="warn">一部価格未登録</Badge> : null}
        {r.ingredient?.costFree ? <Badge tone="info">0円の食材</Badge> : null}
      </span>
    </div>
  );
}

function ReadLines(props: { lines: ReadLine[]; nameOf: (id: string | undefined) => string | undefined; rowsAt?: Map<string, RowCalc> }) {
  const [showChanges, setShowChanges] = useState(false);
  const changed = props.lines.filter((l) => l.changes.length > 0).length;
  return (
    <div>
      {changed > 0 ? (
        <Button kind="ghost" class="small" onClick={() => setShowChanges(!showChanges)}>
          表記を直した行 {changed} 行{showChanges ? 'を隠す' : 'を見る'}
        </Button>
      ) : null}
      <ol class="read-lines">
        {props.lines
          .filter((l) => l.type !== 'blank')
          .map((l) => (
            <li class={`read-line t-${l.type}`}>
              <span class="no muted num">{l.no}</span>
              <span class="kind">
                <Badge tone={l.type === 'unread' ? 'bad' : l.type === 'skip' ? 'warn' : 'info'}>{LINE_LABEL[l.type]}</Badge>
              </span>
              <span class="body">
                <span class="raw">{l.raw.trim()}</span>
                <span class="detail small">
                  {l.type === 'items'
                    ? (l.items ?? []).map((it) => {
                        const rc = it.at ? props.rowsAt?.get(`${it.at.slot}|${it.at.dish}|${it.at.row}`) : undefined;
                        const target = it.same ? props.nameOf(it.same.ingredientId) : props.nameOf(it.ingredientId);
                        return (
                          <span class="item">
                            {it.name}
                            {it.note ? `(${it.note})` : ''} → {target ? <b>{target}</b> : <Badge tone="bad">未登録</Badge>}
                            {it.via === 'def' ? <span class="muted">(テキストの定義)</span> : null}
                            {it.same ? <span class="muted">(同価格: {it.same.name})</span> : null}{' '}
                            {it.answered?.type === 'qty' ? <Badge tone="info">答え {fmtAmount(it.answered.qty, it.answered.unit)}</Badge> : null}
                            {rc ? <span class="num"> {rc.grams !== null ? fmtGrams(rc.grams) : fmtAmount(rc.row.qty, rc.row.unit)}{rc.included ? ` ・${fmtNutrient('kcal', rc.nutrients.kcal)}kcal` : ''}</span> : null}
                            {!it.at && it.qtyState === 'ok' ? <Badge tone="warn">区分なし</Badge> : null}
                          </span>
                        );
                      })
                    : l.detail}
                  {l.type === 'items' && l.detail.includes(' ・') ? <span class="muted"> {l.detail.slice(l.detail.indexOf(' ・'))}</span> : null}
                </span>
                {l.guess ? <span class="guess small">推測: {l.guess}</span> : null}
                {showChanges && l.changes.length > 0 ? <span class="small muted">直した: {l.changes.join('、')}</span> : null}
              </span>
            </li>
          ))}
      </ol>
    </div>
  );
}

export function PurchaseDetail(props: { pd: PurchaseDay; journal: Journal }) {
  const { pd, journal } = props;
  const problems = mergeProblems(pd.problems);
  const nameOf = (id: string | undefined) => (id ? (journal.ctx.ingredients.get(id)?.name ?? id) : undefined);
  return (
    <div>
      {problems.length > 0 ? (
        <a class="banner warn block-link" href={`#problems-p-${pd.date}`}>
          問題 {problems.length} 件(下の一覧で解決できます)
        </a>
      ) : null}
      <section class="card">
        <h3>食材費</h3>
        <p>
          合計 <b class="num">{fmtYen(pd.total, 'total')}</b>(品目 {pd.lines.filter((l) => l.purchase).length} 行、価格として使う {pd.prices.length} 行)
        </p>
        <ul class="list">
          {pd.lines
            .filter((l) => l.purchase)
            .map((l) => (
              <li class="small row-flex">
                <span class="grow">
                  {l.purchase?.name} → {nameOf(l.purchase?.ingredientId) ? <b>{nameOf(l.purchase?.ingredientId)}</b> : <Badge tone="bad">未登録</Badge>}
                  <span class="muted">
                    {' '}
                    {l.purchase?.qty ?? '(量なし)'}
                    {l.purchase?.unit}
                    {l.purchase?.grams !== undefined ? `(${l.purchase.grams}g)` : ''} {l.purchase?.store ? `・${l.purchase.store}` : ''}
                  </span>
                </span>
                <span class="num">{l.purchase?.yen ?? '—'}円</span>
                {!l.purchase?.priceId ? <Badge tone="warn">価格に使えない</Badge> : null}
              </li>
            ))}
        </ul>
      </section>
      <section class="card">
        <h3>読み取りの結果</h3>
        <ReadLines lines={pd.lines} nameOf={nameOf} />
      </section>
      <section class="card" id={`problems-p-${pd.date}`}>
        <h3>問題の一覧({problems.length} 件)</h3>
        <ProblemList problems={problems} />
      </section>
    </div>
  );
}

/** 保存した日を開く: 結果とテキスト。テキストはその場で書き換えられる(書き換えると結果もすぐ変わる) */
export function DaySheet(props: { date: string; initialKind?: NoteKind; onClose: () => void }) {
  const store = useStore();
  const { data } = useAppState();
  const has = (k: NoteKind) => data.texts.some((t) => t.id === textId(k, props.date));
  const [kind, setKind] = useState<NoteKind>(props.initialKind ?? (has('meal') ? 'meal' : 'purchase'));
  const saved = data.texts.find((t) => t.id === textId(kind, props.date));
  const [draft, setDraft] = useState<string | null>(null);
  const journal = useMemo(() => {
    if (draft === null || !saved) return store.journal();
    return buildJournal({ foods: store.foods, ingredients: data.ingredients, texts: overlay(data.texts, [{ ...saved, text: draft }]), answers: data.answers });
  }, [draft, saved, data, store]);
  const md = journal.meals.find((m) => m.date === props.date);
  const pd = journal.purchases.find((p) => p.date === props.date);
  const both = has('meal') && has('purchase');
  return (
    <Sheet
      title={fmtDateJa(props.date, true)}
      onClose={props.onClose}
      footer={
        draft !== null ? (
          <>
            <Button onClick={() => setDraft(null)}>やめる</Button>
            <Button
              kind="primary"
              disabled={!saved || draft === saved.text}
              onClick={() => {
                if (!saved) return;
                if (draft.split('\n').some((l) => matchDateLine(normalizeLine(l).text) !== null)) {
                  if (!confirm('日付だけの行があります。日付の行は、ここでは日付として扱わず、読めない行になります。このまま保存しますか?')) return;
                }
                store.saveTexts([{ ...saved, text: draft, updatedAt: new Date().toISOString() }]);
                setDraft(null);
                toast('保存しました');
              }}
            >
              保存
            </Button>
          </>
        ) : (
          <>
            <Button
              kind="danger"
              disabled={!saved}
              onClick={() => {
                if (!saved || !confirm(`${fmtDateJa(props.date, true)} の${kind === 'meal' ? '献立' : '食材費'}のテキストを消します。よろしいですか?`)) return;
                store.deleteText(kind, props.date);
                if (!both) props.onClose();
                else setKind(kind === 'meal' ? 'purchase' : 'meal');
              }}
            >
              消す
            </Button>
            <Button kind="primary" disabled={!saved} onClick={() => saved && setDraft(saved.text)}>
              テキストを直す
            </Button>
          </>
        )
      }
    >
      {both ? (
        <Segmented
          label="種類"
          value={kind}
          onChange={(k) => {
            setDraft(null);
            setKind(k);
          }}
          options={[
            { value: 'meal', label: '献立' },
            { value: 'purchase', label: '食材費' },
          ]}
        />
      ) : null}
      {draft !== null ? (
        <div class="card">
          <label class="field-label" for="day-text">
            {kind === 'meal' ? '献立' : '食材費'}のテキスト(書き換えると、下の結果がすぐ変わります)
          </label>
          <textarea id="day-text" class="input day-text" rows={12} value={draft} onInput={(e) => setDraft(e.currentTarget.value)} />
        </div>
      ) : null}
      {kind === 'meal' && md ? <MealDetail md={md} journal={journal} /> : null}
      {kind === 'purchase' && pd ? <PurchaseDetail pd={pd} journal={journal} /> : null}
      {draft === null && saved ? (
        <details class="card">
          <summary>保存しているテキスト</summary>
          <pre class="saved-text">{saved.text}</pre>
          <p class="small muted">最後に保存: {saved.updatedAt.slice(0, 16).replace('T', ' ')}</p>
        </details>
      ) : null}
    </Sheet>
  );
}
