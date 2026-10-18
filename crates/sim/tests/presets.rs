//! プリセットの検証（docs/plan.md §6：V-14〜V-21）。研究済みの周期解、ラグランジュの解、惑星、連星への侵入、シトニコフ問題

use sim::integrators::{Integrator, Method};
use sim::scenarios::{
    BUTTERFLY_I, DRAGONFLY, JUPITER_MU, JUPITER_SUN_MASS_RATIO, KEPLER16_INNER_A,
    KEPLER16_PLANET_A, KOZAI_INCLINATION_DEG, MOTH_I, PRESET_COUNT, YIN_YANG_I, binary_exchange,
    binary_ionization, by_id, euler_collinear, kepler16, kozai_lidov, lagrange_triangle, sitnikov,
    suvakov, trojan,
};
use sim::{State, Vec3};

fn rk45(state: State, tolerance: f64) -> Integrator {
    let mut it = Integrator::new(state, Method::Rk45, 1e-3);
    it.tolerance = tolerance;
    it
}

/// 画面の既定（RK45、許容誤差 1e-10）
fn page_default(state: State) -> Integrator {
    rk45(state, 1e-10)
}

fn max_position_error(a: &State, b: &State) -> f64 {
    a.positions
        .iter()
        .zip(&b.positions)
        .map(|(p, q)| (*p - *q).norm())
        .fold(0.0, f64::max)
}

/// 画面はプリセットの値を有効数字 10 桁で入力欄に入れ、そこから計算する（toPrecision(10)）。同じ丸めをする
fn rounded_like_page(mut s: State) -> State {
    let r = |x: f64| format!("{x:.9e}").parse::<f64>().unwrap();
    let rv = |v: Vec3| Vec3::new(r(v.x), r(v.y), r(v.z));
    s.masses = s.masses.iter().map(|m| r(*m)).collect();
    s.positions = s.positions.iter().map(|p| rv(*p)).collect();
    s.velocities = s.velocities.iter().map(|v| rv(*v)).collect();
    s
}

/// 2 体 i・j の相対運動の離心率と軌道長半径（束縛されていなければ軌道長半径は負か無限大）
fn two_body_elements(s: &State, i: usize, j: usize) -> (f64, f64) {
    let m = s.masses[i] + s.masses[j];
    let r = s.positions[j] - s.positions[i];
    let v = s.velocities[j] - s.velocities[i];
    let energy = 0.5 * v.dot(v) - m / r.norm();
    let h = r.cross(v);
    let e = (1.0 + 2.0 * energy * h.dot(h) / (m * m)).max(0.0).sqrt();
    (e, -m / (2.0 * energy))
}

/// どのプリセットも入力の検証を通り、全運動量が 0。番号の範囲の外は None
#[test]
fn every_preset_is_valid() {
    for id in 0..PRESET_COUNT {
        let s = by_id(id).unwrap_or_else(|| panic!("プリセット {id} がない"));
        assert_eq!(s.validate(), Ok(()), "プリセット {id}");
        let m: f64 = s.masses.iter().sum();
        assert!(
            s.momentum().norm() / m < 1e-12,
            "プリセット {id} の全運動量"
        );
    }
    assert!(by_id(PRESET_COUNT).is_none());
}

/// V-14 Šuvakov & Dmitrašinović (2013) の周期解が、1 周期後に初期状態に戻る。角運動量は 0。
/// 初期値は 5〜15 桁なので、戻り方はその精度まで
#[test]
fn v14_suvakov_orbits_return_after_one_period() {
    for (name, orbit) in [
        ("蝶 I", BUTTERFLY_I),
        ("蛾 I", MOTH_I),
        ("陰陽 I", YIN_YANG_I),
        ("トンボ", DRAGONFLY),
    ] {
        assert!(suvakov(orbit).angular_momentum().norm() < 1e-15, "{name}");
        // 文献の初期値を高い精度で積分したものと、画面と同じ条件（丸めた初期値、RK45、許容誤差 1e-10）のもの
        let precise = rk45(suvakov(orbit), 1e-13);
        let page = page_default(rounded_like_page(suvakov(orbit)));
        for (label, mut it) in [("高い精度", precise), ("画面の条件", page)] {
            let start = it.state.clone();
            it.advance_to(orbit.period);
            let err = max_position_error(&it.state, &start);
            assert!(
                err < 5e-3,
                "{name}（{label}）：1 周期後の位置のずれ {err:e}"
            );
        }
    }
}

