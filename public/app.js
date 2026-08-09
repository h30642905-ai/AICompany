// AIカンパニー フロントエンド（依存ゼロ）
// キャラは常駐DOM + 徘徊AIでわらわら動く。状態は3秒ポーリング。
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

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ============================================================
// オフィスのキャラクター常駐管理（わらわらアニメーション）
// ============================================================
const office = { built: false, chars: new Map(), desks: new Map() };
const IDLE_EMOTES = ["☕", "🎵", "💬", "🌸", "😊", "📱", "🍡"];
const WORK_EMOTES = ["💭", "✍️", "📝", "🔥", "💡"];

function officeSize() {
  const el = $("#office");
  return { w: el.clientWidth, h: el.clientHeight };
}

// 机の定位置（オフィス下半分に横並び）
function deskPos(i, n) {
  const { w, h } = officeSize();
  const margin = w * 0.06;
  const span = w - margin * 2 - 90;
  return { x: margin + (span / Math.max(1, n - 1)) * i, y: h - 150 };
}

// 徘徊の目的地候補
function wanderSpots() {
  const { w, h } = officeSize();
  return [
    { x: w * 0.42, y: h * 0.36 },            // 会議テーブル
    { x: w - 120, y: h * 0.46 },             // ウォーターサーバー
    { x: w * 0.5, y: h * 0.55 },             // ラグ
    { x: w * 0.25, y: h * 0.6 },
    { x: w * 0.68, y: h * 0.4 },
    { x: w * 0.8, y: h * 0.62 },             // ねこの近く
  ];
}

function buildOffice(employees) {
  const officeEl = $("#office");
  office.chars.forEach((c) => c.el.remove());
  office.desks.forEach((d) => d.remove());
  office.chars.clear(); office.desks.clear();

  employees.forEach((e, i) => {
    const p = deskPos(i, employees.length);
    const desk = document.createElement("div");
    desk.className = "staff-desk";
    desk.style.left = p.x + 10 + "px";
    desk.style.top = p.y + 92 + "px";
    officeEl.appendChild(desk);
    office.desks.set(e.id, desk);

    const el = document.createElement("div");
    el.className = "char";
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    el.innerHTML = `
      <div class="bubble" style="display:none"></div>
      <span class="emote"></span>
      <div class="doll"><div class="face"></div><div class="body"></div></div>
      <div class="nametag"></div>
      <div class="status"></div>`;
    officeEl.appendChild(el);
    office.chars.set(e.id, { el, x: p.x, y: p.y, home: p, mode: "idle", nextMove: Date.now() + 2000 + Math.random() * 4000, emoteAt: 0 });
  });
  office.built = true;
}

function updateChars(employees) {
  employees.forEach((e) => {
    const c = office.chars.get(e.id);
    if (!c) return;
    const el = c.el;
    el.querySelector(".face").textContent = e.emoji || "🙂";
    el.querySelector(".body").style.background = e.color || "#9bc4e8";
    el.querySelector(".nametag").textContent = `${e.name}｜${e.role}`;
    const st = el.querySelector(".status");
    st.textContent = e.status === "working" ? "作業中" : "待機中";
    st.className = "status" + (e.status === "working" ? " working" : "");
    const bub = el.querySelector(".bubble");
    if (e.bubble) { bub.textContent = e.bubble; bub.style.display = ""; } else { bub.style.display = "none"; }
    c.working = e.status === "working";
  });
}

