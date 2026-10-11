//! シナリオ（docs/plan.md §2：S-01〜S-03）。

use crate::{State, Vec2};

/// S-01 8 の字の解（Chenciner & Montgomery 2000。初期値は Simó による）
pub const FIGURE_EIGHT_PERIOD: f64 = 6.325_913_98;

pub fn figure_eight() -> State {
    let x1 = Vec2::new(-0.970_004_36, 0.243_087_53);
    let v3 = Vec2::new(-0.932_407_37, -0.864_731_46);
    State {
        masses: vec![1.0, 1.0, 1.0],
        positions: vec![x1, x1 * -1.0, Vec2::default()],
        velocities: vec![v3 * -0.5, v3 * -0.5, v3],
    }
}

/// S-02 ピタゴラスの三体問題（Burrau 1913）。質量 3・4・5 を、3・4・5 の直角三角形の頂点に静止させる
pub fn pythagorean() -> State {
    State {
        masses: vec![3.0, 4.0, 5.0],
        positions: vec![
            Vec2::new(1.0, 3.0),
            Vec2::new(-2.0, -1.0),
            Vec2::new(1.0, -1.0),
        ],
        velocities: vec![Vec2::default(); 3],
    }
}

/// 二体問題の円軌道（検証 V-01 用）。質量 1 の 2 天体が、間隔 1 で互いの周りを回る
pub fn circular_binary() -> State {
    // 間隔 r = 1、全質量 M = 2 の円軌道の相対速度は sqrt(M / r)
    let v = (2.0f64).sqrt() / 2.0;
    State {
        masses: vec![1.0, 1.0],
        positions: vec![Vec2::new(-0.5, 0.0), Vec2::new(0.5, 0.0)],
        velocities: vec![Vec2::new(0.0, -v), Vec2::new(0.0, v)],
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
        _ => None,
    }
}
