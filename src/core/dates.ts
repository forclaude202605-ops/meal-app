// 日付は端末のローカル日付を 'YYYY-MM-DD' の文字列で持つ。
// 日付の計算は UTC の暦として行い、時差で日付がずれないようにする(時刻は扱わない)。

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(s: string): boolean {
  const m = RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function toUtc(s: string): Date {
  const m = RE.exec(s);
  if (!m) throw new Error(`日付の形式が違います: ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

const pad = (n: number) => String(n).padStart(2, '0');

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 端末のローカル時刻での今日 */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date: string, n: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** 0 = 日曜 … 6 = 土曜 */
export function dayOfWeek(date: string): number {
  return toUtc(date).getUTCDay();
}

/** a から b までの日数(b - a) */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export interface DateRange {
  start: string;
  end: string;
  calendarDays: number;
}

/** date を含む週(weekStartsOn: 0 = 日曜始まり、1 = 月曜始まり) */
export function weekRange(date: string, weekStartsOn: 0 | 1): DateRange {
  const back = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  const start = addDays(date, -back);
  return { start, end: addDays(start, 6), calendarDays: 7 };
}

/** date を含む暦月 */
export function monthRange(date: string): DateRange {
  const d = toUtc(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = fromUtc(new Date(Date.UTC(y, m, 1)));
  const end = fromUtc(new Date(Date.UTC(y, m + 1, 0)));
  return { start, end, calendarDays: diffDays(start, end) + 1 };
}

export function dayRange(date: string): DateRange {
  return { start: date, end: date, calendarDays: 1 };
}

/** start から end までの日付の一覧 */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
