// 問題の一覧と、その場での解決(仕様書 §8「記録」)。質問は1件ずつではなく、まとめて候補つきで出す。
// 一度答えれば覚えるもの(食材名の割り当て・単位の重さ)は食材マスタに、毎回聞くもの(数量など)はその日のその行の補足に保存する。
import { useMemo, useState } from 'preact/hooks';
import { foodDisplayName, KEY_INDEX } from '../core/nutrients.ts';
import { maskLines } from '../core/parse/mask.ts';
import { sortProblems, type Problem } from '../core/parse/journal.ts';
import { normalizeUnit, parseQuantity } from '../core/quantity.ts';
import { normalizeName, searchFoods } from '../core/search.ts';
import { SLOT_NAMES, type Ingredient } from '../core/types.ts';
import { fmtAmount, fmtNutrient } from './format.ts';
import { FoodPicker, IngredientEditor, IngredientPicker } from './IngredientEditor.tsx';
import { toast } from './pwa.ts';
import { newId, useAppState, useStore } from './store.ts';
import { Badge, Button, QtyInput } from './ui.tsx';

const GROUPS: { types: Problem['type'][]; title: string; hint: string }[] = [
  { types: ['assign', 'note'], title: '食材の割り当て', hint: '一度選べば、その名前を別名として覚えます。' },
  { types: ['unit'], title: '単位の重さ', hint: '一度答えれば、食材マスタに覚えます。' },
  { types: ['slot', 'qty', 'purchase-qty', 'mg'], title: '数量・区分(毎回聞く)', hint: '記入漏れの可能性が高いため、毎回聞きます。答えはその日のその行の補足として残ります。' },
  { types: ['unread'], title: '読めない行', hint: '読めない行は計算に入っていません。テキストを直すか、伏せた形でコピーして知らせてください。' },
  { types: ['calc'], title: 'そのほか', hint: '' },
];

/** 食材マスタの候補: 名前・別名が、書いた名前を含むか、書いた名前に含まれる(2文字以上) */
function ingredientCandidates(name: string, ingredients: Ingredient[], limit = 3): Ingredient[] {
  const q = normalizeName(name);
  const scored: { ing: Ingredient; s: number }[] = [];
  for (const ing of ingredients) {
    let best = 0;
    for (const n of [ing.name, ...ing.aliases].map(normalizeName)) {
      if (!n) continue;
      if (n === q) best = Math.max(best, 4);
      else if (n.startsWith(q) || q.startsWith(n)) best = Math.max(best, n.length >= 2 ? 3 : 0);
      else if ((q.length >= 2 && n.includes(q)) || (n.length >= 2 && q.includes(n))) best = Math.max(best, 2);
    }
    if (best > 0) scored.push({ ing, s: best });
  }
  return scored
    .sort((a, b) => b.s - a.s || a.ing.name.localeCompare(b.ing.name, 'ja'))
    .slice(0, limit)
    .map((x) => x.ing);
}


