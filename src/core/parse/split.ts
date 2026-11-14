// 貼り付けたテキストを、日付の行で日ごとに分ける。年のない日付は前後の日付から補う。純関数のみ。
import { normalizeLine, type NormLine } from './normalize.ts';

export interface SrcLine {
  /** 貼り付けたテキストの中の行番号(1始まり) */
  no: number;
  raw: string;
  norm: NormLine;
}

export interface DateMatch {
  y: number | null;
  m: number;
  d: number;
  /** 書いてある曜日(0=日 … 6=土)。なければ null */
  weekday: number | null;
  /** 日付の後ろに続く文字(「2025/1/6 朝」の「朝」など) */
  rest: string;
}

const WD = '日月火水木金土';
const WEEKDAY = /^\s*(?:\(\s*([日月火水木金土])(?:曜日|曜)?\s*\)|([日月火水木金土])(?:曜日|曜)?(?=\s|$))/;

/**
 * 日付の行か(行は normalizeLine 済み)。受け付ける形: 2025/1/6、2025-01-06、2025.1.6、2025年1月6日、1月6日、1/6。
 * 曜日 (月)・(月曜)・月曜日 を後ろに付けてよい。年のない「1/6」の形は、日付と曜日だけの行に限る(「1/3錠」などと区別するため)。
 */
export function matchDateLine(s: string): DateMatch | null {
  let y: number | null = null;
  let m: number;
  let d: number;
  let allowRest: boolean;
  let len: number;
  let r = /^(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})(?!\d)\s*日?/.exec(s);
  if (r) {
    y = Number(r[1]);
    m = Number(r[2]);
    d = Number(r[3]);
    allowRest = true;
    len = r[0].length;
  } else if ((r = /^(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s))) {
    m = Number(r[1]);
    d = Number(r[2]);
    allowRest = true;
    len = r[0].length;
  } else if ((r = /^(\d{1,2})\/(\d{1,2})(?![\d/.])/.exec(s))) {
    m = Number(r[1]);
    d = Number(r[2]);
    allowRest = false;
    len = r[0].length;
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let rest = s.slice(len);
  let weekday: number | null = null;
  const w = WEEKDAY.exec(rest);
  if (w) {
    weekday = WD.indexOf((w[1] ?? w[2]) as string);
    rest = rest.slice(w[0].length);
  }
  rest = rest.replace(/^[\s:、,]+/, '').trim();
  if (rest && !allowRest) return null;
  return { y, m, d, weekday, rest };
}

const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;

/** 暦に存在する日付なら YYYY-MM-DD、なければ null */
export function ymd(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 基準の日付にいちばん近くなる年(前年・同年・翌年から選ぶ。同じ近さなら基準と同じ年) */
function closestYear(m: number, d: number, ref: { y: number; m: number; d: number }): number | null {
  const base = dayNumber(ref.y, ref.m, ref.d);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const y of [ref.y, ref.y - 1, ref.y + 1]) {
    if (!ymd(y, m, d)) continue;
    const dist = Math.abs(dayNumber(y, m, d) - base);
    if (dist < bestDist) {
      best = y;
      bestDist = dist;
    }
  }
  return best;
}

/** 年がまったく書かれていないときの既定: 今日から見て、いちばん近い過去の日付になる年(今日を含む) */
export function defaultYear(m: number, d: number, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const y = m < tm || (m === tm && d <= td) ? ty : ty - 1;
  // 2/29 のように、その年にない日付は、さらに前の年から探す
  for (let k = 0; k < 8; k++) if (ymd(y - k, m, d)) return y - k;
  return y;
}

export interface Block {
  /** null = 日付の行がない(どの日か聞く) */
  date: string | null;
  dateLine: SrcLine | null;
  /** 年を「今日から見た既定」で補った(確認が必要) */
  yearAssumed: boolean;
  /** 書いてある曜日と、日付の曜日が合わない */
  weekdayMismatch: boolean;
  lines: SrcLine[];
}