/// V-14 周期解は不安定なので、やがて崩れる（蝶 I は t ≈ 130 で周期から外れる：Li & Liao, arXiv:1312.6796）
#[test]
fn v14_butterfly_eventually_departs() {
    let start = rounded_like_page(suvakov(BUTTERFLY_I));
    let mut it = page_default(start.clone());
    it.advance_to(BUTTERFLY_I.period * 10.0);
    let early = max_position_error(&it.state, &start);
    it.advance_to(BUTTERFLY_I.period * 40.0);
    let late = max_position_error(&it.state, &start);
    assert!(early < 0.05, "10 周期ではまだ戻る（ずれ {early}）");
    assert!(late > 0.1, "40 周期では外れている（ずれ {late}）");
}

/// 3 つの辺の長さ
fn sides(s: &State) -> [f64; 3] {
    let p = &s.positions;
    [
        (p[0] - p[1]).norm(),
        (p[1] - p[2]).norm(),
        (p[2] - p[0]).norm(),
    ]
}

/// V-15 ラグランジュの正三角形の解（等質量）：はじめは正三角形のまま回るが、不安定なので崩れる
#[test]
fn v15_lagrange_triangle_is_unstable_for_equal_masses() {
    for start in [lagrange_triangle(), rounded_like_page(lagrange_triangle())] {
        let mut it = page_default(start);
        let period = std::f64::consts::TAU / 3f64.sqrt();
        it.advance_to(period);
        for d in sides(&it.state) {
            assert!((d - 1.0).abs() < 1e-6, "1 周期後の辺の長さ {d}");
        }
        it.advance_to(60.0);
        let worst = sides(&it.state)
            .iter()
            .map(|d| (d - 1.0).abs())
            .fold(0.0, f64::max);
        assert!(
            worst > 0.1,
            "時刻 60 では崩れている（辺の長さのずれ {worst}）"
        );
    }
}

/// 主星から見た、伴星と L4 の天体のなす角（度）
fn trojan_angle(s: &State) -> f64 {
    let (a, b) = (
        s.positions[1] - s.positions[0],
        s.positions[2] - s.positions[0],
    );
    a.cross(b).z.atan2(a.dot(b)).to_degrees()
}

/// V-16 L4 の天体：木星の質量比（μ ≈ 0.00095）では 60° の位置にとどまり、
/// Routh の条件（μ < 約 0.0385）を超える μ = 0.05 では L4 から外れる
#[test]
fn v16_trojan_stability_follows_routh_criterion() {
    let mu_limit = (1.0 - (23.0f64 / 27.0).sqrt()) / 2.0;
    assert!(JUPITER_MU < mu_limit && 0.05 > mu_limit);

    let mut it = page_default(rounded_like_page(by_id(9).unwrap()));
    let mut t = 0.0;
    while t < 100.0 * std::f64::consts::TAU {
        t += 1.0;
        it.advance_to(t);
        let a = trojan_angle(&it.state);
        assert!((a - 60.0).abs() < 1.0, "木星：時刻 {t} の角度 {a}°");
    }

    let mut it = page_default(rounded_like_page(trojan(0.05)));
    let mut worst: f64 = 0.0;
    let mut t = 0.0;
    while t < 30.0 * std::f64::consts::TAU {
        t += 1.0;
        it.advance_to(t);
        worst = worst.max((trojan_angle(&it.state) - 60.0).abs());
    }
    assert!(worst > 30.0, "μ = 0.05：60° からのずれの最大 {worst}°");
}

