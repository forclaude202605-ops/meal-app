# meal-app — 自分用の食事管理 PWA

食事・体重・食費を iPhone で記録し、栄養と費用を**プログラムで決定的に**計算する、個人用の PWA です。
サーバーを持たず、データは端末内(IndexedDB)にだけ保存します。実行時に外部へ通信しません。

> このリポジトリには個人データ(食事・体重・購入履歴)を一切含めません。
> テストとデモのデータは、すべて架空の値です。

## ① ホーム画面に追加する手順(iPhone)

(M2 で追記します)

## ② バックアップと復元

(M2 で追記します)

## ③ データを更新する手順

### 食品成分表

`src/data/foods.json` は、文部科学省「日本食品標準成分表(八訂)増補2023年」本表と「脂肪酸成分表編」第1表の公式 Excel から作ります。アプリはこの JSON をビルド時に同梱し、実行時に取得しません。

1. 文部科学省のページ <https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html> から、次の2つの Excel を取得し、`.cache/mext/` に置く(`.cache/` は git 管理外)。
   - 本表「第2章(データ)」(現行: `20260327-mxt_kagsei-mext-000029402_02.xlsx`、2026-03-27 の正誤を反映済み)
   - 脂肪酸成分表編「第2章第1表(データ)」(現行: `20260327-mxt_kagsei-mext-000029402_09.xlsx`)
2. 変換する。

   ```bash
   node scripts/build-food-db.mjs .cache/mext/<本表>.xlsx .cache/mext/<脂肪酸第1表>.xlsx src/data/foods.json --version mext-8th-2023-supp-YYYYMMDD --retrieved YYYY-MM-DD
   ```

   最後に、食品数・脂肪酸の結合数・セルの内訳・パースできなかった文字列(0 件であること)を表示します。`--compare <前のJSON>` を付けると、前の版との差分を一覧にします。
3. `npm test` で、公式の値との照合(キャベツ 06061 など)が通ることを確かめる。
4. 成分表を差し替えると、過去の日の集計も変わります。アプリでは自動で差し替えず、影響を受ける日数を見せて確認してから切り替えます(M2 以降)。

`reference/` の2ファイル(`build_food_db.py` と `foods.reference.json`)は、**2023-04-28 版**の本表(`20230428-mxt_kagsei-mext_00001_012.xlsx`)から作った**照合用の参照データ**です。取り込み処理が正しいことを確かめるために残しています(アプリでは使いません)。2023-04-28 版の本表で変換して `--compare reference/foods.reference.json` を付けると、値の差が 0 件になることを確認済みです(差は、廃棄率を取り込まないことと、食品名の空白の整え方だけ)。

変換の規則: 推定値 `(数値)` は数値、`Tr`・`(Tr)` は 0、`-`(未測定)と `*` は null、脚注 `†` は取り除く。廃棄率は取り込まない(入力したグラム数は食べた重さとして扱う)。食品名の先頭の分類見出し(`＜いも類＞`、`（キャベツ類）`)は表示名から外し、（…）の小見出しは食品を見分けるために別の欄に残す。備考欄の「100 mL：○ g」は、大さじ・小さじの重さ換算の出典として取り込む。

出典: 「日本食品標準成分表（八訂）増補2023年」(文部科学省)から引用。本アプリの成分値は同データを加工(記号の数値化、食品名の整形など)して作成したもので、文部科学省が内容を保証するものではありません。

## ④ 開発の手順

必要なもの: Node.js 24 以上、git。

```bash
npm install          # 依存の導入。あわせてコミット前フックを設定する
npm test             # 計算コアのテスト(CI なしで一発)
npm run check        # 型チェック + lint + テスト
npm run dev          # 開発サーバー
```

### 個人データを守る仕組み

- `.gitignore` で `private/`、`*.seed.json`、`*backup*.json`、`*-private.md`、仕様書 `meal-app-prompt.md` を無視します。
- **コミット前チェック**: `scripts/check-private.mjs` が、ステージされたファイルに上記や「中身がバックアップ形式の JSON」が含まれていないかを調べ、含まれていればコミットを止めます。
  - フックは `.githooks/pre-commit` にあり、`npm install` のとき `scripts/setup-hooks.mjs` が `git config core.hooksPath .githooks` を設定します。
  - 別の PC に複製したときも、`npm install` を一度実行すれば有効になります。手動で設定するなら次のとおりです。

    ```bash
    git config core.hooksPath .githooks
    ```

  - 単独で実行するには `npm run check:private`。
- 確認3点(`private/` が無視されているか、追跡されていないか、`git status` に出ないか)は `npm run privacy:status` で一度に実行できます。
- `private/` の中身はリポジトリに含まれないので、別の PC では自分でコピーします。
