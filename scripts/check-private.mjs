// コミット前チェック: ステージされたファイルに個人データが含まれていないかを調べる。
// .githooks/pre-commit から呼ばれる。含まれていれば終了コード 1 でコミットを止める。
// 判定ルールは private-rules.mjs を参照。
import { execFileSync } from 'node:child_process';
import { findProblems } from './private-rules.mjs';

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const staged = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT'])
  .split('\0')
  .filter(Boolean);

const problems = findProblems(staged, (p) => {
  try {
    return git(['show', `:${p}`]);
  } catch {
    return null;
  }
});

if (problems.length > 0) {
  console.error('\n[check-private] 個人データの可能性があるファイルがステージされています。コミットを中止しました。\n');
  for (const [p, why] of problems) console.error(`  - ${p}  (${why})`);
  console.error('\n  外すには: git restore --staged <ファイル>(最初のコミットの前は git rm --cached <ファイル>)\n');
  process.exit(1);
}
console.log(`[check-private] OK: ステージされた ${staged.length} 件に個人データのファイルは含まれていません。`);
