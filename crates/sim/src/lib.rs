//! 三体問題の数値計算（docs/plan.md §3）。重力定数 G = 1 の無次元の単位で、平面内の運動を扱う。
//! 外部クレートは使わない（C-01）。

// 数値計算では、添字のループのほうが式（a_i、m_j など）と対応して読みやすいので許可する
#![allow(clippy::needless_range_loop)]

pub mod integrators;
pub mod scenarios;
#[cfg(target_arch = "wasm32")]
mod wasm;

/// 平面内のベクトル
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    pub fn norm(self) -> f64 {
        self.x.hypot(self.y)
    }
}

impl std::ops::Add for Vec2 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y)
    }
}
impl std::ops::Sub for Vec2 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y)
    }
}
impl std::ops::Mul<f64> for Vec2 {
    type Output = Self;
    fn mul(self, k: f64) -> Self {
        Self::new(self.x * k, self.y * k)
    }
}

/// 天体の集まりの状態（位置と速度）
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub masses: Vec<f64>,
    pub positions: Vec<Vec2>,
    pub velocities: Vec<Vec2>,
}

impl State {
    pub fn len(&self) -> usize {
        self.masses.len()
    }

    pub fn is_empty(&self) -> bool {
        self.masses.is_empty()
    }

    /// N-01 各天体の加速度（万有引力、G = 1、軟化なし）
    pub fn accelerations(&self, positions: &[Vec2]) -> Vec<Vec2> {
        let n = self.len();
        let mut acc = vec![Vec2::default(); n];
        for i in 0..n {
            for j in (i + 1)..n {
                let d = positions[j] - positions[i];
                let r2 = d.x * d.x + d.y * d.y;
                let inv_r3 = 1.0 / (r2 * r2.sqrt());
                acc[i] = acc[i] + d * (self.masses[j] * inv_r3);
                acc[j] = acc[j] - d * (self.masses[i] * inv_r3);
            }
        }
        acc
    }

    /// N-05 全エネルギー（運動エネルギー＋位置エネルギー）
    pub fn energy(&self) -> f64 {
        let n = self.len();
        let kinetic: f64 = (0..n)
            .map(|i| {
                0.5 * self.masses[i] * (self.velocities[i].x.powi(2) + self.velocities[i].y.powi(2))
            })
            .sum();
        let mut potential = 0.0;
        for i in 0..n {
            for j in (i + 1)..n {
                potential -= self.masses[i] * self.masses[j]
                    / (self.positions[j] - self.positions[i]).norm();
            }
        }
        kinetic + potential
    }

    /// N-05 全運動量
    pub fn momentum(&self) -> Vec2 {
        (0..self.len()).fold(Vec2::default(), |p, i| {
            p + self.velocities[i] * self.masses[i]
        })
    }

    /// N-05 全角運動量（平面に垂直な成分）
    pub fn angular_momentum(&self) -> f64 {
        (0..self.len())
            .map(|i| {
                self.masses[i]
                    * (self.positions[i].x * self.velocities[i].y
                        - self.positions[i].y * self.velocities[i].x)
            })
            .sum()
    }

    /// 重心
    pub fn center_of_mass(&self) -> Vec2 {
        let total: f64 = self.masses.iter().sum();
        (0..self.len()).fold(Vec2::default(), |c, i| {
            c + self.positions[i] * (self.masses[i] / total)
        })
    }
}
