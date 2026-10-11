// TC-N06：個人情報が公開リポジトリに入っていないかを検査する（NFR-06、BR-06）。
// 1. コミットの作者・コミッターのアドレスが、許可したものだけであること
// 2. 公開される文章に、禁止語（本名や別の活動の名前など）が含まれていないこと：
//    追跡しているファイル、すべてのコミットメッセージ、PR のタイトルと本文（CI の環境変数 PR_TEXT）
//    禁止語そのものを公開リポジトリに書かないよう、環境変数 PRIVACY_DENYLIST（GitHub の Secret）か、
//    git 管理外のファイル .privacy-denylist から読む（1 行に 1 語）。どちらもなければ、この検査は飛ばして警告する。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ALLOWED_EMAILS = new Set([
  "340638804+fukugyononuko@users.noreply.github.com", // コミットの作者（リポジトリの git 設定）
  "fukugyononuko@gmail.com", // 副業のぬこ用のアドレス（GitHub 上のマージ）
  "noreply@github.com", // GitHub 上の操作のコミッター
  "49699333+dependabot[bot]@users.noreply.github.com", // Dependabot
]);
const TEXT_FILE = /\.(md|mdx|astro|ts|tsx|js|mjs|cjs|json|ya?ml|txt|css|html|svg)$/;

const problems = [];

const identities = execFileSync("git", ["log", "--format=%ae%n%ce"], { encoding: "utf8" }).split("\n").filter(Boolean);
for (const email of new Set(identities)) {
  if (!ALLOWED_EMAILS.has(email)) problems.push(`許可していないアドレスのコミットがあります：${email}`);
}

const denylist = (process.env.PRIVACY_DENYLIST ?? (existsSync(".privacy-denylist") ? readFileSync(".privacy-denylist", "utf8") : ""))
  .split("\n")
  .map((w) => w.trim())
  .filter(Boolean);
if (denylist.length === 0) {
  console.warn("check-privacy: 禁止語が設定されていないため、ファイルの検査を飛ばしました（PRIVACY_DENYLIST か .privacy-denylist）");
} else {
  const sources = [];
  for (const file of execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((f) => TEXT_FILE.test(f))) {
    sources.push([file, readFileSync(file, "utf8")]);
  }
  const log = execFileSync("git", ["log", "--format=%H%x00%B%x00"], { encoding: "utf8" }).split("\0");
  for (let i = 0; i + 1 < log.length; i += 2) sources.push([`コミット ${log[i].trim().slice(0, 7)} のメッセージ`, log[i + 1]]);
  if (process.env.PR_TEXT) sources.push(["PR のタイトルと本文", process.env.PR_TEXT]);

  for (const [where, raw] of sources) {
    const text = raw.toLowerCase();
    // 禁止語そのものはログに出さない（CI のログも公開されるため）
    denylist.forEach((word, i) => {
      if (text.includes(word.toLowerCase())) problems.push(`${where}：禁止語（${i + 1} 行目の語）が含まれています`);
    });
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`check-privacy: 問題はありません（コミットのアドレス ${new Set(identities).size} 種類、禁止語 ${denylist.length} 語、PR の本文 ${process.env.PR_TEXT ? "あり" : "なし"}）`);
