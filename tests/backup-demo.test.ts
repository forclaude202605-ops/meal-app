// バックアップ(書き出し → 読み込みで元に戻る、日付ごとのマージ)とデモデータのテスト。データはすべて架空。
import { describe, expect, it } from 'vitest';
import { computeDay, createContext } from '../src/core/calc.ts';
import { DEFAULT_SETTINGS } from '../src/core/types.ts';
import { backupFileName, buildBackup, mergeByDate, parseBackup, summarize, type AppData } from '../src/data/backup.ts';
import { demoData, DEMO_DAYS } from '../src/data/demo.ts';
import { foodTable } from './helpers.ts';

const foods = foodTable();
const demo = demoData(foods);

describe('バックアップ', () => {
  it('書き出して読み込むと、完全に元に戻る', () => {
    const b = buildBackup(demo, foods.versionInfo, new Date('2025-02-01T00:00:00Z'));
    const text = JSON.stringify(b);
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const back: AppData = { ingredients: parsed.backup.ingredients, prices: parsed.backup.prices, days: parsed.backup.days, settings: parsed.backup.settings };
    expect(back).toEqual({ ...demo, days: [...demo.days].sort((a, c) => (a.date < c.date ? -1 : 1)) });
    expect(parsed.backup.foodDbVersion).toEqual(foods.versionInfo);
    expect(parsed.backup.foodDbVersion.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('書き出しの形式: app, schema, exportedAt, foodDbVersion, ingredients, prices, days, settings(成分表本体は含めない)', () => {
    const b = buildBackup(demo, foods.versionInfo, new Date('2025-02-01T00:00:00Z'));
    expect(Object.keys(b).sort()).toEqual(['app', 'days', 'exportedAt', 'foodDbVersion', 'ingredients', 'prices', 'schema', 'settings']);
    expect(JSON.stringify(b).length).toBeLessThan(200_000);
  });

  it('ファイル名は *backup*.json(git の無視対象)', () => {
    expect(backupFileName('2025-02-01')).toBe('meal-app-backup-2025-02-01.json');
  });

  it('読めないもの・新しい schema・別アプリは断る', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"app":"other","schema":1}').ok).toBe(false);
    expect(parseBackup('{"app":"meal-app","schema":99,"ingredients":[],"prices":[],"days":[]}').ok).toBe(false);
    expect(parseBackup('{"app":"meal-app","schema":1,"ingredients":[],"prices":[],"days":[{"date":"2025-13-01","slots":{},"extras":[]}]}').ok).toBe(false);
  });

  it('読み込む前の確認用に、件数と日付の範囲を出す', () => {
    const s = summarize(demo);
    expect(s.days).toBe(DEMO_DAYS);
    expect(s.firstDate).toBe('2025-01-06');
    expect(s.lastDate).toBe('2025-01-19');
    expect(s.rows).toBeGreaterThan(100);
  });

  it('日付ごとにマージ: ファイルにある日付だけ置き換え、ほかは残す', () => {
    const current: AppData = {
      ingredients: demo.ingredients,
      prices: [],
      days: [
        { date: '2025-01-05', slots: {}, extras: [], memo: '残る' },
        { date: '2025-01-06', slots: {}, extras: [], memo: '置き換わる' },
      ],
      settings: { ...DEFAULT_SETTINGS, weekStartsOn: 0 },
    };
    const merged = mergeByDate(current, demo);
    expect(merged.days.find((d) => d.date === '2025-01-05')?.memo).toBe('残る');
    expect(merged.days.find((d) => d.date === '2025-01-06')?.memo).toBe(demo.days[0]?.memo);
    expect(merged.days).toHaveLength(DEMO_DAYS + 1);
    expect(merged.settings.weekStartsOn).toBe(0);
    expect(merged.prices).toHaveLength(demo.prices.length);
  });
});

describe('デモデータ', () => {
  const ctx = createContext(foods, demo.ingredients, demo.prices);
  const calcs = demo.days.map((d) => computeDay(ctx, d));

  it('2025年1月の14日分(実データの期間と重ならない)', () => {
    expect(demo.days[0]?.date).toBe('2025-01-06');
    expect(demo.days.every((d) => d.date.startsWith('2025-01'))).toBe(true);
  });

  it('食材の紐づけ先は、すべて成分表に実在する', () => {
    for (const i of demo.ingredients) if (i.source.kind === 'food') expect(foods.get(i.source.foodId), `${i.name} → ${i.source.foodId}`).toBeDefined();
  });

  it('警告の見え方を確かめるための行が、それぞれ1件以上ある', () => {
    const sum = (k: keyof (typeof calcs)[number]['counts']) => calcs.reduce((s, c) => s + c.counts[k], 0);
    expect(sum('unresolved')).toBe(1);
    expect(sum('noQty')).toBe(1);
    expect(sum('noUnit')).toBe(1);
    expect(sum('emptyRecipe')).toBe(1);
    expect(sum('noPrice')).toBeGreaterThanOrEqual(1);
    expect(sum('unmeasured')).toBeGreaterThan(0);
  });

  it('毎日のエネルギーと費用が、それらしい範囲に入る', () => {
    for (const c of calcs) {
      expect(c.total.nutrients.kcal).toBeGreaterThan(1000);
      expect(c.total.nutrients.kcal).toBeLessThan(3000);
      expect(c.total.cost).toBeGreaterThan(100);
      expect(c.total.cost).toBeLessThan(1500);
    }
  });
});
