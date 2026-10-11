//! 検証（docs/plan.md §6：V-01〜V-05）

use sim::integrators::{Integrator, Method};
use sim::scenarios::{
    CIRCULAR_BINARY_PERIOD, FIGURE_EIGHT_PERIOD, circular_binary, figure_eight, perturbed,
    pythagorean,
};
use sim::{State, Vec2};

fn max_position_error(a: &State, b: &State) -> f64 {
    a.positions
        .iter()
        .zip(&b.positions)
        .map(|(p, q)| (*p - *q).norm())
        .fold(0.0, f64::max)
}

fn rk45(state: State, tolerance: f64) -> Integrator {
    let mut it = Integrator::new(state, Method::Rk45, 1e-3);
    it.tolerance = tolerance;
    it
}

/// V-01 二体問題（円軌道）で、1 周期後に元の位置に戻る（解析解との比較）
#[test]
fn v01_circular_binary_returns_after_one_period() {
    // RK45 の誤差は許容誤差（既定 1e-10）で制御され、刻みごとに積み重なるので、その 100 倍を上限にする
    for (method, dt, tol) in [
        (Method::Rk4, 1e-3, 1e-9),
        (Method::Rk45, 1e-3, 1e-8),
        (Method::Leapfrog, 1e-4, 1e-6),
    ] {
        let start = circular_binary();
        let mut it = Integrator::new(start.clone(), method, dt);
        it.advance_to(CIRCULAR_BINARY_PERIOD);
        let err = max_position_error(&it.state, &start);
        assert!(err < tol, "{method:?}: 1 周期後の位置のずれ {err:e}");
    }
}

/// V-02 8 の字の解で、1 周期後に初期状態に戻る
#[test]
fn v02_figure_eight_returns_after_one_period() {
    let start = figure_eight();
    let mut it = rk45(start.clone(), 1e-12);
    it.advance_to(FIGURE_EIGHT_PERIOD);
    let err = max_position_error(&it.state, &start);
    // 初期値と周期は 8〜9 桁で与えられているので、その精度で戻れば十分
    assert!(err < 1e-6, "1 周期後の位置のずれ {err:e}");
}

/// V-03 全運動量はどの積分法でも保たれる（一次の量はルンゲ・クッタ法でも厳密に保たれる）。
/// 全角運動量（二次の量）を厳密に保つのはリープフロッグ法（シンプレクティック）で、RK45 は許容誤差の範囲で保つ。
/// 刻み幅一定の RK4 は、天体が接近すると角運動量がずれる（S-04 で見せる性質）
#[test]
fn v03_momentum_and_angular_momentum_are_conserved() {
    for start in [figure_eight(), pythagorean()] {
        let (p0, l0) = (start.momentum(), start.angular_momentum());
        for (method, dt) in [
            (Method::Rk4, 1e-3),
            (Method::Rk45, 1e-3),
            (Method::Leapfrog, 1e-3),
        ] {
            let mut it = Integrator::new(start.clone(), method, dt);
            it.advance_to(10.0);
            let dp = (it.state.momentum() - p0).norm();
            assert!(dp < 1e-9, "{method:?}: 運動量のずれ {dp:e}");
            let dl = (it.state.angular_momentum() - l0).abs();
            match method {
                Method::Leapfrog => assert!(dl < 1e-10, "Leapfrog: 角運動量のずれ {dl:e}"),
                Method::Rk45 => assert!(dl < 1e-6, "Rk45: 角運動量のずれ {dl:e}"),
                Method::Rk4 => {}
            }
        }
    }
    // 接近のない 8 の字の解なら、RK4 でも角運動量のずれは小さい
    let start = figure_eight();
    let mut it = Integrator::new(start.clone(), Method::Rk4, 1e-3);
    it.advance_to(10.0);
    assert!((it.state.angular_momentum() - start.angular_momentum()).abs() < 1e-9);
}

/// S-04 刻み幅一定の RK4 は、接近のあるピタゴラスの三体問題では角運動量が大きくずれる
#[test]
fn s04_fixed_step_rk4_drifts_in_close_encounters() {
    let start = pythagorean();
    let mut it = Integrator::new(start.clone(), Method::Rk4, 1e-3);
    it.advance_to(10.0);
    assert!((it.state.angular_momentum() - start.angular_momentum()).abs() > 1e-3);
}

