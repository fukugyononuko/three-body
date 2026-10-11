//! WebAssembly の窓口（docs/plan.md §4：C-02）。wasm-bindgen などは使わず、関数を直接公開する。
//! 計算器は最大 SLOTS 個まで同時に持てる（カオスの比較で 2 つ、積分法の比較で 3 つ使う）。
//! 位置は各スロットの固定長の配列に書き出し、その先頭のアドレスを返す。JavaScript は毎回 Float64Array で読む。

use std::cell::RefCell;

use crate::integrators::{Integrator, Method};
use crate::scenarios;

const SLOTS: usize = 4;
const MAX_BODIES: usize = 3;

struct Slot {
    sim: Option<Integrator>,
    /// x0, y0, x1, y1, x2, y2（長さは固定なので、アドレスは変わらない）
    out: [f64; MAX_BODIES * 2],
    masses: [f64; MAX_BODIES],
}

thread_local! {
    static SLOTS_CELL: RefCell<Vec<Slot>> = RefCell::new(
        (0..SLOTS).map(|_| Slot { sim: None, out: [0.0; MAX_BODIES * 2], masses: [0.0; MAX_BODIES] }).collect()
    );
}

fn with_slot<R>(slot: u32, f: impl FnOnce(&mut Slot) -> R) -> Option<R> {
    SLOTS_CELL.with(|cell| cell.borrow_mut().get_mut(slot as usize).map(f))
}

/// 計算器を用意する。scenario：0 = 8 の字の解、1 = ピタゴラスの三体問題。method：0 = RK4、1 = RK45、2 = リープフロッグ法。
/// perturb は 1 つ目の天体の x 座標に足すずれ（カオスの比較用）。成功すれば 1、失敗すれば 0
#[unsafe(no_mangle)]
pub extern "C" fn sim_init(slot: u32, scenario: u32, method: u32, dt: f64, perturb: f64) -> u32 {
    let (Some(state), Some(method)) = (scenarios::by_id(scenario), Method::from_id(method)) else {
        return 0;
    };
    if !(dt > 0.0 && dt.is_finite()) {
        return 0;
    }
    let state = scenarios::perturbed(state, perturb);
    with_slot(slot, |s| {
        for (i, m) in state.masses.iter().enumerate().take(MAX_BODIES) {
            s.masses[i] = *m;
        }
        s.sim = Some(Integrator::new(state, method, dt));
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

/// 位置（x0, y0, x1, y1, x2, y2）を書き出した配列のアドレス
#[unsafe(no_mangle)]
pub extern "C" fn sim_positions(slot: u32) -> *const f64 {
    with_slot(slot, |s| {
        if let Some(sim) = s.sim.as_ref() {
            for (i, p) in sim.state.positions.iter().enumerate().take(MAX_BODIES) {
                s.out[2 * i] = p.x;
                s.out[2 * i + 1] = p.y;
            }
        }
        s.out.as_ptr()
    })
    .unwrap_or(std::ptr::null())
}

/// 質量の配列のアドレス
#[unsafe(no_mangle)]
pub extern "C" fn sim_masses(slot: u32) -> *const f64 {
    with_slot(slot, |s| s.masses.as_ptr()).unwrap_or(std::ptr::null())
}
