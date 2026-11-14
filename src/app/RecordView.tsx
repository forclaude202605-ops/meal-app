// 記録の画面(仕様書 §8「記録」)。入力はメモの貼り付けが主。手入力で行を追加する画面は作らない。
// 貼った直後に読み取り・計算して見せ(保存の前でも数字が見える)、「保存」で日ごとのテキストとして取り込む。
import { useEffect, useMemo, useState } from 'preact/hooks';
import { diffDays, todayLocal } from '../core/dates.ts';
import { buildJournal, mergeProblems, type Journal, type Problem } from '../core/parse/journal.ts';
import { analyzePaste, overlay, pastedTexts, type Choice, type DiffOp, type PasteBlock } from '../core/parse/paste.ts';
import { textId, type NoteKind } from '../core/types.ts';
import { demoPasteText } from '../data/demo.ts';
import { DaySheet, MealDetail, PurchaseDetail } from './DayView.tsx';
import { fmtDateJa, fmtNutrient, fmtYen } from './format.ts';
import { ProblemList } from './Problems.tsx';
import { toast } from './pwa.ts';
import { useAppState, useStore } from './store.ts';
import { Badge, Button, Segmented, Sheet } from './ui.tsx';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

const STATUS_LABEL: Record<PasteBlock['status'], string> = {
  new: '新しい日',
  same: '変化なし',
  contained: '変化なし(保存済みに含まれる)',
  superset: '行が増えた',
  changed: '変わった',
  'no-date': '日付が未定',
};

const KIND_LABEL: Record<NoteKind, string> = { meal: '献立', purchase: '食材費' };

