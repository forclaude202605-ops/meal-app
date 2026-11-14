// 食事摂取基準(2025年版)との比較(仕様書 §9)。純関数のみ。
// 実績 ÷ 基準 の比と、基準の種類(推奨量・目安量・目標量・上限量・推定エネルギー必要量)を必ず一緒に返す。
import { AGE_GROUPS, ENERGY_BALANCE, EER, EER_PER_KG, IRON_MENSTRUATING, NUTRIENT_DRI, type Five, type NutrientDri, type Sex } from '../data/dri2025.ts';
import type { Vec } from './calc.ts';
import { NUTRIENTS } from './nutrients.ts';
import type { NutrientKey, Profile } from './types.ts';

export interface DriProfile {
  sex: Sex;
  age: number;
  activity: 1 | 2 | 3;
  /** 女性 18〜64歳の鉄の基準に使う。未設定なら鉄は比較しない */
  menstruation?: boolean;
}

export type DriReady = { ok: true; profile: DriProfile; group: number; groupLabel: string } | { ok: false; reason: string };

/** 設定のプロフィールから、比較に使う区分を決める(成人だけ) */
export function driProfile(p: Profile | undefined): DriReady {
  if (!p || !p.sex || !p.age || !p.activity) return { ok: false, reason: '設定でプロフィール(性別・年齢・身体活動レベル)を選ぶと、食事摂取基準と比べられます。' };
  if (p.age < 18) return { ok: false, reason: '成人(18歳以上)の基準だけを入れています。' };
  const group = AGE_GROUPS.findIndex((g) => p.age !== undefined && p.age >= g.min && p.age <= g.max);
  if (group < 0) return { ok: false, reason: '年齢が範囲外です。' };
  const profile: DriProfile = { sex: p.sex, age: p.age, activity: p.activity, ...(p.menstruation !== undefined ? { menstruation: p.menstruation } : {}) };
  return { ok: true, profile, group, groupLabel: (AGE_GROUPS[group] as { label: string }).label };
}

/**
 * 判定:
 * deficit = 推定平均必要量未満(不足のおそれ) / low = 推奨量・目標量の下限に届かない / below-ai = 目安量未満(不足かどうかは判断できない) /
 * ok = 基準を満たす / high = 目標量の上限を超える / over-ul = 耐容上限量を超える / info = 参考(判定しない)
 */
export type DriStatus = 'deficit' | 'low' | 'below-ai' | 'ok' | 'high' | 'over-ul' | 'info';

export interface DriCheck {
  id: string;
  label: string;
  unit: string;
  /** 実績(%エネルギーの項目は %) */
  value: number;
  /** 基準の種類 */
  kind: '推定エネルギー必要量' | '推奨量' | '目安量' | '目標量';
  /** 基準の表示(例: 推奨量 65 g、目標量 20〜30 %、目標量 7.5 g 未満) */
  refText: string;
  /** 比の分母(範囲の目標量は下限、「未満」は上限)。比較しないときは null */
  target: number | null;
  /** value / target */
  ratio: number | null;
  /** 範囲の目標量のときの [下限, 上限] */
  range?: [number | null, number | null];
  ear?: number;
  ul?: number;
  status: DriStatus;
  statusText: string;
  notes: string[];
}

const at = (v: Five | undefined, g: number): number | null => (v ? (v[g] ?? null) : null);
const pick = (v: { male: Five; female: Five } | undefined, sex: Sex, g: number) => (v ? at(v[sex], g) : null);

function fmt(x: number): string {
  return Number.isInteger(x) ? x.toLocaleString('ja-JP') : String(Math.round(x * 100) / 100);
}

