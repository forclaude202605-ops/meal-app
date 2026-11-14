// 食事摂取基準(2025年版)との比較の表示(仕様書 §9)。比と基準の種類を必ず並べ、判定は色だけでなく記号と文字でも示す。
import { useState } from 'preact/hooks';
import type { Vec } from '../core/calc.ts';
import { checkIntake, driProfile, summarizeChecks, type DriCheck, type DriStatus } from '../core/dri.ts';
import { DRI_SOURCE } from '../data/dri2025.ts';
import { formatNumber } from '../core/round.ts';
import { trimZeros } from './format.ts';
import { useAppState } from './store.ts';
import { Button } from './ui.tsx';

export const STATUS_ICON: Record<DriStatus, string> = { deficit: '▼', low: '▼', 'below-ai': '▽', ok: '✓', high: '▲', 'over-ul': '▲', info: '–' };
const STATUS_SHORT: Record<DriStatus, string> = { deficit: '不足のおそれ', low: '少ない', 'below-ai': '目安量未満', ok: '満たす', high: '多い', 'over-ul': '上限超え', info: '参考' };

function fmtVal(c: DriCheck): string {
  const d = c.unit === 'kcal' || c.unit === 'mg' || c.unit === 'μg' || c.unit === 'μgRAE' ? (c.value < 10 ? 1 : 0) : c.value < 10 ? 2 : 1;
  return trimZeros(formatNumber(c.value, c.unit === '%E' ? 1 : d));
}

/** 比のバー: 0〜150% の目盛り。範囲の目標量は帯、そのほかは 100% の位置に印 */
function RatioBar(props: { c: DriCheck }) {
  const c = props.c;
  if (c.ratio === null) return null;
  const MAX = 1.5;
  const pos = (r: number) => `${(Math.max(0, Math.min(r, MAX)) / MAX) * 100}%`;
  if (c.range && c.target) {
    const [lo, hi] = c.range;
    const loR = lo !== null ? lo / c.target : 0;
    const hiR = hi !== null ? hi / c.target : MAX;
    return (
      <div class="ratio" aria-hidden="true">
        <div class="band" style={{ left: pos(loR), width: `calc(${pos(hiR)} - ${pos(loR)})` }} />
        <div class={`dot dot-${c.status}`} style={{ left: pos(c.ratio) }} />
      </div>
    );
  }
  return (
    <div class="ratio" aria-hidden="true">
      <div class={`fill fill-${c.status}`} style={{ width: pos(c.ratio) }} />
      <div class="mark" style={{ left: pos(1) }} />
    </div>
  );
}

export function DriComparison(props: { totals: Vec; weightKg?: number | undefined; title: string; note?: string }) {
  const { data } = useAppState();
  const [all, setAll] = useState(false);
  const ready = driProfile(data.settings.profile);
  if (!ready.ok) {
    return (
      <section class="card" aria-label={props.title}>
        <h3>{props.title}</h3>
        <p class="small muted">{ready.reason}</p>
      </section>
    );
  }
  const list = checkIntake(props.totals, ready, { weightKg: props.weightKg });
  const counts = summarizeChecks(list);
  const MAIN = 16;
  const shown = all ? list : list.slice(0, MAIN);
  const p = ready.profile;
  return (
    <section class="card" aria-label={props.title}>
      <h3>{props.title}</h3>
      <p class="small muted">
        {p.sex === 'male' ? '男性' : '女性'} {ready.groupLabel}・身体活動レベル「{p.activity === 1 ? '低い' : p.activity === 2 ? 'ふつう' : '高い'}」の基準。{props.note ?? ''}
      </p>
      <div class="dri-summary" aria-label="判定の件数">
        {(['ok', 'low', 'deficit', 'below-ai', 'high', 'over-ul'] as DriStatus[])
          .filter((s) => counts[s] > 0)
          .map((s) => (
            <span class={`st st-${s}`}>
              {STATUS_ICON[s]} {STATUS_SHORT[s]} {counts[s]}
            </span>
          ))}
      </div>
      <ul class="dri-list">
        {shown.map((c) => (
          <li class="dri-row">
            <div class="top">
              <span class="name">{c.label}</span>
              <span class="val">
                <b>{fmtVal(c)}</b> <span class="small muted">{c.unit}</span>
              </span>
              <span class={`st st-${c.status}`} title={c.statusText}>
                {STATUS_ICON[c.status]} {c.ratio !== null && c.unit !== '%E' ? `${Math.round(c.ratio * 100)}%` : STATUS_SHORT[c.status]}
              </span>
            </div>
            <RatioBar c={c} />
            <div class="sub">
              {c.refText} ・ {c.statusText}
              {c.ear !== undefined && c.status !== 'ok' ? ` ・ 推定平均必要量 ${trimZeros(String(c.ear))} ${c.unit}` : ''}
              {c.notes.length > 0 ? <span> ・ {c.notes.join(' ・ ')}</span> : null}
            </div>
          </li>
        ))}
      </ul>
      {list.length > MAIN ? (
        <Button kind="ghost" class="small" onClick={() => setAll(!all)}>
          {all ? '主な項目だけ表示' : `すべて表示(ほか ${list.length - MAIN} 項目)`}
        </Button>
      ) : null}
      <p class="small muted">
        棒の縦線が基準(100%)、緑の帯が目標量の範囲。1日分の比較は目安で、食事摂取基準は習慣的な摂取量に対するもの。基準がない項目(コレステロールなど)は比較の対象外。出典: {DRI_SOURCE.publisher}「日本人の食事摂取基準(2025年版)」策定検討会報告書(
        <a href={DRI_SOURCE.url} target="_blank" rel="noopener noreferrer">
          厚生労働省のページ
        </a>
        、取得 {DRI_SOURCE.retrieved})。
      </p>
    </section>
  );
}