export function RecordView(props: { goSettings: () => void; isStandalone: boolean }) {
  const store = useStore();
  const { data, meta } = useAppState();
  const today = todayLocal();
  const [raw, setRaw] = useState('');
  const text = useDebounced(raw, 250);
  const [kinds, setKinds] = useState<Record<number, NoteKind>>({});
  const [dates, setDates] = useState<Record<number, string>>({});
  const [baseYear, setBaseYear] = useState<number | undefined>(undefined);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [openPreview, setOpenPreview] = useState<PasteBlock | null>(null);
  const [openSaved, setOpenSaved] = useState<string | null>(null);
  const [showSame, setShowSame] = useState(false);
  const [limit, setLimit] = useState(30);

  const resetChoices = () => {
    setKinds({});
    setDates({});
    setBaseYear(undefined);
    setChoices({});
  };
  const setText = (t: string) => {
    resetChoices();
    setRaw(t);
  };

  const analysis = useMemo(
    () => (text.trim() ? analyzePaste(text, { today, ...(baseYear !== undefined ? { baseYear } : {}), kinds, dates, saved: data.texts }) : null),
    [text, today, baseYear, kinds, dates, data.texts],
  );
  const previewTexts = useMemo(() => (analysis ? pastedTexts(analysis, choices, 'preview', { preview: true }) : []), [analysis, choices]);
  const journal: Journal | null = useMemo(
    () => (analysis ? buildJournal({ foods: store.foods, ingredients: data.ingredients, texts: overlay(data.texts, previewTexts), answers: data.answers }) : null),
    [analysis, previewTexts, data, store.foods],
  );
  const toSave = useMemo(() => (analysis ? pastedTexts(analysis, choices, 'x') : []), [analysis, choices]);

  const previewIds = new Set(previewTexts.map((t) => t.id));
  const previewProblems: Problem[] = journal
    ? mergeProblems([...journal.meals.filter((m) => previewIds.has(textId('meal', m.date))).flatMap((m) => m.problems), ...journal.purchases.filter((p) => previewIds.has(textId('purchase', p.date))).flatMap((p) => p.problems)])
    : [];

  const doPaste = async () => {
    setPasteHint(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported');
      // iOS では、ここで「ペースト」の吹き出しが出る。押すと読める(ほかの所を押すと読めない)
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        setPasteHint('クリップボードが空です。メモ帳でテキストをコピーしてから、もう一度押してください。');
        return;
      }
      setText(t);
    } catch {
      setPasteHint('クリップボードを読めませんでした。上の欄を長押しして「ペースト」を選んでください。');
    }
  };

  const save = () => {
    if (!analysis) return;
    const now = new Date().toISOString();
    const list = pastedTexts(analysis, choices, now);
    if (list.length === 0) return;
    store.saveTexts(list);
    toast(`${list.length} 日分を保存しました`);
    setText('');
  };

  const backupDue = data.texts.length > 0 && (!meta.lastBackupAt || diffDays(meta.lastBackupAt.slice(0, 10), today) >= data.settings.backupReminderDays);
  const blocks = analysis?.blocks ?? [];
  const shown = blocks.filter((b) => b.status !== 'same' && b.status !== 'contained');
  const same = blocks.filter((b) => b.status === 'same' || b.status === 'contained');
  const undecided = blocks.filter((b) => b.status === 'changed' && !choices[b.index]);
  const single = shown.length === 1 ? shown[0] : undefined;

  return (
    <div>
      <div class="topbar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '1.1rem' }}>記録</h1>
      </div>

      {!props.isStandalone ? (
        <div class="banner info">
          ホーム画面に追加してから使ってください。Safari のタブで入れたデータは、ホーム画面のアプリからは見えません。
          <Button kind="ghost" class="small" onClick={props.goSettings}>
            追加の手順
          </Button>
        </div>
      ) : null}
      {meta.demo ? <div class="banner warn">デモ(架空)の食材が入っています。設定の「デモを消す」で消せます。</div> : null}
      {backupDue ? (
        <div class="banner info">
          {meta.lastBackupAt ? `最後のバックアップから ${diffDays(meta.lastBackupAt.slice(0, 10), today)} 日たちました。` : 'まだバックアップを書き出していません。'}
          <Button kind="ghost" class="small" onClick={props.goSettings}>
            バックアップへ
          </Button>
        </div>
      ) : null}

      <section class="card" aria-label="貼り付け">
        <label class="field-label" for="paste">
          メモ帳のテキスト(献立・食材費。1日分でも、数日分でも、メモ全体でもよい)
        </label>
        <textarea
          id="paste"
          class="input paste-area"
          rows={8}
          placeholder={'ここに貼り付けます(欄を長押し →「ペースト」)\n例:\n2025/01/06\n朝\nオートミール30g\n…'}
          value={raw}
          onInput={(e) => setRaw(e.currentTarget.value)}
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
        />
        <div class="row-flex wrap" style={{ marginTop: '8px' }}>
          <Button kind="primary" onClick={() => void doPaste()}>
            貼り付け
          </Button>
          <Button
            onClick={() => {
              const n = store.addDemoIngredients();
              setText(demoPasteText());
              toast(n > 0 ? `デモ(架空)のテキストを入れました。デモ用の食材 ${n} 件を食材マスタに足しました` : 'デモ(架空)のテキストを入れました');
            }}
          >
            デモを貼り付ける
          </Button>
          <Button kind="ghost" disabled={raw === ''} onClick={() => setText('')}>
            空にする
          </Button>
        </div>
        {pasteHint ? <div class="banner warn">{pasteHint}</div> : null}
      </section>

      {analysis && journal ? (
        <section class="card" aria-label="貼り付けの読み取り">
          <h2>読み取りの結果(まだ保存していません)</h2>
          <p class="small">
            献立 {blocks.filter((b) => b.kind === 'meal').length} 日・食材費 {blocks.filter((b) => b.kind === 'purchase').length} 日 ・ 新しい日 {blocks.filter((b) => b.status === 'new').length}、変わった日{' '}
            {blocks.filter((b) => b.status === 'changed' || b.status === 'superset').length}、変化なし {same.length}
          </p>
          {analysis.cleaned.stats.length > 0 ? (
            <p class="small muted">見えない文字などを直しました: {analysis.cleaned.stats.map((s) => `${s.label} ${s.count}個`).join('、')}(各行の表記の直しは、日ごとの「読み取りの結果」で見られます)</p>
          ) : null}
          {analysis.year ? (
            <div class="banner warn">
              年が書かれていない日付があります。最初の日付 {analysis.year.label}({analysis.year.line}行目)を
              <select class="input inline-select" aria-label="年" value={String(analysis.year.year)} onChange={(e) => setBaseYear(Number(e.currentTarget.value))}>
                {[0, 1, 2, 3].map((k) => {
                  const y = Number(today.slice(0, 4)) - k;
                  return <option value={String(y)}>{y}</option>;
                })}
              </select>
              年として読みました{analysis.year.isDefault ? '(今日から見て、いちばん近い過去の日付になる年)' : ''}。続く日付は、直前の日付から年を補います。
            </div>
          ) : null}
          {blocks
            .filter((b) => b.weekdayMismatch)
            .map((b) => (
              <div class="banner warn">
                曜日が合いません: 「{b.dateText}」は {b.date ? fmtDateJa(b.date, true) : ''} です。日付か曜日を確かめてください。
              </div>
            ))}
          {analysis.skipped.length > 0 ? (
            <p class="small muted">
              日付の行より前の {analysis.skipped.length} 行は、食材の行がないため取り込みません(例: {analysis.skipped[0]?.raw.trim()})。
            </p>
          ) : null}

          {previewProblems.length > 0 ? (
            <details class="problems-box" open>
              <summary>
                <b>問題 {previewProblems.length} 件</b>(まとめて答えられます。答えると結果がすぐ変わります)
              </summary>
              <ProblemList problems={previewProblems} showDates={shown.length > 1} />
            </details>
          ) : (
            <p class="small">問題はありません。</p>
          )}

          <ul class="list day-list">
            {shown.map((b) => (
              <BlockRow
                b={b}
                journal={journal}
                choice={choices[b.index]}
                setChoice={(c) => setChoices({ ...choices, [b.index]: c })}
                setKind={(k) => setKinds({ ...kinds, [b.index]: k })}
                setDate={(d) => setDates({ ...dates, [b.index]: d })}
                open={() => setOpenPreview(b)}
              />
            ))}
          </ul>
          {same.length > 0 ? (
            <div>
              <Button kind="ghost" class="small" onClick={() => setShowSame(!showSame)}>
                変化なし {same.length} 日{showSame ? 'を隠す' : 'を見る'}
              </Button>
              {showSame ? <p class="small muted">{same.map((b) => `${b.date ? fmtDateJa(b.date) : ''}${KIND_LABEL[b.kind]}`).join('、')}</p> : null}
            </div>
          ) : null}

          {single && single.date ? (
            <div class="inline-detail">
              {single.existing && single.diff ? <DiffView diff={single.diff} /> : null}
              {single.kind === 'meal'
                ? (() => {
                    const md = journal.meals.find((m) => m.date === single.date);
                    return md ? <MealDetail md={md} journal={journal} /> : null;
                  })()
                : (() => {
                    const pd = journal.purchases.find((p) => p.date === single.date);
                    return pd ? <PurchaseDetail pd={pd} journal={journal} /> : null;
                  })()}
            </div>
          ) : null}

          <div class="save-bar">
            {undecided.length > 0 ? <p class="small">「置き換え」か「この日に追加」を選んでいない {undecided.length} 日は、保存しません。</p> : null}
            <Button kind="primary" disabled={toSave.length === 0} onClick={save}>
              保存({toSave.length} 日分)
            </Button>
          </div>
        </section>
      ) : null}

      <SavedList limit={limit} onMore={() => setLimit(limit + 30)} open={setOpenSaved} />

      {openPreview && journal ? <PreviewSheet b={blocks.find((x) => x.index === openPreview.index) ?? openPreview} journal={journal} choice={choices[openPreview.index]} setChoice={(c) => setChoices({ ...choices, [openPreview.index]: c })} onClose={() => setOpenPreview(null)} /> : null}
      {openSaved ? <DaySheet date={openSaved} onClose={() => setOpenSaved(null)} /> : null}
    </div>
  );
}

