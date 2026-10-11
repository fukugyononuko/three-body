// 検証（docs/plan.md §6）：V-06、V-07、V-08
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { v: string[] }).v = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { v: string[] }).v.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await page.goto("./");
  await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
}
const num = async (page: Page, id: string) => Number(await page.locator(`[data-out="${id}"]`).textContent());
async function setInitial(page: Page, rows: number[][]) {
  const fields = ["m", "x", "y", "vx", "vy"];
  for (const [b, row] of rows.entries()) for (const [k, v] of row.entries()) await page.fill(`input[name="b${b}-${fields[k]}"]`, String(v));
}

test("V-06：WebAssembly が動き、時間が進み、キャンバスに描かれる。CSP 違反がない", async ({ page }) => {
  await ready(page);
  await expect.poll(() => num(page, "time"), { timeout: 5000 }).toBeGreaterThan(0.5);
  const painted = await page.locator("#orbits").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let count = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 60) count++;
    return count;
  });
  expect(painted).toBeGreaterThan(20);
  expect(await page.evaluate(() => (window as unknown as { v: string[] }).v)).toEqual([]);
  const csp = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute("content");
  expect(csp).toContain("'wasm-unsafe-eval'");
});

test("S-05：プリセットの値が入力欄に入り、書き換えると「自分で入力」になる", async ({ page }) => {
  await ready(page);
  await expect(page.locator('input[name="b0-x"]')).toHaveValue("-0.97000436");
  await page.selectOption("#preset", "1");
  await expect(page.locator('input[name="b0-m"]')).toHaveValue("3");
  await page.fill('input[name="b0-m"]', "2");
  await expect(page.locator("#preset")).toHaveValue("-1");
});

test("S-05：自分で決めた初期値で計算できる（質量・位置・速度）", async ({ page }) => {
  await ready(page);
  await setInitial(page, [
    [1, -1, 0, 0, -0.5],
    [1, 1, 0, 0, 0.5],
    [0.01, 0, 3, 0.4, 0],
  ]);
  await page.click("#apply");
  await expect(page.locator("[data-message]")).toHaveText("");
  await expect.poll(() => num(page, "time"), { timeout: 5000 }).toBeGreaterThan(0.5);
  expect(await num(page, "energy")).toBeLessThan(1e-6);
});

test("S-05：誤った初期値は理由を表示して受け付けない（質量 0、重なった位置）", async ({ page }) => {
  await ready(page);
  await page.fill('input[name="b1-m"]', "0");
  await page.click("#apply");
  await expect(page.locator("[data-message]")).toContainText("質量は正の数");
  await page.fill('input[name="b1-m"]', "1");
  await page.fill('input[name="b1-x"]', await page.locator('input[name="b0-x"]').inputValue());
  await page.fill('input[name="b1-y"]', await page.locator('input[name="b0-y"]').inputValue());
  await page.click("#apply");
  await expect(page.locator("[data-message]")).toContainText("同じ位置");
});

test("N-06：刻み幅を選べ、RK4 では刻み幅を細かくすると全エネルギーの誤差が小さくなる", async ({ page }) => {
  await ready(page);
  await page.selectOption("#method", "0");
  await expect(page.locator("#dt")).toBeVisible();
  await expect(page.locator("#tolerance")).toBeHidden();
  const errorAt = async (dt: string) => {
    await page.fill("#dt", dt);
    await page.click("#apply");
    await expect.poll(() => num(page, "time"), { timeout: 8000 }).toBeGreaterThan(2);
    await page.click("#play"); // 一時停止
    return num(page, "energy");
  };
  const coarse = await errorAt("0.05");
  const fine = await errorAt("0.005");
  expect(fine).toBeLessThan(coarse);
});

test("S-03：カオス：ずらす天体と量を選べ、2 つの計算の位置のずれを表示する", async ({ page }) => {
  await ready(page);
  await page.check("#chaos");
  await expect(page.locator("[data-chaos-fields]")).toBeVisible();
  await page.selectOption("#chaos-body", "2");
  await page.fill("#chaos-dx", "0");
  await page.fill("#chaos-dy", "1e-4");
  await page.click("#apply");
  await expect(page.locator("[data-chaos-legend]")).toBeVisible();
  await expect.poll(() => num(page, "separation"), { timeout: 5000 }).toBeGreaterThan(0);
});

test("図 2：いまの運動の誤差を描き、3 つの積分法の比較では RK45 の誤差が RK4 より小さい（ピタゴラスの三体問題）", async ({ page }) => {
  await ready(page);
  await expect(page.locator("[data-energy-legend] li")).toHaveCount(1);
  await page.selectOption("#preset", "1");
  await page.fill("#compare-until", "40");
  await page.click("#compare");
  await expect(page.locator("[data-compare-table] tr")).toHaveCount(3, { timeout: 60000 });
  const [rk4, rk45] = (await page.locator("[data-compare-table] tr td:nth-child(3)").allTextContents()).map(Number);
  expect(rk45).toBeLessThan(1e-4);
  expect(rk45).toBeLessThan(rk4);
  await expect(page.locator("[data-energy-legend] li")).toHaveCount(3);
});

test("V-08：数式は MathML で表示され、style 属性を持たない", async ({ page }) => {
  await ready(page);
  expect(await page.locator("math").count()).toBeGreaterThan(10);
  expect(await page.locator("math [style], math[style]").count()).toBe(0);
});

test("Q-02：動きを減らす設定のときは、自動で再生しない", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("http://localhost:4321/three-body/");
  await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
  await page.waitForTimeout(800);
  expect(await page.locator('[data-out="time"]').textContent()).toBe("0.00");
  await context.close();
});

test.describe("V-07：アクセシビリティ（axe）と画面幅", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(scheme, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.emulateMedia({ colorScheme: scheme });
      await ready(page);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    });
  }
});
