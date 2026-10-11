//! WebAssembly の窓口（docs/plan.md §4：C-02）。wasm-bindgen などは使わず、関数を直接公開する。
//! 初期値は、JavaScript が入力用の配列（3 天体 × 質量・x・y・vx・vy）に書き込み、sim_init で読み込む（S-05）。
//! 有名シナリオの値は sim_load_preset が入力用の配列に書き出す（値の出どころを Rust の 1 か所にまとめる）。
//! 計算器は最大 SLOTS 個まで同時に持てる（カオスの比較で 2 つ、積分法の比較で 3 つ使う）。

use std::cell::RefCell;

use crate::integrators::{Integrator, Method};
use crate::{State, StateError, Vec2, scenarios};

const SLOTS: usize = 5;
const BODIES: usize = 3;
/// 1 天体あたりの入力：質量、x、y、vx、vy
const FIELDS: usize = 5;

struct Slot {
    sim: Option<Integrator>,
    /// x0, y0, x1, y1, x2, y2（長さは固定なので、アドレスは変わらない）
    out: [f64; BODIES * 2],
}

thread_local! {
    static SLOTS_CELL: RefCell<Vec<Slot>> =
        RefCell::new((0..SLOTS).map(|_| Slot { sim: None, out: [0.0; BODIES * 2] }).collect());
    static INPUT: RefCell<[f64; BODIES * FIELDS]> = const { RefCell::new([0.0; BODIES * FIELDS]) };
}

fn with_slot<R>(slot: u32, f: impl FnOnce(&mut Slot) -> R) -> Option<R> {
    SLOTS_CELL.with(|cell| cell.borrow_mut().get_mut(slot as usize).map(f))
}

/// 入力用の配列のアドレス（JavaScript が Float64Array で書き込む）
#[unsafe(no_mangle)]
pub extern "C" fn sim_input() -> *mut f64 {
    INPUT.with(|cell| cell.borrow_mut().as_mut_ptr())
}

/// 有名シナリオの初期値を、入力用の配列に書き出す。0 = 8 の字の解、1 = ピタゴラスの三体問題。成功すれば 1
#[unsafe(no_mangle)]
pub extern "C" fn sim_load_preset(scenario: u32) -> u32 {
    let Some(state) = scenarios::by_id(scenario) else {
        return 0;
    };
    INPUT.with(|cell| {
        let mut input = cell.borrow_mut();
        for i in 0..BODIES {
            input[i * FIELDS..(i + 1) * FIELDS].copy_from_slice(&[
                state.masses[i],
                state.positions[i].x,
                state.positions[i].y,
                state.velocities[i].x,
                state.velocities[i].y,
            ]);
        }
    });
    1
}

/// 入力用の配列の初期値で計算器を用意する。method：0 = RK4、1 = RK45、2 = リープフロッグ法。
/// dt は刻み幅（RK45 では最初に試す刻み幅）、tolerance は RK45 の許容誤差。
/// 戻り値：1 = 成功、0 = 積分法・刻み幅・許容誤差の誤り、2 = 質量の誤り、3 = 位置や速度が有限でない、4 = 天体が重なっている
#[unsafe(no_mangle)]
pub extern "C" fn sim_init(slot: u32, method: u32, dt: f64, tolerance: f64) -> u32 {
    let Some(method) = Method::from_id(method) else {
        return 0;
    };
    if !(dt > 0.0 && dt.is_finite() && tolerance > 0.0 && tolerance.is_finite()) {
        return 0;
    }
    let state = INPUT.with(|cell| {
        let input = cell.borrow();
        let body = |i: usize| &input[i * FIELDS..(i + 1) * FIELDS];
        State {
            masses: (0..BODIES).map(|i| body(i)[0]).collect(),
            positions: (0..BODIES)
                .map(|i| Vec2::new(body(i)[1], body(i)[2]))
                .collect(),
            velocities: (0..BODIES)
                .map(|i| Vec2::new(body(i)[3], body(i)[4]))
                .collect(),
        }
    });
    match state.validate() {
        Ok(()) => {}
        Err(StateError::Mass) => return 2,
        Err(StateError::NotFinite) => return 3,
        Err(StateError::Overlap) => return 4,
        Err(StateError::Shape) => return 0,
    }
    with_slot(slot, |s| {
        let mut sim = Integrator::new(state, method, dt);
        sim.tolerance = tolerance;
        s.sim = Some(sim);
        1
    })
    .unwrap_or(0)
}

/// 時刻 t まで進める
#[unsafe(no_mangle)]
pub extern "C" fn sim_advance(slot: u32, t: f64) {
    with_slot(slot, |s| {
        if let Some(sim) = s.sim.as_mut() {
            sim.advance_to(t);
        }
    });
}

fn read(slot: u32, f: impl FnOnce(&Integrator) -> f64) -> f64 {
    with_slot(slot, |s| s.sim.as_ref().map(f))
        .flatten()
        .unwrap_or(f64::NAN)
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_time(slot: u32) -> f64 {
    read(slot, |s| s.time)
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_energy(slot: u32) -> f64 {
    read(slot, |s| s.state.energy())
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_angular_momentum(slot: u32) -> f64 {
    read(slot, |s| s.state.angular_momentum())
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_steps(slot: u32) -> f64 {
    read(slot, |s| s.steps as f64)
}

/// 現在の刻み幅（RK45 では自動で変わる）
#[unsafe(no_mangle)]
pub extern "C" fn sim_dt(slot: u32) -> f64 {
    read(slot, |s| s.dt)
}

/// 重心の x、y（表示の中心に使う）
#[unsafe(no_mangle)]
pub extern "C" fn sim_com_x(slot: u32) -> f64 {
    read(slot, |s| s.state.center_of_mass().x)
}

#[unsafe(no_mangle)]
pub extern "C" fn sim_com_y(slot: u32) -> f64 {
    read(slot, |s| s.state.center_of_mass().y)
}

/// 位置（x0, y0, x1, y1, x2, y2）を書き出した配列のアドレス
#[unsafe(no_mangle)]
pub extern "C" fn sim_positions(slot: u32) -> *const f64 {
    with_slot(slot, |s| {
        if let Some(sim) = s.sim.as_ref() {
            for (i, p) in sim.state.positions.iter().enumerate().take(BODIES) {
                s.out[2 * i] = p.x;
                s.out[2 * i + 1] = p.y;
            }
        }
        s.out.as_ptr()
    })
    .unwrap_or(std::ptr::null())
}
