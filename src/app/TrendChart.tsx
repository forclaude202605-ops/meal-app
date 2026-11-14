// 体重と、選んだ項目(エネルギー・たんぱく質など)のグラフ。二重軸は使わず、日付をそろえて縦に並べる(仕様書 §8)。
// どのグラフをタップ(またはなぞる)しても、その日の値をまとめて上に出す。左右の矢印キーでも動かせる。
import { useMemo, useRef, useState } from 'preact/hooks';
import { niceTicks, SERIES, type ReferenceLine, type SeriesDef, type TrendPoint } from '../core/trend.ts';
import { formatNumber } from '../core/round.ts';
import { trimZeros } from './format.ts';

/** 項目ごとの色(実体ごとに固定。体重は青) */
export const SERIES_COLOR: Record<string, string> = {
  weight: 'var(--c2)',
  kcal: 'var(--c1)',
  protein: 'var(--c3)',
  fat: 'var(--c4)',
  carb: 'var(--c5)',
  fiber: 'var(--text-2)',
  salt: 'var(--text-2)',
  cost: 'var(--text-2)',
};

const W = 360;
const LEFT = 40;
const RIGHT = 10;
const PANEL_H = 112;
const TOP = 20;
const PLOT_H = PANEL_H - TOP - 10;
const AXIS_H = 22;

const num = (v: number, d: number) => trimZeros(formatNumber(v, d));
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

interface Panel {
  id: string;
  title: string;
  unit: string;
  decimals: number;
  color: string;
  values: (number | null)[];
  /** 体重のときの7日移動平均 */
  avg?: (number | null)[];
  ref: ReferenceLine | null;
}

