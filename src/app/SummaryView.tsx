// 集計の画面(本格的な集計・グラフ・食事摂取基準との比較は M3)。M2 では、選んだ週の日ごとの合計だけを表で出す。
import { useMemo } from 'preact/hooks';
import { computeDay, computePeriod, createContext } from '../core/calc.ts';
import { eachDate, weekRange } from '../core/dates.ts';
import { fmtDateJa, fmtNutrient, fmtYen } from './format.ts';
import { useAppState, useStore } from './store.ts';

export function SummaryView(props: { date: string }) {
  const store = useStore();
  const { data } = useAppState();
  const range = weekRange(props.date, data.settings.weekStartsOn);
  const ctx = useMemo(() => createContext(store.foods, data.ingredients, data.prices), [store.foods, data.ingredients, data.prices]);
  const days = useMemo(
    () => data.days.filter((d) => d.date >= range.start && d.date <= range.end).map((d) => computeDay(ctx, d)),
    [ctx, data.days, range.start, range.end],
  );
  const p = computePeriod(days, range, data.settings.averageMode);
  const byDate = new Map(days.map((d) => [d.date, d]));
  return (
    <div>
      <div class="topbar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '1.1rem' }}>集計(週)</h1>
        <p class="small muted">
          {fmtDateJa(range.start)} 〜 {fmtDateJa(range.end)}。記録画面で選んだ日の週です。グラフや月の集計、食事摂取基準との比較は次の段階(M3)で入ります。
        </p>
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