/// V-17 オイラーの一直線の解：はじめは一直線のまま回るが、不安定なので中央の天体が外れていく
#[test]
fn v17_euler_collinear_is_unstable() {
    // 中央の天体が両端を結ぶ線からどれだけ離れているか
    let off_line = |s: &State| {
        let p = &s.positions;
        let (u, w) = (p[2] - p[0], p[1] - p[0]);
        u.cross(w).norm() / u.norm()
    };
    let period = std::f64::consts::TAU / 1.25f64.sqrt();
    let mut it = page_default(rounded_like_page(euler_collinear()));
    let (mut first, mut later): (f64, f64) = (0.0, 0.0);
    let mut t = 0.0;
    while t < 30.0 {
        t += 0.05;
        it.advance_to(t);
        let d = off_line(&it.state);
        if t <= period {
            first = first.max(d);
        } else {
            later = later.max(d);
        }
    }
    assert!(first < 1e-3, "1 周期目のずれの最大 {first}");
    assert!(later > 0.1, "時刻 30 までのずれの最大 {later}");
}

/// 2 つの星の重心から惑星（天体 3）までの距離
fn planet_distance(s: &State) -> f64 {
    let m = s.masses[0] + s.masses[1];
    let c = (s.positions[0] * s.masses[0] + s.positions[1] * s.masses[1]) * (1.0 / m);
    (s.positions[2] - c).norm()
}

/// V-18 Kepler-16：実際の軌道（a = 0.7048 AU）の惑星は 2 つの星の周りを回り続け、
/// 安定限界の内側（a = 0.5 AU）に置いた惑星は飛ばされる
#[test]
fn v18_kepler16_planet_stability() {
    let mut it = page_default(rounded_like_page(kepler16(KEPLER16_PLANET_A)));
    let mut t = 0.0;
    while t < 1000.0 {
        t += 0.5;
        it.advance_to(t);
        let d = planet_distance(&it.state);
        assert!((0.6..0.8).contains(&d), "時刻 {t}：惑星の距離 {d} AU");
    }

    let mut it = page_default(rounded_like_page(kepler16(KEPLER16_INNER_A)));
    it.advance_to(200.0);
    let d = planet_distance(&it.state);
    assert!(d > 10.0, "内側の惑星は飛ばされる（時刻 200 の距離 {d} AU）");
}

/// 惑星（天体 2）の、星（天体 1）に対する軌道の離心率の、時刻 until までの最大
fn max_inner_eccentricity(start: State, until: f64) -> f64 {
    let mut it = page_default(start);
    let mut e_max: f64 = 0.0;
    let mut t = 0.0;
    while t < until {
        t += 0.5;
        it.advance_to(t);
        let (e, a) = two_body_elements(&it.state, 0, 1);
        assert!((0.5..2.0).contains(&a), "時刻 {t}：惑星の軌道長半径 {a}");
        e_max = e_max.max(e);
    }
    e_max
}

/// V-19 古在・リドフ振動：傾き 75° では惑星の離心率が 0.05 から 0.9 を超えるまで大きくなり、
/// 臨界の傾き（約 39.2°）より小さい 30° では大きくならない
#[test]
fn v19_kozai_lidov_raises_eccentricity_only_above_critical_inclination() {
    let high = max_inner_eccentricity(rounded_like_page(kozai_lidov(KOZAI_INCLINATION_DEG)), 400.0);
    assert!(high > 0.9, "傾き 75°：離心率の最大 {high}");
    let low = max_inner_eccentricity(kozai_lidov(30.0), 400.0);
    assert!(low < 0.1, "傾き 30°：離心率の最大 {low}");
}

/// 束縛された 2 体（軌道長半径が正で 10 未満）と、重心から 20 より遠い 1 体に分かれていれば、その組を返す
fn binary_and_escaper(s: &State) -> Option<((usize, usize), usize)> {
    let com = s.center_of_mass();
    [(0, 1, 2), (0, 2, 1), (1, 2, 0)]
        .into_iter()
        .find(|&(i, j, k)| {
            let (_, a) = two_body_elements(s, i, j);
            a > 0.0 && a < 10.0 && (s.positions[k] - com).norm() > 20.0
        })
        .map(|(i, j, k)| ((i, j), k))
}

