// 集計の画面(本格的な集計・グラフ・食事摂取基準との比較は M3)。いまは、週ごとに日の合計を表で出す。
// 日の値は、保存したテキストから毎回計算したもの。
import { useMemo, useState } from 'preact/hooks';
import { computePeriod } from '../core/calc.ts';
import { addDays, eachDate, todayLocal, weekRange } from '../core/dates.ts';
import { fmtDateJa, fmtNutrient, fmtYen } from './format.ts';
import { useAppState, useStore } from './store.ts';
import { Button } from './ui.tsx';

export function SummaryView() {
  const store = useStore();
  const { data } = useAppState();
  const journal = store.journal();
  const latest = journal.meals[journal.meals.length - 1]?.date;
  const [date, setDate] = useState(latest ?? todayLocal());
  const range = weekRange(date, data.settings.weekStartsOn);
  const days = useMemo(() => journal.meals.filter((m) => m.date >= range.start && m.date <= range.end).map((m) => m.calc), [journal, range.start, range.end]);
  const p = computePeriod(days, range, data.settings.averageMode);
  const byDate = new Map(days.map((d) => [d.date, d]));
  return (
    <div>
      <div class="topbar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '1.1rem' }}>集計(週)</h1>
        <div class="row-flex">
          <Button kind="ghost" aria-label="前の週" onClick={() => setDate(addDays(date, -7))}>
            ‹
          </Button>
          <span class="grow" style={{ textAlign: 'center' }}>
            {fmtDateJa(range.start, true)} 〜 {fmtDateJa(range.end)}
          </span>
          <Button kind="ghost" aria-label="次の週" onClick={() => setDate(addDays(date, 7))}>
            ›
          </Button>
        </div>
        <p class="small muted">グラフや月の集計、食事摂取基準との比較は次の段階(M3)で入ります。</p>
      </div>
      <div class="card">
        <table class="tbl">
          <thead>
            <tr>
              <th>日</th>
              <th class="r">kcal</th>
              <th class="r">P</th>
              <th class="r">F</th>
              <th class="r">C</th>
              <th class="r">食塩</th>
              <th class="r">費用</th>
            </tr>
          </thead>
          <tbody>
            {eachDate(range.start, range.end).map((d) => {
              const c = byDate.get(d);
              const n = c?.total.nutrients;
              return (
                <tr>
                  <td>{fmtDateJa(d)}</td>
                  <td class="r num">{n && c?.hasRecord ? fmtNutrient('kcal', n.kcal) : '—'}</td>
                  <td class="r num">{n && c?.hasRecord ? fmtNutrient('protein', n.protein) : ''}</td>
                  <td class="r num">{n && c?.hasRecord ? fmtNutrient('fat', n.fat) : ''}</td>
                  <td class="r num">{n && c?.hasRecord ? fmtNutrient('carb', n.carb) : ''}</td>
                  <td class="r num">{n && c?.hasRecord ? fmtNutrient('salt', n.salt) : ''}</td>
                  <td class="r num">{c?.hasRecord ? fmtYen(c.total.cost, 'total') : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>
                平均
                <br />
                <span class="small muted">
                  記録 {p.recordedDays}/{p.calendarDays}日
                </span>
              </th>
              <td class="r num">{p.average ? fmtNutrient('kcal', p.average.nutrients.kcal) : '—'}</td>
              <td class="r num">{p.average ? fmtNutrient('protein', p.average.nutrients.protein) : ''}</td>
              <td class="r num">{p.average ? fmtNutrient('fat', p.average.nutrients.fat) : ''}</td>
              <td class="r num">{p.average ? fmtNutrient('carb', p.average.nutrients.carb) : ''}</td>
              <td class="r num">{p.average ? fmtNutrient('salt', p.average.nutrients.salt) : ''}</td>
              <td class="r num">{p.average ? fmtYen(p.average.cost, 'total') : ''}</td>
            </tr>
          </tfoot>
        </table>
        <p class="small muted">
          平均の分母: {p.mode === 'recordedDays' ? '記録のある日' : '暦日数'}({p.denominator}日)。記録のない日を 0kcal として混ぜません。
        </p>
      </div>
    </div>
  );
}
