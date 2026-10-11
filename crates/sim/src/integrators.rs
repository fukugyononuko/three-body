//! 積分法（docs/plan.md §3：N-02〜N-04）。

use crate::{State, Vec2};

/// 積分法の種類
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    /// N-02 古典的ルンゲ・クッタ法（4 次、刻み幅一定）
    Rk4,
    /// N-03 ドルマン・プリンス法（5(4) 次、刻み幅を誤差に応じて自動で変える）
    Rk45,
    /// N-04 リープフロッグ法（速度ベルレ法、2 次、シンプレクティック）
    Leapfrog,
}

impl Method {
    pub fn from_id(id: u32) -> Option<Self> {
        match id {
            0 => Some(Self::Rk4),
            1 => Some(Self::Rk45),
            2 => Some(Self::Leapfrog),
            _ => None,
        }
    }
}

/// 時間発展を行う計算器
#[derive(Clone, Debug)]
pub struct Integrator {
    pub state: State,
    pub time: f64,
    pub method: Method,
    /// 刻み幅（RK45 では次に試す刻み幅）
    pub dt: f64,
    /// RK45 の許容誤差（相対・絶対）
    pub tolerance: f64,
    pub steps: u64,
}

impl Integrator {
    pub fn new(state: State, method: Method, dt: f64) -> Self {
        Self {
            state,
            time: 0.0,
            method,
            dt,
            tolerance: 1e-10,
            steps: 0,
        }
    }

    /// 時刻 `until` まで進める（行き過ぎない。RK45 は最後の刻み幅を詰める）
    pub fn advance_to(&mut self, until: f64) {
        // 残りが時刻の丸め誤差より小さくなったら終える（そうしないと time + h == time になって進まない）
        let eps = 1e-12 * until.abs().max(1.0);
        while until - self.time > eps {
            let h = self.dt.min(until - self.time);
            let before = self.time;
            match self.method {
                Method::Rk4 => {
                    self.rk4_step(h);
                    self.time += h;
                }
                Method::Leapfrog => {
                    self.leapfrog_step(h);
                    self.time += h;
                }
                Method::Rk45 => {
                    let taken = self.rk45_step(h);
                    self.time += taken;
                }
            }
            self.steps += 1;
            if self.time == before {
                // 念のため：時刻が進まない刻みになったら、無限ループにせずそこで止める
                break;
            }
        }
    }

    /// 状態をまとめた 1 本の列（位置、速度）の時間微分
    fn derivative(&self, pos: &[Vec2], vel: &[Vec2]) -> (Vec<Vec2>, Vec<Vec2>) {
        (vel.to_vec(), self.state.accelerations(pos))
    }

    fn rk4_step(&mut self, h: f64) {
        let (p0, v0) = (self.state.positions.clone(), self.state.velocities.clone());
        let shift = |base: &[Vec2], d: &[Vec2], k: f64| -> Vec<Vec2> {
            base.iter().zip(d).map(|(b, d)| *b + *d * k).collect()
        };
        let (k1p, k1v) = self.derivative(&p0, &v0);
        let (k2p, k2v) = self.derivative(&shift(&p0, &k1p, h / 2.0), &shift(&v0, &k1v, h / 2.0));
        let (k3p, k3v) = self.derivative(&shift(&p0, &k2p, h / 2.0), &shift(&v0, &k2v, h / 2.0));
        let (k4p, k4v) = self.derivative(&shift(&p0, &k3p, h), &shift(&v0, &k3v, h));
        for i in 0..self.state.len() {
            self.state.positions[i] =
                p0[i] + (k1p[i] + k2p[i] * 2.0 + k3p[i] * 2.0 + k4p[i]) * (h / 6.0);
            self.state.velocities[i] =
                v0[i] + (k1v[i] + k2v[i] * 2.0 + k3v[i] * 2.0 + k4v[i]) * (h / 6.0);
        }
    }

    fn leapfrog_step(&mut self, h: f64) {
        let n = self.state.len();
        let a0 = self.state.accelerations(&self.state.positions);
        for i in 0..n {
            self.state.velocities[i] = self.state.velocities[i] + a0[i] * (h / 2.0);
            self.state.positions[i] = self.state.positions[i] + self.state.velocities[i] * h;
        }
        let a1 = self.state.accelerations(&self.state.positions);
        for i in 0..n {
            self.state.velocities[i] = self.state.velocities[i] + a1[i] * (h / 2.0);
        }
    }

