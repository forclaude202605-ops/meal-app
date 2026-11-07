"""日本食品標準成分表(八訂)増補2023年の公式Excelから、アプリ内蔵用のJSONを作る。

使い方: python3 -I build_food_db.py <本表xlsx> <脂肪酸成分表xlsx> <出力json>

値の扱い(公式の記号の意味に従う):
  数値          そのまま
  (数値)        推定値 -> 数値として扱う
  Tr / (Tr)     微量 -> 0 として扱う
  -             未測定 -> null (合計では0扱い、画面に「未測定あり」を出す)
"""
import json
import re
import sys
from collections import Counter

import openpyxl

SRC_MAIN, SRC_FA, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

# (キー, 本表の列番号) 列番号は0始まり。単位は NUTRIENTS 側で管理する。
MAIN_COLS = [
    ("kcal", 6), ("protein", 9), ("fat", 12), ("carb", 20), ("fiber", 18), ("salt", 60),
    ("chol", 11),
    ("na", 23), ("k", 24), ("ca", 25), ("mg", 26), ("p", 27), ("fe", 28), ("zn", 29),
    ("cu", 30), ("mn", 31), ("id", 33), ("se", 34), ("cr", 35), ("mo", 36),
    ("vita", 42), ("vitd", 43), ("vite", 44), ("vitk", 48),
    ("b1", 49), ("b2", 50), ("nia", 52), ("b6", 53), ("b12", 54), ("fol", 55),
    ("pan", 56), ("bio", 57), ("vitc", 58),
]
# 脂肪酸成分表(第1表)の列
FA_COLS = [("satfat", 8), ("n3", 11), ("n6", 12)]
# 出力する並び(配列の列順)。アプリ側もこの順を前提にする。
KEYS = [k for k, _ in MAIN_COLS] + [k for k, _ in FA_COLS]

stats = Counter()
bad_tokens = Counter()


def parse(v):
    """公式表記の1セルを (数値 or None) に変換する。"""
    if v is None:
        stats["empty"] += 1
        return None
    if isinstance(v, (int, float)):
        stats["num"] += 1
        return float(v)
    s = str(v).strip().replace("　", "").replace(" ", "").rstrip("†")  # †は脚注記号
    if s == "":
        stats["empty"] += 1
        return None
    if s in ("-", "*"):  # *は成分表上で値なし扱い(ヨウ素の3食品のみ)
        stats["unmeasured"] += 1
        return None
    paren = s.startswith("(") and s.endswith(")")
    if paren:
        s = s[1:-1]
        stats["estimated"] += 1
    if s == "Tr":
        stats["trace"] += 1
        return 0.0
    try:
        return float(s)
    except ValueError:
        bad_tokens[str(v)] += 1
        return None


def rows_of(path, first_data_row_pred):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["表全体"]
    for r in ws.iter_rows(values_only=True):
        if first_data_row_pred(r):
            yield r


is_food = lambda r: r[1] is not None and re.fullmatch(r"\d{5}", str(r[1]).strip()) is not None

fa = {}
for r in rows_of(SRC_FA, is_food):
    fa[str(r[1]).strip()] = [parse(r[c]) for _, c in FA_COLS]

foods = []
seen = set()
for r in rows_of(SRC_MAIN, is_food):
    fid = str(r[1]).strip()
    if fid in seen:
        raise SystemExit(f"duplicate food id {fid}")
    seen.add(fid)
    name = str(r[3]).replace("　", " ").strip()
    # 先頭の分類見出し(＜いも類＞ や （キャベツ類）)は検索の邪魔なので表示名から外す
    name = re.sub(r"^(＜[^＞]*＞\s*)?(（[^）]*類）\s*)?", "", name).strip() or str(r[3]).strip()
    group = str(r[0]).strip()
    refuse = parse(r[4])
    vals = [parse(r[c]) for _, c in MAIN_COLS]
    vals += fa.get(fid, [None] * len(FA_COLS))
    # 数値は小数第3位で丸めて容量を節約(元データは最大でも小数2位程度)
    vals = [None if v is None else round(v, 3) for v in vals]
    foods.append([fid, name, int(refuse or 0), vals])
    names_seen = globals().setdefault("names_seen", Counter())
    names_seen[name] += 1

out = {
    "source": "日本食品標準成分表（八訂）増補2023年 / 脂肪酸成分表編 (文部科学省)",
    "keys": KEYS,
    "foods": foods,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

print("foods:", len(foods), " fatty-acid rows:", len(fa), " matched:", sum(1 for x in foods if x[0] in fa))
print("cell stats:", dict(stats))
print("unparsed tokens:", dict(bad_tokens))