/// V-04 全エネルギーのずれが、積分法ごとに想定の範囲に収まる
#[test]
fn v04_energy_error_is_within_expected_bounds() {
    let relative = |it: &Integrator, e0: f64| ((it.state.energy() - e0) / e0).abs();

    // 8 の字の解を 10 周期：どの方法でも小さい
    let start = figure_eight();
    let e0 = start.energy();
    // RK45 は許容誤差（1e-10）で制御されるので、10 周期で積み重なった分を見込んで 1e-7 を上限にする
    for (method, dt, bound) in [
        (Method::Rk4, 1e-3, 1e-9),
        (Method::Rk45, 1e-3, 1e-7),
        (Method::Leapfrog, 1e-3, 1e-5),
    ] {
        let mut it = Integrator::new(start.clone(), method, dt);
        it.advance_to(10.0 * FIGURE_EIGHT_PERIOD);
        assert!(
            relative(&it, e0) < bound,
            "{method:?}: エネルギーの相対誤差 {:e}",
            relative(&it, e0)
        );
    }

    // リープフロッグ法はシンプレクティックなので、長時間でもずれが増え続けない。
    // ずれは 1 周期の中で揺れ動くので、ある瞬間の値ではなく期間中の最大値で比べる（100 周期の最大が 10 周期の最大と同程度）
    let max_error = |periods: f64| {
        let mut it = Integrator::new(start.clone(), Method::Leapfrog, 1e-2);
        let (mut t, mut worst) = (0.0, 0.0f64);
        while t < periods * FIGURE_EIGHT_PERIOD {
            t += 0.25;
            it.advance_to(t);
            worst = worst.max(relative(&it, e0));
        }
        worst
    };
    let (worst10, worst100) = (max_error(10.0), max_error(100.0));
    assert!(
        worst100 < 1.5 * worst10,
        "10 周期の最大 {worst10:e}、100 周期の最大 {worst100:e}"
    );

    // ピタゴラスの三体問題（接近がある）：刻み幅を自動で変える RK45 は小さく保てる
    let start = pythagorean();
    let e0 = start.energy();
    let mut it = rk45(start, 1e-12);
    it.advance_to(70.0);
    assert!(
        relative(&it, e0) < 1e-7,
        "RK45：エネルギーの相対誤差 {:e}",
        relative(&it, e0)
    );
}

/// V-05 ピタゴラスの三体問題で、最も軽い天体（質量 3）が弾き飛ばされ、残りの 2 つが連星になる
/// （Szebehely & Peters 1967 の結果と同じ）
#[test]
fn v05_pythagorean_lightest_body_escapes() {
    let mut it = rk45(pythagorean(), 1e-12);
    it.advance_to(100.0);
    let s = &it.state;
    let com = s.center_of_mass();
    let dist = |i: usize| (s.positions[i] - com).norm();
    assert!(dist(0) > 50.0, "質量 3 の天体の重心からの距離 {}", dist(0));
    assert!(
        (s.positions[1] - s.positions[2]).norm() < 2.0,
        "質量 4 と 5 は連星として近くにいる"
    );
    // 運動量のつり合い：質量 3 の天体と、質量 9 の連星は、重心から 3 : 1 の距離にある
    let binary_com = (s.positions[1] * 4.0 + s.positions[2] * 5.0) * (1.0 / 9.0);
    assert!(((binary_com - com).norm() * 3.0 - dist(0)).abs() < 1.0);
}

/// S-03 カオス：10⁻⁶ のずれが、やがて大きな違いになる
#[test]
fn s03_tiny_perturbation_grows() {
    let mut a = rk45(pythagorean(), 1e-12);
    let mut b = rk45(perturbed(pythagorean(), 1e-6), 1e-12);
    a.advance_to(70.0);
    b.advance_to(70.0);
    assert!(max_position_error(&a.state, &b.state) > 1e-2);
}

#[test]
fn vector_basics() {
    assert_eq!(Vec2::new(3.0, 4.0).norm(), 5.0);
}

/// 時刻を細かく何度も進めても止まらない（残り時間が丸め誤差より小さくなっても無限ループにならない）
#[test]
fn advance_to_terminates_for_many_small_calls() {
    for method in [Method::Rk4, Method::Rk45, Method::Leapfrog] {
        let mut it = Integrator::new(figure_eight(), method, 1e-2);
        let mut t = 0.0;
        for _ in 0..2000 {
            t += 0.1 + 1e-13;
            it.advance_to(t);
        }
        assert!((it.time - t).abs() < 1e-9);
    }
}

/// S-05 入力の検証：質量は正、位置と速度は有限、天体は重ならない
#[test]
fn s05_invalid_initial_conditions_are_rejected() {
    use sim::StateError;
    assert_eq!(figure_eight().validate(), Ok(()));
    assert_eq!(pythagorean().validate(), Ok(()));
    let mut s = figure_eight();
    s.masses[1] = 0.0;
    assert_eq!(s.validate(), Err(StateError::Mass));
    let mut s = figure_eight();
    s.masses[2] = -1.0;
    assert_eq!(s.validate(), Err(StateError::Mass));
    let mut s = figure_eight();
    s.velocities[0].x = f64::NAN;
    assert_eq!(s.validate(), Err(StateError::NotFinite));
    let mut s = figure_eight();
    s.positions[1] = s.positions[0];
    assert_eq!(s.validate(), Err(StateError::Overlap));
}

/// N-06 刻み幅を細かくすると、RK4 の誤差は小さくなる（4 次なので、刻み幅を 1/2 にすると誤差はおよそ 1/16）
#[test]
fn n06_smaller_step_reduces_rk4_error() {
    let start = figure_eight();
    let e0 = start.energy();
    let error = |dt: f64| {
        let mut it = Integrator::new(start.clone(), Method::Rk4, dt);
        it.advance_to(FIGURE_EIGHT_PERIOD);
        ((it.state.energy() - e0) / e0).abs()
    };
    let (coarse, fine) = (error(0.02), error(0.01));
    // 理屈では 1/16。丸め誤差などを見込んで 1/8 より小さくなることを確かめる
    assert!(
        fine < coarse / 8.0,
        "dt=0.02: {coarse:e}, dt=0.01: {fine:e}"
    );
}
