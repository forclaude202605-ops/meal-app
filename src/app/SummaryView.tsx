// 集計の画面: 期間(週・月・3か月)の、体重のグラフ(下に選んだ項目を同じ日付で並べる)、平均、食事摂取基準との比較。
// 日の値は、保存したテキストから毎回計算したもの。体重はテキストの「体重〇kg」の行から。
import { useMemo, useState } from 'preact/hooks';
import { computePeriod } from '../core/calc.ts';
import { addDays, monthRange, todayLocal, weekRange, type DateRange } from '../core/dates.ts';
import { driProfile } from '../core/dri.ts';
import { buildTrend, DEFAULT_SERIES, referenceLine, SERIES, type SeriesDef } from '../core/trend.ts';
import { weightChange, weightStats } from '../core/weight.ts';
import { DriComparison } from './DriView.tsx';
import { fmtDateJa, fmtNutrient, fmtYen } from './format.ts';
import { useAppState, useStore } from './store.ts';
import { SERIES_COLOR, TrendChart, TrendTable } from './TrendChart.tsx';
import { Button, Segmented } from './ui.tsx';

type Span = 'week' | 'month' | 'quarter';

function rangeOf(span: Span, date: string, weekStartsOn: 0 | 1): DateRange {
  if (span === 'week') return weekRange(date, weekStartsOn);
  const m = monthRange(date);
  if (span === 'month') return m;
  const prev = monthRange(addDays(m.start, -1));
  const first = monthRange(addDays(prev.start, -1));
  return { start: first.start, end: m.end, calendarDays: first.calendarDays + prev.calendarDays + m.calendarDays };
}

function shift(span: Span, date: string, dir: 1 | -1, weekStartsOn: 0 | 1): string {
  if (span === 'week') return addDays(date, 7 * dir);
  const r = rangeOf(span, date, weekStartsOn);
  return dir < 0 ? addDays(r.start, -1) : addDays(r.end, 1);
}