/// V-20 連星への侵入（Hut & Bahcall 1983 の 3 つの結末のうち 2 つ）。
/// 入れ替わり：天体 3 が天体 1 と連星を作り、天体 2 が弾き出される。
/// ばらばら：全エネルギーが正で、どの 2 体も束縛されず離れていく
#[test]
fn v20_binary_intruder_outcomes() {
    for start in [binary_exchange(), rounded_like_page(binary_exchange())] {
        assert!(start.energy() < 0.0);
        let mut it = page_default(start);
        it.advance_to(300.0);
        assert_eq!(binary_and_escaper(&it.state), Some(((0, 2), 1)));
    }
    for start in [binary_ionization(), rounded_like_page(binary_ionization())] {
        assert!(start.energy() > 0.0, "全エネルギー {}", start.energy());
        let mut it = page_default(start);
        it.advance_to(300.0);
        for (i, j) in [(0, 1), (0, 2), (1, 2)] {
            let (_, a) = two_body_elements(&it.state, i, j);
            let d = (it.state.positions[i] - it.state.positions[j]).norm();
            assert!(
                a < 0.0 && d > 20.0,
                "天体 {i}・{j}：軌道長半径 {a}、距離 {d}"
            );
        }
    }
}

/// V-21 シトニコフ問題：軽い天体は軸（z 軸）の上にとどまり、上下に振動し続ける（離れていかない）
#[test]
fn v21_sitnikov_body_oscillates_on_axis() {
    let mut it = page_default(rounded_like_page(sitnikov()));
    let (mut z_min, mut z_max) = (f64::MAX, f64::MIN);
    let mut t = 0.0;
    while t < 1000.0 {
        t += 0.1;
        it.advance_to(t);
        let p = it.state.positions[2] - it.state.center_of_mass();
        assert!(
            (p.x * p.x + p.y * p.y).sqrt() < 1e-6,
            "時刻 {t}：軸からのずれ"
        );
        z_min = z_min.min(p.z);
        z_max = z_max.max(p.z);
    }
    assert!(z_max < 1.5 && z_min > -1.5, "z の範囲 {z_min}〜{z_max}");
    assert!(
        z_min < -0.9,
        "軌道面を通り抜けて反対側まで振動する（z の最小 {z_min}）"
    );
}

/// 連星への侵入の全エネルギーは、連星の結合エネルギー −1/2 と、無限遠での相対運動のエネルギー
/// (1/2)(2/3) v_inf²（換算質量 2/3）の和になる。v_inf = speed · v_c、v_c² = 3/2
#[test]
fn binary_intruder_energy_matches_requested_speed() {
    use sim::scenarios::binary_intruder;
    for speed in [0.3, 0.6, 1.0, 2.0] {
        for impact in [0.0, 0.3, 1.0] {
            for phase in [0.0, 1.0, 2.0] {
                let target = -0.5 + speed * speed * 1.5 / 3.0;
                let e = binary_intruder(speed, impact, phase).energy();
                assert!(
                    (e - target).abs() < 1e-12,
                    "speed {speed}、impact {impact}、phase {phase}：全エネルギー {e}、期待 {target}"
                );
            }
        }
    }
}

/// 太陽・木星・トロヤ群のプリセットで、伴星と主星の質量の比が木星と太陽の質量の比になる
#[test]
fn trojan_preset_uses_jupiter_sun_mass_ratio() {
    let s = by_id(9).unwrap();
    let q = s.masses[1] / s.masses[0];
    assert!(
        ((q - JUPITER_SUN_MASS_RATIO) / JUPITER_SUN_MASS_RATIO).abs() < 1e-12,
        "伴星と主星の質量の比 {q}"
    );
}
