// npm install のときに自動で実行され、git のフック置き場を .githooks/ に向ける。
// これで、リポジトリを別の PC に複製しても、コミット前チェック(check-private.mjs)が効く。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) {
  console.log('[setup-hooks] .git がないため、フックの設定を飛ばしました。');
  process.exit(0);
}
try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  console.log('[setup-hooks] core.hooksPath = .githooks を設定しました(コミット前チェックが有効)。');
} catch {
  console.error('[setup-hooks] git config に失敗しました。手動で `git config core.hooksPath .githooks` を実行してください。');
  process.exit(1);
}
