// 食材マスタの初期値: 種類が書かれていない調味料・基本食材に、一般的な成分表の食品を割り当てる。
// 重さの換算は、成分表(八訂)増補2023年 本表の備考欄にある「100 mL：○ g」から、
//   大さじ = 15 mL、小さじ = 5 mL、合 = 180 mL(体積の定義)
// として計算する。記憶の数字は入れない。持ち主が確認するまでは unitsConfirmed: false(画面に ⚠)。
// 価格は入れない(持ち主の購入記録だけを使う)。
import type { FoodTable } from '../core/nutrients.ts';
import type { Ingredient, UnitConversion } from '../core/types.ts';

export const VOLUME_ML = { 大さじ: 15, 小さじ: 5, 合: 180 } as const;
export const DENSITY_SOURCE =
  '日本食品標準成分表（八訂）増補2023年 本表 備考欄の「100 mL：○ g」(https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html)';
/** 大さじ 15 mL・小さじ 5 mL の出典(農林水産省 中国四国農政局の資料) */
export const VOLUME_SOURCE = '大さじ15ml・小さじ5ml: 農林水産省 中国四国農政局の資料(https://www.maff.go.jp/chushi/syokuiku/katudou/attach/pdf/oyakudati-18.pdf)';

interface DefaultSpec {
  id: string;
  name: string;
  aliases: string[];
  foodId: string;
  /** 換算に使う容量単位 */
  volumes: (keyof typeof VOLUME_ML | 'mL')[];
  /** 持ち主が確認済みの換算(容量換算より優先) */
  confirmed?: UnitConversion[];
  /** 割り当ての理由・注意 */
  note: string;
}

const SPOONS: DefaultSpec['volumes'] = ['大さじ', '小さじ'];
const LIQUID: DefaultSpec['volumes'] = ['大さじ', '小さじ', 'mL'];

