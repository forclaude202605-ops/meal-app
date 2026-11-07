// 日本食品標準成分表(八訂)増補2023年の公式 Excel から、アプリに同梱する食品データ JSON を作る。
//
// 使い方:
//   node scripts/build-food-db.mjs <本表.xlsx> <脂肪酸成分表編 第1表.xlsx> <出力.json>
//       [--version <foodDbVersion>] [--retrieved YYYY-MM-DD] [--compare <参照JSON>]
//
// 値の扱い(公式の記号の意味に従う):
//   数値 → そのまま / (数値) 推定値 → 数値 / Tr・(Tr) 微量 → 0 / - 未測定 → null
//   * 値なし(ヨウ素の3食品)→ null / † 脚注記号 → 取り除いて数値として読む
// 廃棄率の列は取り込まない(入力したグラム数は食べた重さとして扱うため)。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readSheet } from './lib/xlsx-reader.mjs';

// (キー, 本表の列番号) 列番号は0始まり
const MAIN_COLS = [
  ['kcal', 6], ['protein', 9], ['fat', 12], ['carb', 20], ['fiber', 18], ['salt', 60],
  ['chol', 11],
  ['na', 23], ['k', 24], ['ca', 25], ['mg', 26], ['p', 27], ['fe', 28], ['zn', 29],
  ['cu', 30], ['mn', 31], ['id', 33], ['se', 34], ['cr', 35], ['mo', 36],
  ['vita', 42], ['vitd', 43], ['vite', 44], ['vitk', 48],
  ['b1', 49], ['b2', 50], ['nia', 52], ['b6', 53], ['b12', 54], ['fol', 55],
  ['pan', 56], ['bio', 57], ['vitc', 58],
];
// 脂肪酸成分表編 第1表(可食部100g当たり)の列
const FA_COLS = [['satfat', 8], ['n3', 11], ['n6', 12]];
const KEYS = [...MAIN_COLS, ...FA_COLS].map(([k]) => k);
const REFUSE_COL = 4; // 廃棄率。取り込まないが、セル内訳の照合のためだけに数える
const SHEET = '表全体';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const version = opt('--version') ?? 'mext-8th-2023-supp';
const comparePath = opt('--compare');
const retrieved = opt('--retrieved') ?? localDate(new Date());
const [SRC_MAIN, SRC_FA, OUT] = args;
if (!SRC_MAIN || !SRC_FA || !OUT) {
  console.error('使い方: node scripts/build-food-db.mjs <本表.xlsx> <脂肪酸第1表.xlsx> <出力.json> [--version v] [--retrieved YYYY-MM-DD] [--compare 参照.json]');
  process.exit(2);
}

function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const stats = { number: 0, numericText: 0, estimated: 0, trace: 0, unmeasured: 0, noValue: 0, dagger: 0, empty: 0 };
const statsWithRefuse = { ...stats };
const unparsed = new Map();

/** 公式表記の1セルを 数値 または null に変換する */
function parse(cell, st) {
  if (cell === undefined) {
    st.empty++;
    return null;
  }
  if (cell.kind === 'number') {
    st.number++;
    return cell.value;
  }
  let s = cell.value.replace(/\s/g, ''); // 正規表現の \s は全角空白も含む
  if (s.endsWith('†')) {
    st.dagger++;
    s = s.slice(0, -1);
  }
  if (s === '') {
    st.empty++;
    return null;
  }
  if (s === '-') {
    st.unmeasured++;
    return null;
  }
  if (s === '*') {
    st.noValue++;
    return null;
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    st.estimated++;
    s = s.slice(1, -1);
  }
  if (s === 'Tr') {
    st.trace++;
    return 0;
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    if (!(cell.value.trim().startsWith('('))) st.numericText++;
    return Number(s);
  }
  unparsed.set(cell.value, (unparsed.get(cell.value) ?? 0) + 1);
  return null;
}

const idOf = (row) => {
  const c = row.cells[1];
  if (c === undefined) return null;
  const s = String(c.value).trim();
  return /^\d{5}$/.test(s) ? s : null;
};

// 分類見出し(＜いも類＞、（キャベツ類）)は検索の邪魔なので、表示名の先頭から外す。
// ただし（…）の小見出しは、食品を見分けるのに要ることがある
// (例: 「（かつお類） 加工品 塩辛」と「（いか類） 加工品 塩辛」)ので、別の欄 head に残す。
// ＜…＞の大分類(＜魚類＞など)は捨てる。
function cleanName(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  const m = /^(＜[^＞]*＞\s*)?(（([^）]*)）\s*)?/.exec(s);
  const name = s.slice(m[0].length).trim();
  return name ? { name, head: m[3] ?? '' } : { name: s, head: '' };
}