function dayNumbers(b: PasteBlock, journal: Journal): string {
  if (!b.date) return '';
  if (b.kind === 'meal') {
    const md = journal.meals.find((m) => m.date === b.date);
    if (!md) return '';
    return `${fmtNutrient('kcal', md.calc.total.nutrients.kcal)}kcal ・ ${fmtYen(md.calc.total.cost, 'total')}`;
  }
  const pd = journal.purchases.find((p) => p.date === b.date);
  return pd ? `合計 ${fmtYen(pd.total, 'total')}` : '';
}

function problemsOf(b: PasteBlock, journal: Journal): number {
  if (!b.date) return 0;
  const list = b.kind === 'meal' ? journal.meals.find((m) => m.date === b.date)?.problems : journal.purchases.find((p) => p.date === b.date)?.problems;
  return mergeProblems(list ?? []).length;
}

function BlockRow(props: {
  b: PasteBlock;
  journal: Journal;
  choice: Choice | undefined;
  setChoice: (c: Choice) => void;
  setKind: (k: NoteKind) => void;
  setDate: (d: string) => void;
  open: () => void;
}) {
  const { b } = props;
  const n = problemsOf(b, props.journal);
  const choice = props.choice ?? (b.status === 'superset' ? 'replace' : undefined);
  return (
    <li class="block-row">
      <div class="row-flex wrap">
        <button type="button" class="list-btn grow" onClick={props.open} disabled={!b.date}>
          <span class="grow">
            <b>{b.date ? fmtDateJa(b.date, true) : '日付が未定'}</b> <Badge tone="info">{KIND_LABEL[b.kind]}</Badge>{' '}
            <Badge tone={b.status === 'new' ? 'info' : 'warn'}>{STATUS_LABEL[b.status]}</Badge>
            <br />
            <span class="small num">{dayNumbers(b, props.journal)}</span>
            {n > 0 ? <Badge tone="bad">問題 {n}</Badge> : null}
          </span>
        </button>
      </div>
      <div class="row-flex wrap small">
        <span class="muted">判定: {KIND_LABEL[b.kind]}({b.kind === b.autoKind ? b.kindReason : '切り替えた'})</span>
        <Button kind="ghost" class="small" onClick={() => props.setKind(b.kind === 'meal' ? 'purchase' : 'meal')}>
          {b.kind === 'meal' ? '食材費' : '献立'}に切り替える
        </Button>
        {b.dateLine === null ? (
          <label class="row-flex small">
            日付の行がありません。どの日?
            <input class="input" type="date" value={b.date ?? ''} onChange={(e) => e.currentTarget.value && props.setDate(e.currentTarget.value)} style={{ width: 'auto' }} />
          </label>
        ) : null}
        {b.merged > 1 ? <span class="muted">同じ日のまとまりが {b.merged} 個あったので、続けて1日にしました</span> : null}
      </div>
      {b.status === 'changed' || b.status === 'superset' ? (
        <div class="row-flex wrap small">
          <span>保存済みの内容と違います:</span>
          <Segmented
            label="取り込み方"
            value={choice ?? ('' as Choice)}
            onChange={props.setChoice}
            options={[
              { value: 'replace', label: '置き換え' },
              { value: 'append', label: 'この日に追加' },
            ]}
          />
        </div>
      ) : null}
    </li>
  );
}

