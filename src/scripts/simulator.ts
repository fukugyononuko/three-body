// 図 1（シミュレーター）と図 2（積分法の比較）。計算はすべて WebAssembly（crates/sim）で行う（C-03）。

interface SimExports {
  memory: WebAssembly.Memory;
  sim_init(slot: number, scenario: number, method: number, dt: number, perturb: number): number;
  sim_advance(slot: number, t: number): void;
  sim_time(slot: number): number;
  sim_energy(slot: number): number;
  sim_angular_momentum(slot: number): number;
  sim_steps(slot: number): number;
  sim_dt(slot: number): number;
  sim_positions(slot: number): number;
  sim_masses(slot: number): number;
}

type ScenarioKey = "figure8" | "pythagorean" | "chaos";
interface Scenario {
  id: number;
  /** 表示する範囲（x の半分の幅）。縦は画面の比率に合わせる */
  halfWidth: number;
  /** 1 秒あたりに進める時間 */
  speed: number;
  /** 刻み幅一定の方法で使う刻み幅 */
  dt: number;
  /** 比較（図 2）で計算する時間 */
  compareUntil: number;
}

const SCENARIOS: Record<ScenarioKey, Scenario> = {
  figure8: { id: 0, halfWidth: 1.4, speed: 1.0, dt: 0.01, compareUntil: 63.3 },
  pythagorean: { id: 1, halfWidth: 7, speed: 3.0, dt: 0.001, compareUntil: 70 },
  chaos: { id: 1, halfWidth: 7, speed: 3.0, dt: 0.001, compareUntil: 70 },
};
const CHAOS_PERTURBATION = 1e-6;
const TRAIL = 3000;

const root = document.querySelector<HTMLElement>("[data-simulator]")!;
const canvas = root.querySelector<HTMLCanvasElement>("#orbits")!;
const compareCanvas = document.querySelector<HTMLCanvasElement>("#energy")!;
const ctx = canvas.getContext("2d")!;
const scenarioSelect = root.querySelector<HTMLSelectElement>("#scenario")!;
const methodSelect = root.querySelector<HTMLSelectElement>("#method")!;
const playButton = root.querySelector<HTMLButtonElement>("#play")!;
const resetButton = root.querySelector<HTMLButtonElement>("#reset")!;
const out = (id: string) => root.querySelector<HTMLElement>(`[data-out="${id}"]`)!;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colors = () => [css("--series-1"), css("--series-2"), css("--series-3")];

let wasm: SimExports;
let playing = false;
let simTime = 0;
let lastFrame = 0;
/** 軌跡：計算（スロット）→ 天体 → 点の列 */
let trails: [number, number][][][] = [];
let e0 = [0, 0];
let l0 = [0, 0];
let masses: number[] = [];

function positions(slot: number): number[] {
  return Array.from(new Float64Array(wasm.memory.buffer, wasm.sim_positions(slot), 6));
}

function current(): { key: ScenarioKey; scenario: Scenario; method: number; slots: number[] } {
  const key = scenarioSelect.value as ScenarioKey;
  return { key, scenario: SCENARIOS[key], method: Number(methodSelect.value), slots: key === "chaos" ? [0, 1] : [0] };
}

function reset(): void {
  const { key, scenario, method, slots } = current();
  for (const slot of slots) {
    const perturb = slot === 1 ? CHAOS_PERTURBATION : 0;
    wasm.sim_init(slot, scenario.id, method, method === 1 ? 1e-3 : scenario.dt, perturb);
    e0[slot] = wasm.sim_energy(slot);
    l0[slot] = wasm.sim_angular_momentum(slot);
  }
  masses = Array.from(new Float64Array(wasm.memory.buffer, wasm.sim_masses(0), 3));
  simTime = 0;
  trails = slots.map((slot) => {
    const p = positions(slot);
    return [0, 1, 2].map((i): [number, number][] => [[p[2 * i], p[2 * i + 1]]]);
  });
  root.querySelector<HTMLElement>("[data-chaos-legend]")!.hidden = key !== "chaos";
  draw();
  updateReadout();
}

function toScreen(x: number, y: number, halfWidth: number): [number, number] {
  const scale = canvas.width / (2 * halfWidth);
  return [canvas.width / 2 + x * scale, canvas.height / 2 - y * scale];
}

