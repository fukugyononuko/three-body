// 検証（docs/plan.md §6）：V-06、V-07
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function collectCspViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { v: string[] }).v = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { v: string[] }).v.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
}

test("V-06：WebAssembly が動き、時間が進み、キャンバスに描かれる。CSP 違反がない", async ({ page }) => {
  await collectCspViolations(page);
  await page.goto("./");
  await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
  const time = page.locator('[data-out="time"]');
  await expect.poll(async () => Number(await time.textContent()), { timeout: 5000 }).toBeGreaterThan(0.5);
  // キャンバスに、背景と違う色の画素がある（軌道が描かれている）
  const painted = await page.locator("#orbits").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const [r0, g0, b0] = [d[0], d[1], d[2]];
    let count = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 60) count++;
    return count;
  });
  expect(painted).toBeGreaterThan(20);
  expect(await page.evaluate(() => (window as unknown as { v: string[] }).v)).toEqual([]);
  const csp = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute("content");
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).toContain("default-src 'self'");
});

test("V-06：8 の字の解では、全エネルギーの相対誤差が小さいまま進む（RK45）", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => Number(await page.locator('[data-out="time"]').textContent()), { timeout: 5000 }).toBeGreaterThan(1);
  expect(Number(await page.locator('[data-out="energy"]').textContent())).toBeLessThan(1e-6);
});

test("V-06：積分法の比較（ピタゴラスの三体問題）で、RK45 の誤差は RK4 より小さい", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
  await page.selectOption("#scenario", "pythagorean");
  await page.click("#compare");
  await expect(page.locator("[data-compare-table] tr")).toHaveCount(3, { timeout: 60000 });
  const maxErrors = await page.locator("[data-compare-table] tr td:nth-child(3)").allTextContents();
  const [rk4, rk45] = maxErrors.map(Number);
  expect(rk45).toBeLessThan(1e-4);
  expect(rk45).toBeLessThan(rk4);
});

test("V-06：カオスでは 2 つの計算を比べ、位置のずれを表示する", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
  await page.selectOption("#scenario", "chaos");
  await expect(page.locator("[data-chaos-legend]")).toBeVisible();
  await expect.poll(async () => Number(await page.locator('[data-out="separation"]').textContent()), { timeout: 5000 }).toBeGreaterThan(0);
});

test("Q-02：動きを減らす設定のときは、自動で再生しない", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("http://localhost:4321/three-body/");
  await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
  await page.waitForTimeout(800);
  expect(await page.locator('[data-out="time"]').textContent()).toBe("0.00");
  await expect(page.locator("#play")).toHaveText("再生");
  await context.close();
});

test.describe("V-07：アクセシビリティ（axe）と画面幅", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(scheme, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("./");
      await expect(page.locator("[data-simulator]")).toHaveAttribute("data-ready", "true");
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      const serious = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    });
  }
});
