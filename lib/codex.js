// Codex CLI 呼び出しヘルパー（サーバー専用・依存ゼロ）
// 有料APIは使わない。ローカルの codex CLI（サブスク認証済み ~/.codex）で生成する。

const { spawn } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_EFFORT = "medium"; // 作品解説は質重視。速度が欲しければ AICOMPANY_EFFORT=low
const TIMEOUT_MS = 300_000;

/**
 * codex exec を1回実行してテキストを返す。
 * @param {string} prompt
 * @param {{images?: string[], effort?: string, webSearch?: boolean}} opts
 */
function codexText(prompt, opts = {}) {
  const model = process.env.AICOMPANY_MODEL || DEFAULT_MODEL;
  const effort = opts.effort || process.env.AICOMPANY_EFFORT || DEFAULT_EFFORT;

  const workDir = mkdtempSync(path.join(tmpdir(), "aicompany-"));
  const outFile = path.join(workDir, "last-message.txt");

  const args = [
    "exec",
    "-m", model,
    "-c", `model_reasoning_effort="${effort}"`,
    "-s", "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color", "never",
    "-o", outFile,
  ];
  if (opts.webSearch) {
    args.push("-c", "tools.web_search=true");
  }
  for (const img of opts.images || []) {
    args.push("-i", img);
  }
  args.push("-"); // プロンプトは stdin（長文対策）

  return new Promise((resolve, reject) => {
    const proc = spawn("codex", args, { cwd: workDir, env: process.env });

    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.stdout.on("data", () => {}); // 詰まり防止で消費のみ

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("codex の応答がタイムアウトしました（300秒）。"));
    }, TIMEOUT_MS);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error("codex CLI を起動できませんでした。`codex login` 済みか確認してください。 " + err.message));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      let out = "";
      try {
        out = readFileSync(outFile, "utf8");
      } catch {}
      if (!out.trim()) {
        reject(new Error(`codex exec が失敗しました (exit ${code}): ${stderr.slice(-500)}`));
        return;
      }
      resolve(out);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  }).finally(() => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  });
}

/** JSONを返させる（コードフェンス混入にも耐える） */
async function codexJSON(prompt, opts = {}) {
  const text = await codexText(
    prompt + "\n\n重要: 返答は指定されたJSONオブジェクトのみ。前置き・説明・コードフェンスは付けない。",
    opts
  );
  return parseLooseJSON(text);
}

function parseLooseJSON(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
    throw new Error("codex 応答のJSON解析に失敗: " + cleaned.slice(0, 300));
  }
}

module.exports = { codexText, codexJSON, parseLooseJSON };
