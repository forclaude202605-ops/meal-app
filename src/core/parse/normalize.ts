// 貼り付けたテキストの正規化(仕様書 §8「記録」の読み取りのルール)。純関数のみ。
// 表記のゆれは確認なしで直し、「どの規則で直したか」を残して、画面であとから見られるようにする。

export interface CleanStat {
  label: string;
  count: number;
}

/** 文字コードから文字を作る(見えない文字をソースに直接書かないため) */
const ch = (...codes: number[]) => String.fromCharCode(...codes);
const cls = (...codes: number[]) => new RegExp(`[${ch(...codes)}]`, 'g');
const ZERO_WIDTH = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad, 0x180e];
const ODD_SPACES = [0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f];

const CLEAN_RULES: [RegExp, string, string][] = [
  [/\r\n/g, '\n', ''],
  [/\r/g, '\n', '改行の文字(CR)'],
  [cls(0x2028), '\n', '改行の文字(U+2028 行区切り)'],
  [cls(0x2029), '\n', '改行の文字(U+2029 段落区切り)'],
  [cls(0x0085), '\n', '改行の文字(U+0085)'],
  [cls(...ZERO_WIDTH), '', 'ゼロ幅文字'],
  [cls(0x00a0), ' ', 'ノーブレークスペース'],
  [cls(...ODD_SPACES), ' ', '特殊な空白'],
  [/\t/g, ' ', 'タブ'],
];

/**
 * 保存する前に1回だけ行う掃除。メモ帳からのコピーで混ざる、見えない文字や特殊な改行を直す。
 * 文字の形(全角/半角など)はここでは変えない(保存するテキストは、書いたままに近い形で残す)。
 */
export function cleanText(raw: string): { text: string; stats: CleanStat[] } {
  let text = raw;
  const stats: CleanStat[] = [];
  for (const [re, to, label] of CLEAN_RULES) {
    const n = text.match(re)?.length ?? 0;
    if (n === 0) continue;
    text = text.replace(re, to);
    if (label) stats.push({ label, count: n });
  }
  return { text, stats };
}

export interface NormLine {
  /** 読み取りに使う形 */
  text: string;
  /** 直した内容(規則の名前) */
  changes: string[];
}

const OPEN = /[【〔[｛{〈《]/g;
const CLOSE = /[】〕\]｝}〉》]/g;
/** 行頭の記号(箇条書きの印など) */
const LEADING = /^(?:[・•●○◦▪▫■□◆◇▶►▸▹➤→⇒\-–—*+✓✔☆★♪]+)\s*/;

/**
 * 1行を、読み取りに使う形にする。順に: 文字の形(NFKC: 全角→半角、㎏→kg、µ→μ など) → 分数の記号 →
 * 空白 → 数字の桁区切り → 括弧の種類 → 行頭の記号 → 行末の句点。
 */
export function normalizeLine(raw: string): NormLine {
  const changes: string[] = [];
  let s = raw;
  const step = (label: string, f: (x: string) => string) => {
    const t = f(s);
    if (t !== s) {
      changes.push(label);
      s = t;
    }
  };
  step('全角・半角などの文字の形', (x) => x.normalize('NFKC'));
  step('分数の記号', (x) => x.replace(/[⁄∕]/g, '/'));
  s = s.trim();
  step('空白', (x) => x.replace(/\s+/g, ' '));
  step('数字の桁区切り', (x) => x.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1'));
  step('括弧の種類', (x) => x.replace(OPEN, '(').replace(CLOSE, ')'));
  step('行頭の記号', (x) => x.replace(LEADING, ''));
  step('行末の句点', (x) => x.replace(/[。.]+$/, ''));
  return { text: s, changes };
}

/** 比較用: 正規化した行の並び(空行は除く)。「内容が同じか」の判定に使う */
export function canonicalLines(text: string): string[] {
  return cleanText(text)
    .text.split('\n')
    .map((l) => normalizeLine(l).text)
    .filter((l) => l !== '');
}
