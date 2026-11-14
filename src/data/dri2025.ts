// 日本人の食事摂取基準(2025年版)の、成人(18歳以上)の値(仕様書 §9)。
// 数値は厚生労働省の報告書(PDF)の表から写したもの。記憶や他サイトの値は使っていない。
// 報告書の PDF は文字の情報を持たない形式のため、各表のページを画像にして読み、1表ずつ写した(ページは下の source)。
// 正誤表(令和7年3月25日)は、ここで使う成人の値を変えていない(HP 上の PDF は正誤を反映済み)。
// 妊婦・授乳婦の付加量と、18歳未満の値は入れていない(持ち主と合意)。

export const DRI_SOURCE = {
  title: '「日本人の食事摂取基準（2025年版）」策定検討会報告書',
  publisher: '厚生労働省',
  url: 'https://www.mhlw.go.jp/stf/newpage_44138.html',
  pageDate: '令和6年10月11日(最終更新 令和7年3月25日。正誤表を反映)',
  retrieved: '2026-11-15',
  files: [
    { part: 'エネルギー', url: 'https://www.mhlw.go.jp/content/10904750/001316461.pdf' },
    { part: 'たんぱく質', url: 'https://www.mhlw.go.jp/content/10904750/001316462.pdf' },
    { part: '脂質', url: 'https://www.mhlw.go.jp/content/10904750/001316463.pdf' },
    { part: '炭水化物', url: 'https://www.mhlw.go.jp/content/10904750/001316464.pdf' },
    { part: 'エネルギー産生栄養素バランス', url: 'https://www.mhlw.go.jp/content/10904750/001316465.pdf' },
    { part: 'ビタミン(脂溶性)', url: 'https://www.mhlw.go.jp/content/10904750/001316466.pdf' },
    { part: 'ビタミン(水溶性)', url: 'https://www.mhlw.go.jp/content/10904750/001316467.pdf' },
    { part: 'ミネラル(多量)', url: 'https://www.mhlw.go.jp/content/10904750/001316468.pdf' },
    { part: 'ミネラル(微量)', url: 'https://www.mhlw.go.jp/content/10904750/001316469.pdf' },
    { part: '正誤表(令和7年3月25日)', url: 'https://www.mhlw.go.jp/content/10904750/001316480.pdf' },
  ],
} as const;

/** 年齢区分(成人) */
export const AGE_GROUPS = [
  { id: '18-29', label: '18〜29歳', min: 18, max: 29 },
  { id: '30-49', label: '30〜49歳', min: 30, max: 49 },
  { id: '50-64', label: '50〜64歳', min: 50, max: 64 },
  { id: '65-74', label: '65〜74歳', min: 65, max: 74 },
  { id: '75+', label: '75歳以上', min: 75, max: 200 },
] as const;

/** 年齢区分ごとの値(18-29, 30-49, 50-64, 65-74, 75+)。null = 設定なし */
export type Five = readonly [number | null, number | null, number | null, number | null, number | null];
export type Sex = 'male' | 'female';
type BySex = Readonly<Record<Sex, Five>>;

const all = (x: number): Five => [x, x, x, x, x];
const same = (v: Five): BySex => ({ male: v, female: v });

/** 推定エネルギー必要量(kcal/日)。参考表2。身体活動レベル 1=低い 2=ふつう 3=高い。報告書 p78 */
export const EER: Readonly<Record<Sex, Readonly<Record<1 | 2 | 3, Five>>>> = {
  male: { 1: [2250, 2350, 2250, 2100, 1850], 2: [2600, 2750, 2650, 2350, 2250], 3: [3000, 3150, 3000, 2650, null] },
  female: { 1: [1700, 1750, 1700, 1650, 1450], 2: [1950, 2050, 1950, 1850, 1750], 3: [2250, 2350, 2250, 2050, null] },
};

/** 体重1kg当たりの推定エネルギー必要量(kcal/kg/日)。参考表1。報告書 p77 */
export const EER_PER_KG: Readonly<Record<Sex, Readonly<Record<1 | 2 | 3, Five>>>> = {
  male: { 1: [35.6, 33.8, 32.7, 32.4, 30.1], 2: [41.5, 39.4, 38.2, 36.7, 36.6], 3: [47.4, 45.0, 43.6, 41.0, null] },
  female: { 1: [33.2, 32.9, 31.1, 31.1, 29.0], 2: [38.7, 38.3, 36.2, 35.2, 35.2], 3: [44.2, 43.8, 41.4, 39.3, null] },
};