function DiffView(props: { diff: DiffOp[] }) {
  const changed = props.diff.filter((d) => d.t !== 'same').length;
  return (
    <details class="card" open>
      <summary>保存済みとの違い({changed} 行)</summary>
      <ul class="diff">
        {props.diff.map((d) => (
          <li class={`diff-${d.t}`}>
            <span aria-hidden="true">{d.t === 'add' ? '+' : d.t === 'del' ? '−' : ' '}</span>
            <span class="sr-only">{d.t === 'add' ? '増えた行' : d.t === 'del' ? '消える行' : '同じ行'}</span>
            {d.text}
          </li>
        ))}
      </ul>
      <p class="small muted">「置き換え」は保存済みの行を貼った内容に置き換えます(− の行は消えます)。「この日に追加」は保存済みの後ろに貼った行を足します(一部だけ貼ったときに、ほかの食事が消えないように)。</p>
    </details>
  );
}

function PreviewSheet(props: { b: PasteBlock; journal: Journal; choice: Choice | undefined; setChoice: (c: Choice) => void; onClose: () => void }) {
  const { b, journal } = props;
  const md = b.kind === 'meal' ? journal.meals.find((m) => m.date === b.date) : undefined;
  const pd = b.kind === 'purchase' ? journal.purchases.find((p) => p.date === b.date) : undefined;
  return (
    <Sheet title={`${b.date ? fmtDateJa(b.date, true) : ''} ${KIND_LABEL[b.kind]}(保存前)`} onClose={props.onClose}>
      {b.existing && b.diff ? (
        <>
          <DiffView diff={b.diff} />
          <Segmented
            label="取り込み方"
            value={props.choice ?? (b.status === 'superset' ? 'replace' : ('' as Choice))}
            onChange={props.setChoice}
            options={[
              { value: 'replace', label: '置き換え' },
              { value: 'append', label: 'この日に追加' },
            ]}
          />
        </>
      ) : null}
      {md ? <MealDetail md={md} journal={journal} /> : null}
      {pd ? <PurchaseDetail pd={pd} journal={journal} /> : null}
    </Sheet>
  );
}

