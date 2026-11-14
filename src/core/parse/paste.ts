// 貼り付けの取り込み: 日ごとに分け、献立か食材費かを決め、保存済みの日と比べる(新規・変化なし・変更)。純関数のみ。
import { textId, type DayText, type NoteKind } from '../types.ts';
import { classifyLines } from './grammar.ts';
import { canonicalLines, cleanText, type CleanStat } from './normalize.ts';
import { blockBody, splitByDate, type SrcLine } from './split.ts';

export type DiffOp = { t: 'same' | 'add' | 'del'; text: string };

/**
 * 保存済みとの関係:
 * new: 新しい日 / same: 内容が同じ / contained: 貼った行はすべて保存済み(一部だけ貼った) /
 * superset: 保存済みの行をすべて含み、行が増えた / changed: 行が変わった・消えた / no-date: 日付が決まっていない
 */
export type BlockStatus = 'new' | 'same' | 'contained' | 'superset' | 'changed' | 'no-date';
export type Choice = 'replace' | 'append';

export interface PasteBlock {
  /** 貼り付けの中での番号(日付の選択・種類の切り替えの鍵) */
  index: number;
  date: string | null;
  kind: NoteKind;
  autoKind: NoteKind;
  kindReason: string;
  body: string;
  /** 日付の行(行番号)。日付の行がないときは null */
  dateLine: number | null;
  dateText: string | null;
  yearAssumed: boolean;
  weekdayMismatch: boolean;
  /** 同じ日・同じ種類のブロックが、貼り付けの中に複数あってまとめた */
  merged: number;
  status: BlockStatus;
  existing?: DayText;
  diff?: DiffOp[];
}

export interface PasteAnalysis {
  cleaned: { text: string; stats: CleanStat[] };
  blocks: PasteBlock[];
  skipped: SrcLine[];
  year: { line: number; label: string; year: number; isDefault: boolean } | null;
}

export interface PasteOptions {
  today: string;
  /** 年がどこにも書かれていないときに使う年(画面で選んだもの) */
  baseYear?: number;
  /** 種類の切り替え(ブロックの番号 → 種類) */
  kinds?: Record<number, NoteKind>;
  /** 日付の行がないブロックの日付(ブロックの番号 → 日付)。なければ today */
  dates?: Record<number, string>;
  saved: DayText[];
}

/** 最長共通部分列による行の差分 */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) (dp[i] as number[])[j] = a[i] === b[j] ? ((dp[i + 1] as number[])[j + 1] as number) + 1 : Math.max((dp[i + 1] as number[])[j] as number, (dp[i] as number[])[j + 1] as number);
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: 'same', text: a[i] as string });
      i++;
      j++;
    } else if (((dp[i + 1] as number[])[j] as number) >= ((dp[i] as number[])[j + 1] as number)) out.push({ t: 'del', text: a[i++] as string });
    else out.push({ t: 'add', text: b[j++] as string });
  }
  while (i < n) out.push({ t: 'del', text: a[i++] as string });
  while (j < m) out.push({ t: 'add', text: b[j++] as string });
  return out;
}

/** a の行が、順番どおりに b の中にすべてあるか */
function isSubsequence(a: string[], b: string[]): boolean {
  let j = 0;
  for (const x of a) {
    while (j < b.length && b[j] !== x) j++;
    if (j === b.length) return false;
    j++;
  }
  return true;
}

export function compareTexts(saved: string, incoming: string): { status: 'same' | 'contained' | 'superset' | 'changed'; diff: DiffOp[] } {
  const a = canonicalLines(saved);
  const b = canonicalLines(incoming);
  const diff = diffLines(a, b);
  if (a.length === b.length && a.every((x, i) => x === b[i])) return { status: 'same', diff };
  if (isSubsequence(b, a)) return { status: 'contained', diff };
  if (isSubsequence(a, b)) return { status: 'superset', diff };
  return { status: 'changed', diff };
}

export function analyzePaste(raw: string, opts: PasteOptions): PasteAnalysis {
  const cleaned = cleanText(raw);
  const split = splitByDate(cleaned.text, { today: opts.today, ...(opts.baseYear !== undefined ? { baseYear: opts.baseYear } : {}) });
  const savedById = new Map(opts.saved.map((t) => [t.id, t]));
  const blocks: PasteBlock[] = [];
  split.blocks.forEach((b, index) => {
    const auto = classifyLines(b.lines.map((l) => l.norm.text));
    const kind = opts.kinds?.[index] ?? auto.kind;
    const date = b.date ?? (b.dateLine ? null : (opts.dates?.[index] ?? opts.today));
    const body = blockBody(b.lines);
    // 同じ日・同じ種類が貼り付けの中に複数あるときは、1つにまとめる(後のものを末尾に足す)
    const same = date ? blocks.find((x) => x.date === date && x.kind === kind) : undefined;
    if (same) {
      same.body = [same.body, body].filter((s) => s !== '').join('\n');
      same.merged++;
      return;
    }
    blocks.push({
      index,
      date,
      kind,
      autoKind: auto.kind,
      kindReason: auto.reason,
      body,
      dateLine: b.dateLine?.no ?? null,
      dateText: b.dateLine?.raw.trim() ?? null,
      yearAssumed: b.yearAssumed,
      weekdayMismatch: b.weekdayMismatch,
      merged: 1,
      status: 'new',
    });
  });
  for (const b of blocks) {
    if (!b.date) {
      b.status = 'no-date';
      continue;
    }
    const existing = savedById.get(textId(b.kind, b.date));
    if (!existing) continue;
    const c = compareTexts(existing.text, b.body);
    b.status = c.status;
    b.existing = existing;
    b.diff = c.diff;
  }
  return { cleaned, blocks, skipped: split.skipped, year: split.year };
}

/** 既定の選び方: 行が増えただけなら置き換え。行が変わった・消えたときは、持ち主が選ぶまで決めない */
export function defaultChoice(b: PasteBlock): Choice | null {
  return b.status === 'superset' ? 'replace' : null;
}

/** 保存する(または計算の下見に使う)テキストを作る。変化なし・日付未定・未選択の変更は含めない */
export function pastedTexts(a: PasteAnalysis, choices: Record<number, Choice | undefined>, now: string, opts: { preview?: boolean } = {}): DayText[] {
  const out: DayText[] = [];
  for (const b of a.blocks) {
    if (!b.date || b.body === '') continue;
    if (b.status === 'same' || b.status === 'contained') continue;
    const choice = choices[b.index] ?? defaultChoice(b) ?? (opts.preview ? 'replace' : null);
    if (b.status !== 'new' && !choice) continue;
    const text = b.existing && choice === 'append' ? `${b.existing.text.replace(/\s+$/, '')}\n${b.body}` : b.body;
    out.push({ id: textId(b.kind, b.date), kind: b.kind, date: b.date, text, updatedAt: now });
  }
  return out;
}

/** 保存済みのテキストに、貼ったテキストを重ねる(同じ id は置き換え) */
export function overlay(saved: DayText[], incoming: DayText[]): DayText[] {
  const map = new Map(saved.map((t) => [t.id, t]));
  for (const t of incoming) map.set(t.id, t);
  return [...map.values()];
}