/** 栄養素1つの判定(推奨量・目安量・目標量・上限量) */
function checkNutrient(key: NutrientKey, d: NutrientDri, value: number, sex: Sex, g: number, opts: { iron?: { ear: number | null; rda: number | null } | null }): DriCheck | null {
  const info = NUTRIENTS[key];
  const notes: string[] = [];
  if (d.note) notes.push(d.note);
  let ear = pick(d.ear, sex, g);
  let rda = pick(d.rda, sex, g);
  if (opts.iron !== undefined) {
    if (opts.iron === null) return { id: key, label: info.label, unit: info.unit, value, kind: '推奨量', refText: '設定で月経の有無を選ぶと比べます', target: null, ratio: null, status: 'info', statusText: '比較しない', notes };
    ear = opts.iron.ear;
    rda = opts.iron.rda;
  }
  const ai = pick(d.ai, sex, g);
  const ul = pick(d.ul, sex, g);
  const atLeast = pick(d.dgAtLeast, sex, g);
  const below = pick(d.dgBelow, sex, g);
  let base: Omit<DriCheck, 'status' | 'statusText'>;
  let status: DriStatus;
  let statusText: string;
  if (rda !== null) {
    base = { id: key, label: info.label, unit: info.unit, value, kind: '推奨量', refText: `推奨量 ${fmt(rda)} ${info.unit}`, target: rda, ratio: value / rda, notes };
    if (ear !== null) base.ear = ear;
    if (ear !== null && value < ear) [status, statusText] = ['deficit', '推定平均必要量未満(不足のおそれ)'];
    else if (value < rda) [status, statusText] = ['low', '推奨量未満'];
    else [status, statusText] = ['ok', '推奨量以上'];
  } else if (atLeast !== null) {
    base = { id: key, label: info.label, unit: info.unit, value, kind: '目標量', refText: `目標量 ${fmt(atLeast)} ${info.unit} 以上`, target: atLeast, ratio: value / atLeast, notes };
    [status, statusText] = value < atLeast ? ['low', '目標量未満'] : ['ok', '目標量以上'];
    if (ai !== null) notes.push(`目安量 ${fmt(ai)} ${info.unit}`);
  } else if (below !== null) {
    base = { id: key, label: info.label, unit: info.unit, value, kind: '目標量', refText: `目標量 ${fmt(below)} ${info.unit} 未満`, target: below, ratio: value / below, range: [null, below], notes };
    [status, statusText] = value >= below ? ['high', '目標量を超えている'] : ['ok', '目標量未満'];
  } else if (ai !== null) {
    base = { id: key, label: info.label, unit: info.unit, value, kind: '目安量', refText: `目安量 ${fmt(ai)} ${info.unit}`, target: ai, ratio: value / ai, notes };
    [status, statusText] = value >= ai ? ['ok', '目安量以上'] : ['below-ai', '目安量未満(不足かどうかは判断できない)'];
  } else return null;
  if (ul !== null) {
    base.ul = ul;
    if (d.ulScope === 'total') {
      notes.push(`耐容上限量 ${fmt(ul)} ${info.unit}`);
      if (value > ul) [status, statusText] = ['over-ul', '耐容上限量を超えている'];
    } else notes.push(`耐容上限量 ${fmt(ul)} ${info.unit}(${d.ulNote ?? '比較しない'}。ここでは比べない)`);
  } else if (d.ulNote) notes.push(d.ulNote);
  return { ...base, status, statusText };
}

/** %エネルギーの目標量の判定 */
function checkPercent(id: string, label: string, pct: number, range: readonly [number | null, number | null]): DriCheck {
  const [lo, hi] = range;
  const refText = lo !== null && hi !== null ? `目標量 ${lo}〜${hi} %E` : `目標量 ${hi} %E 以下`;
  let status: DriStatus = 'ok';
  let statusText = '目標量の範囲内';
  if (lo !== null && pct < lo) [status, statusText] = ['low', '目標量の下限より少ない'];
  else if (hi !== null && pct > hi) [status, statusText] = ['high', '目標量の上限より多い'];
  else if (lo === null) statusText = '目標量以下';
  const target = lo ?? hi;
  return { id, label, unit: '%E', value: pct, kind: '目標量', refText, target, ratio: target ? pct / target : null, range: [lo, hi], status, statusText, notes: ['%E は総エネルギーに占める割合(合計が100%にならないことがある)'] };
}

/** 先に見せる項目(残りは「すべて表示」で) */
export const MAIN_CHECKS = ['kcal', 'protein', 'pct-protein', 'pct-fat', 'pct-carb', 'fiber', 'salt', 'ca', 'fe', 'zn', 'vita', 'vitd', 'b1', 'b2', 'vitc', 'fol'];
const ORDER: NutrientKey[] = ['protein', 'fiber', 'salt', 'k', 'ca', 'mg', 'p', 'fe', 'zn', 'cu', 'mn', 'id', 'se', 'cr', 'mo', 'vita', 'vitd', 'vite', 'vitk', 'b1', 'b2', 'nia', 'b6', 'b12', 'fol', 'pan', 'bio', 'vitc', 'n6', 'n3'];

