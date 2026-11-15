// 体重と、選んだ項目(エネルギー・たんぱく質など)のグラフ。
// 上の大きいグラフ: 体重(左の軸)と、重ねる項目(右の軸)を1枚に重ねる(持ち主の希望で二重軸を使う)。
// その下: ほかに選んだ項目を、同じ日付で縦に並べる。どこをタップしても、その点の値をまとめて上に出す。
import { useMemo, useRef, useState } from 'preact/hooks';
import { niceTicks, SERIES, type Grain, type ReferenceLine, type SeriesDef, type TrendPoint } from '../core/trend.ts';
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
const RIGHT_STACK = 10;
const RIGHT_OVERLAY = 40;
const PANEL_H = 112;
const OVERLAY_H = 190;
const TOP = 22;
const AXIS_H = 22;

const num = (v: number, d: number) => trimZeros(formatNumber(v, d));

export function pointLabel(p: TrendPoint & { end?: string }, grain: Grain): string {
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  if (grain === 'month') return `${date4(p.date)}/${Number(p.date.slice(5, 7))}`;
  if (grain === 'week') return `${md(p.date)}〜`;
  return md(p.date);
}
const date4 = (d: string) => d.slice(0, 4);

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

interface Line {
  id: string;
  title: string;
  unit: string;
  decimals: number;
  color: string;
  values: (number | null)[];
  ref: ReferenceLine | null;
}

