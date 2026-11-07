import { describe, expect, it } from 'vitest';
import { findProblems, looksLikeBackup } from '../scripts/private-rules.mjs';

const none = () => null;

describe('コミット前チェックの判定', () => {
  it('private/ 以下は、どの階層でも止める', () => {
    const r = findProblems(['private/notes/a.txt', 'sub/private/x.md', 'Private/y.txt'], none);
    expect(r.map(([p]) => p)).toEqual(['private/notes/a.txt', 'sub/private/x.md', 'Private/y.txt']);
  });

  it('seed・backup・-private.md・仕様書を止める', () => {
    const r = findProblems(
      ['private.seed.json', 'x/my.seed.json', 'meal-app-backup-2025-01-02.json', 'Backup.JSON', 'memo-private.md', 'meal-app-prompt.md'],
      none,
    );
    expect(r).toHaveLength(6);
  });

  it('名前に関係なく、中身がバックアップ形式の JSON は止める', () => {
    const text = JSON.stringify({ app: 'meal-app', schema: 1, days: [] });
    expect(findProblems(['data/export.json'], () => text)).toHaveLength(1);
  });

  it('"fictional": true の架空データは通す', () => {
    const text = JSON.stringify({ app: 'meal-app', schema: 1, fictional: true, days: [] });
    expect(findProblems(['fixtures/demo.json'], () => text)).toEqual([]);
  });

  it('ふつうのファイルは通す', () => {
    const r = findProblems(['src/core/nutrition.ts', 'src/data/foods.json', 'README.md', 'privacy.md'], () => '{"keys":[]}');
    expect(r).toEqual([]);
  });

  it('壊れた JSON でもバックアップの印があれば止める', () => {
    expect(looksLikeBackup('{"app":"meal-app","days":[')).toBe(true);
    expect(looksLikeBackup('{"app":"other"}')).toBe(false);
  });
});
