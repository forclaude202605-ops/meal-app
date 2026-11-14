// 読み取りの単体テスト(正規化・日付・1行の読み取り・伏せ字)。入力はすべて架空。
import { describe, expect, it } from 'vitest';
import { classifyLines, parseMealLine, parsePurchaseLine, readNameQty, type MealItemsLine } from '../src/core/parse/grammar.ts';
import { maskLine } from '../src/core/parse/mask.ts';
import { canonicalLines, cleanText, normalizeLine } from '../src/core/parse/normalize.ts';
import { defaultYear, matchDateLine, splitByDate } from '../src/core/parse/split.ts';

const ch = (c: number) => String.fromCharCode(c);
const items = (s: string): MealItemsLine => {
  const r = parseMealLine(normalizeLine(s).text);
  const l = r[r.length - 1];
  if (!l || l.t !== 'items') throw new Error(`items ではない: ${JSON.stringify(r)}`);
  return l;
};

describe('正規化: 特殊な文字', () => {
  it('U+2028・U+2029・CR を改行に、ゼロ幅文字を削除、ノーブレークスペースなどを空白にし、数を記録する', () => {
    const raw = `朝${ch(0x2028)}オートミール30g${ch(0x2029)}昼\r\nパス${ch(0x200b)}タ${ch(0x00a0)}100g${ch(0xfeff)}\rキャベツ${ch(0x2009)}40g`;
    const r = cleanText(raw);
    expect(r.text).toBe('朝\nオートミール30g\n昼\nパスタ 100g\nキャベツ 40g');
    const labels = r.stats.map((s) => s.label);
    expect(labels).toContain('改行の文字(U+2028 行区切り)');
    expect(labels).toContain('改行の文字(U+2029 段落区切り)');
    expect(labels).toContain('ゼロ幅文字');
    expect(labels).toContain('ノーブレークスペース');
    expect(r.stats.find((s) => s.label === 'ゼロ幅文字')?.count).toBe(2);
  });

  it('全角/半角、単位の記号、括弧の種類、行頭の記号、空白、行末の句点を直し、直した規則を残す', () => {
    const n = normalizeLine('　・ パスタ乾麺　　１２０ｇ【サンプルメモ】。');
    expect(n.text).toBe('パスタ乾麺 120g(サンプルメモ)');
    expect(n.changes).toEqual(['全角・半角などの文字の形', '空白', '括弧の種類', '行頭の記号', '行末の句点']);
    expect(normalizeLine('• 卵1個').text).toBe('卵1個');
    expect(normalizeLine('- 卵1個').text).toBe('卵1個');
    expect(normalizeLine('白米3,000g').text).toBe('白米3000g');
    expect(normalizeLine('みそ⁄').text).toBe('みそ/');
    expect(normalizeLine('ヨーグルト50㎎').text).toBe('ヨーグルト50mg');
  });

  it('比較用の行は、表記のゆれと空行を無視する', () => {
    expect(canonicalLines('朝\n\n・オートミール３０ｇ\n')).toEqual(canonicalLines('朝\nオートミール30g'));
  });
});

