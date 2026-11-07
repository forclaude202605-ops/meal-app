// 表示の整形のテスト。
import { describe, expect, it } from 'vitest';
import { fmtDateJa, fmtGrams, fmtQty, fmtYen, trimZeros } from '../src/app/format.ts';

describe('表示の整形', () => {
  it('末尾の0は小数点以下だけ外す(整数の0は外さない)', () => {
    expect(trimZeros('100')).toBe('100');
    expect(trimZeros('3.40')).toBe('3.4');
    expect(trimZeros('2.000')).toBe('2');
    expect(fmtQty(100)).toBe('100');
    expect(fmtQty(0.65)).toBe('0.65');
    expect(fmtQty(1 / 3)).toBe('0.333');
    expect(fmtQty(null)).toBe('(数量なし)');
    expect(fmtGrams(100)).toBe('100g');
    expect(fmtGrams(12)).toBe('12g');
    expect(fmtGrams(17.715)).toBe('17.7g');
    expect(fmtGrams(2.3333)).toBe('2.33g');
  });
  it('費用: 行は小数1位、合計は整数円', () => {
    expect(fmtYen((158 * 45) / 820, 'row')).toBe('8.7円');
    expect(fmtYen(108.87, 'total')).toBe('109円');
  });
  it('日付は曜日つき', () => {
    expect(fmtDateJa('2025-01-08')).toBe('1月8日(水)');
    expect(fmtDateJa('2025-01-08', true)).toBe('2025年1月8日(水)');
  });
});
