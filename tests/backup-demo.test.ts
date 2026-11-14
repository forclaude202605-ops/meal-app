// バックアップ(schema 2: 日ごとのテキスト・補足・食材マスタ・設定)とデモのテスト。データはすべて架空。
import { describe, expect, it } from 'vitest';
import { buildJournal, mergeProblems } from '../src/core/parse/journal.ts';
import { analyzePaste, pastedTexts } from '../src/core/parse/paste.ts';
import { DEFAULT_SETTINGS, type LineAnswer } from '../src/core/types.ts';
import { backupFileName, buildBackup, mergeByDate, parseBackup, SCHEMA, summarize, type AppData } from '../src/data/backup.ts';
import { defaultIngredients } from '../src/data/defaultIngredients.ts';
import { DEMO_DAYS, demoIngredients, demoPasteText } from '../src/data/demo.ts';
import { foodTable } from './helpers.ts';

const foods = foodTable();
const demoTexts = pastedTexts(analyzePaste(demoPasteText(), { today: '2025-03-10', saved: [] }), {}, '2025-02-01T00:00:00.000Z');
const answer: LineAnswer = { id: 'meal|2025-01-10|昼|しょうゆ|0|0', kind: 'meal', date: '2025-01-10', lineKey: '昼|しょうゆ', occurrence: 0, item: 0, value: { type: 'qty', qty: 0.5, unit: '小さじ' }, answeredAt: '2025-02-01T00:00:00.000Z' };
const demo: AppData = { ingredients: [...defaultIngredients(foods), ...demoIngredients()], texts: demoTexts, answers: [answer], settings: { ...DEFAULT_SETTINGS } };

describe('バックアップ', () => {
  it('書き出して読み込むと、完全に元に戻る', () => {
    const b = buildBackup(demo, foods.versionInfo, new Date('2025-02-01T00:00:00Z'));
    const parsed = parseBackup(JSON.stringify(b));
    if (!parsed.ok) throw new Error(parsed.error);
    const back: AppData = { ingredients: parsed.backup.ingredients, texts: parsed.backup.texts, answers: parsed.backup.answers, settings: parsed.backup.settings };
    const byId = <T extends { id: string }>(l: T[]) => [...l].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(back).toEqual({ ...demo, texts: byId(demo.texts), answers: byId(demo.answers) });
    expect(parsed.backup.foodDbVersion).toEqual(foods.versionInfo);
    expect(parsed.migratedFrom).toBeNull();
  });

  it('書き出しの形式: app, schema 2, exportedAt, foodDbVersion, texts, answers, ingredients, settings(成分表本体は含めない)', () => {
    const b = buildBackup(demo, foods.versionInfo, new Date('2025-02-01T00:00:00Z'));
    expect(SCHEMA).toBe(2);
    expect(Object.keys(b).sort()).toEqual(['answers', 'app', 'exportedAt', 'foodDbVersion', 'ingredients', 'schema', 'settings', 'texts']);
    expect(JSON.stringify(b).length).toBeLessThan(200_000);
  });

  it('ファイル名は *backup*.json(git の無視対象)', () => {
    expect(backupFileName('2025-02-01')).toBe('meal-app-backup-2025-02-01.json');
  });

  it('読めないもの・新しい schema・別アプリ・形の崩れたものは断る', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"app":"other","schema":2}').ok).toBe(false);
    expect(parseBackup('{"app":"meal-app","schema":99,"ingredients":[],"texts":[],"answers":[]}').ok).toBe(false);
    expect(parseBackup('{"app":"meal-app","schema":2,"ingredients":[],"texts":[{"id":"meal:2025-13-01","kind":"meal","date":"2025-13-01","text":""}],"answers":[]}').ok).toBe(false);
    expect(parseBackup('{"app":"meal-app","schema":2,"ingredients":[],"texts":[{"id":"x","kind":"meal","date":"2025-01-01","text":""}],"answers":[]}').ok).toBe(false);
  });

  it('schema 1(旧形式)は、食材マスタと設定だけを読み込み、日と価格の件数を知らせる', () => {
    const v1 = { app: 'meal-app', schema: 1, exportedAt: '', foodDbVersion: foods.versionInfo, ingredients: demoIngredients(), prices: [{}, {}], days: [{}, {}, {}], settings: { weekStartsOn: 0 } };
    const r = parseBackup(JSON.stringify(v1));
    if (!r.ok) throw new Error(r.error);
    expect(r.migratedFrom).toBe(1);
    expect(r.dropped).toEqual({ days: 3, prices: 2 });
    expect(r.backup.texts).toEqual([]);
    expect(r.backup.ingredients).toHaveLength(demoIngredients().length);
    expect(r.backup.settings.weekStartsOn).toBe(0);
  });

  it('読み込む前の確認用に、日数・行数・日付の範囲を出す', () => {
    const s = summarize(demo);
    expect(s.mealDays).toBe(DEMO_DAYS);
    expect(s.purchaseDays).toBe(3);
    expect(s.firstDate).toBe('2024-12-28');
    expect(s.lastDate).toBe('2025-01-19');
    expect(s.answers).toBe(1);
  });

  it('日付ごとにマージ: ファイルにある日(と、その日の答え)だけ置き換え、ほかは残す', () => {
    const current: AppData = {
      ingredients: defaultIngredients(foods),
      texts: [
        { id: 'meal:2025-01-05', kind: 'meal', date: '2025-01-05', text: '残る', updatedAt: '' },
        { id: 'meal:2025-01-10', kind: 'meal', date: '2025-01-10', text: '置き換わる', updatedAt: '' },
      ],
      answers: [{ ...answer, id: 'meal|2025-01-10|昼|古い|0|0', lineKey: '昼|古い' }],
      settings: { ...DEFAULT_SETTINGS, weekStartsOn: 0 },
    };
    const merged = mergeByDate(current, demo);
    expect(merged.texts.find((t) => t.date === '2025-01-05')?.text).toBe('残る');
    expect(merged.texts.find((t) => t.id === 'meal:2025-01-10')?.text).toBe(demo.texts.find((t) => t.id === 'meal:2025-01-10')?.text);
    expect(merged.texts).toHaveLength(demo.texts.length + 1);
    expect(merged.answers.map((a) => a.id)).toEqual([answer.id]);
    expect(merged.settings.weekStartsOn).toBe(0);
  });
});