describe('日付の行', () => {
  it('いろいろな書き方を読む(曜日つき・年なし)', () => {
    expect(matchDateLine('2024/11/04')).toMatchObject({ y: 2024, m: 11, d: 4, rest: '' });
    expect(matchDateLine('2024-11-04')).toMatchObject({ y: 2024, m: 11, d: 4 });
    expect(matchDateLine('2024年11月4日(月)')).toMatchObject({ y: 2024, m: 11, d: 4, weekday: 1 });
    expect(matchDateLine('11月4日(月曜日)')).toMatchObject({ y: null, m: 11, d: 4, weekday: 1 });
    expect(matchDateLine('11/4 月')).toMatchObject({ y: null, m: 11, d: 4, weekday: 1 });
    expect(matchDateLine('11/4(月)')).toMatchObject({ y: null, m: 11, d: 4, weekday: 1 });
    expect(matchDateLine('2024/11/04 朝')).toMatchObject({ rest: '朝' });
  });

  it('分数や数量は日付にしない', () => {
    expect(matchDateLine('1/3錠')).toBeNull();
    expect(matchDateLine('2/3 個')).toBeNull();
    expect(matchDateLine('13/40')).toBeNull();
    expect(matchDateLine('卵1個')).toBeNull();
  });

  it('年がどこにも書かれていなければ、今日から見ていちばん近い過去の日付になる年', () => {
    expect(defaultYear(3, 1, '2025-03-10')).toBe(2025);
    expect(defaultYear(3, 10, '2025-03-10')).toBe(2025);
    expect(defaultYear(3, 11, '2025-03-10')).toBe(2024);
    expect(defaultYear(12, 31, '2025-03-10')).toBe(2024);
    expect(defaultYear(2, 29, '2025-03-10')).toBe(2024);
  });

  it('年のない日付は、直前の日付にいちばん近い年で補う(年をまたぐときも)', () => {
    const r = splitByDate('2024/12/30\n朝\n12/31\n朝\n1/1\n朝\n1/2\n朝', { today: '2025-03-10' });
    expect(r.blocks.map((b) => b.date)).toEqual(['2024-12-30', '2024-12-31', '2025-01-01', '2025-01-02']);
    expect(r.year).toBeNull();
    // 新しい日が上に来る書き方(降順)でも
    const d = splitByDate('1/2\n朝\n1/1\n朝\n2024/12/31\n朝', { today: '2025-03-10' });
    expect(d.blocks.map((b) => b.date)).toEqual(['2025-01-02', '2025-01-01', '2024-12-31']);
  });

  it('年がまったくないときは、最初の日付を既定の年にし、確認のための情報を返す。選んだ年でも読める', () => {
    const r = splitByDate('1/6(月)\n朝\n1/7\n昼', { today: '2025-03-10' });
    expect(r.blocks.map((b) => b.date)).toEqual(['2025-01-06', '2025-01-07']);
    expect(r.year).toEqual({ line: 1, label: '1/6', year: 2025, isDefault: true });
    expect(r.blocks[0]?.yearAssumed).toBe(true);
    const s = splitByDate('1/6(月)\n朝\n1/7\n昼', { today: '2025-03-10', baseYear: 2024 });
    expect(s.blocks.map((b) => b.date)).toEqual(['2024-01-06', '2024-01-07']);
    expect(s.year?.isDefault).toBe(false);
  });

  it('曜日が日付と合わなければ印を付ける', () => {
    const r = splitByDate('2024/11/04(火)\n朝', { today: '2025-03-10' });
    expect(r.blocks[0]?.weekdayMismatch).toBe(true);
    expect(splitByDate('2024/11/04(月)\n朝', { today: '2025-03-10' }).blocks[0]?.weekdayMismatch).toBe(false);
  });

  it('日付の行がなければ日付が未定の1つのまとまり。日付の行より前の行は、数字がなければ取り込まない', () => {
    const r = splitByDate('朝\nオートミール30g', { today: '2025-03-10' });
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.date).toBeNull();
    const s = splitByDate('サンプルメモ\n\n2024/11/04\n朝', { today: '2025-03-10' });
    expect(s.blocks.map((b) => b.date)).toEqual(['2024-11-04']);
    expect(s.skipped.map((l) => l.raw)).toEqual(['サンプルメモ']);
    const t = splitByDate('卵1個\n2024/11/04\n朝', { today: '2025-03-10' });
    expect(t.blocks.map((b) => b.date)).toEqual([null, '2024-11-04']);
  });
});