export function TrendChart(props: {
  points: (TrendPoint & { end?: string; recordedDays?: number })[];
  grain: Grain;
  /** 体重に重ねる項目(null なら重ねない) */
  overlay: SeriesDef['id'] | null;
  /** 下に並べる項目 */
  series: SeriesDef['id'][];
  refs: Partial<Record<SeriesDef['id'], ReferenceLine | null>>;
}) {
  const pts = props.points;
  const n = pts.length;
  const [sel, setSel] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const daily = props.grain === 'day';

  const line = (s: SeriesDef): Line => ({ id: s.id, title: s.label, unit: s.unit, decimals: s.decimals, color: SERIES_COLOR[s.id] as string, values: pts.map((p) => p.values[s.id]), ref: props.refs[s.id] ?? null });
  const over = useMemo(() => {
    const s = SERIES.find((x) => x.id === props.overlay);
    return s ? line(s) : null;
  }, [pts, props.overlay, props.refs]);
  const stack = useMemo(() => SERIES.filter((s) => props.series.includes(s.id) && s.id !== props.overlay).map(line), [pts, props.series, props.overlay, props.refs]);
  const weights = pts.map((p) => p.weight);
  const weightLine = pts.map((p) => p.weightAvg);

  const right = over ? RIGHT_OVERLAY : RIGHT_STACK;
  const plotW = W - LEFT - right;
  const x = (i: number) => LEFT + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const H = OVERLAY_H + stack.length * PANEL_H + AXIS_H;
  const markers = n <= 40;

  const pickIndex = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - LEFT) / plotW) * (n - 1));
    setSel(Math.max(0, Math.min(n - 1, i)));
  };

  const scale = (vals: (number | null)[], ref: ReferenceLine | null, y0: number, h: number) => {
    const v = vals.filter((a): a is number => a !== null);
    if (ref) v.push(ref.value);
    const t = v.length > 0 ? niceTicks(Math.min(...v), Math.max(...v), 3) : { lo: 0, hi: 1, ticks: [0, 1] };
    const y = (a: number) => y0 + TOP + (h - TOP - 10) - ((a - t.lo) / (t.hi - t.lo || 1)) * (h - TOP - 10);
    return { ...t, y };
  };

  const s = sel !== null ? pts[sel] : undefined;
  const step = Math.max(1, Math.ceil(n / 6));
  const xTicks = pts.map((p, i) => ({ p, i })).filter(({ i }) => i % step === 0 || i === n - 1);

  // 上の重ねたグラフ
  const wS = scale([...weights, ...weightLine], null, 0, OVERLAY_H);
  const oS = over ? scale(over.values, over.ref, 0, OVERLAY_H) : null;
  const avgLabel = daily ? '7日移動平均' : props.grain === 'week' ? '週の平均' : '月の平均';

  return (
    <div>
      <div class="readout" aria-live="polite">
        {s ? (
          <>
            <b>{pointLabel(s, props.grain)}</b>
            {!daily ? <span class="muted small">(記録 {s.recordedDays ?? 0} 日の平均)</span> : null}{' '}
            <span class="item">
              <i style={{ background: SERIES_COLOR.weight }} />
              体重 {s.weight !== null ? `${num(s.weight, daily ? 1 : 2)}kg` : '—'}
              {daily && s.weightAvg !== null ? `(7日平均 ${num(s.weightAvg, 2)}kg)` : ''}
            </span>
            {[...(over ? [over] : []), ...stack].map((l) => {
              const v = l.values[sel as number];
              return (
                <span class="item">
                  <i style={{ background: l.color }} />
                  {l.title} {v !== null && v !== undefined ? `${num(v, l.decimals)}${l.unit}` : '—'}
                </span>
              );
            })}
          </>
        ) : (
          <span class="muted">グラフをタップすると、その{daily ? '日' : props.grain === 'week' ? '週' : '月'}の値をまとめて出します。</span>
        )}
      </div>
      <svg
        ref={svgRef}
        class="trend"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`体重${over ? `と${over.title}を重ねた` : ''}グラフ${stack.length ? `と、${stack.map((l) => l.title).join('・')}のグラフ` : ''}(${n}点)。表でも見られます`}
        tabIndex={0}
        onPointerDown={(e) => pickIndex(e.clientX)}
        onPointerMove={(e) => (e.buttons > 0 || e.pointerType === 'mouse') && pickIndex(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setSel((v) => Math.max(0, (v ?? n) - 1));
          if (e.key === 'ArrowRight') setSel((v) => Math.min(n - 1, (v ?? -1) + 1));
        }}
      >
        {/* 凡例 */}
        <g>
          <circle cx={LEFT + 4} cy={9} r={4} fill={SERIES_COLOR.weight} stroke="var(--surface)" stroke-width={2} />
          <text x={LEFT + 11} y={12}>
            体重(左 kg)
          </text>
          <line x1={LEFT + 82} x2={LEFT + 96} y1={9} y2={9} stroke={SERIES_COLOR.weight} stroke-width={2} opacity={0.6} />
          <text x={LEFT + 99} y={12}>
            {avgLabel}
          </text>
          {over ? (
            <>
              <line x1={LEFT + 170} x2={LEFT + 184} y1={9} y2={9} stroke={over.color} stroke-width={2.5} />
              <text x={LEFT + 187} y={12}>
                {over.title}(右 {over.unit})
              </text>
            </>
          ) : null}
        </g>
        {wS.ticks.map((t) => (
          <g>
            <line class="grid" x1={LEFT} x2={W - right} y1={wS.y(t)} y2={wS.y(t)} />
            <text x={LEFT - 4} y={wS.y(t) + 3} text-anchor="end" style={{ fill: 'var(--c2)' }}>
              {num(t, wS.hi - wS.lo < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {oS && over
          ? oS.ticks.map((t) => (
              <text x={W - right + 4} y={oS.y(t) + 3} text-anchor="start" style={{ fill: over.color }}>
                {num(t, over.decimals > 0 && oS.hi - oS.lo < 10 ? 1 : 0)}
              </text>
            ))
          : null}
        {oS && over?.ref ? (
          <g>
            <line class="ref" x1={LEFT} x2={W - right} y1={oS.y(over.ref.value)} y2={oS.y(over.ref.value)} style={{ stroke: over.color }} />
            <text x={W - right - 2} y={oS.y(over.ref.value) - 3} text-anchor="end">
              {over.ref.label} {num(over.ref.value, over.decimals)}
            </text>
          </g>
        ) : null}
        {oS && over ? (
          <>
            <path d={pathFor(over.values, x, oS.y)} fill="none" stroke={over.color} stroke-width={2.5} stroke-linejoin="round" stroke-linecap="round" />
            {over.values.map((v, i) => (v !== null && (markers || i === sel) ? <rect x={x(i) - 3.5} y={oS.y(v) - 3.5} width={7} height={7} fill={over.color} stroke="var(--surface)" stroke-width={1.5} /> : null))}
          </>
        ) : null}
        <path d={pathFor(weightLine, x, wS.y)} fill="none" stroke={SERIES_COLOR.weight} stroke-width={2} stroke-linejoin="round" stroke-linecap="round" opacity={daily ? 0.6 : 1} />
        {weights.map((v, i) => (v !== null ? <circle cx={x(i)} cy={wS.y(v)} r={i === sel ? 5 : 4} fill={SERIES_COLOR.weight} stroke="var(--surface)" stroke-width={2} /> : null))}
        {weights.every((v) => v === null) ? (
          <text x={LEFT + plotW / 2} y={OVERLAY_H / 2} text-anchor="middle">
            この期間に体重の記録がありません
          </text>
        ) : null}

        {/* 下に並べる項目 */}
        {stack.map((l, k) => {
          const y0 = OVERLAY_H + k * PANEL_H;
          const sc = scale(l.values, l.ref, y0, PANEL_H);
          return (
            <g>
              <text class="title" x={LEFT} y={y0 + 14}>
                {l.title}({l.unit})
              </text>
              {sc.ticks.map((t) => (
                <g>
                  <line class="grid" x1={LEFT} x2={W - right} y1={sc.y(t)} y2={sc.y(t)} />
                  <text x={LEFT - 4} y={sc.y(t) + 3} text-anchor="end">
                    {num(t, l.decimals > 0 && sc.hi - sc.lo < 10 ? 1 : 0)}
                  </text>
                </g>
              ))}
              {l.ref ? (
                <g>
                  <line class="ref" x1={LEFT} x2={W - right} y1={sc.y(l.ref.value)} y2={sc.y(l.ref.value)} />
                  <text x={W - right} y={sc.y(l.ref.value) - 3} text-anchor="end">
                    {l.ref.label} {num(l.ref.value, l.decimals)}
                  </text>
                </g>
              ) : null}
              {l.values.every((v) => v === null) ? (
                <text x={LEFT + plotW / 2} y={y0 + PANEL_H / 2 + 6} text-anchor="middle">
                  この期間に記録がありません
                </text>
              ) : null}
              <path d={pathFor(l.values, x, sc.y)} fill="none" stroke={l.color} stroke-width={2} stroke-linejoin="round" stroke-linecap="round" />
              {l.values.map((v, i) => (v !== null && (markers || i === sel) ? <circle cx={x(i)} cy={sc.y(v)} r={i === sel ? 5 : 4} fill={l.color} stroke="var(--surface)" stroke-width={2} /> : null))}
            </g>
          );
        })}
        {xTicks.map(({ p, i }) => (
          <text x={x(i)} y={H - 6} text-anchor="middle">
            {pointLabel(p, props.grain)}
          </text>
        ))}
        {sel !== null ? <line class="cross" x1={x(sel)} x2={x(sel)} y1={TOP - 6} y2={H - AXIS_H} /> : null}
      </svg>
    </div>
  );
}

/** 同じ内容の表(グラフと切り替える) */
export function TrendTable(props: { points: (TrendPoint & { recordedDays?: number })[]; series: SeriesDef['id'][]; grain: Grain }) {
  const cols = SERIES.filter((s) => props.series.includes(s.id));
  const daily = props.grain === 'day';
  return (
    <div class="table-scroll">
      <table class="tbl nutr">
        <thead>
          <tr>
            <th>{daily ? '日' : props.grain === 'week' ? '週' : '月'}</th>
            <th class="r">体重</th>
            {daily ? <th class="r">7日平均</th> : <th class="r">記録</th>}
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
              <td>{pointLabel(p, props.grain)}</td>
              <td class="r num">{p.weight !== null ? num(p.weight, daily ? 1 : 2) : ''}</td>
              {daily ? <td class="r num">{p.weightAvg !== null ? num(p.weightAvg, 2) : ''}</td> : <td class="r num">{p.recordedDays ?? 0}日</td>}
              {cols.map((c) => (
                <td class="r num">{p.values[c.id] !== null ? num(p.values[c.id] as number, c.decimals) : '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!daily ? <p class="small muted">週・月の値は、記録のある日の平均(体重は記録の平均)。</p> : null}
    </div>
  );
}