/** エネルギー産生栄養素バランスの目標量(%エネルギー)。男女同じ。報告書 p149(たんぱく質 p103、脂質 p126・127、炭水化物 p143) */
export const ENERGY_BALANCE = {
  protein: [
    [13, 20],
    [13, 20],
    [14, 20],
    [15, 20],
    [15, 20],
  ],
  fat: [
    [20, 30],
    [20, 30],
    [20, 30],
    [20, 30],
    [20, 30],
  ],
  /** 飽和脂肪酸: 7 %エネルギー以下 */
  satfatMax: [7, 7, 7, 7, 7],
  carb: [
    [50, 65],
    [50, 65],
    [50, 65],
    [50, 65],
    [50, 65],
  ],
} as const;

export interface NutrientDri {
  /** 推定平均必要量 */
  ear?: BySex;
  /** 推奨量 */
  rda?: BySex;
  /** 目安量 */
  ai?: BySex;
  /** 耐容上限量 */
  ul?: BySex;
  /**
   * 上限量の対象: total = 食事全体 / nonfood = 通常の食品以外(サプリなど)からの摂取だけ /
   * preformed = プロビタミンAカロテノイドを含まない量(成分表の RAE はカロテン由来を含むため、そのまま比べない)
   */
  ulScope?: 'total' | 'nonfood' | 'preformed';
  ulNote?: string;
  /** 目標量「〜以上」 */
  dgAtLeast?: BySex;
  /** 目標量「〜未満」 */
  dgBelow?: BySex;
  /** 報告書のページ */
  page: number;
  note?: string;
}