describe('献立の行', () => {
  it('名前 + 数量 + 単位(単位の別表記を直し、記録する)', () => {
    expect(items('パスタ乾麺120g').items[0]).toMatchObject({ name: 'パスタ乾麺', qty: 120, unit: 'g', qtyState: 'ok' });
    expect(items('鶏むね肉80グラム').items[0]).toMatchObject({ name: '鶏むね肉', qty: 80, unit: 'g' });
    expect(items('しょうゆ大匙2').items[0]).toMatchObject({ name: 'しょうゆ', qty: 2, unit: '大さじ', unitChanges: ['大匙→大さじ'] });
    expect(items('しょうゆ小匙0.4').items[0]).toMatchObject({ unit: '小さじ', qty: 0.4 });
    expect(items('ごま油大1').items[0]).toMatchObject({ name: 'ごま油', unit: '大さじ', qty: 1, unitChanges: ['大→大さじ'] });
    expect(items('しょうゆ大さじ2と1/3').items[0]?.qty).toBeCloseTo(7 / 3, 12);
    expect(items('しょうゆ大さじ2と1/3').items[0]?.unit).toBe('大さじ');
    expect(items('卵2コ').items[0]).toMatchObject({ unit: '個', qty: 2 });
    expect(items('白米0.6合').items[0]).toMatchObject({ name: '白米', qty: 0.6, unit: '合' });
    expect(items('デモ用ビタミンC1/3錠').items[0]?.qty).toBeCloseTo(1 / 3, 12);
    expect(items('牛乳1カップ').items[0]).toMatchObject({ unit: 'カップ', qty: 1 });
    expect(items('パン1斤').items[0]).toMatchObject({ unit: '斤', qty: 1 });
  });

  it('名前の中の数字(ビタミンC〇mg分)は名前に残し、最後の数量を読む', () => {
    expect(items('ビタミンC300mg分1/3錠').items[0]).toMatchObject({ name: 'ビタミンC300mg分', unit: '錠' });
    const b = items('ビタミンB12').items[0];
    expect(b).toMatchObject({ name: 'ビタミンB', fullName: 'ビタミンB12', qtyState: 'no-unit' });
  });

  it('個数と重さ(1個50g、1個(55g))は、重さを使い、個数は表示用に残す', () => {
    expect(items('卵1個52g').items[0]).toMatchObject({ name: '卵', qty: 52, unit: 'g', countQty: { qty: 1, unit: '個' } });
    expect(items('卵1個(57g)').items[0]).toMatchObject({ name: '卵', qty: 57, unit: 'g', countQty: { qty: 1, unit: '個' } });
  });

  it('複数の名前に数量が1つだけなら、それぞれに同じ数量を付ける', () => {
    const l = items('しょうゆ、酢、なたね油小さじ0.7');
    expect(l.shared).toBe(true);
    expect(l.items.map((i) => [i.name, i.qty, i.unit])).toEqual([
      ['しょうゆ', 0.7, '小さじ'],
      ['酢', 0.7, '小さじ'],
      ['なたね油', 0.7, '小さじ'],
    ]);
    expect(items('しょうゆ,みりん').items.map((i) => [i.name, i.qtyState])).toEqual([
      ['しょうゆ', 'none'],
      ['みりん', 'none'],
    ]);
  });

  it('数量のない行・数字のない単位・少々は、それぞれの状態として読む(推測で埋めない)', () => {
    expect(items('しょうゆ').items[0]).toMatchObject({ qty: null, qtyState: 'none' });
    expect(items('鶏がらスープ小さじ').items[0]).toMatchObject({ name: '鶏がらスープ', qty: null, unit: '小さじ', qtyState: 'unit-only' });
    expect(items('塩少々').items[0]).toMatchObject({ name: '塩', qtyState: 'vague', vague: '少々' });
    expect(items('こしょう 適量').items[0]).toMatchObject({ name: 'こしょう', qtyState: 'vague', vague: '適量' });
  });

  it('括弧: 単価メモ・同価格・その場での定義・調理メモ', () => {
    expect(items('豚こま70g(100g87円)').price).toEqual({ yen: 87, qty: 100, unit: 'g' });
    expect(items('豚こま70g（87円/100g）').price).toEqual({ yen: 87, qty: 100, unit: 'g' });
    expect(items('サンプルレシピC2尾(煮干し4尾9gと同価格)').same).toMatchObject({ name: '煮干し', qty: 9, unit: 'g', countQty: { qty: 4, unit: '尾' } });
    const def = items('サンプル菓子A2枚(1枚カルシウム160mgビタミンD1.2μg 12円)').def;
    expect(def).toEqual({ per: { qty: 1, unit: '枚' }, nutrients: { ca: 160, vitd: 1.2 }, yen: 12 });
    // 単位の換算: カルシウム 0.2g → 200mg
    expect(items('サンプル菓子A1枚(1枚カルシウム0.2g)').def?.nutrients.ca).toBeCloseTo(200, 9);
    const memo = items('ナス20g(サンプル調理メモ)');
    expect(memo.notes).toEqual(['サンプル調理メモ']);
    expect(memo.items[0]).toMatchObject({ name: 'ナス', qty: 20 });
    // 括弧が名前と数量の間にあってもよい
    expect(items('ナス(サンプル調理メモ)20g').items[0]).toMatchObject({ name: 'ナス', qty: 20 });
  });

  it('定義の基準量がないときは、読めない部分として残す', () => {
    expect(items('サンプル菓子A2枚(カルシウム160mg)').def?.error).toContain('基準量');
  });

  it('複数の名前に単価メモは付けられない(読めない行にする)', () => {
    const r = parseMealLine(normalizeLine('しょうゆ、みりん小さじ1(100g87円)').text);
    expect(r[0]?.t).toBe('unread');
  });

  it('区分の見出し・体重・日照のビタミンD・メモ・料理名(末尾の:)', () => {
    expect(parseMealLine('朝')).toEqual([{ t: 'slot', slot: '朝', label: '朝' }]);
    expect(parseMealLine(normalizeLine('【夕食】').text)[0]).toMatchObject({ t: 'slot', slot: '夜' });
    expect(parseMealLine('おやつ')[0]).toMatchObject({ t: 'slot', slot: '間食' });
    expect(parseMealLine('サプリメント')[0]).toMatchObject({ t: 'slot', slot: 'サプリ' });
    expect(parseMealLine('夕張メロン50g')[0]?.t).toBe('items');
    const both = parseMealLine(normalizeLine('朝: オートミール30g').text);
    expect(both.map((l) => l.t)).toEqual(['slot', 'items']);
    expect(parseMealLine('体重58.2kg')).toEqual([{ t: 'weight', kg: 58.2 }]);
    expect(parseMealLine(normalizeLine('体重：58.4キロ').text)[0]).toMatchObject({ t: 'weight', kg: 58.4 });
    expect(parseMealLine('日照によるビタミンD 6μg')).toEqual([{ t: 'sun', ug: 6, atLeast: false }]);
    expect(parseMealLine('日照によって7マイクログラム以上のビタミンDが作られる')).toEqual([{ t: 'sun', ug: 7, atLeast: true }]);
    expect(parseMealLine('日照あり')[0]?.t).toBe('unread');
    expect(parseMealLine('※サンプルメモ')[0]).toEqual({ t: 'memo', text: 'サンプルメモ' });
    expect(parseMealLine('サンプル料理A:')[0]).toEqual({ t: 'title', title: 'サンプル料理A' });
  });
});