describe('デモ', () => {
  const j = buildJournal({ foods, ingredients: demo.ingredients, texts: demo.texts, answers: [] });

  it('2025年1月の14日分の献立と、3日分の食材費(実データの期間と重ならない)', () => {
    expect(j.meals).toHaveLength(DEMO_DAYS);
    expect(j.meals[0]?.date).toBe('2025-01-06');
    expect(j.meals.every((m) => m.date.startsWith('2025-01'))).toBe(true);
    expect(j.purchases.map((p) => p.date)).toEqual(['2024-12-28', '2025-01-04', '2025-01-11']);
  });

  it('食材の紐づけ先は、すべて成分表に実在する', () => {
    for (const i of demoIngredients()) if (i.source.kind === 'food') expect(foods.get(i.source.foodId), `${i.name} → ${i.source.foodId}`).toBeDefined();
  });

  it('問題の見え方を確かめるための行が、それぞれある', () => {
    const all = mergeProblems(j.meals.flatMap((m) => m.problems));
    const types = all.map((p) => (p.type === 'calc' ? `calc:${p.issue}` : p.type));
    expect(types).toEqual(expect.arrayContaining(['assign', 'note', 'unit', 'qty', 'calc:empty-recipe', 'calc:no-price']));
    expect(all.filter((p) => p.type === 'qty').map((p) => (p.type === 'qty' ? p.state : ''))).toEqual(expect.arrayContaining(['none', 'vague', 'unit-only']));
    // 料理名の推測、その場での定義、同価格、単価メモ、日照のビタミンD、体重
    const lines = j.meals.flatMap((m) => m.lines);
    expect(lines.some((l) => l.type === 'title' && l.guess)).toBe(true);
    expect(lines.some((l) => l.items?.some((i) => i.via === 'def'))).toBe(true);
    expect(lines.some((l) => l.items?.some((i) => i.same?.ingredientId === 'demo-niboshi'))).toBe(true);
    expect(j.prices.some((p) => p.source === 'inline' && p.ingredientId === 'demo-pork')).toBe(true);
    expect(j.meals.filter((m) => m.day.extras.length > 0).length).toBeGreaterThan(0);
    expect(j.meals.filter((m) => m.day.weightKg !== undefined).length).toBe(11);
  });

  it('毎日のエネルギーと費用が、それらしい範囲に入る', () => {
    for (const m of j.meals) {
      expect(m.calc.total.nutrients.kcal).toBeGreaterThan(1000);
      expect(m.calc.total.nutrients.kcal).toBeLessThan(3000);
      expect(m.calc.total.cost).toBeGreaterThan(100);
      expect(m.calc.total.cost).toBeLessThan(1500);
    }
  });
});
