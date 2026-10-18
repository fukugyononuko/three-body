// 回転座標系の変換（docs/plan.md §6：V-25）。ページを開かず、src/lib/rotating-frame.ts の関数を直接確かめる
import { expect, test } from "@playwright/test";
import { rotatingFrame, toFrame, type Body, type V3 } from "../../src/lib/rotating-frame";

const close = (a: V3, b: V3) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 12));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 質量 m1・m2、間隔 d の円軌道（角速度 ω）を、xy 平面から tilt だけ傾けた面で、位相 phase の位置に置く */
function circularPair(m1: number, m2: number, d: number, phase: number, tilt: number) {
  const omega = Math.sqrt((m1 + m2) / d ** 3);
  const place = (r: number, angle: number) => {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    const flat = { p: [r * c, r * s, 0], v: [-r * omega * s, r * omega * c, 0] };
    // x 軸の周りに tilt だけ傾ける
    const tiltV = ([x, y]: number[]): V3 => [x, y * Math.cos(tilt), y * Math.sin(tilt)];
    return { p: tiltV(flat.p), v: tiltV(flat.v) };
  };
  const m = m1 + m2;
  return { omega, place, primary: { m: m1, ...place(-d * m2 / m, phase) }, secondary: { m: m2, ...place(d * m1 / m, phase) } };
}

test("V-25：円軌道のどの位相・傾きでも、伴星は +x′ 軸、主星は −x′ 軸の上に止まり、共回転する点も止まる", () => {
  for (const [m1, m2, d] of [[1 - 9.537e-4, 9.537e-4, 1], [1, 1, 2], [0.6897, 0.20255, 0.2]]) {
    const m = m1 + m2;
    for (const phase of [0, 1, 2.5, 4, 6]) {
      for (const tilt of [0, 0.5, -1.2]) {
        const pair = circularPair(m1, m2, d, phase, tilt);
        const frame = rotatingFrame(pair.primary, pair.secondary)!;
        close(toFrame(frame, pair.secondary.p), [d * m1 / m, 0, 0]);
        close(toFrame(frame, pair.primary.p), [-d * m2 / m, 0, 0]);
        expect(frame.separation).toBeCloseTo(d, 12);
        expect(frame.mu).toBeCloseTo(m2 / m, 15);
        // 2 天体の前方 60° の点（L4 の向き）は、位相によらず同じ回転座標の位置に来る
        close(toFrame(frame, pair.place(d, phase + Math.PI / 3).p), [d * Math.cos(Math.PI / 3), d * Math.sin(Math.PI / 3), 0]);
        // z′ は公転の軸（反時計回りの xy 平面の公転なら +z を x 軸の周りに傾けた向き）
        close(frame.axes[2], [0, -Math.sin(tilt), Math.cos(tilt)]);
      }
    }
  }
});

test("V-25：角運動量が 0（正面からぶつかる向き）でも、軸は正規直交で、x′ は主星から伴星への向き", () => {
  const cases: [V3, V3][] = [
    [[1, 2, 0], [3, 2, 0]],
    [[0, 0, -1], [0, 0, 2]], // x′ が静止座標系の z 軸と平行
  ];
  for (const [p1, p2] of cases) {
    const v1 = p1.map((x) => -0.3 * x) as V3; // 2 天体を結ぶ線に沿った速度だけ
    const frame = rotatingFrame({ m: 1, p: p1, v: v1 }, { m: 1, p: p2, v: [0, 0, 0] })!;
    const [x, y, z] = frame.axes;
    for (const [a, b, expected] of [[x, x, 1], [y, y, 1], [z, z, 1], [x, y, 0], [y, z, 0], [z, x, 0]] as [V3, V3, number][]) {
      expect(dot(a, b)).toBeCloseTo(expected, 12);
    }
    const r = p2.map((v, k) => v - p1[k]) as V3;
    expect(dot(x, r)).toBeCloseTo(Math.hypot(...r), 12);
  }
  expect(rotatingFrame({ m: 1, p: [1, 1, 1], v: [0, 0, 0] }, { m: 2, p: [1, 1, 1], v: [1, 0, 0] })).toBeNull();
});

test("V-25：rotatingFrame は null か、有限で正規直交な軸を返す（極小・極大の間隔、あふれる速度、NaN）", () => {
  const cases: [string, Body, Body][] = [
    ["間隔 Number.MIN_VALUE", { m: 1, p: [0, 0, 0], v: [0, 1, 0] }, { m: 1, p: [Number.MIN_VALUE, 0, 0], v: [0, -1, 0] }],
    ["間隔 1e-300", { m: 1, p: [0, 0, 0], v: [0, 1, 0] }, { m: 1, p: [1e-300, 0, 0], v: [0, -1, 0] }],
    ["差があふれる座標", { m: 1, p: [-1e308, 0, 0], v: [0, 1, 0] }, { m: 1, p: [1e308, 0, 0], v: [0, -1, 0] }],
    ["外積があふれる速度", { m: 1, p: [0, 0, 0], v: [0, 1e300, 1e300] }, { m: 1, p: [1e10, 0, 0], v: [0, -1e300, 0] }],
    ["質量が NaN", { m: NaN, p: [0, 0, 0], v: [0, 1, 0] }, { m: 1, p: [1, 0, 0], v: [0, -1, 0] }],
    ["ふつうの入力", { m: 1, p: [0, 0, 0], v: [0, 1, 0] }, { m: 1, p: [1, 0, 0], v: [0, -1, 0] }],
  ];
  for (const [name, primary, secondary] of cases) {
    const frame = rotatingFrame(primary, secondary);
    if (!frame) continue;
    const values = [...frame.origin, ...frame.axes.flat(), frame.separation, frame.mu];
    expect(values.every(Number.isFinite), `${name}：${values}`).toBe(true);
    const [x, y, z] = frame.axes;
    for (const [a, b, expected] of [[x, x, 1], [y, y, 1], [z, z, 1], [x, y, 0], [y, z, 0], [z, x, 0]] as [V3, V3, number][]) {
      expect(dot(a, b), name).toBeCloseTo(expected, 12);
    }
    expect(Math.sign(x[0]), `${name}：x′ は主星から伴星への向き`).toBe(1);
  }
  // ふつうの入力では null にならない
  expect(rotatingFrame(cases[5][1], cases[5][2])).not.toBeNull();
});

test("V-25：質量の合計があふれる・極小のときも、原点は 2 天体の重心、μ は伴星の質量の割合になる", () => {
  const cases: [number, number][] = [[1e308, 1e308], [1e308, 1], [1e-308, 3e-308], [Number.MIN_VALUE, Number.MIN_VALUE]];
  for (const [m1, m2] of cases) {
    const frame = rotatingFrame({ m: m1, p: [0, 0, 0], v: [0, 1, 0] }, { m: m2, p: [1, 2, 0], v: [0, -1, 0] })!;
    // 期待値は、質量の比 q = m₂ / m₁ から求める（m₁ + m₂ を直接計算しない）
    const q = m2 / m1;
    const mu = q / (1 + q);
    expect(frame.mu, `m = ${m1}, ${m2}`).toBeCloseTo(mu, 12);
    close(frame.origin, [mu, 2 * mu, 0]);
  }
});
