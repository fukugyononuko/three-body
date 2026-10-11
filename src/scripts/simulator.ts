// 図 1（シミュレーター）と図 2（全エネルギーの相対誤差）。計算はすべて WebAssembly（crates/sim）で行う（C-03）。
// 初期値（質量・位置・速度）は利用者が入力でき、有名シナリオはその入力欄に値を入れるプリセットとして扱う（S-05）。

interface SimExports {
  memory: WebAssembly.Memory;
  sim_input(): number;
  sim_load_preset(scenario: number): number;
  sim_init(slot: number, method: number, dt: number, tolerance: number): number;
  sim_advance(slot: number, t: number): void;
  sim_time(slot: number): number;
  sim_energy(slot: number): number;
  sim_angular_momentum(slot: number): number;
  sim_steps(slot: number): number;
  sim_dt(slot: number): number;
  sim_com_x(slot: number): number;
  sim_com_y(slot: number): number;
  sim_positions(slot: number): number;
}

const BODIES = 3;
const FIELDS = ["m", "x", "y", "vx", "vy"] as const;
const TRAIL = 4000;
const MAIN = 0;
const CHAOS = 1;
const COMPARE = [2, 3, 4];
const METHOD_NAMES = ["RK4", "RK45 (Dormand–Prince)", "Leapfrog"];
const INIT_ERRORS: Record<number, string> = {
  0: "積分法・刻み幅・許容誤差を確かめてください（刻み幅と許容誤差は正の数）。",
  2: "質量は正の数にしてください。",
  3: "数値として読めない値があります。",
  4: "2 つの天体が同じ位置にあります。位置をずらしてください。",
};

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const root = $<HTMLElement>("[data-simulator]");
const orbits = $<HTMLCanvasElement>("#orbits");
const energyCanvas = $<HTMLCanvasElement>("#energy");
const presetSelect = $<HTMLSelectElement>("#preset");
const methodSelect = $<HTMLSelectElement>("#method");
const dtInput = $<HTMLInputElement>("#dt");
const tolInput = $<HTMLInputElement>("#tolerance");
const speedSelect = $<HTMLSelectElement>("#speed");
const chaosToggle = $<HTMLInputElement>("#chaos");
const chaosBody = $<HTMLSelectElement>("#chaos-body");
const chaosDx = $<HTMLInputElement>("#chaos-dx");
const chaosDy = $<HTMLInputElement>("#chaos-dy");
const playButton = $<HTMLButtonElement>("#play");
const applyButton = $<HTMLButtonElement>("#apply");
const compareButton = $<HTMLButtonElement>("#compare");
const compareUntil = $<HTMLInputElement>("#compare-until");
const message = $<HTMLElement>("[data-message]");
const out = (id: string) => $<HTMLElement>(`[data-out="${id}"]`);
const cell = (body: number, field: string) => $<HTMLInputElement>(`input[name="b${body}-${field}"]`);

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colors = () => [css("--series-1"), css("--series-2"), css("--series-3")];
const fmt = (v: number, digits = 3) => (Number.isFinite(v) ? v.toExponential(digits - 1) : "—");

let wasm: SimExports;
let playing = false;
let simTime = 0;
let lastFrame = 0;
let slots: number[] = [MAIN];
let trails: [number, number][][][] = [];
let e0: number[] = [];
let l0: number[] = [];
let masses: number[] = [];
let view = { cx: 0, cy: 0, half: 1.5 };
/** 図 2 の系列：計算ごとの [時刻, 相対誤差] */
let energySeries: { label: string; color: number; dashed: boolean; points: [number, number][] }[] = [];

function readInputs(): number[] | null {
  const values: number[] = [];
  for (let b = 0; b < BODIES; b++) for (const f of FIELDS) values.push(Number(cell(b, f).value));
  return values.every(Number.isFinite) ? values : null;
}

function writeInputs(values: ArrayLike<number>): void {
  for (let b = 0; b < BODIES; b++) FIELDS.forEach((f, k) => (cell(b, f).value = String(Number(values[b * FIELDS.length + k].toPrecision(10)))));
}

function inputBuffer(): Float64Array {
  return new Float64Array(wasm.memory.buffer, wasm.sim_input(), BODIES * FIELDS.length);
}

function loadPreset(): void {
  const id = Number(presetSelect.value);
  if (id < 0) return; // 「自分で入力」
  wasm.sim_load_preset(id);
  writeInputs(inputBuffer());
  if (id === 0) dtInput.value = "0.01";
  if (id === 1) dtInput.value = "0.001";
}