    /// ドルマン・プリンス法で 1 歩進める。誤差が許容を超えたら刻み幅を縮めてやり直す。進んだ時間を返す
    fn rk45_step(&mut self, h_max: f64) -> f64 {
        // ドルマン・プリンス法の係数（Dormand & Prince 1980）
        const A: [[f64; 6]; 6] = [
            [1.0 / 5.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [3.0 / 40.0, 9.0 / 40.0, 0.0, 0.0, 0.0, 0.0],
            [44.0 / 45.0, -56.0 / 15.0, 32.0 / 9.0, 0.0, 0.0, 0.0],
            [
                19372.0 / 6561.0,
                -25360.0 / 2187.0,
                64448.0 / 6561.0,
                -212.0 / 729.0,
                0.0,
                0.0,
            ],
            [
                9017.0 / 3168.0,
                -355.0 / 33.0,
                46732.0 / 5247.0,
                49.0 / 176.0,
                -5103.0 / 18656.0,
                0.0,
            ],
            [
                35.0 / 384.0,
                0.0,
                500.0 / 1113.0,
                125.0 / 192.0,
                -2187.0 / 6784.0,
                11.0 / 84.0,
            ],
        ];
        const B5: [f64; 7] = [
            35.0 / 384.0,
            0.0,
            500.0 / 1113.0,
            125.0 / 192.0,
            -2187.0 / 6784.0,
            11.0 / 84.0,
            0.0,
        ];
        const B4: [f64; 7] = [
            5179.0 / 57600.0,
            0.0,
            7571.0 / 16695.0,
            393.0 / 640.0,
            -92097.0 / 339200.0,
            187.0 / 2100.0,
            1.0 / 40.0,
        ];

        let n = self.state.len();
        let (p0, v0) = (self.state.positions.clone(), self.state.velocities.clone());
        let mut h = self.dt.min(h_max);
        loop {
            let mut kp: Vec<Vec<Vec2>> = Vec::with_capacity(7);
            let mut kv: Vec<Vec<Vec2>> = Vec::with_capacity(7);
            let (p, v) = self.derivative(&p0, &v0);
            kp.push(p);
            kv.push(v);
            for stage in 0..6 {
                let mut ps = p0.clone();
                let mut vs = v0.clone();
                for (j, a) in A[stage].iter().enumerate().take(stage + 1) {
                    for i in 0..n {
                        ps[i] = ps[i] + kp[j][i] * (h * a);
                        vs[i] = vs[i] + kv[j][i] * (h * a);
                    }
                }
                let (p, v) = self.derivative(&ps, &vs);
                kp.push(p);
                kv.push(v);
            }
            let combine = |base: &[Vec2], k: &[Vec<Vec2>], b: &[f64; 7]| -> Vec<Vec2> {
                (0..n)
                    .map(|i| (0..7).fold(base[i], |acc, s| acc + k[s][i] * (h * b[s])))
                    .collect()
            };
            let (p5, v5) = (combine(&p0, &kp, &B5), combine(&v0, &kv, &B5));
            let (p4, v4) = (combine(&p0, &kp, &B4), combine(&v0, &kv, &B4));

            // 誤差の目安：各成分の差を、許容誤差（相対＋絶対）で割った値の二乗平均
            let mut sum = 0.0;
            let mut count = 0.0;
            for i in 0..n {
                for (a, b, base) in [
                    (p5[i].x, p4[i].x, p0[i].x),
                    (p5[i].y, p4[i].y, p0[i].y),
                    (v5[i].x, v4[i].x, v0[i].x),
                    (v5[i].y, v4[i].y, v0[i].y),
                ] {
                    let scale = self.tolerance * (1.0 + base.abs().max(a.abs()));
                    sum += ((a - b) / scale).powi(2);
                    count += 1.0;
                }
            }
            let err = (sum / count).sqrt();
            let factor = if err == 0.0 {
                5.0
            } else {
                (0.9 * err.powf(-0.2)).clamp(0.2, 5.0)
            };
            if err <= 1.0 {
                self.state.positions = p5;
                self.state.velocities = v5;
                // 次の刻み幅（行き過ぎ防止で縮めた場合でも、本来の刻み幅から決める）
                self.dt = (h * factor).max(1e-12);
                return h;
            }
            h *= factor;
        }
    }
}
