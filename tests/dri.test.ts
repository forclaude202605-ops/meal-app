// 食事摂取基準(2025年版)との比較のテスト。プロフィールは特定の人のものではなく、すべての区分と男女を順に試す。
import { describe, expect, it } from 'vitest';
import { zeroVec, type Vec } from '../src/core/calc.ts';
import { checkIntake, driProfile, summarizeChecks, type DriCheck } from '../src/core/dri.ts';
import { AGE_GROUPS, EER, NUTRIENT_DRI } from '../src/data/dri2025.ts';
import type { Profile } from '../src/core/types.ts';

const vec = (v: Partial<Vec>): Vec => ({ ...zeroVec(), ...v });
const ready = (p: Profile) => {
  const r = driProfile(p);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const find = (list: DriCheck[], id: string) => {
  const c = list.find((x) => x.id === id);
  if (!c) throw new Error(`${id} がない`);
  return c;
};

describe('プロフィールと年齢区分', () => {
  it('未設定や18歳未満は比較しない(理由を返す)', () => {
    expect(driProfile(undefined).ok).toBe(false);
    expect(driProfile({ sex: 'male', age: 49 }).ok).toBe(false);
    expect(driProfile({ sex: 'female', age: 17, activity: 2 })).toMatchObject({ ok: false, reason: expect.stringContaining('18歳以上') });
  });

  it('年齢区分の境目', () => {
    const cases: [number, number][] = [
      [18, 0], [29, 0], [30, 1], [49, 1], [50, 2], [64, 2], [65, 3], [74, 3], [75, 4], [99, 4],
    ];
    for (const [age, g] of cases) expect(ready({ sex: 'male', age, activity: 2 }).group, `${age}歳`).toBe(g);
    expect(AGE_GROUPS.map((g) => g.label)).toEqual(['18〜29歳', '30〜49歳', '50〜64歳', '65〜74歳', '75歳以上']);
  });
});

describe('報告書の表との照合(書き写しの確認。報告書のページを開いて確かめた値)', () => {
  it('推定エネルギー必要量(参考表2、p78)', () => {
    expect(EER.male[2]).toEqual([2600, 2750, 2650, 2350, 2250]);
    expect(EER.female[1]).toEqual([1700, 1750, 1700, 1650, 1450]);
    expect(EER.male[3][4]).toBeNull();
  });
  it('たんぱく質・食物繊維・食塩・カルシウム・鉄(p103, p144, p281, p283, p345)', () => {
    expect(NUTRIENT_DRI.protein.rda.male).toEqual([65, 65, 65, 60, 60]);
    expect(NUTRIENT_DRI.fiber.dgAtLeast.male).toEqual([20, 22, 22, 21, 20]);
    expect(NUTRIENT_DRI.salt.dgBelow.female[0]).toBe(6.5);
    expect(NUTRIENT_DRI.ca.rda.female).toEqual([650, 650, 650, 650, 600]);
    expect(NUTRIENT_DRI.fe.rda.male).toEqual([7.0, 7.5, 7.0, 7.0, 6.5]);
  });
});

describe('判定', () => {
  const m30 = ready({ sex: 'male', age: 30, activity: 2 });

  it('推奨量のある栄養素: 推定平均必要量未満 → 不足のおそれ、推奨量未満 → 少ない、推奨量以上 → 満たす', () => {
    expect(find(checkIntake(vec({ protein: 40, kcal: 2000 }), m30), 'protein').status).toBe('deficit');
    expect(find(checkIntake(vec({ protein: 55, kcal: 2000 }), m30), 'protein').status).toBe('low');
    const ok = find(checkIntake(vec({ protein: 78, kcal: 2000 }), m30), 'protein');
    expect(ok.status).toBe('ok');
    expect(ok.kind).toBe('推奨量');
    expect(ok.ratio).toBeCloseTo(78 / 65, 12);
  });

  it('目安量だけの栄養素は「目安量未満」(不足かどうかは判断しない)', () => {
    const c = find(checkIntake(vec({ vitd: 4, kcal: 2000 }), m30), 'vitd');
    expect(c).toMatchObject({ kind: '目安量', status: 'below-ai' });
  });

  it('目標量: 食物繊維は「以上」、食塩相当量は「未満」', () => {
    expect(find(checkIntake(vec({ fiber: 15, kcal: 2000 }), m30), 'fiber').status).toBe('low');
    expect(find(checkIntake(vec({ fiber: 25, kcal: 2000 }), m30), 'fiber').status).toBe('ok');
    expect(find(checkIntake(vec({ salt: 7.5, kcal: 2000 }), m30), 'salt').status).toBe('high');
    expect(find(checkIntake(vec({ salt: 7.4, kcal: 2000 }), m30), 'salt').status).toBe('ok');
  });

  it('耐容上限量: 食事全体に対するものだけ比べる(マグネシウム・葉酸・ナイアシンは比べない)', () => {
    expect(find(checkIntake(vec({ ca: 2600, kcal: 2000 }), m30), 'ca').status).toBe('over-ul');
    const mg = find(checkIntake(vec({ mg: 900, kcal: 2000 }), m30), 'mg');
    expect(mg.status).toBe('ok');
    expect(mg.notes.join()).toContain('比べない');
    expect(find(checkIntake(vec({ fol: 1500, kcal: 2000 }), m30), 'fol').status).toBe('ok');
  });

  it('エネルギー産生栄養素バランス: 分母は総エネルギー', () => {
    const list = checkIntake(vec({ kcal: 2000, protein: 80, fat: 50, carb: 300, satfat: 20 }), m30);
    expect(find(list, 'pct-protein').value).toBeCloseTo((80 * 4 * 100) / 2000, 12);
    expect(find(list, 'pct-protein').status).toBe('ok');
    expect(find(list, 'pct-fat').value).toBeCloseTo((50 * 9 * 100) / 2000, 12);
    expect(find(list, 'pct-satfat').status).toBe('high');
    expect(find(list, 'pct-carb').value).toBeCloseTo(60, 12);
  });

  it('エネルギーは推定エネルギー必要量との比(参考)。体重があれば体重1kg当たりの値からの参考も出す', () => {
    const c = find(checkIntake(vec({ kcal: 2200 }), m30, { weightKg: 60 }), 'kcal');
    expect(c.ratio).toBeCloseTo(2200 / 2750, 12);
    expect(c.status).toBe('low');
    expect(c.notes.join()).toContain('60 kg × 39.4 kcal/kg');
    // 75歳以上の「高い」は設定なし
    const old = ready({ sex: 'female', age: 75, activity: 3 });
    expect(find(checkIntake(vec({ kcal: 1500 }), old), 'kcal').status).toBe('info');
  });

  it('鉄: 女性 18〜64歳は月経の有無で基準が違い、未設定なら比べない', () => {
    const none = find(checkIntake(vec({ fe: 8, kcal: 1800 }), ready({ sex: 'female', age: 49, activity: 2 })), 'fe');
    expect(none.status).toBe('info');
    const yes = find(checkIntake(vec({ fe: 8, kcal: 1800 }), ready({ sex: 'female', age: 49, activity: 2, menstruation: true })), 'fe');
    expect(yes).toMatchObject({ target: 10.5, status: 'low' });
    const no = find(checkIntake(vec({ fe: 8, kcal: 1800 }), ready({ sex: 'female', age: 49, activity: 2, menstruation: false })), 'fe');
    expect(no).toMatchObject({ target: 6.0, status: 'ok' });
    // 65歳以上は月経の有無を使わない
    expect(find(checkIntake(vec({ fe: 8, kcal: 1800 }), ready({ sex: 'female', age: 65, activity: 2 })), 'fe').target).toBe(6.0);
  });

  it('どの区分・男女でも、主な項目を先に、すべての項目を返す。件数をまとめられる', () => {
    for (const sex of ['male', 'female'] as const) {
      for (const g of AGE_GROUPS) {
        for (const activity of [1, 2, 3] as const) {
          const list = checkIntake(vec({ kcal: 1800, protein: 60, fat: 50, carb: 250 }), ready({ sex, age: g.min, activity, menstruation: false }));
          expect(list[0]?.id).toBe('kcal');
          expect(list.map((c) => c.id)).toEqual(expect.arrayContaining(['protein', 'fiber', 'salt', 'ca', 'fe', 'vitc', 'n3']));
          const counts = summarizeChecks(list);
          expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(list.length);
        }
      }
    }
  });
});
