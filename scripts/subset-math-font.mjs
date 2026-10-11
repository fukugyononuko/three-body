// 数式のフォント（STIX Two Math、OFL）を、ページの数式で使う文字だけに絞る（サブセット化）。
// 403KB のフォントが最初の表示と取り合いになり、性能が基準（90 点）を割ったため（Q-01、Q-05）。
// 大きな ∑ や伸びる括弧のための MATH テーブルは、harfbuzz のサブセット化で、使う文字に関わる部分が残る。見た目は e2e テストとスクリーンショットで確かめる。
// astro build のあとに実行し、dist/_astro/ のフォントを置き換える。ライセンス（OFL）も dist/fonts/ に置く。
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import subsetFont from "subset-font";

const DIST = "dist";
const html = readFileSync(join(DIST, "index.html"), "utf8");
const chars = new Set();
for (const m of html.matchAll(/<math\b[\s\S]*?<\/math>/g)) {
  for (const ch of m[0].replace(/<annotation\b[\s\S]*?<\/annotation>/g, "").replace(/<[^>]+>/g, "")) if (ch.trim()) chars.add(ch);
}
// 数字、英字、よく使う記号は常に含める
for (const ch of "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-−=<>()[]{}|‖,.;:/·∑∫√≤≥≠±×") chars.add(ch);

const target = readdirSync(join(DIST, "_astro")).find((f) => f.startsWith("stix-two-math") && f.endsWith(".woff2"));
if (!target) throw new Error("dist/_astro/ に数式のフォントがありません");
const source = readFileSync("node_modules/@fontsource/stix-two-math/files/stix-two-math-latin-400-normal.woff2");
const subset = await subsetFont(source, [...chars].join(""), { targetFormat: "woff2" });
writeFileSync(join(DIST, "_astro", target), subset);
mkdirSync(join(DIST, "fonts"), { recursive: true });
copyFileSync("node_modules/@fontsource/stix-two-math/LICENSE", join(DIST, "fonts", "STIX-Two-Math-OFL.txt"));
console.log(`subset-math-font: ${chars.size} 文字、${(source.length / 1024).toFixed(0)} KB → ${(subset.length / 1024).toFixed(1)} KB`);