function positions(slot: number): number[] {
  return Array.from(new Float64Array(wasm.memory.buffer, wasm.sim_positions(slot), BODIES * 2));
}

function settings() {
  return { method: Number(methodSelect.value), dt: Number(dtInput.value), tolerance: Number(tolInput.value) };
}

/** 入力の値で計算器を用意する。失敗したら理由を表示して false */
function initSlot(slot: number, values: number[], method: number, dt: number, tolerance: number): boolean {
  inputBuffer().set(values);
  const code = wasm.sim_init(slot, method, dt, tolerance);
  if (code !== 1) {
    message.textContent = INIT_ERRORS[code] ?? "初期値を確かめてください。";
    return false;
  }
  return true;
}

function perturbed(values: number[]): number[] {
  const copy = [...values];
  const body = Number(chaosBody.value);
  copy[body * FIELDS.length + 1] += Number(chaosDx.value);
  copy[body * FIELDS.length + 2] += Number(chaosDy.value);
  return copy;
}

function apply(): void {
  setPlaying(false);
  message.textContent = "";
  const values = readInputs();
  if (!values) {
    message.textContent = INIT_ERRORS[3];
    return;
  }
  const { method, dt, tolerance } = settings();
  slots = chaosToggle.checked ? [MAIN, CHAOS] : [MAIN];
  if (!initSlot(MAIN, values, method, dt, tolerance)) return;
  if (chaosToggle.checked && !initSlot(CHAOS, perturbed(values), method, dt, tolerance)) return;
  masses = [0, 1, 2].map((b) => values[b * FIELDS.length]);
  e0 = [];
  l0 = [];
  for (const s of slots) {
    e0[s] = wasm.sim_energy(s);
    l0[s] = wasm.sim_angular_momentum(s);
  }
  simTime = 0;
  trails = slots.map((s) => {
    const p = positions(s);
    return [0, 1, 2].map((i): [number, number][] => [[p[2 * i], p[2 * i + 1]]]);
  });
  // 表示の範囲：重心を中心に、初期位置がゆとりをもって収まるように（動きに合わせて広げる）
  view = { cx: wasm.sim_com_x(MAIN), cy: wasm.sim_com_y(MAIN), half: 0 };
  fitView();
  energySeries = slots.map((s, k) => ({ label: k === 0 ? METHOD_NAMES[method] : `${METHOD_NAMES[method]}（ずらした初期値）`, color: method, dashed: k === 1, points: [] }));
  $<HTMLElement>("[data-chaos-legend]").hidden = !chaosToggle.checked;
  drawOrbits();
  drawEnergy();
  updateReadout();
  playButton.disabled = false;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
}

function fitView(): void {
  const aspect = orbits.height / orbits.width;
  let need = view.half;
  for (const trail of trails) for (const body of trail) {
    const [x, y] = body[body.length - 1];
    need = Math.max(need, Math.abs(x - view.cx) * 1.15, (Math.abs(y - view.cy) * 1.15) / aspect);
  }
  view.half = Math.max(need, 0.5);
}

function toScreen(x: number, y: number): [number, number] {
  const scale = orbits.width / (2 * view.half);
  return [orbits.width / 2 + (x - view.cx) * scale, orbits.height / 2 - (y - view.cy) * scale];
}

function niceStep(range: number): number {
  const raw = range / 6;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
}

function drawOrbits(): void {
  const g = orbits.getContext("2d")!;
  const c = colors();
  g.fillStyle = css("--paper");
  g.fillRect(0, 0, orbits.width, orbits.height);
  g.strokeStyle = css("--grid");
  g.lineWidth = 1;
  const step = niceStep(2 * view.half);
  const aspect = orbits.height / orbits.width;
  for (let u = Math.floor((view.cx - view.half) / step) * step; u <= view.cx + view.half; u += step) {
    const [x] = toScreen(u, 0);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, orbits.height);
    g.stroke();
  }
  for (let u = Math.floor((view.cy - view.half * aspect) / step) * step; u <= view.cy + view.half * aspect; u += step) {
    const [, y] = toScreen(0, u);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(orbits.width, y);
    g.stroke();
  }
  slots.forEach((slot, s) => {
    const p = positions(slot);
    for (let i = 0; i < BODIES; i++) {
      g.setLineDash(s === 1 ? [6, 5] : []);
      g.strokeStyle = c[i];
      g.lineWidth = s === 1 ? 1.5 : 2;
      g.beginPath();
      trails[s][i].forEach(([x, y], k) => {
        const [sx, sy] = toScreen(x, y);
        if (k === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      });
      g.stroke();
      g.setLineDash([]);
      const [sx, sy] = toScreen(p[2 * i], p[2 * i + 1]);
      g.fillStyle = c[i];
      g.strokeStyle = css("--paper");
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, 3 + 2.5 * Math.cbrt(masses[i] / Math.max(...masses)) * 2, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
    }
  });
  // 目盛りの値（左下に、1 目盛りの長さ）
  g.fillStyle = css("--muted");
  g.font = `20px ${css("--font-body")}`;
  g.fillText(`grid = ${step} (G = 1 units)`, 12, orbits.height - 12);
}

