// コミット前チェックの判定ルール(純関数。git を呼ばないのでテストできる)。
//
// 止める対象:
//   - private/ 以下のファイル(どの階層の private/ でも)
//   - *.seed.json、*backup*.json、*-private.md
//   - 仕様書 meal-app-prompt.md(実データの断片を含むため手元のみ)
//   - 中身がこのアプリのバックアップ形式に見える JSON(ファイル名に関係なく)。
//     ただし、架空データであることを示す "fictional": true を持つものは許可する。

/**
 * @param {string[]} paths ステージされたファイルのパス
 * @param {(path: string) => string | null} readText ステージされた中身を返す(読めなければ null)
 * @returns {[string, string][]} [パス, 理由] の一覧。空なら問題なし
 */
export function findProblems(paths, readText) {
  /** @type {[string, string][]} */
  const problems = [];
  for (const path of paths) {
    const p = path.replaceAll('\\', '/');
    const lower = (p.split('/').pop() ?? p).toLowerCase();
    if (p.split('/').some((seg) => seg.toLowerCase() === 'private')) problems.push([p, 'private/ 以下のファイル']);
    else if (lower.endsWith('.seed.json')) problems.push([p, '*.seed.json']);
    else if (lower.endsWith('.json') && lower.includes('backup')) problems.push([p, '*backup*.json']);
    else if (lower.endsWith('-private.md')) problems.push([p, '*-private.md']);
    else if (p.toLowerCase() === 'meal-app-prompt.md') problems.push([p, '仕様書(手元のみに置く)']);
    else if (lower.endsWith('.json')) {
      const text = readText(p);
      if (text !== null && looksLikeBackup(text)) {
        problems.push([p, '中身がバックアップ形式の JSON("fictional": true がない)']);
      }
    }
  }
  return problems;
}

/** @param {string} text */
export function looksLikeBackup(text) {
  // 大きな JSON(成分表など)も速く扱えるよう、まず先頭だけで当たりをつける
  if (!/"app"\s*:\s*"meal-app"/.test(text.slice(0, 4096))) return false;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.app === 'meal-app') {
      return obj.fictional !== true;
    }
  } catch {
    return true; // 壊れていても、バックアップの印があれば止める
  }
  return false;
}
