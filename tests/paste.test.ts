// 貼り付けの取り込み: 日ごとの分割、献立/食材費の判定、同じ日の貼り直し(置き換え・追加・変化なし)。入力はすべて架空。
import { describe, expect, it } from 'vitest';
import { analyzePaste, compareTexts, defaultChoice, diffLines, overlay, pastedTexts } from '../src/core/parse/paste.ts';
import { textId, type DayText } from '../src/core/types.ts';

const saved = (kind: 'meal' | 'purchase', date: string, body: string): DayText => ({ id: textId(kind, date), kind, date, text: body, updatedAt: '2024-11-30T00:00:00.000Z' });
const TODAY = '2025-03-10';

describe('貼り付けの分割と判定', () => {
  const PASTE = ['2024/11/01', '・サンプルマート', 'キャベツ1kg 147円', 'ナス4本 158円', '', '2024/11/04(月)', '朝', 'オートミール30g', '', '11/5', '昼', 'キャベツ50g'].join('\n');

  it('日付の行で日に分け、献立か食材費かを決める。年のない日付は前の日付から補う', () => {
    const a = analyzePaste(PASTE, { today: TODAY, saved: [] });
    expect(a.blocks.map((b) => [b.date, b.kind, b.status])).toEqual([
      ['2024-11-01', 'purchase', 'new'],
      ['2024-11-04', 'meal', 'new'],
      ['2024-11-05', 'meal', 'new'],
    ]);
    expect(a.blocks[1]?.body).toBe('朝\nオートミール30g');
    expect(a.year).toBeNull();
  });

  it('判定は切り替えられる', () => {
    const a = analyzePaste(PASTE, { today: TODAY, saved: [], kinds: { 0: 'meal' } });
    expect(a.blocks[0]?.kind).toBe('meal');
    expect(a.blocks[0]?.autoKind).toBe('purchase');
  });

  it('日付の行がなければ、選んだ日(既定は今日)にする', () => {
    const a = analyzePaste('朝\nオートミール30g', { today: TODAY, saved: [] });
    expect(a.blocks[0]?.date).toBe(TODAY);
    expect(a.blocks[0]?.dateLine).toBeNull();
    const b = analyzePaste('朝\nオートミール30g', { today: TODAY, saved: [], dates: { 0: '2024-11-04' } });
    expect(b.blocks[0]?.date).toBe('2024-11-04');
  });

  it('同じ日・同じ種類のまとまりが2つあれば、1日にまとめる', () => {
    const a = analyzePaste('2024/11/04\n朝\nオートミール30g\n2024/11/04\n夜\nキャベツ50g', { today: TODAY, saved: [] });
    expect(a.blocks).toHaveLength(1);
    expect(a.blocks[0]?.merged).toBe(2);
    expect(a.blocks[0]?.body).toBe('朝\nオートミール30g\n夜\nキャベツ50g');
  });

  it('メモからのコピーで混ざる特殊な改行でも、同じように分かれる', () => {
    const a = analyzePaste(PASTE.replace(/\n/g, String.fromCharCode(0x2028)), { today: TODAY, saved: [] });
    expect(a.blocks.map((b) => b.date)).toEqual(['2024-11-01', '2024-11-04', '2024-11-05']);
    expect(a.cleaned.stats[0]?.label).toBe('改行の文字(U+2028 行区切り)');
  });
});