// 備考欄の「(100 g：120 mL、100 mL：83 g)」から、100 mL あたりの重さ(g)を取り出す。
// 大さじ・小さじ・合の重さ換算の出典にする(成分表そのものが出典になる)。
const REMARK_COL = 61;
function densityOf(cell) {
  if (cell === undefined) return null;
  const m = /100\s*mL\s*[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*g/.exec(String(cell.value));
  return m ? Number(m[1]) : null;
}

// --- 脂肪酸成分表 ---
const fa = new Map();
const faStats = { ...stats };
for (const row of readSheet(SRC_FA, SHEET)) {
  const id = idOf(row);
  if (id === null) continue;
  if (fa.has(id)) throw new Error(`脂肪酸成分表で食品番号が重複: ${id}`);
  fa.set(id, FA_COLS.map(([, c]) => parse(row.cells[c], faStats)));
}

// --- 本表 ---
const foods = [];
const seen = new Set();
let duplicates = 0;
for (const row of readSheet(SRC_MAIN, SHEET)) {
  const id = idOf(row);
  if (id === null) continue;
  if (seen.has(id)) {
    duplicates++;
    continue;
  }
  seen.add(id);
  const nameCell = row.cells[3];
  const { name, head } = cleanName(nameCell ? String(nameCell.value) : '');
  parse(row.cells[REFUSE_COL], statsWithRefuse);
  const vals = MAIN_COLS.map(([, c]) => {
    const before = { ...stats };
    const v = parse(row.cells[c], stats);
    for (const k of Object.keys(stats)) statsWithRefuse[k] += stats[k] - before[k];
    return v;
  });
  vals.push(...(fa.get(id) ?? FA_COLS.map(() => null)));
  foods.push([id, name, head, vals, densityOf(row.cells[REMARK_COL])]);
}
const withDensity = foods.filter((f) => f[4] !== null).length;

const keyCount = new Map();
for (const [, name, head] of foods) keyCount.set(`${head}|${name}`, (keyCount.get(`${head}|${name}`) ?? 0) + 1);
const ambiguous = [...keyCount].filter(([, n]) => n > 1).map(([k]) => k);

const matched = foods.filter(([id]) => fa.has(id)).length;
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const out = {
  format: 1,
  version,
  source: '日本食品標準成分表（八訂）増補2023年 / 同 脂肪酸成分表編 第1表（文部科学省）',
  sourceUrl: 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html',
  retrieved,
  // 使った Excel のファイル名・版の日付(ファイル名の先頭の YYYYMMDD)・SHA-256
  files: [
    ['main', SRC_MAIN],
    ['fattyAcid', SRC_FA],
  ].map(([role, p]) => {
    const name = basename(p);
    const d = /^(\d{4})(\d{2})(\d{2})-/.exec(name);
    return { role, name, date: d ? `${d[1]}-${d[2]}-${d[3]}` : null, sha256: sha256(p) };
  }),
  note: '可食部100g当たり。記号は数値化(推定値は数値、Tr は 0、- と * は null)。廃棄率は含めない。foods の各要素は [食品番号, 食品名, 小見出し, 値の配列(keys の順), 100mLあたりの重さg(備考欄から。なければ null)]。',
  keys: KEYS,
  foods,
};
writeFileSync(OUT, JSON.stringify(out) + '\n', 'utf8');

console.log(`食品数: ${foods.length}  脂肪酸の行: ${fa.size}  結合できた食品: ${matched}  重複した食品番号: ${duplicates}  備考に容量換算がある食品: ${withDensity}`);
console.log('本表の取り込み列のセル内訳:', stats);
console.log('  (参考: 廃棄率の列も含めた内訳):', statsWithRefuse);
console.log('脂肪酸の取り込み列のセル内訳:', faStats);
console.log(`パースできなかった文字列: ${unparsed.size} 種類`, Object.fromEntries(unparsed));
console.log(`小見出し+食品名が重複する食品: ${ambiguous.length} 件`, ambiguous);
console.log(`出力: ${OUT}  (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);

// --- 参照 JSON との照合(丸め桁を小数第3位に揃える) ---
if (comparePath) {
  const ref = JSON.parse(readFileSync(comparePath, 'utf8'));
  const r3 = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
  const diffs = [];
  if (JSON.stringify(ref.keys) !== JSON.stringify(KEYS)) diffs.push('keys の並びが違う');
  const refById = new Map(ref.foods.map((f) => [f[0], f]));
  const mineIds = new Set(foods.map((f) => f[0]));
  for (const id of refById.keys()) if (!mineIds.has(id)) diffs.push(`${id}: 参照にだけある`);
  for (const [id, name, head, vals] of foods) {
    const rf = refById.get(id);
    if (!rf) {
      diffs.push(`${id}: こちらにだけある`);
      continue;
    }
    // reference/foods.reference.json は [id, name, 廃棄率, 値]、このスクリプトの出力は [id, name, 小見出し, 値]
    const refIsReference = typeof rf[2] === 'number';
    const rname = rf[1];
    const rvals = rf[3];
    if (refIsReference) {
      // 参照は（…類）だけを外している。こちらは（その他）なども外して head に移している
      if (rname !== name && rname !== `（${head}） ${name}`) diffs.push(`${id}: 名前 「${rname}」→「${name}」`);
    } else if (rname !== name || rf[2] !== head) {
      diffs.push(`${id}: 名前 「${rf[2]}|${rname}」→「${head}|${name}」`);
    }
    KEYS.forEach((k, i) => {
      const a = rvals[i] === null ? null : r3(rvals[i]);
      const b = r3(vals[i]);
      if (a !== b && !(a !== null && b !== null && Math.abs(a - b) < 1e-9)) diffs.push(`${id} ${name}: ${k} ${a} → ${b}`);
    });
  }
  const order = ref.foods.map((f) => f[0]).join() === foods.map((f) => f[0]).join();
  console.log(`\n参照 JSON との照合 (${comparePath}): 並び順 ${order ? '一致' : '不一致'}、差分 ${diffs.length} 件`);
  for (const d of diffs.slice(0, 200)) console.log('  ' + d);
  if (diffs.length > 200) console.log(`  …ほか ${diffs.length - 200} 件`);
}

if (unparsed.size > 0 || duplicates > 0) process.exit(1);