/** 成分表の栄養素ごとの基準(エネルギーと %エネルギーの目標量は上の別の表)。キーは NutrientKey */
export const NUTRIENT_DRI = {
  protein: { ear: { male: all(50), female: all(40) }, rda: { male: [65, 65, 65, 60, 60], female: all(50) }, page: 103 },
  n6: { ai: { male: [12, 11, 11, 10, 9], female: [9, 9, 9, 9, 8] }, page: 128 },
  n3: { ai: { male: [2.2, 2.2, 2.3, 2.3, 2.3], female: [1.7, 1.7, 1.9, 2.0, 2.0] }, page: 128 },
  fiber: { dgAtLeast: { male: [20, 22, 22, 21, 20], female: [18, 18, 18, 18, 17] }, page: 144 },
  vita: {
    ear: { male: [600, 650, 650, 600, 550], female: [450, 500, 500, 500, 450] },
    rda: { male: [850, 900, 900, 850, 800], female: [650, 700, 700, 700, 650] },
    ul: same(all(2700)),
    ulScope: 'preformed',
    ulNote: '上限量はプロビタミンAカロテノイドを含まない量に対する値',
    page: 181,
  },
  vitd: { ai: same(all(9.0)), ul: same(all(100)), ulScope: 'total', page: 182, note: '日照により皮膚でも作られる' },
  vite: { ai: { male: [6.5, 6.5, 6.5, 7.5, 7.0], female: [5.0, 6.0, 6.0, 7.0, 6.0] }, ul: { male: all(800), female: [650, 700, 700, 700, 650] }, ulScope: 'total', page: 183, note: 'α-トコフェロール' },
  vitk: { ai: same(all(150)), page: 184 },
  b1: { ear: { male: [0.8, 0.8, 0.8, 0.7, 0.7], female: [0.6, 0.6, 0.6, 0.6, 0.5] }, rda: { male: [1.1, 1.2, 1.1, 1.0, 1.0], female: [0.8, 0.9, 0.8, 0.8, 0.7] }, page: 234, note: 'チアミン塩化物塩酸塩相当量' },
  b2: { ear: { male: [1.3, 1.4, 1.3, 1.2, 1.1], female: [1.0, 1.0, 1.0, 0.9, 0.9] }, rda: { male: [1.6, 1.7, 1.6, 1.4, 1.4], female: [1.2, 1.2, 1.2, 1.1, 1.1] }, page: 235 },
  nia: {
    ear: { male: [13, 13, 13, 11, 11], female: [9, 10, 9, 9, 8] },
    rda: { male: [15, 16, 15, 14, 13], female: [11, 12, 11, 11, 10] },
    ul: { male: [300, 350, 350, 300, 300], female: [250, 250, 250, 250, 250] },
    ulScope: 'nonfood',
    ulNote: '上限量はニコチンアミドの重量(サプリなどの形)に対する値',
    page: 236,
    note: 'ナイアシン当量',
  },
  b6: { ear: { male: all(1.2), female: all(1.0) }, rda: { male: [1.5, 1.5, 1.5, 1.4, 1.4], female: all(1.2) }, ul: { male: [55, 60, 60, 55, 50], female: [45, 45, 45, 45, 40] }, ulScope: 'total', page: 237, ulNote: '上限量はピリドキシン相当量' },
  b12: { ai: same(all(4.0)), page: 238 },
  fol: { ear: same(all(200)), rda: same(all(240)), ul: same([900, 1000, 1000, 900, 900]), ulScope: 'nonfood', ulNote: '上限量は通常の食品以外の食品に含まれる葉酸に対する値', page: 239 },
  pan: { ai: { male: all(6), female: all(5) }, page: 240 },
  bio: { ai: same(all(50)), page: 241 },
  vitc: { ear: same(all(80)), rda: same(all(100)), page: 242 },
  salt: { dgBelow: { male: all(7.5), female: all(6.5) }, page: 281, note: '高血圧と慢性腎臓病の重症化予防のためには 6.0 g/日未満' },
  k: { ai: { male: all(2500), female: all(2000) }, dgAtLeast: { male: all(3000), female: all(2600) }, page: 282 },
  ca: {
    ear: { male: [650, 650, 600, 600, 600], female: [550, 550, 550, 550, 500] },
    rda: { male: [800, 750, 750, 750, 750], female: [650, 650, 650, 650, 600] },
    ul: same(all(2500)),
    ulScope: 'total',
    page: 283,
  },
  mg: {
    ear: { male: [280, 320, 310, 290, 270], female: [230, 240, 240, 240, 220] },
    rda: { male: [340, 380, 370, 350, 330], female: [280, 290, 290, 280, 270] },
    ul: same(all(350)),
    ulScope: 'nonfood',
    ulNote: '上限量は通常の食品以外からの摂取量に対する値(通常の食品からは設定なし)',
    page: 284,
  },
  p: { ai: { male: all(1000), female: all(800) }, ul: same(all(3000)), ulScope: 'total', page: 285 },
  // 鉄: 女性 18〜64歳は月経の有無で違う(月経ありは IRON_MENSTRUATING)。成人の上限量は設定なし
  fe: { ear: { male: [5.5, 6.0, 6.0, 5.5, 5.5], female: [5.0, 5.0, 5.0, 5.0, 4.5] }, rda: { male: [7.0, 7.5, 7.0, 7.0, 6.5], female: [6.0, 6.0, 6.0, 6.0, 5.5] }, page: 345 },
  zn: { ear: { male: [7.5, 8.0, 8.0, 7.5, 7.5], female: [6.0, 6.5, 6.5, 6.5, 6.0] }, rda: { male: [9.0, 9.5, 9.5, 9.0, 9.0], female: [7.5, 8.0, 8.0, 7.5, 7.0] }, ul: { male: [40, 45, 45, 45, 40], female: all(35) }, ulScope: 'total', page: 346 },
  cu: { ear: { male: [0.7, 0.8, 0.7, 0.7, 0.7], female: all(0.6) }, rda: { male: [0.8, 0.9, 0.9, 0.8, 0.8], female: all(0.7) }, ul: same(all(7)), ulScope: 'total', page: 347 },
  mn: { ai: { male: all(3.5), female: all(3.0) }, ul: same(all(11)), ulScope: 'total', page: 348 },
  id: { ear: same(all(100)), rda: same(all(140)), ul: same(all(3000)), ulScope: 'total', page: 349 },
  se: { ear: { male: all(25), female: all(20) }, rda: { male: [30, 35, 30, 30, 30], female: all(25) }, ul: { male: [400, 450, 450, 450, 400], female: all(350) }, ulScope: 'total', page: 350 },
  cr: { ai: same(all(10)), ul: same(all(500)), ulScope: 'total', page: 351 },
  mo: { ear: { male: [20, 25, 25, 20, 20], female: all(20) }, rda: { male: [30, 30, 30, 30, 25], female: all(25) }, ul: { male: all(600), female: all(500) }, ulScope: 'total', page: 352 },
} as const satisfies Record<string, NutrientDri>;

/** 鉄: 女性で月経ありの値(18〜64歳。65歳以上は設定なし)。報告書 p345 */
export const IRON_MENSTRUATING = {
  ear: [7.0, 7.5, 7.5, null, null] as Five,
  rda: [10.0, 10.5, 10.5, null, null] as Five,
};