function draw(): void {
  const { scenario, slots } = current();
  const c = colors();
  ctx.fillStyle = css("--paper");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 目盛りの補助線（1 単位ごと。広い範囲では 2 単位ごと）
  ctx.strokeStyle = css("--grid");
  ctx.lineWidth = 1;
  const stepUnit = scenario.halfWidth > 3 ? 2 : 0.5;
  for (let u = -Math.ceil(scenario.halfWidth); u <= Math.ceil(scenario.halfWidth); u += stepUnit) {
    const [x] = toScreen(u, 0, scenario.halfWidth);
    const [, y] = toScreen(0, u, scenario.halfWidth);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  slots.forEach((slot, s) => {
    ctx.setLineDash(s === 1 ? [6, 5] : []);
    const p = positions(slot);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = c[i];
      ctx.lineWidth = s === 1 ? 1.5 : 2;
      ctx.beginPath();
      trails[s][i].forEach(([x, y], k) => {
        const [sx, sy] = toScreen(x, y, scenario.halfWidth);
        if (k === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      const [sx, sy] = toScreen(p[2 * i], p[2 * i + 1], scenario.halfWidth);
      ctx.setLineDash([]);
      ctx.fillStyle = c[i];
      ctx.strokeStyle = css("--paper");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 4 + 2 * Math.sqrt(masses[i] ?? 1), 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash(s === 1 ? [6, 5] : []);
    }
  });
  ctx.setLineDash([]);
}

const fmt = (v: number, digits = 3) => (Number.isFinite(v) ? v.toExponential(digits - 1) : "—");

function updateReadout(): void {
  const { slots } = current();
  out("time").textContent = wasm.sim_time(0).toFixed(2);
  out("steps").textContent = wasm.sim_steps(0).toLocaleString("ja-JP");
  out("dt").textContent = fmt(wasm.sim_dt(0));
  out("energy").textContent = fmt(Math.abs((wasm.sim_energy(0) - e0[0]) / e0[0]));
  out("angular").textContent = fmt(Math.abs(wasm.sim_angular_momentum(0) - l0[0]));
  if (slots.length === 2) {
    const a = positions(0);
    const b = positions(1);
    let worst = 0;
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.hypot(a[2 * i] - b[2 * i], a[2 * i + 1] - b[2 * i + 1]));
    out("separation").textContent = fmt(worst);
  } else {
    out("separation").textContent = "—";
  }
}

function frame(now: number): void {
  if (!playing) return;
  const { scenario, slots } = current();
  const elapsed = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  simTime += elapsed * scenario.speed;
  slots.forEach((slot, s) => {
    wasm.sim_advance(slot, simTime);
    const p = positions(slot);
    for (let i = 0; i < 3; i++) {
      trails[s][i].push([p[2 * i], p[2 * i + 1]]);
      if (trails[s][i].length > TRAIL) trails[s][i].shift();
    }
  });
  draw();
  updateReadout();
  requestAnimationFrame(frame);
}

function setPlaying(value: boolean): void {
  playing = value;
  playButton.setAttribute("aria-pressed", String(value));
  playButton.textContent = value ? "一時停止" : "再生";
  if (value) {
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
}

// 図 2：同じシナリオを 3 つの積分法で解き、全エネルギーの相対誤差を比べる
const compareButton = document.querySelector<HTMLButtonElement>("#compare")!;
const compareStatus = document.querySelector<HTMLElement>("[data-compare-status]")!;
const compareTable = document.querySelector<HTMLTableSectionElement>("[data-compare-table]")!;
const METHOD_NAMES = ["RK4（刻み幅一定）", "RK45（刻み幅を自動で変える）", "リープフロッグ法（刻み幅一定）"];

function compare(): void {
  const key = (scenarioSelect.value === "chaos" ? "pythagorean" : scenarioSelect.value) as ScenarioKey;
  const scenario = SCENARIOS[key];
  const slots = [1, 2, 3];
  const energies0: number[] = [];
  slots.forEach((slot, m) => {
    wasm.sim_init(slot, scenario.id, m, m === 1 ? 1e-3 : scenario.dt, 0);
    energies0[m] = wasm.sim_energy(slot);
  });
  const samples: number[][] = [[], [], []];
  const times: number[] = [];
  const sampleStep = scenario.compareUntil / 400;
  let t = 0;
  compareButton.disabled = true;
  compareStatus.textContent = "計算しています…";
  const chunk = () => {
    const until = Math.min(t + sampleStep * 10, scenario.compareUntil);
    while (t < until) {
      t = Math.min(t + sampleStep, scenario.compareUntil);
      times.push(t);
      slots.forEach((slot, m) => {
        wasm.sim_advance(slot, t);
        samples[m].push(Math.abs((wasm.sim_energy(slot) - energies0[m]) / energies0[m]));
      });
    }
    drawComparison(times, samples, scenario.compareUntil);
    if (t < scenario.compareUntil) {
      requestAnimationFrame(chunk);
      return;
    }
    compareButton.disabled = false;
    compareStatus.textContent = `${key === "figure8" ? "8 の字の解" : "ピタゴラスの三体問題"}を、時刻 ${scenario.compareUntil} まで計算しました。`;
    compareTable.replaceChildren(
      ...slots.map((slot, m) => {
        const row = document.createElement("tr");
        for (const text of [METHOD_NAMES[m], fmt(samples[m].at(-1) ?? NaN), fmt(Math.max(...samples[m])), wasm.sim_steps(slot).toLocaleString("ja-JP")]) {
          const td = document.createElement("td");
          td.textContent = text;
          row.append(td);
        }
        return row;
      }),
    );
  };
  requestAnimationFrame(chunk);
}

function drawComparison(times: number[], samples: number[][], until: number): void {
  const g = compareCanvas.getContext("2d")!;
  const { width, height } = compareCanvas;
  const pad = { left: 70, right: 16, top: 16, bottom: 44 };
  const c = colors();
  g.fillStyle = css("--paper");
  g.fillRect(0, 0, width, height);
  const [lo, hi] = [-16, 0]; // 縦軸：相対誤差の 10 の何乗か
  const x = (t: number) => pad.left + (t / until) * (width - pad.left - pad.right);
  const y = (v: number) => {
    const e = Math.min(hi, Math.max(lo, Math.log10(Math.max(v, 1e-16))));
    return pad.top + ((hi - e) / (hi - lo)) * (height - pad.top - pad.bottom);
  };
  g.strokeStyle = css("--grid");
  g.fillStyle = css("--muted");
  g.font = `20px ${css("--font-body")}`;
  g.lineWidth = 1;
  for (let e = lo; e <= hi; e += 4) {
    g.beginPath();
    g.moveTo(pad.left, y(10 ** e));
    g.lineTo(width - pad.right, y(10 ** e));
    g.stroke();
    g.fillText(`10^${e}`, 6, y(10 ** e) + 6);
  }
  // 横軸の目盛り（時刻）
  const tick = until > 40 ? 10 : 5;
  for (let t = 0; t <= until + 1e-9; t += tick) {
    g.beginPath();
    g.moveTo(x(t), pad.top);
    g.lineTo(x(t), height - pad.bottom);
    g.stroke();
    g.fillText(String(t), x(t) - 8, height - pad.bottom + 22);
  }
  g.fillText("時刻", width - pad.right - 44, height - 4);
  samples.forEach((series, m) => {
    g.strokeStyle = c[m];
    g.lineWidth = 2.5;
    g.beginPath();
    series.forEach((v, k) => (k === 0 ? g.moveTo(x(times[k]), y(v)) : g.lineTo(x(times[k]), y(v))));
    g.stroke();
  });
}

async function main(): Promise<void> {
  const url = root.dataset.wasmUrl!;
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
  wasm = instance.exports as unknown as SimExports;
  scenarioSelect.addEventListener("change", reset);
  methodSelect.addEventListener("change", reset);
  resetButton.addEventListener("click", reset);
  playButton.addEventListener("click", () => setPlaying(!playing));
  compareButton.addEventListener("click", compare);
  root.dataset.ready = "true";
  playButton.disabled = false;
  compareButton.disabled = false;
  reset();
  // 動きを減らす設定のときは、自動で再生しない（Q-02）
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
}

main().catch((error) => {
  root.querySelector<HTMLElement>("[data-error]")!.hidden = false;
  console.error(error);
});