describe('食材費の行', () => {
  const p = (s: string) => parsePurchaseLine(normalizeLine(s).text);
  it('金額と量はどの順でもよい', () => {
    expect(p('キャベツ147円1150g')).toMatchObject({ t: 'item', name: 'キャベツ', yen: 147, qty: 1150, unit: 'g' });
    expect(p('しめじ240g 88円')).toMatchObject({ name: 'しめじ', yen: 88, qty: 240, unit: 'g' });
    expect(p('ナス4本 158円')).toMatchObject({ name: 'ナス', yen: 158, qty: 4, unit: '本' });
    expect(p('イワシ4尾412g 296円')).toMatchObject({ name: 'イワシ', yen: 296, qty: 4, unit: '尾', grams: 412 });
    expect(p('大根1.2kg 178円')).toMatchObject({ name: '大根', yen: 178, qty: 1.2, unit: 'kg' });
    expect(p('¥1,280 デモ用マルチビタミン90錠')).toMatchObject({ t: 'item', error: 'no-yen' });
    expect(p('デモ用マルチビタミン90錠 ¥1,280')).toMatchObject({ name: 'デモ用マルチビタミン', yen: 1280, qty: 90, unit: '錠' });
    expect(p('にんじん4本590g 138円(サンプルメモ)')).toMatchObject({ grams: 590, notes: ['サンプルメモ'] });
  });

  it('店名の行・メモの行・足りない行', () => {
    expect(p('・サンプルマート')).toEqual({ t: 'store', name: 'サンプルマート' });
    expect(p('合計1234円')).toMatchObject({ t: 'memo' });
    expect(p('卵 238円')).toMatchObject({ t: 'item', error: 'no-amount' });
    expect(p('キャベツ1150g')).toMatchObject({ t: 'item', error: 'no-yen' });
    expect(p('しょうゆ、酢 412円')).toMatchObject({ t: 'unread' });
  });

  it('献立か食材費かを中身から決める', () => {
    expect(classifyLines(['・サンプルマート', 'キャベツ147円1150g', 'ナス4本 158円']).kind).toBe('purchase');
    expect(classifyLines(['朝', 'オートミール30g', '豚こま70g(100g87円)']).kind).toBe('meal');
    expect(classifyLines(['オートミール30g', '卵1個']).kind).toBe('meal');
  });
});

describe('読めなかった行を伏せる', () => {
  it('名前は〇〇、数字のかたまりは〇。単位・記号・決まった語は残す', () => {
    expect(maskLine('豚こま70g(100g87円)')).toBe('〇〇〇g(〇g〇円)');
    expect(maskLine('しょうゆ大さじ2')).toBe('〇〇大さじ〇');
    expect(maskLine('サンプル菓子A2枚(1枚カルシウム160mgビタミンD1.2μg 12円)')).toBe('〇〇〇枚(〇枚カルシウム〇mgビタミンD〇.〇μg 〇円)');
    expect(maskLine('サンプルレシピC2尾(煮干し4尾9gと同価格)')).toBe('〇〇〇尾(〇〇〇尾〇gと同価格)');
    expect(maskLine('体重58.2kg')).toBe('体重〇.〇kg');
    expect(maskLine('2024/11/04(月)')).toBe('〇/〇/〇(月)');
    expect(maskLine('ナス(サンプル調理メモ)')).toBe('〇〇(〇〇)');
  });

  it('readNameQty は括弧のない部分だけを読む', () => {
    expect(readNameQty('卵1個').qtyState).toBe('ok');
  });
});
