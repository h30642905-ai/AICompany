// ============================================================
// AICompany — ゲーム式AIカンパニー（バーチャルオフィスでAI社員が働く）
//   生成はすべて codex CLI（サブスク・費用0円）。有料API禁止（CodexAppServer共通ルール）。
//   依存ゼロ・ビルド不要。データは ~/.aicompany-data/ に保存。
// ============================================================
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { codexText, codexJSON } = require("./lib/codex");

const PORT = Number(process.env.AICOMPANY_PORT || 4680);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.AICOMPANY_DATA || path.join(os.homedir(), ".aicompany-data");
const OUTPUT_DIR = path.join(DATA_DIR, "outputs");
const COMPANY_PATH = path.join(DATA_DIR, "company.json");
const TASKS_PATH = path.join(DATA_DIR, "tasks.json");
const CHAT_PATH = path.join(DATA_DIR, "chat.json");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------- 永続化 ----------
const readJSON = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

let company = readJSON(COMPANY_PATH, null);
let tasks = readJSON(TASKS_PATH, []);
let chat = readJSON(CHAT_PATH, []);
const saveAll = () => {
  if (company) writeJSON(COMPANY_PATH, company);
  writeJSON(TASKS_PATH, tasks);
  writeJSON(CHAT_PATH, chat.slice(-100));
};

// ---------- 社員の状態（メモリ） ----------
// employee.status: idle | working
// task.status: 未着手 | 作業中 | 確認待ち | 完了
let busy = false;            // codex は同時1ジョブ（順番に働く）
const queue = [];            // 実行待ちジョブ
let notice = company ? "" : "まずは「会社を設立する」から始めてね！";

function findEmp(id) { return company?.employees.find((e) => e.id === id); }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function enqueue(job) {
  queue.push(job);
  pump();
}
async function pump() {
  if (busy || queue.length === 0) return;
  busy = true;
  const job = queue.shift();
  try { await job(); } catch (e) { notice = "⚠️ " + e.message; }
  busy = false;
  saveAll();
  pump();
}

// ---------- codex プロンプト ----------
function companyContext() {
  return `# 会社情報
会社名: ${company.name}
事業内容: ${company.business}
今期の会社目標: ${company.goal}（達成度 ${company.goalProgress}%）
社長: ${company.ceoName}（人間。あなたたちの上司）
社員一覧: ${company.employees.map((e) => `${e.name}（${e.role}）`).join(" / ")}`;
}

function personaPrompt(emp) {
  return `あなたは「${company.name}」の社員「${emp.name}」（役職: ${emp.role}）です。
性格: ${emp.personality}
口調は親しみやすく、日本語で。成果物は具体的で、社長がそのまま使えるレベルまで仕上げる。`;
}

// ---------- タスク実行（AI社員が働く） ----------
function runTask(task) {
  const emp = findEmp(task.assignee);
  if (!emp) return;
  emp.status = "working";
  task.status = "作業中";
  notice = `${emp.name} が「${task.title}」に取りかかりました`;
  saveAll();

  enqueue(async () => {
    const rejectedNote = task.feedback
      ? `\n\n# 社長からの差し戻しコメント（必ず反映すること）\n${task.feedback}\n\n# 前回の成果物\n${task.outputFile ? fs.readFileSync(path.join(OUTPUT_DIR, task.outputFile), "utf8").slice(0, 4000) : "なし"}`
      : "";
    const text = await codexText(
      `${personaPrompt(emp)}

${companyContext()}

# 依頼されたタスク
タイトル: ${task.title}
指示内容: ${task.detail || task.title}${rejectedNote}

# 出力ルール
- 成果物をMarkdownで書く。1行目は「# ${task.title}」
- 前置き・言い訳は不要。成果物本体のみ
- 具体名・実例・すぐ使える文面を含め、社長の確認が一度で済む完成度にする
- 最後に「---」の後、社長への一言報告（2行以内、${emp.name}らしい口調）を添える`,
      { effort: process.env.AICOMPANY_EFFORT || "medium" }
    );
    const file = `${new Date().toISOString().slice(0, 10)}-${task.id}.md`;
    fs.writeFileSync(path.join(OUTPUT_DIR, file), text);
    task.outputFile = file;
    task.status = "確認待ち";
    task.feedback = "";
    emp.status = "idle";
    emp.bubble = `「${task.title}」できました！決裁トレイをみてください`;
    notice = `📝 ${emp.name} が「${task.title}」を提出しました（決裁トレイへ）`;
  });
}

