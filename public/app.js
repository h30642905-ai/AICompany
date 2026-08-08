// AIカンパニー フロントエンド（依存ゼロ）
const $ = (s) => document.querySelector(s);
let state = null;
let viewingFile = null;
let viewingTaskId = null;

// 夜はピンクのナイトオフィスに
const hour = new Date().getHours();
if (hour >= 18 || hour < 6) document.body.classList.add("night");

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "通信エラー");
  return data;
}

// ---------- 描画 ----------
function render() {
  const c = state.company;
  $("#notice").textContent = state.notice || (state.busy ? "🐝 AI社員が作業中です…" : "");

  if (!c) { $("#setupModal").classList.remove("hidden"); return; }
  $("#setupModal").classList.add("hidden");

  $("#companyName").textContent = c.name;
  $("#goalText").textContent = c.goal;
  $("#goalBar").style.width = c.goalProgress + "%";
  $("#goalNum").textContent = c.goalProgress + "%";

  // 社長
  $("#ceoChar").innerHTML = charHTML({ name: c.ceoName, role: "社長", emoji: "🤴", color: "#caa2d8", status: "idle", bubble: "" }, false);

  // 社員
  $("#staffArea").innerHTML = c.employees.map((e) => `<div class="char ${e.status === "working" ? "working" : ""}">${charHTML(e, true)}</div>`).join("");

  // タスクボード
  const counts = { 未着手: 0, 作業中: 0, 確認待ち: 0, 完了: 0 };
  state.tasks.forEach((t) => counts[t.status] !== undefined && counts[t.status]++);
  $("#taskCounts").innerHTML = Object.entries(counts).map(([k, v]) => `<span>${k} ${v}</span>`).join("");
  const active = state.tasks.filter((t) => t.status === "未着手" || t.status === "作業中").slice(-8).reverse();
  $("#taskList").innerHTML = active.length
    ? active.map((t) => {
        const emp = c.employees.find((e) => e.id === t.assignee);
        return `<div class="task-item"><div>${esc(t.title)}</div>
          <div class="t-meta">${emp ? emp.emoji + " " + esc(emp.name) : "担当未定"}・${t.status}
          ${t.status === "未着手" ? `<button onclick="startTask('${t.id}')">働いてもらう</button>` : ""}</div></div>`;
      }).join("")
    : `<div class="empty">タスクはありません。「今日のタスクを決める」を押してみて</div>`;

  // 決裁トレイ
  const pend = state.tasks.filter((t) => t.status === "確認待ち");
  $("#approveCount").textContent = pend.length;
  $("#approveList").innerHTML = pend.length
    ? pend.map((t) => `<div class="approve-item" onclick="openOutput('${t.outputFile}','${t.id}')">🖋 ${esc(t.title)}</div>`).join("")
    : `<div class="empty">決裁待ちはありません</div>`;

  // 成果物BOX
  $("#outputCount").textContent = state.outputs.length;
  $("#outputList").innerHTML = state.outputs.length
    ? state.outputs.slice(0, 8).map((f) => `<div class="output-item" onclick="openOutput('${f}',null)">📄 ${esc(f)}</div>`).join("")
    : `<div class="empty">まだ成果物はありません</div>`;
}

