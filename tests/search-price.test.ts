// 名前の正規化・検索と、価格の入力文字列のテスト(すべて架空の値)。
import { describe, expect, it } from 'vitest';
import { parsePriceText } from '../src/core/priceText.ts';
import { FOOD_ALIASES, normalizeName, resolveIngredient, searchFoods, searchIngredients } from '../src/core/search.ts';
import type { Ingredient } from '../src/core/types.ts';
import { foodIng, foodTable } from './helpers.ts';

describe('名前の正規化', () => {
  it('全角/半角、カタカナ/ひらがな、空白・記号を揃える', () => {
    expect(normalizeName('ﾅｯﾄｳ')).toBe(normalizeName('なっとう'));
    expect(normalizeName('ナットウ')).toBe('なっとう');
    expect(normalizeName('オートミール')).toBe(normalizeName('ｵｰﾄﾐｰﾙ'));
    expect(normalizeName(' 豚 こま ')).toBe('豚こま');
    expect(normalizeName('ＡＢＣ')).toBe('abc');
  });
});

describe('食材マスタの名前解決', () => {
  const ings: Ingredient[] = [
    { ...foodIng('natto', '04046'), name: '納豆', aliases: ['なっとう'] },
    { ...foodIng('pork', '11115'), name: '豚こま', aliases: ['豚こま切れ'] },
  ];
  it('名前・別名に正規化して一致する', () => {
    expect(resolveIngredient('ナットウ', ings)?.id).toBe('natto');
    expect(resolveIngredient('豚こま', ings)?.id).toBe('pork');
    expect(resolveIngredient('牛こま', ings)).toBeUndefined();
  });
  it('検索は 完全一致 > 前方一致 > 部分一致', () => {
    const hits = searchIngredients('豚こま', ings);
    expect(hits.map((h) => h.ingredient.id)).toEqual(['pork']);
    expect(searchIngredients('こま', ings).map((h) => h.ingredient.id)).toEqual(['pork']);
  });
});

describe('成分表の検索(単語単位)', () => {
  const t = foodTable();
  it('「牛乳」で牛肉が出ない', () => {
    const hits = searchFoods('牛乳', t);
    expect(hits[0]?.food.id).toBe('13003');
    expect(hits.some((h) => h.food.name.startsWith('うし'))).toBe(false);
  });
  it('別名辞書: 白米 → 精白米 うるち米', () => {
    expect(searchFoods('白米', t)[0]?.food.id).toBe('01083');
  });
  it('曖昧な別名は複数の候補を並べる(豚こま)', () => {
    const hits = searchFoods('豚こま', t).filter((h) => h.viaAlias);
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
  it('別名辞書の食品名は、すべて成分表に実在する', () => {
    const names = new Set(t.all.map((f) => f.name));
    for (const [k, list] of Object.entries(FOOD_ALIASES)) for (const n of list) expect(names.has(n), `${k} → ${n}`).toBe(true);
  });
  it('複数の語はすべて当たるものだけ(キャベツ 生)', () => {
    const hits = searchFoods('キャベツ 生', t);
    expect(hits[0]?.food.id).toBe('06061');
    for (const h of hits) expect(h.food.name.includes('生') || h.food.head.includes('生')).toBe(true);
  });
  it('小見出しでも引ける(いか 塩辛)', () => {
    const ids = searchFoods('いか 塩辛', t).map((h) => h.food.id);
    expect(ids).toContain('10358');
    expect(ids).not.toContain('10095');
  });
});

describe('価格の入力文字列', () => {
  it.each([
    ['420g 118円', { yen: 118, qty: 420, unit: 'g' }],
    ['118円 420g', { yen: 118, qty: 420, unit: 'g' }],
    ['118円420g', { yen: 118, qty: 420, unit: 'g' }],
    ['４２０ｇ　１１８円', { yen: 118, qty: 420, unit: 'g' }],
    ['420グラム 118円', { yen: 118, qty: 420, unit: 'g' }],
    ['4本 158円', { yen: 158, qty: 4, unit: '本' }],
    ['612g 6尾 538円', { yen: 538, qty: 6, unit: '尾', grams: 612 }],
    ['2.3kg 248円', { yen: 248, qty: 2.3, unit: 'kg' }],
    ['¥1,260 1500g', { yen: 1260, qty: 1500, unit: 'g' }],
    ['2パック 168円', { yen: 168, qty: 2, unit: 'パック' }],
  ])('%s', (text, expected) => {
    const r = parsePriceText(text);
    expect(r).toEqual({ ok: true, value: expected });
  });
  it.each(['118円', '420g', '118円 120円 420g', 'abc', '420 118円'])('読めないもの: %s', (text) => {
    expect(parsePriceText(text).ok).toBe(false);
  });
});
