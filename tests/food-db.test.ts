// 同梱する成分表データ(src/data/foods.json)の自己検証(仕様書 §7)。
// 期待値は、文部科学省の公式の値(可食部100gあたり)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KEY_INDEX } from '../src/core/nutrients.ts';
import { NUTRIENT_KEYS, type NutrientKey } from '../src/core/types.ts';
import { foodTable } from './helpers.ts';

const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/foods.json', import.meta.url)), 'utf8')) as {
  version: string;
  keys: string[];
  foods: unknown[][];
};

const val = (id: string, k: NutrientKey) => foodTable().get(id)?.values[KEY_INDEX[k]];

describe('成分表データ', () => {
  it('食品数 2,538 件、脂肪酸が結合できたもの 1,967 件、食品番号の重複なし', () => {
    const t = foodTable();
    expect(t.all).toHaveLength(2538);
    expect(new Set(t.all.map((f) => f.id)).size).toBe(2538);
    expect(t.all.filter((f) => f.values[KEY_INDEX.satfat] !== null).length).toBe(1967);
  });

  it('栄養素の並びがアプリの想定どおりで、廃棄率は含まない', () => {
    expect(raw.keys).toEqual([...NUTRIENT_KEYS]);
    expect(raw.keys).not.toContain('refuse');
    for (const f of raw.foods) {
      expect(f).toHaveLength(5); // [番号, 名前, 小見出し, 値, 100mLあたりの重さ]
      expect((f[3] as unknown[]).length).toBe(NUTRIENT_KEYS.length);
    }
    expect(raw.version).toMatch(/^mext-8th-2023-supp/);
  });

  it('版の情報: 使った Excel のファイル名・版の日付・SHA-256 を持つ', () => {
    const v = foodTable().versionInfo;
    expect(v.id).toBe(raw.version);
    expect(v.files.map((f) => f.role)).toEqual(['main', 'fattyAcid']);
    for (const f of v.files) {
      expect(f.name).toMatch(/\.xlsx$/);
      expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('表示名から分類見出しを外している', () => {
    for (const f of foodTable().all) expect(f.name).not.toMatch(/^[＜（]/);
    expect(foodTable().get('06061')?.name).toBe('キャベツ 結球葉 生');
    expect(foodTable().get('06061')?.head).toBe('キャベツ類');
  });

  it.each([
    ['06061', { kcal: 23, protein: 1.2, fat: 0.1, carb: 5.2, fiber: 1.8, na: 5, k: 190, ca: 42, mg: 14, p: 26, fe: 0.3, zn: 0.1, fol: 66, pan: 0.19, bio: 1.5, vitc: 38 }],
    ['12004', { kcal: 142, protein: 12.2, fat: 10.2, carb: 0.4, fiber: 0, salt: 0.4, vitd: 3.8 }],
    ['06153', { kcal: 33, protein: 1.0, fat: 0.1, carb: 8.4, fiber: 1.5 }],
    ['04032', { kcal: 73, protein: 7.0, fat: 4.9, carb: 1.5, fiber: 1.1 }],
    ['14001', { kcal: 894, protein: 0, fat: 100, carb: 0, fiber: 0 }],
    ['06212', { kcal: 35, protein: 0.7, fat: 0.2, carb: 9.3, fiber: 2.8 }],
  ] as [string, Partial<Record<NutrientKey, number>>][])('%s の値が公式の値と一致する', (id, expected) => {
    for (const [k, v] of Object.entries(expected) as [NutrientKey, number][]) expect(val(id, k)).toBe(v);
  });

  it('備考欄の容量換算(100 mL あたりの重さ)を取り込む', () => {
    // 公式の備考欄: こいくちしょうゆ「100 mL：118.1 g」、上白糖「100 mL：65 g」、精白米「100 mL：83 g」
    expect(foodTable().get('17007')?.gPer100mL).toBe(118.1);
    expect(foodTable().get('03003')?.gPer100mL).toBe(65);
    expect(foodTable().get('01083')?.gPer100mL).toBe(83);
    expect(foodTable().get('06061')?.gPer100mL).toBeNull();
  });

  it('にんじん(06212)のヨウ素・セレン・クロム・モリブデン・ビオチンは未測定(null)', () => {
    for (const k of ['id', 'se', 'cr', 'mo', 'bio'] as NutrientKey[]) expect(val('06212', k)).toBeNull();
  });

  it('記号の扱い: Tr は 0、推定値は数値、* は null', () => {
    // 01001 アマランサス 玄穀: 食塩相当量は 0(公式表記 0)
    expect(val('01001', 'salt')).toBe(0);
    // 値はすべて数値か null
    for (const f of foodTable().all) for (const v of f.values) expect(v === null || Number.isFinite(v)).toBe(true);
  });
});