function pathFor(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function TrendChart(props: { points: TrendPoint[]; series: SeriesDef['id'][]; refs: Partial<Record<SeriesDef['id'], ReferenceLine | null>> }) {
  const pts = props.points;
  const n = pts.length;
  const [sel, setSel] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const panels: Panel[] = useMemo(() => {
    const list: Panel[] = [
      { id: 'weight', title: '体重', unit: 'kg', decimals: 1, color: SERIES_COLOR.weight as string, values: pts.map((p) => p.weight), avg: pts.map((p) => p.weightAvg), ref: null },
    ];
    for (const s of SERIES) {
      if (!props.series.includes(s.id)) continue;
      list.push({ id: s.id, title: s.label, unit: s.unit, decimals: s.decimals, color: SERIES_COLOR[s.id] as string, values: pts.map((p) => p.values[s.id]), ref: props.refs[s.id] ?? null });
    }
    return list;
  }, [pts, props.series, props.refs]);

  const plotW = W - LEFT - RIGHT;
  const x = (i: number) => LEFT + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const H = panels.length * PANEL_H + AXIS_H;
  const markers = n <= 35;

  const pickIndex = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - LEFT) / plotW) * (n - 1));
    setSel(Math.max(0, Math.min(n - 1, i)));
  };

  const s = sel !== null ? pts[sel] : undefined;
  // x 軸の日付: 最初・最後と、その間を最大 5 か所
  const step = Math.max(1, Math.ceil(n / 6));
  const xTicks = pts.map((p, i) => ({ p, i })).filter(({ i }) => i % step === 0 || i === n - 1);

  return (
    <div>
      <div class="readout" aria-live="polite">
        {s ? (
          <>
            <b>{md(s.date)}</b>{' '}
            {panels.map((p) => {
              const v = p.values[sel as number];
              return (
                <span class="item">
                  <i style={{ background: p.color }} />
                  {p.title} {v !== null && v !== undefined ? `${num(v, p.decimals)}${p.unit}` : '—'}
                  {p.avg && p.avg[sel as number] !== null ? `(7日平均 ${num(p.avg[sel as number] as number, 2)}kg)` : ''}
                </span>
              );
            })}
          </>
        ) : (
          <span class="muted">グラフをタップすると、その日の値をまとめて出します。</span>
        )}
      </div>
      <svg
        ref={svgRef}
        class="trend"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`体重${panels.length > 1 ? `と${panels.slice(1).map((p) => p.title).join('・')}` : ''}のグラフ(${n}日分)。表でも見られます`}
        tabIndex={0}
        onPointerDown={(e) => pickIndex(e.clientX)}
        onPointerMove={(e) => (e.buttons > 0 || e.pointerType === 'mouse') && pickIndex(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setSel((v) => Math.max(0, (v ?? n) - 1));
          if (e.key === 'ArrowRight') setSel((v) => Math.min(n - 1, (v ?? -1) + 1));
        }}
      >
        {panels.map((p, k) => {
          const y0 = k * PANEL_H;
          const vals = [...p.values, ...(p.avg ?? [])].filter((v): v is number => v !== null);
          if (p.ref) vals.push(p.ref.value);
          const { lo, hi, ticks } = vals.length > 0 ? niceTicks(Math.min(...vals), Math.max(...vals), 3) : { lo: 0, hi: 1, ticks: [0, 1] };
          const y = (v: number) => y0 + TOP + PLOT_H - ((v - lo) / (hi - lo || 1)) * PLOT_H;
          const empty = p.values.every((v) => v === null);
          return (
            <g>
              <text class="title" x={LEFT} y={y0 + 12}>
                {p.title}({p.unit})
              </text>
              {p.avg ? (
                <g>
                  <circle cx={W - 150} cy={y0 + 9} r={4} fill={p.color} stroke="var(--surface)" stroke-width={2} />
                  <text x={W - 143} y={y0 + 12}>
                    記録
                  </text>
                  <line x1={W - 108} x2={W - 92} y1={y0 + 9} y2={y0 + 9} stroke={p.color} stroke-width={2} />
                  <text x={W - 88} y={y0 + 12}>
                    7日移動平均
                  </text>
                </g>
              ) : null}
              {ticks.map((t) => (
                <g>
                  <line class="grid" x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} />
                  <text x={LEFT - 4} y={y(t) + 3} text-anchor="end">
                    {num(t, p.decimals > 0 && hi - lo < 10 ? 1 : 0)}
                  </text>
                </g>
              ))}
              {p.ref ? (
                <g>
                  <line class="ref" x1={LEFT} x2={W - RIGHT} y1={y(p.ref.value)} y2={y(p.ref.value)} />
                  <text x={W - RIGHT} y={y(p.ref.value) - 3} text-anchor="end">
                    {p.ref.label} {num(p.ref.value, p.decimals)}
                  </text>
                </g>
              ) : null}
              {empty ? (
                <text x={LEFT + plotW / 2} y={y0 + TOP + PLOT_H / 2} text-anchor="middle">
                  {p.id === 'weight' ? 'この期間に体重の記録がありません' : 'この期間に記録がありません'}
                </text>
              ) : null}
              {p.avg ? <path d={pathFor(p.avg, x, y)} fill="none" stroke={p.color} stroke-width={2} stroke-linejoin="round" stroke-linecap="round" opacity={0.55} /> : <path d={pathFor(p.values, x, y)} fill="none" stroke={p.color} stroke-width={2} stroke-linejoin="round" stroke-linecap="round" />}
              {p.values.map((v, i) =>
                v !== null && (markers || p.avg || i === sel) ? <circle cx={x(i)} cy={y(v)} r={i === sel ? 5 : 4} fill={p.color} stroke="var(--surface)" stroke-width={2} /> : null,
              )}
            </g>
          );
        })}
        {xTicks.map(({ p, i }) => (
          <text x={x(i)} y={H - 6} text-anchor="middle">
            {md(p.date)}
          </text>
        ))}
        {sel !== null ? <line class="cross" x1={x(sel)} x2={x(sel)} y1={TOP - 6} y2={H - AXIS_H} /> : null}
      </svg>
    </div>
  );
}

/** 同じ内容の表(グラフと切り替える) */
export function TrendTable(props: { points: TrendPoint[]; series: SeriesDef['id'][] }) {
  const cols = SERIES.filter((s) => props.series.includes(s.id));
  return (
    <div class="table-scroll">
      <table class="tbl nutr">
        <thead>
          <tr>
            <th>日</th>
            <th class="r">体重</th>
            <th class="r">7日平均</th>
            {cols.map((c) => (
              <th class="r">
                {c.label}
                <span class="muted small"> {c.unit}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.points.map((p) => (
            <tr>
              <td>{md(p.date)}</td>
              <td class="r num">{p.weight !== null ? num(p.weight, 1) : ''}</td>
              <td class="r num">{p.weightAvg !== null ? num(p.weightAvg, 2) : ''}</td>
              {cols.map((c) => (
                <td class="r num">{p.values[c.id] !== null ? num(p.values[c.id] as number, c.decimals) : '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
