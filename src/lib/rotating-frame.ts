// 回転座標系（C-03）。主星と伴星を結ぶ線が止まって見える座標系に、位置を移す。
// 原点は 2 天体の重心、x′ 軸は主星から伴星への向き、z′ 軸は 2 天体の相対運動の角運動量の向き、y′ = z′ × x′。
// その時刻の 2 天体の位置と速度から決めるので、楕円軌道では間隔が変わる（座標は伸び縮みさせない）。

export type V3 = [number, number, number];

export interface Body {
  m: number;
  p: V3;
  v: V3;
}

export interface Frame {
  origin: V3;
  /** x′、y′、z′ 軸の単位ベクトル（静止座標系での向き） */
  axes: [V3, V3, V3];
  /** 2 天体の間隔 */
  separation: number;
  /** 伴星の質量の割合 μ = m₂ / (m₁ + m₂) */
  mu: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 | null => {
  const n = Math.hypot(...a);
  return n > 0 && Number.isFinite(n) ? scale(a, 1 / n) : null;
};

/** 主星と伴星から回転座標系を作る。2 天体が重なっているときは null */
export function rotatingFrame(primary: Body, secondary: Body): Frame | null {
  const m = primary.m + secondary.m;
  const origin = scale([0, 1, 2].map((k) => primary.p[k] * primary.m + secondary.p[k] * secondary.m) as V3, 1 / m);
  const r = sub(secondary.p, primary.p);
  const x = unit(r);
  if (!x) return null;
  // 2 天体が正面からぶつかる向きに動いていて角運動量が 0 のときは、静止座標系の z 軸（それも x′ と平行なら y 軸）を使う
  const candidates: V3[] = [cross(r, sub(secondary.v, primary.v)), [0, 0, 1], [0, 1, 0]];
  const perpendicular = candidates
    .map((c) => sub(c, scale(x, dot(c, x))))
    .find((w, k) => Math.hypot(...w) > 1e-9 * Math.hypot(...candidates[k]));
  const z = unit(perpendicular!)!;
  return { origin, axes: [x, cross(z, x), z], separation: Math.hypot(...r), mu: secondary.m / m };
}

/** 静止座標系の位置を、回転座標系の (x′, y′, z′) に移す */
export function toFrame(frame: Frame, p: V3): V3 {
  const d = sub(p, frame.origin);
  return frame.axes.map((a) => dot(d, a)) as V3;
}