/**
 * 1日分(または期間の平均)の摂取量を、食事摂取基準と比べる。
 * エネルギーは推定エネルギー必要量との比を出す(過不足の判断は体重の変化で行う、という報告書の注意も付ける)。
 */
export function checkIntake(n: Vec, ready: Extract<DriReady, { ok: true }>, opts: { weightKg?: number | undefined } = {}): DriCheck[] {
  const { profile: p, group: g } = ready;
  const out: DriCheck[] = [];
  // エネルギー
  const eer = at(EER[p.sex][p.activity], g);
  const perKg = at(EER_PER_KG[p.sex][p.activity], g);
  if (eer !== null) {
    const ratio = n.kcal / eer;
    const notes = ['エネルギーの過不足は、体重の変化や BMI で判断する(報告書の注意)。比は参考'];
    if (perKg !== null && opts.weightKg) notes.push(`体重から: ${opts.weightKg} kg × ${perKg} kcal/kg = ${fmt(Math.round(perKg * opts.weightKg))} kcal(参考表1)`);
    const status: DriStatus = ratio < 0.9 ? 'low' : ratio > 1.1 ? 'high' : 'ok';
    out.push({ id: 'kcal', label: 'エネルギー', unit: 'kcal', value: n.kcal, kind: '推定エネルギー必要量', refText: `推定エネルギー必要量 ${fmt(eer)} kcal`, target: eer, ratio, status, statusText: status === 'ok' ? '±10% の範囲(参考)' : status === 'low' ? '90% 未満(参考)' : '110% を超える(参考)', notes });
  } else {
    out.push({ id: 'kcal', label: 'エネルギー', unit: 'kcal', value: n.kcal, kind: '推定エネルギー必要量', refText: 'この区分の推定エネルギー必要量は設定なし', target: null, ratio: null, status: 'info', statusText: '比較しない', notes: [] });
  }
  // エネルギー産生栄養素バランス(%エネルギー。分母は総エネルギー)
  if (n.kcal > 0) {
    const pr = ENERGY_BALANCE.protein[g] as readonly [number, number];
    out.push(checkPercent('pct-protein', 'たんぱく質 %E', ((n.protein * 4) / n.kcal) * 100, pr));
    out.push(checkPercent('pct-fat', '脂質 %E', ((n.fat * 9) / n.kcal) * 100, ENERGY_BALANCE.fat[g] as readonly [number, number]));
    out.push(checkPercent('pct-satfat', '飽和脂肪酸 %E', ((n.satfat * 9) / n.kcal) * 100, [null, ENERGY_BALANCE.satfatMax[g] as number]));
    out.push(checkPercent('pct-carb', '炭水化物 %E', ((n.carb * 4) / n.kcal) * 100, ENERGY_BALANCE.carb[g] as readonly [number, number]));
  }
  for (const key of ORDER) {
    const d = (NUTRIENT_DRI as Record<string, NutrientDri>)[key];
    if (!d) continue;
    let iron: { ear: number | null; rda: number | null } | null | undefined;
    if (key === 'fe' && p.sex === 'female' && g <= 2) {
      iron = p.menstruation === undefined ? null : p.menstruation ? { ear: at(IRON_MENSTRUATING.ear, g), rda: at(IRON_MENSTRUATING.rda, g) } : { ear: pick(d.ear, 'female', g), rda: pick(d.rda, 'female', g) };
    }
    const c = checkNutrient(key, d, n[key], p.sex, g, iron === undefined ? {} : { iron });
    if (c) {
      if (key === 'fe' && iron) c.notes.push(p.menstruation ? '月経ありの値' : '月経なしの値');
      out.push(c);
    }
  }
  // 並び: 主な項目を先に(その中は MAIN_CHECKS の順)、残りは元の順
  const main = MAIN_CHECKS.map((id) => out.find((c) => c.id === id)).filter((c): c is DriCheck => c !== undefined);
  const rest = out.filter((c) => !MAIN_CHECKS.includes(c.id));
  return [...main, ...rest];
}

/** 判定ごとの件数(画面の上に出す) */
export function summarizeChecks(list: DriCheck[]): Record<DriStatus, number> {
  const out: Record<DriStatus, number> = { deficit: 0, low: 0, 'below-ai': 0, ok: 0, high: 0, 'over-ul': 0, info: 0 };
  for (const c of list) out[c.status]++;
  return out;
}