// 0.4秒ごとの「意思決定」ティック
setInterval(() => {
  if (!office.built) return;
  const now = Date.now();
  office.chars.forEach((c) => {
    const el = c.el;
    if (c.working) {
      // 作業中: 自分の机へ戻ってカタカタ。考え事エモートを回す
      if (c.mode !== "work") {
        c.mode = "work";
        moveTo(c, c.home.x, c.home.y);
      }
      el.classList.add("working");
      el.classList.remove("walking");
      if (now > c.emoteAt) {
        setEmote(el, WORK_EMOTES[Math.floor(Math.random() * WORK_EMOTES.length)]);
        c.emoteAt = now + 2200 + Math.random() * 1800;
      }
    } else {
      el.classList.remove("working");
      if (c.mode === "work") { c.mode = "idle"; c.nextMove = now + 1000; }
      // 待機中: ときどき徘徊。目的地に着いたら少し休んでまた歩く
      if (now > c.nextMove) {
        const spots = wanderSpots();
        const goHome = Math.random() < 0.35;
        const t = goHome ? c.home : spots[Math.floor(Math.random() * spots.length)];
        const jitter = () => (Math.random() - 0.5) * 40;
        moveTo(c, t.x + (goHome ? 0 : jitter()), t.y + (goHome ? 0 : jitter()));
        c.nextMove = now + 5000 + Math.random() * 7000;
        if (Math.random() < 0.5) setEmote(el, IDLE_EMOTES[Math.floor(Math.random() * IDLE_EMOTES.length)]);
        else setEmote(el, "");
      }
    }
  });
}, 400);

function moveTo(c, x, y) {
  const { w, h } = officeSize();
  x = Math.max(10, Math.min(w - 96, x));
  y = Math.max(60, Math.min(h - 150, y));
  c.el.classList.add("walking");
  c.el.classList.toggle("flip", x < c.x);
  c.el.style.left = x + "px";
  c.el.style.top = y + "px";
  c.x = x; c.y = y;
  clearTimeout(c.walkTimer);
  c.walkTimer = setTimeout(() => c.el.classList.remove("walking"), 2400);
}

function setEmote(el, emoji) {
  const em = el.querySelector(".emote");
  em.textContent = emoji;
  em.classList.toggle("show", !!emoji);
}

// 提出があった瞬間に書類が決裁トレイ方向へ飛ぶ演出
let prevPending = -1;
function paperFlyEffect() {
  const officeEl = $("#office");
  const paper = document.createElement("div");
  paper.className = "paper-fly";
  paper.textContent = "📄";
  const { w, h } = officeSize();
  paper.style.left = w / 2 + "px";
  paper.style.top = h - 160 + "px";
  officeEl.appendChild(paper);
  requestAnimationFrame(() => {
    paper.style.left = "-30px";
    paper.style.top = "40px";
    paper.style.opacity = "0";
  });
  setTimeout(() => paper.remove(), 1600);
}

// ============================================================
// 描画
// ============================================================
function render() {
  const c = state.company;
  $("#notice").textContent = state.notice || (state.busy ? "🐝 AI社員が作業中です…" : "");

  if (!c) { $("#setupModal").classList.remove("hidden"); office.built = false; return; }
  $("#setupModal").classList.add("hidden");

  $("#companyName").textContent = c.name;
  $("#goalText").textContent = c.goal;
  $("#goalBar").style.width = c.goalProgress + "%";
  $("#goalNum").textContent = c.goalProgress + "%";

  // 社長（社長室に常駐）
  $("#ceoChar").innerHTML = `
    <span class="emote show">👑</span>
    <div class="doll"><div class="face">🤴</div><div class="body" style="background:#caa2d8"></div></div>
    <div class="nametag">${esc(c.ceoName)}｜社長</div>`;

  // 社員（初回だけDOM生成、以降は状態更新のみ→アニメが途切れない）
  if (!office.built) buildOffice(c.employees);
  updateChars(c.employees);

  // 提出演出
  const pending = state.tasks.filter((t) => t.status === "確認待ち").length;
  if (prevPending >= 0 && pending > prevPending) paperFlyEffect();
  prevPending = pending;

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
    office.built = false;
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
    if (confirm("会社を作り直しますか？（社員・タスク・進捗はリセット。成果物ファイルは残ります）")) { await api("/api/reset", {}); office.built = false; }
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

// リサイズで机の位置を組み直す
window.addEventListener("resize", () => { office.built = false; if (state?.company) render(); });

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
