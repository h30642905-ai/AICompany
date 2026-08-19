// Codex CLI 呼び出しヘルパー（サーバー専用・依存ゼロ）
// 有料APIは使わない。ローカルの codex CLI（サブスク認証済み ~/.codex）で生成する。

const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } = require("node:fs");
const { homedir, tmpdir } = require("node:os");
const path = require("node:path");

const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_EFFORT = "medium"; // 作品解説は質重視。速度が欲しければ AICOMPANY_EFFORT=low
const TIMEOUT_MS = 300_000;

// Windows の spawn() は PATHEXT を補完しないため `codex` だけでは ENOENT になる。
// また Node 20+ は .cmd を shell 無しで起動できない。実体（.exe）を優先して探す。
let cachedBin = null;
function resolveCodexBin() {
  if (cachedBin) return cachedBin;
  if (process.env.AICOMPANY_CODEX_BIN) return (cachedBin = process.env.AICOMPANY_CODEX_BIN);
  if (process.platform !== "win32") return (cachedBin = "codex");

  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const findInPath = (name) => {
    for (const dir of pathDirs) {
      const p = path.join(dir, name);
      if (existsSync(p)) return p;
    }
    return null;
  };

  const candidates = [
    findInPath("codex.exe"),
    // npm グローバル導入時の実体（PATH には .cmd シムしか置かれない）
    process.env.APPDATA &&
      path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex",
        "node_modules", "@openai", "codex-win32-x64", "vendor",
        "x86_64-pc-windows-msvc", "bin", "codex.exe"),
    // Codex デスクトップアプリ同梱版（ハッシュ付きフォルダなので新しい順に走査）
    newestDesktopCodex(),
    // 最後の手段：.cmd シム（spawn 時に shell を使う）
    findInPath("codex.cmd"),
    findInPath("codex.bat"),
  ];
  cachedBin = candidates.find((p) => p && existsSync(p)) || "codex";
  return cachedBin;
}

function newestDesktopCodex() {
  const base = path.join(process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"),
    "OpenAI", "Codex", "bin");
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(base, d.name, "codex.exe"))
      .filter(existsSync)
      .sort()
      .pop() || null;
  } catch {
    return null;
  }
}

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

  const bin = resolveCodexBin();
  const useShell = /\.(cmd|bat)$/i.test(bin);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: workDir, env: process.env, shell: useShell, windowsHide: true });

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
