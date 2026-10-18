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
const finite = (values: number[]) => values.every(Number.isFinite);
/** 単位ベクトル。成分ごとに長さで割る（極小の長さの逆数はあふれるため）。長さが 0 か、結果が有限でなければ null */
const unit = (a: V3): V3 | null => {
  const n = Math.hypot(...a);
  if (!(n > 0)) return null;
  const u: V3 = [a[0] / n, a[1] / n, a[2] / n];
  return finite(u) ? u : null;
};

/** 主星と伴星から回転座標系を作る。座標系が決まらないとき（2 天体が重なる、値があふれる、NaN を含む）は null */
export function rotatingFrame(primary: Body, secondary: Body): Frame | null {
  // 質量の合計や、質量と位置の積は、あふれたり 0 に落ちたりする。大きいほうの質量で割った比から μ を求め、
  // 原点（2 天体の重心）は主星から伴星へ μ だけ進んだ点として求める
  const big = Math.max(primary.m, secondary.m);
  const [w1, w2] = [primary.m / big, secondary.m / big];
  const mu = w2 / (w1 + w2);
  const r = sub(secondary.p, primary.p);
  const origin = [0, 1, 2].map((k) => primary.p[k] + mu * (secondary.p[k] - primary.p[k])) as V3;
  const x = unit(r);
  if (!x) return null;
  // z′ は、2 天体の相対運動の角運動量の向き。それが 0（正面からぶつかる向きの運動）か、あふれるときは、
  // 静止座標系の z 軸（それも x′ と平行なら y 軸）の、x′ に垂直な成分を使う
  const candidates: V3[] = [cross(r, sub(secondary.v, primary.v)), [0, 0, 1], [0, 1, 0]];
  let z: V3 | null = null;
  for (const c of candidates) {
    const w = sub(c, scale(x, dot(c, x)));
    if (Math.hypot(...w) > 1e-9 * Math.hypot(...c)) z = unit(w);
    if (z) break;
  }
  if (!z) return null;
  const frame: Frame = { origin, axes: [x, cross(z, x), z], separation: Math.hypot(...r), mu };
  // 返す値はすべて有限にする（質量や位置に NaN やあふれる値があると、原点・間隔・μ が有限でなくなる）
  return finite([...frame.origin, ...frame.axes.flat(), frame.separation, frame.mu]) ? frame : null;
}

/** 静止座標系の位置を、回転座標系の (x′, y′, z′) に移す */
export function toFrame(frame: Frame, p: V3): V3 {
  const d = sub(p, frame.origin);
  return frame.axes.map((a) => dot(d, a)) as V3;
}
