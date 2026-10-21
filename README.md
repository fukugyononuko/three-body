# 三体問題シミュレーター

天体が重力で引き合う三体問題（天体の数は 2〜8 に変えられる N 体問題）を、Rust で数値計算し、WebAssembly にしてブラウザで 3 次元に動かします。

- 公開ページ：https://fukugyononuko.github.io/three-body/
- 制作計画書（シナリオ・数値計算・構成・検証・トレーサビリティ）：[docs/plan.md](docs/plan.md)
- 制作：[副業のぬこ](https://fukugyononuko.github.io/)

## 構成

| 場所 | 内容 |
| --- | --- |
| `crates/sim/` | 数値計算（Rust、外部クレートなし）。3 次元・N 体。積分法（RK4、RK45、リープフロッグ法）、プリセット、保存量、入力の検証、WebAssembly の窓口 |
| `crates/sim/tests/` | 検証（二体の円軌道、8 の字の解の周期、保存量、エネルギーの誤差、ピタゴラスの三体問題の結末）。`presets.rs` は追加のプリセット（研究済みの周期解、ラグランジュ点、惑星、連星への侵入、シトニコフ問題）の性質 |
| `src/` | Web ページ（Astro + TypeScript）。キャンバスへの描画と操作 |
| `tests/e2e/` | ブラウザでの検証（WebAssembly の動作、CSP、アクセシビリティ） |

## 開発

Rust（`rust-toolchain.toml` で版を固定）と Node.js 24 を使います。

```sh
cargo test --release           # 数値計算の検証
npm ci
npm run dev                    # WebAssembly をビルドして http://localhost:4321/three-body/
npm run build && npm run test:e2e && npm run test:lighthouse
```

## 開発の進め方

- プリセットを足すときは、ページの説明に書いた物理量（質量・質量の比・軌道の要素・速さ・エネルギー）を、作った初期状態から測って確かめるテストを書く。帰結（安定・不安定、結末）のテストだけでは、パラメーターの取り違えを見逃す（振り返り [2026-10-18](docs/retrospectives/2026-10-18-presets.md) の T-01）。
- 「画面と同じ条件」のように同じであることを主張するときは、条件（初期値の丸め、積分法、許容誤差、刻み幅）を列挙し、値を 1 か所から読む。1 か所にできない値は、一致を確かめるテストを書く（同 T-02）。
- 数値を扱う関数（座標変換、根の探索、表示の範囲の計算など）は、設計の段階で、入力の範囲（値の大きさの上限と下限、NaN・無限大の扱い）と出力の条件（例：有限、正規直交、向きが物理量と一致）を書く。範囲の外は入力の検証で拒否する。テストは、範囲の端の大きさ × 向き × 特別な値の格子で、出力の条件を確かめる（振り返り [2026-10-21](docs/retrospectives/2026-10-21-rotating-frame.md) の T-02）。
- 振り返りの記録は `docs/retrospectives/` に置く。

## ライセンス

MIT License