// ---------- API ----------
async function handleAPI(req, res, url, body) {
  const json = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  // 現在の状態（3秒ポーリング用）
  if (url.pathname === "/api/state") {
    return json(200, {
      company, tasks, notice, busy: busy || queue.length > 0,
      chat: chat.slice(-30),
      outputs: fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".md")).sort().reverse().slice(0, 50),
    });
  }

  // 会社設立（ヒアリング内容から codex が会社と社員を生成）
  if (url.pathname === "/api/setup" && req.method === "POST") {
    const { name, business, goal, ceoName, vibe } = body;
    notice = "🏗️ 会社を設立中…（30秒ほどかかります）";
    const generated = await codexJSON(
      `あなたは会社設立コンサルタントです。以下の情報から、バーチャルAIカンパニーの社員チームを設計してください。

会社名: ${name}
事業内容: ${business}
今期の目標: ${goal}
社長の名前: ${ceoName}
会社の雰囲気: ${vibe || "かわいくて明るい"}

次のJSONだけを返す:
{
 "employees": [
   {"id":"英小文字の短いid","name":"日本語の親しみやすい名前(ひらがな/カタカナ2-4文字)","role":"役職(COO/AI秘書/ライター/商品企画/SNS担当/品質チェック担当 など事業内容に合わせて6人)","personality":"性格と得意分野を1文で","emoji":"その社員を表す絵文字1つ","color":"服の色(hex)"}
 ]
}
条件: 必ず6人。1人目はCOO（社長の右腕）。名前は全員違う雰囲気に。colorはパステル調で全員別の色。`,
      { effort: "low" }
    );
    company = {
      name, business, goal, ceoName: ceoName || "社長",
      goalProgress: 0,
      vibe: vibe || "かわいくて明るい",
      createdAt: new Date().toISOString(),
      employees: generated.employees.map((e) => ({ ...e, status: "idle", bubble: "" })),
    };
    tasks = [];
    chat = [];
    company.employees[0].bubble = "セットアップ完了！まずは「今日のタスクを決める」を押してみて";
    notice = `🎉 ${name} を設立しました！`;
    saveAll();
    return json(200, { ok: true });
  }

  if (!company) return json(400, { error: "先に会社を設立してください" });

  // 今日のタスクを決める（COOが提案）
  if (url.pathname === "/api/plan" && req.method === "POST") {
    notice = "🗓 COOが今日のタスクを考えています…";
    enqueue(async () => {
      const coo = company.employees[0];
      const done = tasks.filter((t) => t.status === "完了").map((t) => t.title).slice(-10);
      const plan = await codexJSON(
        `${personaPrompt(coo)}\n\n${companyContext()}\n\n最近完了したタスク: ${done.join(" / ") || "まだなし"}\n\n会社目標に近づくために今日やるべきタスクを3つ提案する。次のJSONだけを返す:\n{"tasks":[{"title":"タスク名(20文字以内)","detail":"具体的な指示(何をどう作るか2-3文)","assignee":"担当社員のid(適材適所で選ぶ)"}]}\n社員のid: ${company.employees.map((e) => `${e.id}=${e.name}(${e.role})`).join(", ")}`,
        { effort: "low" }
      );
      for (const t of plan.tasks || []) {
        tasks.push({ id: newId(), title: t.title, detail: t.detail, assignee: t.assignee, status: "未着手", createdAt: new Date().toISOString() });
      }
      coo.bubble = "今日のタスクを3つ用意しました！タスクボードから「働いてもらう」を押してね";
      notice = "📋 今日のタスクがタスクボードに入りました";
    });
    return json(200, { ok: true });
  }

  // タスクを社員に実行させる
  if (url.pathname === "/api/start" && req.method === "POST") {
    const task = tasks.find((t) => t.id === body.taskId);
    if (!task) return json(404, { error: "タスクが見つかりません" });
    if (body.assignee) task.assignee = body.assignee;
    runTask(task);
    return json(200, { ok: true });
  }

  // 自由に仕事を振る（新規タスク作成して即実行）
  if (url.pathname === "/api/assign" && req.method === "POST") {
    const task = {
      id: newId(), title: (body.title || "").slice(0, 30) || "社長からの指示",
      detail: body.detail || body.title, assignee: body.employeeId,
      status: "未着手", createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    runTask(task);
    return json(200, { ok: true });
  }

  // 決裁（承認 or 差し戻し）
  if (url.pathname === "/api/approve" && req.method === "POST") {
    const task = tasks.find((t) => t.id === body.taskId);
    if (!task) return json(404, { error: "タスクが見つかりません" });
    if (body.ok) {
      task.status = "完了";
      company.goalProgress = Math.min(100, company.goalProgress + 5);
      const emp = findEmp(task.assignee);
      if (emp) emp.bubble = "承認ありがとうございます！次もがんばります";
      notice = `✅ 「${task.title}」を承認しました（会社目標 +5%）`;
    } else {
      task.feedback = body.comment || "もう一歩ブラッシュアップして";
      notice = `↩️ 「${task.title}」を差し戻しました`;
      runTask(task);
    }
    saveAll();
    return json(200, { ok: true });
  }

  // COOへ相談（チャット）
  if (url.pathname === "/api/chat" && req.method === "POST") {
    const coo = company.employees[0];
    chat.push({ from: "社長", text: body.message, at: new Date().toISOString() });
    notice = `💬 ${coo.name} が考え中…`;
    enqueue(async () => {
      const history = chat.slice(-10).map((c) => `${c.from}: ${c.text}`).join("\n");
      const reply = await codexText(
        `${personaPrompt(coo)}\n\n${companyContext()}\n\n# これまでの会話\n${history}\n\n# ルール\n社長の相談に${coo.name}として答える。3-6文で簡潔に。必要なら「このタスクを社員に振りましょう」と提案する。`,
        { effort: "low" }
      );
      chat.push({ from: coo.name, text: reply.trim(), at: new Date().toISOString() });
      coo.bubble = reply.trim().slice(0, 60) + (reply.length > 60 ? "…" : "");
      notice = "";
    });
    return json(200, { ok: true });
  }

  // 週次レビュー
  if (url.pathname === "/api/review" && req.method === "POST") {
    notice = "📊 週次レビューを作成中…";
    enqueue(async () => {
      const coo = company.employees[0];
      const doneList = tasks.filter((t) => t.status === "完了").map((t) => `- ${t.title}（${findEmp(t.assignee)?.name || "?"}）`).join("\n");
      const text = await codexText(
        `${personaPrompt(coo)}\n\n${companyContext()}\n\n# 完了タスク一覧\n${doneList || "なし"}\n\n# 依頼\n週次レビューをMarkdownで作成。構成: # 週次レビュー / ## 今週の成果 / ## 会社目標への進捗と所感 / ## 来週の重点3つ / ## 社長へのひとこと。簡潔に、前向きに。`,
        { effort: "low" }
      );
      const file = `${new Date().toISOString().slice(0, 10)}-weekly-review.md`;
      fs.writeFileSync(path.join(OUTPUT_DIR, file), text);
      coo.bubble = "週次レビューを成果物BOXに入れました！";
      notice = "📊 週次レビューが成果物BOXに入りました";
    });
    return json(200, { ok: true });
  }

  // 成果物の中身
  if (url.pathname === "/api/output" && req.method === "GET") {
    const f = url.searchParams.get("f") || "";
    if (!/^[\w.-]+\.md$/.test(f)) return json(400, { error: "bad name" });
    try {
      return json(200, { name: f, text: fs.readFileSync(path.join(OUTPUT_DIR, f), "utf8") });
    } catch { return json(404, { error: "not found" }); }
  }

  // 会社をリセット
  if (url.pathname === "/api/reset" && req.method === "POST") {
    company = null; tasks = []; chat = [];
    try { fs.rmSync(COMPANY_PATH, { force: true }); fs.rmSync(TASKS_PATH, { force: true }); fs.rmSync(CHAT_PATH, { force: true }); } catch {}
    notice = "まずは「会社を設立する」から始めてね！";
    return json(200, { ok: true });
  }

  json(404, { error: "unknown api" });
}

// ---------- HTTP ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
      }
      return await handleAPI(req, res, url, body);
    }
    // 静的ファイル
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const fp = path.join(PUBLIC_DIR, path.normalize(file));
    if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403).end(); return; }
    try {
      const data = fs.readFileSync(fp);
      res.writeHead(200, { "Content-Type": (MIME[path.extname(fp)] || "application/octet-stream") + "; charset=utf-8" });
      res.end(data);
    } catch { res.writeHead(404).end("not found"); }
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`AICompany オフィス開店 → http://localhost:${PORT}`));