export const DEFAULT_SPECS: DefaultSpec[] = [
  { id: 'def-shoyu', name: 'しょうゆ', aliases: ['醤油', 'こいくちしょうゆ', '濃口醤油', '濃口しょうゆ'], foodId: '17007', volumes: LIQUID, note: '種類の記載がなければ、こいくち(最も一般的)' },
  { id: 'def-sato', name: '砂糖', aliases: ['さとう', '上白糖'], foodId: '03003', volumes: SPOONS, note: '種類の記載がなければ上白糖' },
  { id: 'def-shio', name: '塩', aliases: ['しお', '食塩'], foodId: '17012', volumes: SPOONS, note: '種類の記載がなければ「食塩」' },
  { id: 'def-su', name: '酢', aliases: ['す', '穀物酢'], foodId: '17015', volumes: LIQUID, note: '種類の記載がなければ穀物酢(米酢 17016 も同じ密度)' },
  { id: 'def-sake', name: '酒', aliases: ['さけ', '日本酒', '清酒'], foodId: '16001', volumes: LIQUID, note: '清酒 普通酒。料理酒は別の食材' },
  { id: 'def-ryorishu', name: '料理酒', aliases: [], foodId: '17138', volumes: LIQUID, note: '「料理酒」と書いたときだけ' },
  { id: 'def-mirin', name: 'みりん', aliases: ['本みりん', '味醂'], foodId: '16025', volumes: LIQUID, note: '本みりん。みりん風調味料は 17054' },
  { id: 'def-abura', name: '油', aliases: ['サラダ油', 'あぶら'], foodId: '14006', volumes: LIQUID, note: '種類の記載がなければ調合油(サラダ油)' },
  { id: 'def-natane', name: '菜種油', aliases: ['なたね油', 'キャノーラ油', '菜種サラダ油'], foodId: '14008', volumes: LIQUID, note: '' },
  { id: 'def-gomaabura', name: 'ごま油', aliases: ['胡麻油'], foodId: '14002', volumes: LIQUID, note: '' },
  { id: 'def-olive', name: 'オリーブオイル', aliases: ['オリーブ油'], foodId: '14001', volumes: LIQUID, note: '' },
  { id: 'def-miso', name: 'みそ', aliases: ['味噌'], foodId: '17045', volumes: SPOONS, note: '種類の記載がなければ米みそ 淡色辛みそ' },
  { id: 'def-mayo', name: 'マヨネーズ', aliases: [], foodId: '17042', volumes: SPOONS, note: '全卵型' },
  { id: 'def-ketchup', name: 'ケチャップ', aliases: ['トマトケチャップ'], foodId: '17036', volumes: SPOONS, note: '' },
  { id: 'def-chunou', name: '中濃ソース', aliases: ['ソース'], foodId: '17002', volumes: LIQUID, note: '「ソース」だけのときも中濃(ウスター 17001、濃厚 17003 もある)' },
  { id: 'def-worcester', name: 'ウスターソース', aliases: [], foodId: '17001', volumes: LIQUID, note: '' },
  { id: 'def-hachimitsu', name: 'はちみつ', aliases: ['蜂蜜'], foodId: '03022', volumes: SPOONS, note: '' },
  { id: 'def-katakuri', name: '片栗粉', aliases: ['かたくり粉'], foodId: '02034', volumes: SPOONS, note: 'じゃがいもでん粉' },
  { id: 'def-komugiko', name: '小麦粉', aliases: ['薄力粉'], foodId: '01015', volumes: SPOONS, note: '種類の記載がなければ薄力粉 1等' },
  { id: 'def-dashi', name: '顆粒だし', aliases: ['和風だし', 'ほんだし'], foodId: '17028', volumes: SPOONS, note: '顆粒和風だし' },
  { id: 'def-gyunyu', name: '牛乳', aliases: [], foodId: '13003', volumes: LIQUID, note: '普通牛乳' },
  {
    id: 'def-hakumai',
    name: '白米',
    aliases: ['米', '精白米', 'こめ', 'お米'],
    foodId: '01083',
    volumes: [],
    confirmed: [{ unit: '合', qty: 1, grams: 150, basis: 'manual' }],
    note: '炊く前の精白米(うるち米)。1合=150g は持ち主の換算(確認済み)。参考: 成分表の備考では 100 mL：83 g(1合 180 mL なら 149.4 g)',
  },
  { id: 'def-torigara', name: '鶏がらスープ顆粒', aliases: ['鶏ガラスープの素', '鶏がらスープの素', '鶏がらスープ'], foodId: '17093', volumes: [], note: '顆粒中華だし。成分表の備考に容量換算がないため、大さじ等の換算は未設定(持ち主が入れる)' },
  { id: 'def-consomme', name: 'コンソメ', aliases: ['固形コンソメ', 'ブイヨン'], foodId: '17027', volumes: [], note: '固形ブイヨン。1個の重さは成分表にないため未設定' },
];

/** 成分表の密度(100 mL あたりの g)から容量単位の換算を作る */
export function volumeUnits(gPer100mL: number, volumes: DefaultSpec['volumes']): UnitConversion[] {
  return volumes.map((v) =>
    v === 'mL'
      ? { unit: 'mL', qty: 100, grams: gPer100mL, basis: 'mext-density' as const }
      : { unit: v, qty: 1, grams: (VOLUME_ML[v] * gPer100mL) / 100, basis: 'mext-density' as const },
  );
}

export function defaultIngredients(foods: FoodTable): Ingredient[] {
  return DEFAULT_SPECS.map((s) => {
    const food = foods.get(s.foodId);
    if (!food) throw new Error(`初期値の食品 ${s.foodId} が成分表にありません`);
    const derived = food.gPer100mL !== null ? volumeUnits(food.gPer100mL, s.volumes) : [];
    const units = [...(s.confirmed ?? []), ...derived];
    const memo = [s.note, derived.length > 0 ? `換算の出典: ${DENSITY_SOURCE}。${VOLUME_SOURCE}` : ''].filter(Boolean).join(' / ');
    return {
      id: s.id,
      name: s.name,
      aliases: s.aliases,
      source: { kind: 'food', foodId: s.foodId },
      units,
      // 持ち主の確認が済んだ換算だけのときは確認済み。成分表から計算した推定値を含むときは未確認
      unitsConfirmed: derived.length === 0 && (s.confirmed?.length ?? 0) > 0,
      ...(memo ? { memo } : {}),
    };
  });
}