function relativeEnergyError(slot: number): number {
  return Math.abs((wasm.sim_energy(slot) - e0[slot]) / e0[slot]);
}

function updateReadout(): void {
  out("time").textContent = wasm.sim_time(MAIN).toFixed(2);
  out("steps").textContent = wasm.sim_steps(MAIN).toLocaleString("ja-JP");
  out("dt").textContent = fmt(wasm.sim_dt(MAIN));
  out("energy").textContent = fmt(relativeEnergyError(MAIN));
  out("angular").textContent = fmt(Math.abs(wasm.sim_angular_momentum(MAIN) - l0[MAIN]));
  if (slots.length === 2) {
    const a = positions(MAIN);
    const b = positions(CHAOS);
    let worst = 0;
    for (let i = 0; i < BODIES; i++) worst = Math.max(worst, Math.hypot(a[2 * i] - b[2 * i], a[2 * i + 1] - b[2 * i + 1]));
    out("separation").textContent = fmt(worst);
  } else {
    out("separation").textContent = "—";
  }
}

let lastSample = -Infinity;
function frame(now: number): void {
  if (!playing) return;
  const elapsed = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  simTime += elapsed * Number(speedSelect.value);
  slots.forEach((slot, s) => {
    wasm.sim_advance(slot, simTime);
    const p = positions(slot);
    for (let i = 0; i < BODIES; i++) {
      trails[s][i].push([p[2 * i], p[2 * i + 1]]);
      if (trails[s][i].length > TRAIL) trails[s][i].shift();
    }
  });
  if (simTime - lastSample > 0.02) {
    lastSample = simTime;
    slots.forEach((slot, s) => energySeries[s].points.push([simTime, relativeEnergyError(slot)]));
    drawEnergy();
  }
  view.cx = wasm.sim_com_x(MAIN);
  view.cy = wasm.sim_com_y(MAIN);
  fitView();
  drawOrbits();
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

/** 図 2：時刻ごとの全エネルギーの相対誤差（縦軸は対数） */
function drawEnergy(): void {
  const g = energyCanvas.getContext("2d")!;
  const { width, height } = energyCanvas;
  const pad = { left: 96, right: 16, top: 16, bottom: 64 };
  const c = colors();
  g.fillStyle = css("--paper");
  g.fillRect(0, 0, width, height);
  const all = energySeries.flatMap((s) => s.points);
  const tMax = Math.max(1, ...all.map(([t]) => t));
  const positive = all.map(([, e]) => e).filter((e) => e > 0);
  const hi = Math.min(2, Math.ceil(Math.log10(Math.max(1e-16, ...positive))) + 1);
  const lo = Math.min(hi - 4, Math.floor(Math.log10(Math.min(1, ...positive))) - 1, -12);
  const x = (t: number) => pad.left + (t / tMax) * (width - pad.left - pad.right);
  const y = (v: number) => {
    const e = Math.min(hi, Math.max(lo, Math.log10(Math.max(v, 10 ** lo))));
    return pad.top + ((hi - e) / (hi - lo)) * (height - pad.top - pad.bottom);
  };
  g.strokeStyle = css("--grid");
  g.fillStyle = css("--muted");
  g.font = `20px ${css("--font-body")}`;
  g.lineWidth = 1;
  const yStep = Math.max(1, Math.ceil((hi - lo) / 6));
  for (let e = lo; e <= hi; e += yStep) {
    g.beginPath();
    g.moveTo(pad.left, y(10 ** e));
    g.lineTo(width - pad.right, y(10 ** e));
    g.stroke();
    g.fillText(`1e${e}`, pad.left - 58, y(10 ** e) + 6);
  }
  const tStep = niceStep(tMax);
  for (let t = 0; t <= tMax + 1e-9; t += tStep) {
    g.beginPath();
    g.moveTo(x(t), pad.top);
    g.lineTo(x(t), height - pad.bottom);
    g.stroke();
    g.fillText(String(Number(t.toPrecision(6))), x(t) - 8, height - pad.bottom + 24);
  }
  // 軸のラベル（英語）
  g.fillStyle = css("--text");
  g.fillText("Time t (G = 1 units)", width / 2 - 90, height - 8);
  g.save();
  g.translate(22, height / 2 + 150);
  g.rotate(-Math.PI / 2);
  g.fillText("Relative energy error |ΔE / E₀|", 0, 0);
  g.restore();
  for (const series of energySeries) {
    g.strokeStyle = c[series.color];
    g.lineWidth = 2.5;
    g.setLineDash(series.dashed ? [6, 5] : []);
    g.beginPath();
    series.points.forEach(([t, v], k) => (k === 0 ? g.moveTo(x(t), y(v)) : g.lineTo(x(t), y(v))));
    g.stroke();
  }
  g.setLineDash([]);
  const legend = $<HTMLUListElement>("[data-energy-legend]");
  legend.replaceChildren(
    ...energySeries.map((s) => {
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = `swatch s${s.color + 1}${s.dashed ? " dashed" : ""}`;
      li.append(sw, s.label);
      return li;
    }),
  );
}

/** 同じ初期値・同じ刻み幅で、3 つの積分法を重ねて描く */
function compare(): void {
  const values = readInputs();
  if (!values) return;
  const { dt, tolerance } = settings();
  const until = Number(compareUntil.value);
  if (!(until > 0)) return;
  for (let m = 0; m < 3; m++) if (!initSlot(COMPARE[m], values, m, m === 1 ? Math.min(dt, 1e-3) : dt, tolerance)) return;
  const base = COMPARE.map((s) => wasm.sim_energy(s));
  setPlaying(false);
  energySeries = [0, 1, 2].map((m) => ({ label: METHOD_NAMES[m], color: m, dashed: false, points: [] as [number, number][] }));
  const sample = until / 400;
  let t = 0;
  compareButton.disabled = true;
  message.textContent = "3 つの積分法で計算しています…";
  const chunk = () => {
    const end = Math.min(t + sample * 10, until);
    while (t < end) {
      t = Math.min(t + sample, until);
      COMPARE.forEach((slot, m) => {
        wasm.sim_advance(slot, t);
        energySeries[m].points.push([t, Math.abs((wasm.sim_energy(slot) - base[m]) / base[m])]);
      });
    }
    drawEnergy();
    if (t < until) {
      requestAnimationFrame(chunk);
      return;
    }
    compareButton.disabled = false;
    message.textContent = `時刻 ${until} まで、3 つの積分法で計算しました（刻み幅 ${dt}、RK45 の許容誤差 ${tolerance}）。`;
    $<HTMLTableSectionElement>("[data-compare-table]").replaceChildren(
      ...COMPARE.map((slot, m) => {
        const row = document.createElement("tr");
        const series = energySeries[m].points.map(([, v]) => v);
        for (const text of [METHOD_NAMES[m], fmt(series.at(-1) ?? NaN), fmt(Math.max(...series)), wasm.sim_steps(slot).toLocaleString("ja-JP")]) {
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

function syncMethodFields(): void {
  const rk45 = methodSelect.value === "1";
  $<HTMLElement>("[data-field=dt]").hidden = rk45;
  $<HTMLElement>("[data-field=tolerance]").hidden = !rk45;
}

async function main(): Promise<void> {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(root.dataset.wasmUrl!), {});
  wasm = instance.exports as unknown as SimExports;
  presetSelect.addEventListener("change", () => {
    loadPreset();
    apply();
  });
  // 入力欄を書き換えたら、プリセットは「自分で入力」にする
  root.querySelectorAll<HTMLInputElement>("[data-initial] input").forEach((input) =>
    input.addEventListener("input", () => (presetSelect.value = "-1")),
  );
  methodSelect.addEventListener("change", syncMethodFields);
  chaosToggle.addEventListener("change", () => ($<HTMLElement>("[data-chaos-fields]").hidden = !chaosToggle.checked));
  applyButton.addEventListener("click", apply);
  playButton.addEventListener("click", () => setPlaying(!playing));
  compareButton.addEventListener("click", compare);
  syncMethodFields();
  loadPreset();
  root.dataset.ready = "true";
  applyButton.disabled = false;
  compareButton.disabled = false;
  apply();
}

main().catch((error) => {
  $<HTMLElement>("[data-error]").hidden = false;
  console.error(error);
});