describe('同じ日の貼り直し', () => {
  const OLD = saved('meal', '2024-11-04', '朝\nオートミール30g\n夜\nキャベツ50g');

  it('内容が同じなら変化なし(空白や全角/半角の違いは無視)。保存するものはない', () => {
    const a = analyzePaste('2024/11/04\n朝\n・オートミール３０ｇ\n\n夜\nキャベツ50g\n', { today: TODAY, saved: [OLD] });
    expect(a.blocks[0]?.status).toBe('same');
    expect(pastedTexts(a, {}, 'now')).toEqual([]);
  });

  it('一部だけ貼った(保存済みに含まれる)なら変化なし', () => {
    const a = analyzePaste('2024/11/04\n夜\nキャベツ50g', { today: TODAY, saved: [OLD] });
    expect(a.blocks[0]?.status).toBe('contained');
    expect(pastedTexts(a, {}, 'now')).toEqual([]);
  });

  it('行が増えただけなら「置き換え」が既定', () => {
    const a = analyzePaste('2024/11/04\n朝\nオートミール30g\n昼\n卵1個\n夜\nキャベツ50g', { today: TODAY, saved: [OLD] });
    const b = a.blocks[0];
    expect(b?.status).toBe('superset');
    expect(b && defaultChoice(b)).toBe('replace');
    expect(pastedTexts(a, {}, 'now')[0]?.text).toBe('朝\nオートミール30g\n昼\n卵1個\n夜\nキャベツ50g');
  });

  it('行が変わったら、選ぶまで保存しない。置き換え・この日に追加を選べる', () => {
    const a = analyzePaste('2024/11/04\n昼\n卵1個', { today: TODAY, saved: [OLD] });
    const b = a.blocks[0];
    expect(b?.status).toBe('changed');
    expect(b && defaultChoice(b)).toBeNull();
    expect(pastedTexts(a, {}, 'now')).toEqual([]);
    expect(pastedTexts(a, { 0: 'replace' }, 'now')[0]?.text).toBe('昼\n卵1個');
    expect(pastedTexts(a, { 0: 'append' }, 'now')[0]?.text).toBe('朝\nオートミール30g\n夜\nキャベツ50g\n昼\n卵1個');
    // 計算の下見では、選ぶ前は置き換えた場合を見せる
    expect(pastedTexts(a, {}, 'now', { preview: true })[0]?.text).toBe('昼\n卵1個');
    expect(b?.diff?.filter((d) => d.t !== 'same').map((d) => `${d.t}:${d.text}`)).toEqual(['del:朝', 'del:オートミール30g', 'del:夜', 'del:キャベツ50g', 'add:昼', 'add:卵1個']);
  });

  it('メモ全体を貼り直したときは、新しい日と変わった日だけが保存の対象になる', () => {
    const others = [OLD, saved('meal', '2024-11-05', '昼\nキャベツ50g'), saved('purchase', '2024-11-01', 'キャベツ1kg 147円')];
    const all = ['2024/11/01', 'キャベツ1kg 147円', '2024/11/04', '朝', 'オートミール30g', '夜', 'キャベツ50g', '2024/11/05', '昼', 'キャベツ60g', '2024/11/06', '朝', 'オートミール40g'].join('\n');
    const a = analyzePaste(all, { today: TODAY, saved: others });
    expect(a.blocks.map((b) => [b.date, b.status])).toEqual([
      ['2024-11-01', 'same'],
      ['2024-11-04', 'same'],
      ['2024-11-05', 'changed'],
      ['2024-11-06', 'new'],
    ]);
    expect(pastedTexts(a, {}, 'now').map((t) => t.date)).toEqual(['2024-11-06']);
    expect(pastedTexts(a, { 2: 'replace' }, 'now').map((t) => t.date)).toEqual(['2024-11-05', '2024-11-06']);
    // 重ねると、同じ id は置き換わる
    const merged = overlay(others, pastedTexts(a, { 2: 'replace' }, 'now'));
    expect(merged.find((t) => t.date === '2024-11-05')?.text).toBe('昼\nキャベツ60g');
    expect(merged).toHaveLength(4);
  });

  it('献立と食材費は別のもの(同じ日でも比べない)', () => {
    const a = analyzePaste('2024/11/04\nキャベツ1kg 147円', { today: TODAY, saved: [OLD] });
    expect(a.blocks[0]?.kind).toBe('purchase');
    expect(a.blocks[0]?.status).toBe('new');
  });
});

describe('差分', () => {
  it('最長共通部分列で、同じ・増えた・消えた行を出す', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { t: 'same', text: 'a' },
      { t: 'del', text: 'b' },
      { t: 'add', text: 'x' },
      { t: 'same', text: 'c' },
      { t: 'add', text: 'd' },
    ]);
    expect(compareTexts('朝\nオートミール30g', '朝\nオートミール30g').status).toBe('same');
  });
});
