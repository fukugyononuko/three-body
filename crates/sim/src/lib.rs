//! 三体問題（N 体問題）の数値計算（docs/plan.md §3）。重力定数 G = 1 の無次元の単位で、3 次元の運動を扱う。
//! 外部クレートは使わない（C-01）。

// 数値計算では、添字のループのほうが式（a_i、m_j など）と対応して読みやすいので許可する
#![allow(clippy::needless_range_loop)]

pub mod integrators;
pub mod scenarios;
#[cfg(target_arch = "wasm32")]
mod wasm;

/// 3 次元のベクトル
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    pub fn dot(self, o: Self) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn norm(self) -> f64 {
        self.dot(self).sqrt()
    }
}

impl std::ops::Add for Vec3 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}
impl std::ops::Sub for Vec3 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}
impl std::ops::Mul<f64> for Vec3 {
    type Output = Self;
    fn mul(self, k: f64) -> Self {
        Self::new(self.x * k, self.y * k, self.z * k)
    }
}

/// 扱える天体の数の上限（色の見分けやすさを検証した配色が 8 色のため）
pub const MAX_BODIES: usize = 8;

/// 入力の誤り（S-05）
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateError {
    /// 天体の数が 2〜MAX_BODIES の外か、配列の長さが合わない
    Shape,
    /// 質量が正の有限の数でない
    Mass,
    /// 位置や速度に、有限でない数がある
    NotFinite,
    /// 2 つの天体が同じ位置にある
    Overlap,
}

/// 天体の集まりの状態（位置と速度）
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub masses: Vec<f64>,
    pub positions: Vec<Vec3>,
    pub velocities: Vec<Vec3>,
}

impl State {
    pub fn len(&self) -> usize {
        self.masses.len()
    }

    pub fn is_empty(&self) -> bool {
        self.masses.is_empty()
    }

    /// N-01 各天体の加速度（万有引力、G = 1、軟化なし）
    pub fn accelerations(&self, positions: &[Vec3]) -> Vec<Vec3> {
        let n = self.len();
        let mut acc = vec![Vec3::default(); n];
        for i in 0..n {
            for j in (i + 1)..n {
                let d = positions[j] - positions[i];
                let r2 = d.dot(d);
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
            .map(|i| 0.5 * self.masses[i] * self.velocities[i].dot(self.velocities[i]))
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
    pub fn momentum(&self) -> Vec3 {
        (0..self.len()).fold(Vec3::default(), |p, i| {
            p + self.velocities[i] * self.masses[i]
        })
    }

    /// N-05 全角運動量（ベクトル）：L = Σ m_i r_i × v_i
    pub fn angular_momentum(&self) -> Vec3 {
        (0..self.len()).fold(Vec3::default(), |l, i| {
            l + self.positions[i].cross(self.velocities[i]) * self.masses[i]
        })
    }

    /// 入力の検証（S-05）：天体は 2〜MAX_BODIES 個、質量は正の有限の数、位置と速度は有限の数、どの 2 天体も同じ位置にない
    pub fn validate(&self) -> Result<(), StateError> {
        let n = self.len();
        if !(2..=MAX_BODIES).contains(&n) || self.positions.len() != n || self.velocities.len() != n
        {
            return Err(StateError::Shape);
        }
        if self.masses.iter().any(|m| !(m.is_finite() && *m > 0.0)) {
            return Err(StateError::Mass);
        }
        let finite = |v: &Vec3| v.x.is_finite() && v.y.is_finite() && v.z.is_finite();
        if !self.positions.iter().all(finite) || !self.velocities.iter().all(finite) {
            return Err(StateError::NotFinite);
        }
        for i in 0..n {
            for j in (i + 1)..n {
                if (self.positions[j] - self.positions[i]).norm() < 1e-9 {
                    return Err(StateError::Overlap);
                }
            }
        }
        Ok(())
    }

    /// 重心
    pub fn center_of_mass(&self) -> Vec3 {
        let total: f64 = self.masses.iter().sum();
        (0..self.len()).fold(Vec3::default(), |c, i| {
            c + self.positions[i] * (self.masses[i] / total)
        })
    }
}