export function ProblemList(props: { problems: Problem[]; showDates?: boolean }) {
  const list = sortProblems(props.problems);
  const unread = list.filter((p): p is Extract<Problem, { type: 'unread' }> => p.type === 'unread');
  if (list.length === 0) return <p class="small muted">問題はありません。</p>;
  return (
    <div>
      {GROUPS.map((g) => {
        const items = list.filter((p) => g.types.includes(p.type));
        if (items.length === 0) return null;
        return (
          <div class="problem-group">
            <h3>
              {g.title} <span class="muted small">{items.length} 件</span>
            </h3>
            {g.hint ? <p class="small muted">{g.hint}</p> : null}
            {g.types.includes('unread') ? (
              <Button
                class="small"
                onClick={async () => {
                  const text = maskLines(unread.map((u) => u.lineText));
                  try {
                    await navigator.clipboard.writeText(text);
                    toast('読めなかった行を、名前と数字を伏せてコピーしました');
                  } catch {
                    prompt('コピーできませんでした。下の文字を選んでコピーしてください', text);
                  }
                }}
              >
                読めなかった行を伏せてコピー
              </Button>
            ) : null}
            {items.map((p) => (
              <ProblemCard key={p.key} p={p} showDates={props.showDates ?? false} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function where(p: Problem, showDates: boolean): string {
  const refs = 'refs' in p ? p.refs : [p.ref];
  const first = refs[0];
  if (!first) return '';
  const date = showDates ? `${first.date.slice(5).replace('-', '/')} ` : '';
  return `${date}${first.line}行目${refs.length > 1 ? ` ほか ${refs.length - 1} か所` : ''}`;
}

function ProblemCard(props: { p: Problem; showDates: boolean }) {
  const p = props.p;
  return (
    <div class="problem">
      <div class="small muted">{where(p, props.showDates)}</div>
      {p.type === 'assign' || p.type === 'note' ? <AssignProblem p={p} /> : null}
      {p.type === 'unit' ? <UnitProblem p={p} /> : null}
      {p.type === 'qty' || p.type === 'purchase-qty' ? <QtyProblem p={p} /> : null}
      {p.type === 'slot' ? <SlotProblem p={p} /> : null}
      {p.type === 'mg' ? <MgProblem p={p} /> : null}
      {p.type === 'unread' ? (
        <div>
          <code class="line">{p.lineText}</code>
          <div class="small">{p.reason}</div>
        </div>
      ) : null}
      {p.type === 'calc' ? <CalcProblem p={p} /> : null}
    </div>
  );
}

function AssignProblem(props: { p: Extract<Problem, { type: 'assign' | 'note' }> }) {
  const store = useStore();
  const { data } = useAppState();
  const p = props.p;
  const note = p.note;
  const alias = note ? `${p.name}(${note})` : p.name;
  const [mode, setMode] = useState<null | 'food' | 'master' | 'new'>(null);
  const masters = useMemo(() => ingredientCandidates(p.name, data.ingredients), [p.name, data.ingredients]);
  const foods = useMemo(() => searchFoods(p.name, store.foods, 4), [p.name, store.foods]);
  const plain = p.type === 'note' ? data.ingredients.find((i) => i.id === p.plainId) : undefined;
  const pickMaster = (ing: Ingredient) => {
    store.addAlias(ing.id, alias);
    toast(`「${alias}」を「${ing.name}」の別名として覚えました`);
  };
  const pickFood = (foodId: string) => {
    const ing: Ingredient = { id: newId('ing'), name: alias, aliases: [], source: { kind: 'food', foodId }, units: [], unitsConfirmed: true };
    store.upsertIngredient(ing);
    toast(`「${alias}」を食材に登録しました`);
  };
  return (
    <div>
      <p>
        「<b>{alias}</b>」はどの食材ですか? <Badge tone="bad">未登録</Badge>
      </p>
      <div class="row-flex wrap">
        {plain ? (
          <Button kind="primary" class="small" onClick={() => pickMaster(plain)}>
            「{plain.name}」と同じ
          </Button>
        ) : null}
        {masters
          .filter((m) => m.id !== plain?.id)
          .map((m) => (
            <Button class="small" onClick={() => pickMaster(m)}>
              {m.name}
            </Button>
          ))}
        {foods.map((f) => (
          <Button class="small" onClick={() => pickFood(f.food.id)} title={f.food.id}>
            {foodDisplayName(f.food)}
            <span class="muted"> {fmtNutrient('kcal', f.food.values[KEY_INDEX.kcal] ?? 0)}kcal/100g</span>
          </Button>
        ))}
      </div>
      <div class="row-flex wrap">
        <Button kind="ghost" class="small" onClick={() => setMode('food')}>
          成分表を探す
        </Button>
        <Button kind="ghost" class="small" onClick={() => setMode('master')}>
          食材マスタから選ぶ
        </Button>
        <Button kind="ghost" class="small" onClick={() => setMode('new')}>
          ラベル値・レシピで登録
        </Button>
      </div>
      {mode === 'food' ? (
        <FoodPicker
          initialQuery={p.name}
          onClose={() => setMode(null)}
          onPick={(fid) => {
            setMode(null);
            pickFood(fid);
          }}
        />
      ) : null}
      {mode === 'master' ? (
        <IngredientPicker
          onClose={() => setMode(null)}
          onPick={(ing) => {
            setMode(null);
            pickMaster(ing);
          }}
        />
      ) : null}
      {mode === 'new' ? <IngredientEditor presetName={alias} onClose={() => setMode(null)} onSaved={() => setMode(null)} /> : null}
    </div>
  );
}

function UnitProblem(props: { p: Extract<Problem, { type: 'unit' }> }) {
  const store = useStore();
  const { data } = useAppState();
  const p = props.p;
  const ing = data.ingredients.find((i) => i.id === p.ingredientId) ?? store.journal().defs.find((d) => d.id === p.ingredientId);
  const [text, setText] = useState('');
  const g = parseQuantity(text);
  const isDef = p.ingredientId.startsWith('def:');
  return (
    <div>
      <p>
        <b>{ing?.name ?? p.ingredientId}</b> の 1{p.unit} は何g ですか? <Badge tone="bad">単位の重さが未登録</Badge>
      </p>
      {isDef ? (
        <p class="small muted">テキストで定義した食材です。食材マスタに同じ名前で登録すると、単位の重さを持てます。</p>
      ) : (
        <div class="row-flex">
          <span>1{p.unit} =</span>
          <QtyInput label={`1${p.unit}の重さ(g)`} value={text} onChange={(t) => setText(t)} placeholder="g" />
          <span>g</span>
          <Button
            kind="primary"
            class="small"
            disabled={g === null || !(g > 0)}
            onClick={() => {
              if (g === null || !(g > 0)) return;
              store.addUnit(p.ingredientId, p.unit, g);
              toast(`${ing?.name ?? ''} 1${p.unit} = ${g}g を覚えました`);
            }}
          >
            覚える
          </Button>
        </div>
      )}
    </div>
  );
}

/** 単位の候補: 書いた単位、食材の単位、g */
function unitOptions(ing: Ingredient | undefined, written: string): string[] {
  const list = [written, 'g', ...(ing?.units.map((u) => normalizeUnit(u.unit)) ?? [])];
  if (ing?.source.kind === 'label') list.unshift(normalizeUnit(ing.source.per.unit));
  return [...new Set(list.filter(Boolean))];
}

function QtyProblem(props: { p: Extract<Problem, { type: 'qty' | 'purchase-qty' }> }) {
  const store = useStore();
  const { data } = useAppState();
  const p = props.p;
  const ing = p.ingredientId ? (data.ingredients.find((i) => i.id === p.ingredientId) ?? store.journal().defs.find((d) => d.id === p.ingredientId)) : undefined;
  const written = p.type === 'qty' ? p.unit : '';
  const opts = unitOptions(ing, written);
  const [text, setText] = useState(p.type === 'qty' && p.qty !== null ? String(p.qty) : '');
  const [unit, setUnit] = useState(written || opts[0] || 'g');
  const q = parseQuantity(text);
  const save = (qty: number, u: string) => store.setAnswer(p.target, { type: 'qty', qty, unit: u }, p.ingredientId);
  const what =
    p.type === 'purchase-qty'
      ? '量がありません'
      : p.state === 'unit-only'
        ? '数字がありません'
        : p.state === 'vague'
          ? `「${p.vague ?? ''}」の量は?`
          : p.state === 'no-unit'
            ? '単位がありません'
            : '数量がありません';
  return (
    <div>
      <p>
        {p.lineText.trim() !== p.name ? (
          <>
            <code class="line">{p.lineText.trim()}</code> の{' '}
          </>
        ) : null}
        <b>{p.name}</b>: {what}
      </p>
      <div class="row-flex wrap">
        <QtyInput label={`${p.name}の数量`} value={text} onChange={(t) => setText(t)} placeholder="数量" />
        <div class="unit-chips" role="radiogroup" aria-label="単位">
          {opts.map((u) => (
            <button type="button" role="radio" aria-checked={u === unit} class={`chip-btn${u === unit ? ' on' : ''}`} onClick={() => setUnit(u)}>
              {u}
            </button>
          ))}
        </div>
        <Button kind="primary" class="small" disabled={q === null} onClick={() => q !== null && save(q, unit)}>
          決める
        </Button>
      </div>
      {p.type === 'qty' && p.last ? (
        <Button class="small" onClick={() => p.last && save(p.last.qty, p.last.unit)}>
          前回と同じ({fmtAmount(p.last.qty, p.last.unit)})
        </Button>
      ) : null}
      {p.type === 'qty' && !p.ingredientId && p.state === 'none' && p.target.item === 0 ? (
        <div class="row-flex wrap">
          <Button kind="ghost" class="small" onClick={() => store.setAnswer(p.target, { type: 'as', as: 'title' })}>
            料理名として扱う
          </Button>
          <Button kind="ghost" class="small" onClick={() => store.setAnswer(p.target, { type: 'as', as: 'skip' })}>
            この行を読み飛ばす
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SlotProblem(props: { p: Extract<Problem, { type: 'slot' }> }) {
  const store = useStore();
  const p = props.p;
  return (
    <div>
      <p>
        区分(朝・昼など)の見出しより前に、食材の行があります({p.lines.join('、')}行目)。どの区分ですか?
      </p>
      <div class="row-flex wrap">
        {SLOT_NAMES.map((s) => (
          <Button class="small" onClick={() => store.setAnswer(p.target, { type: 'slot', slot: s })}>
            {s}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MgProblem(props: { p: Extract<Problem, { type: 'mg' }> }) {
  const store = useStore();
  const p = props.p;
  return (
    <div>
      <p>
        <b>{p.name}</b> の量が {p.qty}mg になっています。入力ミスではありませんか?
      </p>
      <div class="row-flex wrap">
        {['mL', 'g', 'mg'].map((u) => (
          <Button class="small" kind={u === 'mg' ? 'ghost' : 'plain'} onClick={() => store.setAnswer(p.target, { type: 'unit', unit: u })}>
            {u === 'mg' ? 'mg のまま' : `${p.qty}${u}`}
          </Button>
        ))}
      </div>
    </div>
  );
}

const CALC_LABEL: Partial<Record<string, string>> = {
  'no-price': '価格未登録(費用から除外)',
  'empty-recipe': '内訳未登録(栄養・費用は0として数える)',
  'missing-food': '成分表の食品が見つからない',
  'bad-recipe': 'レシピの完成重量がない',
  cycle: 'レシピが循環している',
  'no-unit': 'レシピの材料の単位の重さが未登録',
};

function CalcProblem(props: { p: Extract<Problem, { type: 'calc' }> }) {
  const store = useStore();
  const { data } = useAppState();
  const p = props.p;
  const ing = data.ingredients.find((i) => i.id === p.ingredientId);
  const def = store.journal().defs.find((d) => d.id === p.ingredientId);
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <p>
        <b>{ing?.name ?? def?.name ?? p.ingredientId}</b>: {CALC_LABEL[p.issue] ?? p.issue}
      </p>
      {p.issue === 'no-price' ? <p class="small muted">食材費のメモを貼るか、献立の行に単価メモ「(100g〇円)」を書くと、費用に入ります。</p> : null}
      <div class="row-flex wrap">
        {p.issue === 'no-price' && ing ? (
          <Button class="small" onClick={() => store.upsertIngredient({ ...ing, costFree: true })}>
            費用に含めない食材にする(0円)
          </Button>
        ) : null}
        {ing ? (
          <Button kind="ghost" class="small" onClick={() => setEditing(true)}>
            食材を開く
          </Button>
        ) : null}
      </div>
      {editing && ing ? <IngredientEditor initial={ing} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