export interface SplitResult {
  blocks: Block[];
  /** 日付の行より前にあり、食材らしい行を含まないため取り込まない行(空行を除く) */
  skipped: SrcLine[];
  /** 年がどこにも書かれていない日付があるとき、その最初の日付と、使った年 */
  year: { line: number; label: string; year: number; isDefault: boolean } | null;
}

/**
 * テキストを日付の行で分ける。年のない日付は、直前の日付(なければ後ろで最初に年が書かれた日付)に
 * いちばん近くなる年で補う。年がどこにも書かれていなければ、最初の日付を baseYear(既定: 今日から見て
 * いちばん近い過去の日付になる年)とし、以降は直前の日付から補う。
 */
export function splitByDate(text: string, opts: { today: string; baseYear?: number }): SplitResult {
  const src: SrcLine[] = text.split('\n').map((raw, i) => ({ no: i + 1, raw, norm: normalizeLine(raw) }));
  const found: { i: number; m: DateMatch }[] = [];
  src.forEach((l, i) => {
    const m = matchDateLine(l.norm.text);
    if (m && (m.y === null || ymd(m.y, m.m, m.d))) found.push({ i, m });
  });

  // 年を決める
  const years: (number | null)[] = found.map((f) => f.m.y);
  const hasAnchor = years.some((y) => y !== null);
  let yearInfo: SplitResult['year'] = null;
  let prev: { y: number; m: number; d: number } | null = null;
  found.forEach((f, k) => {
    let y = years[k] ?? null;
    if (y === null) {
      if (prev) y = closestYear(f.m.m, f.m.d, prev);
      else if (hasAnchor) {
        const next = found.find((g, j) => j > k && g.m.y !== null);
        if (next) y = closestYear(f.m.m, f.m.d, { y: next.m.y as number, m: next.m.m, d: next.m.d });
      } else {
        const def = defaultYear(f.m.m, f.m.d, opts.today);
        y = opts.baseYear ?? def;
        yearInfo = { line: (src[f.i] as SrcLine).no, label: `${f.m.m}/${f.m.d}`, year: y, isDefault: y === def };
      }
    }
    years[k] = y;
    if (y !== null) prev = { y, m: f.m.m, d: f.m.d };
  });

  const blocks: Block[] = [];
  const skipped: SrcLine[] = [];
  const bodyOf = (from: number, to: number) => src.slice(from, to);
  if (found.length === 0) {
    const lines = src;
    if (lines.some((l) => l.norm.text !== '')) blocks.push({ date: null, dateLine: null, yearAssumed: false, weekdayMismatch: false, lines });
    return { blocks, skipped, year: null };
  }
  const first = found[0] as { i: number };
  const leading = bodyOf(0, first.i);
  if (leading.some((l) => /\d/.test(l.norm.text))) blocks.push({ date: null, dateLine: null, yearAssumed: false, weekdayMismatch: false, lines: leading });
  else skipped.push(...leading.filter((l) => l.norm.text !== ''));

  found.forEach((f, k) => {
    const line = src[f.i] as SrcLine;
    const end = k + 1 < found.length ? (found[k + 1] as { i: number }).i : src.length;
    const lines = bodyOf(f.i + 1, end);
    if (f.m.rest) lines.unshift({ no: line.no, raw: f.m.rest, norm: normalizeLine(f.m.rest) });
    const y = years[k];
    const date = y === null || y === undefined ? null : ymd(y, f.m.m, f.m.d);
    const actualWd = date ? new Date(`${date}T00:00:00Z`).getUTCDay() : null;
    blocks.push({
      date,
      dateLine: line,
      yearAssumed: f.m.y === null && !hasAnchor,
      weekdayMismatch: f.m.weekday !== null && actualWd !== null && f.m.weekday !== actualWd,
      lines,
    });
  });
  return { blocks, skipped, year: yearInfo };
}

/** ブロックの本文(保存するテキスト)。前後の空行を除き、行は書いたままの形 */
export function blockBody(lines: SrcLine[]): string {
  const raws = lines.map((l) => l.raw.replace(/\s+$/, ''));
  while (raws.length > 0 && (raws[0] as string).trim() === '') raws.shift();
  while (raws.length > 0 && (raws[raws.length - 1] as string).trim() === '') raws.pop();
  return raws.join('\n');
}
