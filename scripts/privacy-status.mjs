// 個人データ保護の確認3点を実行し、結果をそのまま表示する(作業開始時・コミット前・報告時に使う)。
//   1. git check-ignore -v private/meal-app-samples-private.md … private/ を無視するルールが出る
//   2. git ls-files private                                   … 何も出ない
//   3. git status --short                                     … private/ が出ない
import { spawnSync } from 'node:child_process';

const checks = [
  ['check-ignore', ['check-ignore', '-v', 'private/meal-app-samples-private.md']],
  ['ls-files', ['ls-files', 'private']],
  ['status', ['status', '--short']],
];

const out = {};
for (const [key, args] of checks) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  out[key] = r.stdout;
  console.log(`$ git ${args.join(' ')}`);
  process.stdout.write(r.stdout || '(出力なし)\n');
  console.log();
}

const ok1 = /(^|:)private\/\s/.test(out['check-ignore']);
const ok2 = out['ls-files'].trim() === '';
const ok3 = !out.status.split('\n').some((l) => /(^|\s)"?private\//.test(l));
console.log(`判定: 1=${ok1 ? 'OK' : 'NG'} 2=${ok2 ? 'OK' : 'NG'} 3=${ok3 ? 'OK' : 'NG'}`);
process.exit(ok1 && ok2 && ok3 ? 0 : 1);
