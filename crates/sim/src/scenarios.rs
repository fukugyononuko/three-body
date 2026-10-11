//! シナリオ（docs/plan.md §2）。平面のものは z = 0。

use crate::{State, Vec3};

/// S-01 8 の字の解（Chenciner & Montgomery 2000。初期値は Simó による）
pub const FIGURE_EIGHT_PERIOD: f64 = 6.325_913_98;

pub fn figure_eight() -> State {
    let x1 = Vec3::new(-0.970_004_36, 0.243_087_53, 0.0);
    let v3 = Vec3::new(-0.932_407_37, -0.864_731_46, 0.0);
    State {
        masses: vec![1.0, 1.0, 1.0],
        positions: vec![x1, x1 * -1.0, Vec3::default()],
        velocities: vec![v3 * -0.5, v3 * -0.5, v3],
    }
}

/// S-02 ピタゴラスの三体問題（Burrau 1913）。質量 3・4・5 を、3・4・5 の直角三角形の頂点に静止させる
pub fn pythagorean() -> State {
    State {
        masses: vec![3.0, 4.0, 5.0],
        positions: vec![
            Vec3::new(1.0, 3.0, 0.0),
            Vec3::new(-2.0, -1.0, 0.0),
            Vec3::new(1.0, -1.0, 0.0),
        ],
        velocities: vec![Vec3::default(); 3],
    }
}

/// S-06 8 の字の解の天体 1 に、平面に垂直な速度 v_z = 0.1 を足したもの（3 次元の軌道になる）
pub fn figure_eight_vertical() -> State {
    let mut s = figure_eight();
    s.velocities[0].z += 0.1;
    // 全運動量を 0 に保つため、ほかの 2 天体に半分ずつ逆向きに配る
    s.velocities[1].z -= 0.05;
    s.velocities[2].z -= 0.05;
    s
}

/// S-07 傾いた階層的三体：質量 1・1 の連星（間隔 1、xy 平面の円軌道）の周りを、
/// 質量 0.1 の天体が半径 5 の円軌道で、xy 平面から 30° 傾いて回る。全運動量は 0
pub fn hierarchical_inclined() -> State {
    let inclination = 30f64.to_radians();
    let inner = (2.0f64).sqrt() / 2.0; // 連星の各天体の速さ（間隔 1、全質量 2）
    let outer = (2.1f64 / 5.0).sqrt(); // 第 3 天体の円軌道の速さ（全質量 2.1、半径 5）
    let v3 = Vec3::new(0.0, outer * inclination.cos(), outer * inclination.sin());
    let m3 = 0.1;
    // 連星の重心が第 3 天体と逆向きに動くようにして、全運動量を 0 にする
    let drift = v3 * (-m3 / 2.0);
    let r3 = Vec3::new(5.0, 0.0, 0.0);
    let shift = r3 * (-m3 / 2.0); // 全体の重心を原点に置く
    State {
        masses: vec![1.0, 1.0, m3],
        positions: vec![
            Vec3::new(-0.5, 0.0, 0.0) + shift,
            Vec3::new(0.5, 0.0, 0.0) + shift,
            r3 + shift,
        ],
        velocities: vec![
            Vec3::new(0.0, -inner, 0.0) + drift,
            Vec3::new(0.0, inner, 0.0) + drift,
            v3,
        ],
    }
}

/// 二体問題の円軌道（検証 V-01 用）。質量 1 の 2 天体が、間隔 1 で互いの周りを回る
pub fn circular_binary() -> State {
    // 間隔 r = 1、全質量 M = 2 の円軌道の相対速度は sqrt(M / r)
    let v = (2.0f64).sqrt() / 2.0;
    State {
        masses: vec![1.0, 1.0],
        positions: vec![Vec3::new(-0.5, 0.0, 0.0), Vec3::new(0.5, 0.0, 0.0)],
        velocities: vec![Vec3::new(0.0, -v, 0.0), Vec3::new(0.0, v, 0.0)],
    }
}

/// 円軌道の周期：T = 2π sqrt(r³ / M)
pub const CIRCULAR_BINARY_PERIOD: f64 = std::f64::consts::PI * std::f64::consts::SQRT_2;

/// S-03 カオス：初期位置の 1 つを `epsilon` だけずらしたもの
pub fn perturbed(mut state: State, epsilon: f64) -> State {
    state.positions[0].x += epsilon;
    state
}

/// シナリオ番号から状態を作る（WebAssembly の窓口用）
pub fn by_id(id: u32) -> Option<State> {
    match id {
        0 => Some(figure_eight()),
        1 => Some(pythagorean()),
        2 => Some(figure_eight_vertical()),
        3 => Some(hierarchical_inclined()),
        _ => None,
    }
}