function SavedList(props: { limit: number; onMore: () => void; open: (date: string) => void }) {
  const store = useStore();
  const { data } = useAppState();
  const journal = store.journal();
  const dates = [...new Set(data.texts.map((t) => t.date))].sort().reverse();
  const meals = new Map(journal.meals.map((m) => [m.date, m]));
  const buys = new Map(journal.purchases.map((p) => [p.date, p]));
  return (
    <section class="card" aria-label="保存した日">
      <h2>保存した日({dates.length})</h2>
      {dates.length === 0 ? <p class="small muted">まだありません。上の欄にメモを貼り付けて「保存」してください。「デモを貼り付ける」で、架空のテキストを試せます。</p> : null}
      <ul class="list">
        {dates.slice(0, props.limit).map((d) => {
          const m = meals.get(d);
          const p = buys.get(d);
          const n = mergeProblems([...(m?.problems ?? []), ...(p?.problems ?? [])]).length;
          return (
            <li>
              <button type="button" class="list-btn" onClick={() => props.open(d)}>
                <span class="grow">
                  <b>{fmtDateJa(d, true)}</b>
                  <br />
                  <span class="small num">
                    {m ? `献立 ${fmtNutrient('kcal', m.calc.total.nutrients.kcal)}kcal ・ ${fmtYen(m.calc.total.cost, 'total')}${m.day.weightKg !== undefined ? ` ・ ${m.day.weightKg}kg` : ''}` : ''}
                    {m && p ? ' / ' : ''}
                    {p ? `食材費 ${fmtYen(p.total, 'total')}` : ''}
                  </span>
                </span>
                {n > 0 ? <Badge tone="bad">問題 {n}</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {dates.length > props.limit ? (
        <Button kind="ghost" onClick={props.onMore}>
          もっと見る
        </Button>
      ) : null}
    </section>
  );
}