function charHTML(e, withDesk) {
  return `${e.bubble ? `<div class="bubble">${esc(e.bubble)}</div>` : ""}
    <div class="face">${e.emoji || "🙂"}</div>
    <div class="body" style="background:${e.color || "#9bc4e8"}"></div>
    <div class="nametag">${esc(e.name)}｜${esc(e.role)}</div>
    <div class="status ${e.status === "working" ? "working" : ""}">${e.status === "working" ? "作業中" : "待機中"}</div>
    ${withDesk ? '<div class="desk"></div>' : ""}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- 操作 ----------
window.startTask = async (taskId) => { await api("/api/start", { taskId }); poll(); };

window.openOutput = async (file, taskId) => {
  const { name, text } = await api(`/api/output?f=${encodeURIComponent(file)}`);
  viewingFile = name; viewingTaskId = taskId;
  $("#viewTitle").textContent = "📄 " + name;
  $("#viewBody").textContent = text;
  $("#viewApprove").style.display = taskId ? "" : "none";
  $("#viewReject").style.display = taskId ? "" : "none";
  $("#viewModal").classList.remove("hidden");
};

$("#viewApprove").onclick = async () => { await api("/api/approve", { taskId: viewingTaskId, ok: true }); $("#viewModal").classList.add("hidden"); poll(); };
$("#viewReject").onclick = async () => {
  const comment = prompt("差し戻しコメント（どう直してほしい？）");
  if (comment === null) return;
  await api("/api/approve", { taskId: viewingTaskId, ok: false, comment });
  $("#viewModal").classList.add("hidden"); poll();
};

$("#setupBtn").onclick = async () => {
  const name = $("#inName").value.trim(), business = $("#inBusiness").value.trim(), goal = $("#inGoal").value.trim();
  if (!name || !business || !goal) { alert("会社名・事業内容・目標は入れてね"); return; }
  $("#setupBtn").disabled = true; $("#setupBtn").textContent = "設立中…（AIが社員を採用しています）";
  try {
    await api("/api/setup", { name, business, goal, ceoName: $("#inCeo").value.trim(), vibe: $("#inVibe").value.trim() });
  } catch (e) { alert(e.message); }
  $("#setupBtn").disabled = false; $("#setupBtn").textContent = "設立する（30秒ほどかかります）";
  poll();
};

$("#planBtn").onclick = () => act("plan");
document.querySelectorAll("#actions button").forEach((b) => (b.onclick = () => act(b.dataset.act)));

async function act(kind) {
  if (!state?.company && kind !== "reset") return;
  if (kind === "plan") await api("/api/plan", {});
  if (kind === "review") await api("/api/review", {});
  if (kind === "outputs") { const f = state.outputs[0]; if (f) openOutput(f, null); else alert("まだ成果物がありません"); }
  if (kind === "assign") {
    $("#assignWho").innerHTML = state.company.employees.map((e) => `<option value="${e.id}">${e.emoji} ${esc(e.name)}（${esc(e.role)}）</option>`).join("");
    $("#assignModal").classList.remove("hidden");
  }
  if (kind === "chat") { renderChat(); $("#chatModal").classList.remove("hidden"); }
  if (kind === "reset") {
    if (confirm("会社を作り直しますか？（社員・タスク・進捗はリセット。成果物ファイルは残ります）")) { await api("/api/reset", {}); }
  }
  poll();
}

$("#assignGo").onclick = async () => {
  const detail = $("#assignWhat").value.trim();
  if (!detail) return;
  await api("/api/assign", { employeeId: $("#assignWho").value, title: detail.slice(0, 24), detail });
  $("#assignWhat").value = "";
  $("#assignModal").classList.add("hidden");
  poll();
};

function renderChat() {
  $("#chatLog").innerHTML = (state.chat || []).map((m) =>
    `<div class="chat-msg ${m.from === "社長" ? "me" : "coo"}"><span class="who">${esc(m.from)}</span>${esc(m.text)}</div>`
  ).join("");
  $("#chatLog").scrollTop = 99999;
}

$("#chatSend").onclick = async () => {
  const t = $("#chatText").value.trim();
  if (!t) return;
  $("#chatText").value = "";
  await api("/api/chat", { message: t });
  poll();
};
$("#chatText").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#chatSend").click(); });

document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest(".modal").classList.add("hidden")));

// ---------- ポーリング ----------
async function poll() {
  try {
    state = await api("/api/state");
    render();
    if (!$("#chatModal").classList.contains("hidden")) renderChat();
  } catch {}
}
poll();
setInterval(poll, 3000);