export function SummaryView() {
  const store = useStore();
  const { data } = useAppState();
  const journal = store.journal();
  const latest = journal.meals[journal.meals.length - 1]?.date;
  const [date, setDate] = useState(latest ?? todayLocal());
  const [span, setSpan] = useState<Span>('month');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const ws = data.settings.weekStartsOn;
  const range = rangeOf(span, date, ws);
  const series = (data.settings.chartSeries ?? DEFAULT_SERIES).filter((id): id is SeriesDef['id'] => SERIES.some((s) => s.id === id));
  const setSeries = (list: SeriesDef['id'][]) => store.setSettings({ ...data.settings, chartSeries: list });

  const all = useMemo(() => journal.meals.map((m) => ({ date: m.date, calc: m.calc, weightKg: m.day.weightKg })), [journal]);
  const points = useMemo(() => buildTrend(all, range), [all, range.start, range.end]);
  const ready = driProfile(data.settings.profile);
  const refs = useMemo(() => Object.fromEntries(SERIES.map((s) => [s.id, referenceLine(s.id, ready)])), [ready.ok, data.settings.profile]);
  const days = journal.meals.filter((m) => m.date >= range.start && m.date <= range.end).map((m) => m.calc);
  const p = computePeriod(days, range, data.settings.averageMode);
  // 食事摂取基準と比べるのは、記録のある日の平均(仕様書 §9)
  const recordedAvg = computePeriod(days, range, 'recordedDays').average;
  const log = useMemo(() => new Map(all.filter((d) => d.weightKg !== undefined).map((d) => [d.date, d.weightKg as number])), [all]);
  const ws1 = weightStats(log, range.start, range.end);
  const prevRange = rangeOf(span, shift(span, date, -1, ws), ws);
  const change = weightChange(ws1, weightStats(log, prevRange.start, prevRange.end));
  const lastWeight = [...points].reverse().find((x) => x.weight !== null)?.weight ?? undefined;

  return (
    <div>
      <div class="topbar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: '8px' }}>
        <h1 style={{ fontSize: '1.1rem' }}>集計</h1>
        <Segmented
          label="期間"
          value={span}
          onChange={setSpan}
          options={[
            { value: 'week', label: '週' },
            { value: 'month', label: '月' },
            { value: 'quarter', label: '3か月' },
          ]}
        />
        <div class="row-flex">
          <Button kind="ghost" aria-label="前の期間" onClick={() => setDate(shift(span, date, -1, ws))}>
            ‹
          </Button>
          <span class="grow" style={{ textAlign: 'center' }}>
            {fmtDateJa(range.start, true)} 〜 {fmtDateJa(range.end)}
          </span>
          <Button kind="ghost" aria-label="次の期間" onClick={() => setDate(shift(span, date, 1, ws))}>
            ›
          </Button>
        </div>
      </div>

      <section class="card" aria-label="体重と栄養のグラフ">
        <div class="row-flex">
          <h2 class="grow">体重と、並べて見る項目</h2>
          <Segmented
            label="表示"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'グラフ' },
              { value: 'table', label: '表' },
            ]}
          />
        </div>
        <div class="series-chips" role="group" aria-label="体重の下に並べる項目">
          {SERIES.map((s) => {
            const on = series.includes(s.id);
            return (
              <button type="button" class={`chip-btn${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setSeries(on ? series.filter((x) => x !== s.id) : [...series, s.id])}>
                <i style={{ background: SERIES_COLOR[s.id] }} />
                {s.label}
              </button>
            );
          })}
        </div>
        {view === 'chart' ? <TrendChart points={points} series={series} refs={refs} /> : <TrendTable points={points} series={series} />}
        <p class="small muted">
          体重は、献立のテキストの「体重〇kg」の行から読みます。線のとぎれは記録のない日です。点線は食事摂取基準(プロフィールを設定したとき)。単位の違う値は同じ軸に重ねず、日付をそろえて並べています。
        </p>
      </section>

      <section class="card" aria-label="期間の平均">
        <h2>期間の平均</h2>
        <dl class="kv">
          <dt>記録のある日</dt>
          <dd>
            {p.recordedDays}/{p.calendarDays} 日(平均の分母: {p.mode === 'recordedDays' ? '記録のある日' : '暦日数'})
          </dd>
          <dt>エネルギー</dt>
          <dd class="num">{p.average ? `${fmtNutrient('kcal', p.average.nutrients.kcal)} kcal` : '—'}</dd>
          <dt>P / F / C</dt>
          <dd class="num">
            {p.average
              ? `${fmtNutrient('protein', p.average.nutrients.protein)} / ${fmtNutrient('fat', p.average.nutrients.fat)} / ${fmtNutrient('carb', p.average.nutrients.carb)} g`
              : '—'}
          </dd>
          <dt>食物繊維 / 食塩</dt>
          <dd class="num">{p.average ? `${fmtNutrient('fiber', p.average.nutrients.fiber)} / ${fmtNutrient('salt', p.average.nutrients.salt)} g` : '—'}</dd>
          <dt>費用</dt>
          <dd class="num">{p.average ? `${fmtYen(p.average.cost, 'total')}/日(合計 ${fmtYen(p.total.cost, 'total')})` : '—'}</dd>
          <dt>体重</dt>
          <dd class="num">
            {ws1.average !== null ? `平均 ${ws1.average.toFixed(2)} kg(${ws1.count} 回)` : '記録なし'}
            {change !== null ? ` ・ 前の期間から ${change >= 0 ? '+' : ''}${change.toFixed(2)} kg` : ''}
          </dd>
        </dl>
        <p class="small muted">記録のない日を 0kcal として平均に混ぜません。</p>
      </section>

      {recordedAvg ? (
        <DriComparison totals={recordedAvg.nutrients} weightKg={lastWeight ?? undefined} title="食事摂取基準との比較(期間の平均)" note={`記録のある ${p.recordedDays} 日の平均を、1日分の基準と比べています(平均の分母の設定によらず、記録のある日で割ります)。`} />
      ) : null}
    </div>
  );
}
