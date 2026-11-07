// 表示のための丸め(仕様書 §5.5)。内部の計算では丸めない。
// 四捨五入(0.5 は切り上げ)。負の値は絶対値で丸めてから符号を戻す。
// 浮動小数点の誤差(例: 1.005 が内部では 1.00499999…)を、有効数字12桁に揃えてから補正する。

const SIG = 12;

export function roundHalfUp(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  // 有効数字12桁の10進表記に直してから桁をずらす(指数表記の文字列で行い、掛け算の誤差を入れない)
  const [mant, exp] = Math.abs(x).toPrecision(SIG).split('e');
  const shifted = Number(`${mant}e${Number(exp ?? 0) + digits}`);
  const rounded = Math.floor(shifted + 0.5);
  // 整数 ÷ 10^n は、10進の値に最も近い浮動小数点数になる
  const back = digits >= 0 ? rounded / 10 ** digits : rounded * 10 ** -digits;
  return back === 0 ? 0 : sign * back;
}

/** 丸めて、桁数を揃えた文字列にする(例: 1.1 → "1.10")。 */
export function formatNumber(x: number, digits: number): string {
  const r = roundHalfUp(x, digits);
  return r.toFixed(digits);
}
