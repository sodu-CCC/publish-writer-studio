import { books, chapters, cards, snapshots, kv, id, exportAll, importAll, storageMode, all, corpus, chunks } from "./db.js";
import { analyzeStyle, profileToText, chunkText, buildIndex, search, buildRagBlock } from "./corpus.js";
import { runAgent, applyCriticIssues, runOutlineAgent, reviseOutlineByDeviations, suggestPlotFixes } from "./agent.js";
import { ACTIONS, chat, getSettings, saveSettings, logAI, getAILog, PRESETS } from "./ai.js";

const $ = (s) => document.querySelector(s);
const state = {
  books: [], book: null, chapters: [], chapter: null,
  cards: [], cardType: "outline", card: null,
  settings: null, action: "continue", lastLen: 0, aiResult: "",
  library: { bookId: null, chapterId: null },
  view: "library",
  corpusDocs: [], corpusIndex: null, styleProfile: null, ragEnabled: true,
  corpusDoc: null, corpusNewDraft: false, hideScrollbars: false, agentSteps: [], lastAgent: null,
};

const countWords = (t) => (t || "").replace(/\s+/g, "").length;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtTime = (iso) => new Date(iso).toLocaleString("zh-CN", { hour12: false });

function setSave(text) { $("#saveState").textContent = text; }

async function dailyAdd(delta) {
  const d = await kv.get("daily", { date: today(), count: 0 });
  if (d.date !== today()) { d.date = today(); d.count = 0; }
  d.count = Math.max(0, d.count + delta);
  await kv.set("daily", d);
  const hist = await kv.get("dailyHistory", {});
  hist[today()] = d.count;
  await kv.set("dailyHistory", hist);
  await renderStats();
  await renderStatsPanel();
}

/* ---------------- 作品 ---------------- */

async function loadBooks(selectId) {
  state.books = (await books.all()).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  if (state.books.length === 0) {
    const b = { id: id("bk_"), title: "我的第一本书", author: "", summary: "", cover: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await books.save(b); state.books = [b];
  }
  const sel = $("#bookSelect");
  sel.innerHTML = state.books.map((b) => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join("");
  const target = selectId || (state.book && state.book.id) || state.books[0].id;
  sel.value = target;
  state.book = state.books.find((b) => b.id === sel.value) || state.books[0];
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- 章节 ---------------- */

async function loadChapters(selectId) {
  state.chapters = (await chapters.of(state.book.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (state.chapters.length === 0) {
    const c = newChapterObj(1);
    await chapters.save(c); state.chapters = [c];
  }
  const target = selectId || (state.chapter && state.chapter.id) || state.chapters[0].id;
  state.chapter = state.chapters.find((c) => c.id === target) || state.chapters[0];
  renderChapterList();
  selectChapter(state.chapter.id);
}

function newChapterObj(n) {
  return {
    id: id("ch_"), bookId: state.book.id, title: `第 ${n} 章`,
    content: "", words: 0, status: "draft", order: n,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function renderChapterList() {
  const ul = $("#chapterList");
  if (!ul) return;
  ul.innerHTML = state.chapters
    .map((c) => {
      const title = c.title || "";
      // 该章是否埋了伏笔：认「所属章节」，也认正文里出现的「伏笔文段」
      const f = foreshadowOfChapter(c);
      return `<li data-id="${c.id}" class="${state.chapter && state.chapter.id === c.id ? "active" : ""}">
      <span class="t">${escapeHtml(title || "无标题")}</span>
      ${f ? '<span class="fs-mark" title="已埋伏笔">●</span>' : ""}
      <span class="t" style="flex:0;color:var(--ink-3);font-size:11px">${c.words || 0}</span>
      <button class="x" data-del="${c.id}" title="删除">✕</button></li>`;
    })
    .join("");
}

function selectChapter(cid) {
  const c = state.chapters.find((x) => x.id === cid);
  if (!c) return;
  state.chapter = c;
  $("#chapterTitle").value = c.title || "";
  $("#content").value = c.content || "";
  state.lastLen = countWords(c.content);
  renderChapterList();
  renderStats();
  setSave("已就绪");
  renderMarks();   // 切章后重画伏笔标注
}

/* ---------------- 卡片 ---------------- */

async function loadCards() {
  state.cards = (await cards.of(state.book.id, state.cardType))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  // 伏笔卡片单独缓存：章节列表要据此显示标记与悬停提示
  state.foreshadows = await cards.of(state.book.id, "foreshadow");
  if (typeof renderMarks === "function") renderMarks();
  if (typeof renderChapterList === "function") renderChapterList();
  $("#cardList").innerHTML = state.cards
    .map((c) => `<li data-card-id="${c.id}"><span class="t">${escapeHtml(c.title || "未命名")}</span></li>`)
    .join("");
}

/* ---------------- 统计 ---------------- */

async function renderStats() {
  const words = countWords($("#content").value);
  $("#wordCount").textContent = `${words} 字`;
  const d = await kv.get("daily", { date: today(), count: 0 });
  const dc = d.date === today() ? d.count : 0;
  $("#todayWords").textContent = `今日 ${dc} 字`;
  const goal = state.settings?.dailyGoal ?? 3000;
  $("#goalText").textContent = `目标 ${dc} / ${goal}`;
}

/* ---------------- 自动保存 ---------------- */

let saveTimer = null;
function scheduleSave() {
  setSave("编辑中…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 700);
}
async function doSave() {
  if (!state.chapter) return;
  const content = $("#content").value;
  const title = $("#chapterTitle").value.trim();
  Object.assign(state.chapter, {
    content, title, words: countWords(content), updatedAt: new Date().toISOString(),
  });
  await chapters.save(state.chapter);
  const b = state.books.find((x) => x.id === state.book.id);
  if (b) { b.updatedAt = new Date().toISOString(); await books.save(b); }
  state.chapters = state.chapters.map((c) => (c.id === state.chapter.id ? state.chapter : c));
  renderChapterList();
  setSave("已保存 " + new Date().toLocaleTimeString("zh-CN", { hour12: false }));
}

/* ---------------- 导出 / 导入 ---------------- */

function download(name, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

async function exportBook() {
  await doSave();
  const list = state.chapters;
  const name = state.book.title.replace(/[\\/:*?"<>|]/g, "_");
  let out = `《${state.book.title}》\n\n`;
  for (const c of list) {
    const full = await chapters.get(c.id);
    out += `${full.title}\n\n${full.content || ""}\n\n`;   // 缩进已写入正文，导出自然一致
  }
  download(`${name}.txt`, out);
}

/* ---------------- AI ---------------- */

function renderAIActions() {
  $("#aiActions").innerHTML = Object.entries(ACTIONS)
    .map(([k, a]) => `<button data-action="${k}" class="${k === state.action ? "active" : ""}">${a.label}</button>`)
    .join("");
}

function selectedOrTail() {
  const ta = $("#content");
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  if (sel) return { text: sel, isSelection: true };
  const tail = ta.value.slice(-(state.settings?.contextChars || 1500));
  return { text: tail, isSelection: false };
}

async function runAI() {
  const action = ACTIONS[state.action];
  if (!action) return;
  const { text, isSelection } = selectedOrTail();
  const extra = $("#aiPrompt").value.trim();
  if (!text.trim() && !extra && state.action !== "names") {
    alert("正文为空：请先写一点内容、选中一段，或在右侧「自定义要求」里填写。");
    return;
  }
  const words = parseInt($("#aiWords").value, 10) || 300;
  const ctx = {
    text: extra && (state.action === "names" || state.action === "rolecard") ? extra : text + (extra ? `\n\n【额外要求】${extra}` : ""),
    systemPrompt: state.settings.systemPrompt,
    bookTitle: state.book.title,
    chapterTitle: state.chapter?.title,
    words,
  };
  const messages = action.build(ctx);
  try {
    const rag = ragBlockFor(ctx.text);
    if (rag.block) {
      messages[0].content = ctx.systemPrompt + "\n\n" + rag.block;
      const info = document.getElementById("aiRagInfo");
      if (info) info.textContent = `已注入：风格画像 + ${rag.hits.length} 条范例`;
    }
  } catch (err) { console.warn("RAG 注入失败：", err); }

  $("#aiRun").disabled = true;
  $("#aiRun").textContent = "生成中…";
  $("#aiOut").textContent = "（请求中，请稍候）";
  try {
    const out = await chat(messages);
    state.aiResult = out.trim();
    $("#aiOut").textContent = state.aiResult || "（模型没有返回内容）";
    $("#aiOutActions").hidden = false;
    await logAI({
      action: state.action, model: state.settings.model, book: state.book.title,
      chapter: state.chapter?.title, chars: state.aiResult.length, usedSelection: isSelection,
    });
  } catch (e) {
    $("#aiOut").textContent = "调用失败：" + e.message;
  } finally {
    $("#aiRun").disabled = false;
    $("#aiRun").textContent = "生成";
  }
}

/* ---------------- 设置 ---------------- */

async function openSettings() {
  const s = state.settings;
  const sel = $("#preset");
  sel.innerHTML = `<option value="">— 选择预设 —</option>` +
    PRESETS.map((p) => `<option value="${p.baseUrl}|${p.model}">${p.label}</option>`).join("");
  $("#baseUrl").value = s.baseUrl; $("#apiKey").value = s.apiKey; $("#model").value = s.model;
  $("#temperature").value = s.temperature; $("#contextChars").value = s.contextChars;
  $("#dailyGoal").value = s.dailyGoal ?? 3000;
  $("#fontSize").value = state.settings.fontSize ?? 16;
  $("#settingsDialog").showModal();
}

async function applyFontSize(px) {
  const v = parseInt(px, 10);
  if (v >= 12 && v <= 28) $("#content").style.fontSize = v + "px";
}

/* ---------------- 绑定 ---------------- */

/* ==================================================================
   卡片弹窗用「非模态」浮层（不是 showModal）
   原因：showModal 会让背景整页 inert —— 正文既不能聚焦也不能选字，
   于是"在正文里选中一段 → 点取当前选中"这条路径物理上走不通。
   改成 show() 之后：正文照常可选，弹窗浮在右上角，也可以拖着挪开。
   ================================================================== */
let cardDialogOpenedAt = 0;

function showCardDialog() {
  const d = document.getElementById("cardDialog");
  if (!d) return;
  d.classList.add("modeless");
  cardDialogOpenedAt = Date.now();
  if (!d.open) d.show();
}

/* 非模态时：点弹窗内部不关；点正文（要选字）也不关；点别处才关。 */
document.addEventListener("click", (e) => {
  const d = document.getElementById("cardDialog");
  if (!d || !d.open || !d.classList.contains("modeless")) return;
  if (Date.now() - cardDialogOpenedAt < 300) return;      // 刚打开，别自己关掉
  if (d.contains(e.target)) return;                       // 点在弹窗里
  if (e.target.closest && e.target.closest("#content, #previewContent")) return; // 在正文里选字
  if (justActivatedWindow()) return;
  d.close();
});

/* ==================================================================
   次级菜单：每次打开都回到干净状态
   以前弹窗只 showModal()，上一次跑完的日志 / 草稿 / 输入会一直留着，
   不刷新页面就一直显示上一次的内容。这里统一在打开时还原成初始状态。
   ================================================================== */

const DIALOG_RESET = {
  agentDialog: ["agentGoal", "agentLog", "agentDraft", "agentState"],
  outlineDialog: ["outlineLog", "outlineState"],
  importDialog: ["importBookTitle", "importFileName", "importText", "importState"],
  cardDialog: ["cardTitle", "cardBody", "cardAnchor", "anchorEnabled", "anchorMatch"],
};

const DIALOG_DEFAULTS = new Map();

/** 记下这些字段在 HTML 里的初始值（作为"干净状态"的基准） */
function snapshotDialogDefaults() {
  for (const ids of Object.values(DIALOG_RESET)) {
    for (const fid of ids) {
      const el = document.getElementById(fid);
      if (!el || DIALOG_DEFAULTS.has(fid)) continue;
      const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
      DIALOG_DEFAULTS.set(fid, el.type === "checkbox" ? el.checked : (isField ? el.value : el.innerHTML));
    }
  }
}

/** 把某个次级菜单里的一次性字段还原成初始状态 */
function resetDialog(id) {
  const ids = DIALOG_RESET[id];
  if (!ids) return;
  for (const fid of ids) {
    const el = document.getElementById(fid);
    if (!el) continue;
    const def = DIALOG_DEFAULTS.get(fid) ?? "";
    if (el.type === "checkbox") el.checked = !!def;
    else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.value = def;
    else el.innerHTML = def;
  }
  if (id === "outlineDialog") {
    outlineResult = null;
    renderOutlineResult(null);
  }
}

function bind() {
  $("#bookSelect").addEventListener("change", async (e) => {
    await doSave();
    state.book = state.books.find((b) => b.id === e.target.value);
    state.chapter = null;
    await loadChapters(); await loadCards();
  });

  $("#newBook").addEventListener("click", async () => {
    const t = prompt("作品名称：", "新作品");
    if (!t) return;
    const b = { id: id("bk_"), title: t.trim(), author: "", summary: "", cover: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await books.save(b);
    await loadBooks(b.id); state.chapter = null;
    await loadChapters(); await loadCards();
  });

  $("#renameBook").addEventListener("click", async () => {
    const t = prompt("新的作品名称：", state.book.title);
    if (!t) return;
    state.book.title = t.trim(); await books.save(state.book);
    await loadBooks(state.book.id);
  });

  $("#deleteBook").addEventListener("click", async () => {
    if (!confirm(`删除《${state.book.title}》及其全部章节？此操作不可撤销。`)) return;
    for (const c of await chapters.of(state.book.id)) await chapters.remove(c.id);
    for (const k of await cards.of(state.book.id)) await cards.remove(k.id);
    await books.remove(state.book.id);
    state.book = null; state.chapter = null;
    await loadBooks(); await loadChapters(); await loadCards();
  });

  $("#newChapter").addEventListener("click", async () => {
    await doSave();
    const n = state.chapters.length + 1;
    const c = newChapterObj(n);
    await chapters.save(c);
    state.chapters.push(c);
    selectChapter(c.id);
  });

  $("#chapterList").addEventListener("click", async (e) => {
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      e.stopPropagation();
      const cid = delBtn.dataset.del;
      if (!confirm("删除这一章？")) return;
      await chapters.remove(cid);
      state.chapters = state.chapters.filter((c) => c.id !== cid);
      if (state.chapter?.id === cid) { state.chapter = null; await loadChapters(); }
      else renderChapterList();
      return;
    }
    const li = e.target.closest("[data-id]");
    if (li) { await doSave(); selectChapter(li.dataset.id); }
  });

  $("#chapterTitle").addEventListener("input", scheduleSave);
  $("#content").addEventListener("input", async () => {
    const len = countWords($("#content").value);
    await dailyAdd(len - state.lastLen);
    state.lastLen = len;
    scheduleSave();
    renderStats();
  });

  // 设定卡片
  $("#cardTabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab"); if (!t) return;
    state.cardType = t.dataset.card;
    document.querySelectorAll("#cardTabs .tab").forEach((x) => x.classList.toggle("active", x === t));
    loadCards();
  });
  $("#newCard").addEventListener("click", () => {
    state.card = null;
    resetDialog("cardDialog");
    $("#cardDialogTitle").textContent = { outline: "新建大纲", role: "新建角色", setting: "新建设定", foreshadow: "新建伏笔" }[state.cardType];
    $("#cardTitle").value = ""; $("#cardBody").value = "";
    const aBox = document.getElementById("cardAnchor");
    if (aBox) aBox.value = state.cardType === "foreshadow" ? currentSelectionText() : "";
    syncCardLabels();
    showCardDialog();
  });
  $("#cardList").addEventListener("click", async (e) => {
    const li = e.target.closest("[data-card-id]"); if (!li) return;
    const c = await cards.get(li.dataset.cardId);
    if (!c) return;
    state.card = c;
    resetDialog("cardDialog");
    $("#cardDialogTitle").textContent = "编辑卡片";
    syncCardLabels();
    $("#cardTitle").value = c.title || ""; $("#cardBody").value = c.body || "";
    document.getElementById("cardAnchor").value = c.anchor || "";
    const anchorSw = document.getElementById("anchorEnabled");
    if (anchorSw) anchorSw.checked = !c.anchorOff;
    refreshAnchorMatch();
    showCardDialog();
  });
  $("#cardSave").addEventListener("click", async () => {
    const c = state.card || { id: id("cd_"), bookId: state.book.id, type: state.cardType, createdAt: new Date().toISOString() };
    c.title = $("#cardTitle").value.trim() || "未命名";
    c.body = $("#cardBody").value;
    c.anchor = state.cardType === "foreshadow" ? (document.getElementById("cardAnchor").value || "").trim() : "";
    const anchorSw = document.getElementById("anchorEnabled");
    c.anchorOff = state.cardType === "foreshadow" ? !(anchorSw ? anchorSw.checked : true) : false;
    c.updatedAt = new Date().toISOString();
    await cards.save(c);
    const noAnchor = c.type === "foreshadow" && !String(c.anchor || "").trim();
    // 「所属章节」里像不像正文片段（有句读标点或比较长）
    const titleLooksLikeBody = /[。！？，；：]/.test(String(c.title || "")) || String(c.title || "").length >= 10;
    state.card = null;
    await loadCards();
    // 只在「看起来填错框」时提醒；单纯清空文段（主动撤掉虚线）不弹窗打扰
    if (noAnchor && titleLooksLikeBody) {
      alert("已保存，但虚线只认「伏笔文段」，不会认「所属章节」。\n\n你填在「所属章节」里的内容看起来是正文片段，想画虚线请把它填到上面的「伏笔文段」。\n\n（也可以先在正文里选中那一句，再新建伏笔，点「取当前选中」）");
    }
  });
  $("#cardDelete").addEventListener("click", async () => {
    if (!state.card) { $("#cardDialog").close(); return; }
    if (!confirm("删除这张卡片？")) return;
    await cards.remove(state.card.id);
    state.card = null; $("#cardDialog").close(); await loadCards();
  });

  // 快照
  $("#snapshot").addEventListener("click", async () => {
    await doSave();
    await snapshots.save({
      id: id("ss_"), chapterId: state.chapter.id, title: state.chapter.title,
      content: $("#content").value, words: countWords($("#content").value), createdAt: new Date().toISOString(),
    });
    setSave("已存快照");
  });
  $("#history").addEventListener("click", openHistory);

  $("#exportBook").addEventListener("click", exportBook);
  $("#importTxt").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".txt,text/plain";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const text = await f.text();
      const ta = $("#content");
      ta.value = ta.value ? ta.value + "\n\n" + text : text;
      ta.dispatchEvent(new Event("input"));
    };
    inp.click();
  });

  // AI
  $("#aiActions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    state.action = b.dataset.action;
    renderAIActions();
  });
  $("#aiRun").addEventListener("click", runAI);
  $("#aiAppend").addEventListener("click", () => {
    const ta = $("#content");
    if (!state.aiResult) { alert("还没有可插入的内容，请先生成。"); return; }
    // 有选区时要先删掉选区再写入 —— 否则「润色 / 扩写 / 缩写」这类结果
    // 会把原文原封不动留在后面，看起来就是"多出一段文本"。
    // 这也是编辑器里输入/粘贴的通用行为：有选区就替换。
    const s = ta.selectionStart ?? ta.value.length;
    const e = ta.selectionEnd ?? s;
    ta.setRangeText(state.aiResult, s, e, "end");
    ta.focus();
    ta.dispatchEvent(new Event("input"));
  });
  $("#aiReplace").addEventListener("click", () => {
    const ta = $("#content");
    const s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) { alert("请先在正文中选中要被替换的内容。"); return; }
    ta.value = ta.value.slice(0, s) + state.aiResult + ta.value.slice(e);
    ta.focus(); ta.dispatchEvent(new Event("input"));
  });
  $("#aiCopy").addEventListener("click", () => navigator.clipboard.writeText(state.aiResult));
  $("#aiLog").addEventListener("click", openLog);

  // 设置
  $("#btnSettings").addEventListener("click", openSettings);
  $("#preset").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const [baseUrl, model] = e.target.value.split("|");
    $("#baseUrl").value = baseUrl; $("#model").value = model;
  });
  $("#saveSettings").addEventListener("click", async () => {
    state.settings = await saveSettings({
      baseUrl: $("#baseUrl").value.trim(), apiKey: $("#apiKey").value.trim(), model: $("#model").value.trim(),
      temperature: parseFloat($("#temperature").value) || 0.85,
      contextChars: parseInt($("#contextChars").value, 10) || 1500,
      dailyGoal: parseInt($("#dailyGoal").value, 10) || 3000,
      fontSize: parseInt($("#fontSize").value, 10) || 16,
    });
    await applyFontSize(state.settings.fontSize);
    renderAIStatus(); renderStats();
  });
  $("#fontSize").addEventListener("input", (e) => applyFontSize(e.target.value));
  $("#exportAll").addEventListener("click", async () => download("writer-studio-backup.json", JSON.stringify(await exportAll(), null, 2)));
  $("#importAllBtn").addEventListener("click", () => $("#importAllFile").click());
  $("#importAllFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const n = await importAll(JSON.parse(await f.text()));
      alert(`已导入 ${n} 条记录，页面将刷新。`);
      location.reload();
    } catch (err) { alert("导入失败：" + err.message); }
  });
}

function renderAIStatus() {
  $("#aiStatus").textContent = state.settings?.apiKey ? `已配置 · ${state.settings.model}` : "未配置";
}

async function openHistory() {
  const list = await snapshots.of(state.chapter.id);
  list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  $("#historyList").innerHTML = list.length
    ? list.map((s) => `<li><span class="t">${fmtTime(s.createdAt)} · ${s.words} 字</span>
        <button class="mini" data-restore="${s.id}">恢复</button>
        <button class="x" data-delsnap="${s.id}">✕</button></li>`).join("")
    : `<li><span class="t" style="color:var(--ink-3)">暂无快照</span></li>`;
  $("#historyDialog").showModal();
}
$("#historyList")?.addEventListener("click", async (e) => {
  const r = e.target.closest("[data-restore]"), d = e.target.closest("[data-delsnap]");
  if (r) {
    const all = await snapshots.of(state.chapter.id);
    const snap = all.find((x) => x.id === r.dataset.restore);
    if (snap && confirm("用该快照覆盖当前正文？")) {
      $("#content").value = snap.content;
      $("#content").dispatchEvent(new Event("input"));
      $("#historyDialog").close();
    }
  } else if (d) {
    await snapshots.remove(d.dataset.delsnap);
    openHistory();
  }
});
$("#closeHistory")?.addEventListener("click", () => $("#historyDialog").close());

async function openLog() {
  const logs = (await getAILog()).slice().reverse();
  $("#logList").innerHTML = logs.length
    ? logs.map((l) => `<li><span class="t">${fmtTime(l.at)} · ${l.action} · ${l.model} · ${l.chars} 字</span></li>`).join("")
    : `<li><span class="t" style="color:var(--ink-3)">暂无记录</span></li>`;
  $("#logDialog").showModal();
}
$("#closeLog")?.addEventListener("click", () => $("#logDialog").close());

/* ---------------- 启动 ---------------- */

function bootBar(text, isErr) {
  const b = document.getElementById("bootBar");
  if (!b) return;
  b.hidden = false;
  b.textContent = text;
  b.classList.toggle("err", !!isErr);
}

async function main() {
  bootBar("正在初始化…");
  state.settings = await getSettings();
  await loadBooks();
  await loadChapters();
  await loadCards();
  renderAIActions();
  renderAIStatus();
  await applyFontSize(state.settings.fontSize ?? 16);
  await renderStats();
  snapshotDialogDefaults();
  bind();
  initLibrary();
  await loadCorpus();
  initCorpusUI();
  initSettingsExtras();
  await applyTheme();
  await applyScrollbars();
  await applyTypeset();
  initFxUI();
  initAgentUI();
  initFindUI();
  initOutlineUI();
  initForeshadowUI();
  initFindButton();
  initMarksUI();
  initImportUI();
  bindScrollHints();
  await renderCorpus();
  await renderCatalog();
  await renderStatsPanel();
  showView("library");
  window.addEventListener("beforeunload", () => { doSave(); });

  if (storageMode() === "ls") {
    bootBar("已启用兼容模式（localStorage）：功能一致，数据同样只存在本机。");
    setTimeout(() => { const b = document.getElementById("bootBar"); if (b) b.hidden = true; }, 5000);
  } else {
    const b = document.getElementById("bootBar");
    if (b) b.hidden = true;
  }
}

main().catch((e) => {
  console.error(e);
  bootBar("启动失败：" + (e && e.message ? e.message : e) + " —— 请把这条信息发给开发者。", true);
});

/* ==================================================================
   书库（前置页）：目录 / 统计缩略条 / 书目浮层 / 右侧可编辑预览
   ================================================================== */

const COVER_COLORS = ["#3b5bdb", "#2f7d6e", "#8a5a2b", "#7a3f8a", "#2b6cb0", "#9c4221", "#276749", "#553c9a"];

function colorFor(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function coverHtml(book, large) {
  const cls = "cover" + (large ? " cover-lg" : "");
  if (book && book.cover) return `<div class="${cls}"><img src="${book.cover}" alt=""></div>`;
  const ch = escapeHtml(((book && book.title) || "书").trim().slice(0, 1) || "书");
  return `<div class="${cls}" style="background:${colorFor(book && book.title)}">${ch}</div>`;
}

async function bookWordCounts() {
  const list = await all("chapters");
  const m = {};
  for (const c of list) {
    const e = m[c.bookId] || (m[c.bookId] = { words: 0, chapters: 0 });
    e.words += c.words || 0;
    e.chapters += 1;
  }
  return m;
}

/* ---------- 1&2. 目录列表 ---------- */

/** 书架检索关键词（原始大小写，用于回显） */
function libQueryRaw() {
  const el = document.getElementById("libSearch");
  return el ? el.value.trim() : "";
}

/** 一本书是否命中检索词：书名 / 作者 / 梗概 任一包含即算 */
function matchBook(b, qLower) {
  if (!qLower) return true;
  return [b.title, b.author, b.summary].some((s) => String(s || "").toLowerCase().includes(qLower));
}

async function renderCatalog() {
  const box = $("#catalog");
  if (!box) return;
  const raw = libQueryRaw();
  const qLower = raw.toLowerCase();
  const all = state.books;
  const bs = all.filter((b) => matchBook(b, qLower));
  const cnt = $("#catalogCount");
  if (cnt) cnt.textContent = qLower ? `${bs.length} / ${all.length} 本` : `${all.length} 本`;
  const clr = document.getElementById("libSearchClear");
  if (clr) clr.hidden = !raw;
  if (!all.length) {
    box.innerHTML = `<div class="catalog-empty">还没有作品，点右上角「＋ 新建作品」开始。</div>`;
    return;
  }
  if (!bs.length) {
    box.innerHTML = `<div class="catalog-empty">没有匹配「${escapeHtml(raw)}」的作品。</div>`;
    return;
  }
  const counts = await bookWordCounts();
  box.innerHTML = bs.map((b) => {
    const c = counts[b.id] || { words: 0, chapters: 0 };
    return `<div class="book-row${state.library.bookId === b.id ? " active" : ""}" data-book="${b.id}">
      ${coverHtml(b, false)}
      <div class="book-main">
        <div class="book-name">${escapeHtml(b.title || "未命名")}</div>
        ${b.author ? `<div class="book-author">${escapeHtml(b.author)}</div>` : ""}
        <div class="book-summary">${escapeHtml(b.summary || "（还没有梗概，点开后可以补上）")}</div>
        <div class="book-meta"><span>${c.chapters} 章</span><span>${c.words} 字</span><span>更新 ${fmtDate(b.updatedAt)}</span></div>
      </div>
    </div>`;
  }).join("");
}

/* ---------- 4&5. 选中书目：浮层 + 右侧预览 ---------- */

function showPreview(on) {
  const p = $("#previewPane");
  if (p) p.hidden = !on;
}

async function selectBook(bookId) {
  state.library.bookId = bookId;
  state.book = state.books.find((b) => b.id === bookId) || null;
  if (!state.book) return;
  await loadChapters();
  await loadCards();
  renderCatalog();
  renderOverlay();
  showPreview(true);
  loadPreviewChapter(state.chapter ? state.chapter.id : null);
}

function renderOverlay() {
  const b = state.book;
  const card = $("#overlayCard");
  if (!b || !card) return;
  const totals = state.chapters.reduce((s, c) => s + (c.words || 0), 0);
  card.innerHTML = `
    <div class="ov-head">
      ${coverHtml(b, true)}
      <div style="min-width:0;flex:1">
        <div class="ov-title">${escapeHtml(b.title || "未命名")}</div>
        ${b.author ? `<div class="ov-author">${escapeHtml(b.author)}</div>` : ""}
        <div class="ov-meta"><span>${state.chapters.length} 章</span><span>${totals} 字</span><span>更新 ${fmtDate(b.updatedAt)}</span></div>
        <div class="ov-summary">${escapeHtml(b.summary || "（还没有梗概）")}</div>
        <div class="ov-actions">
          <button class="mini" data-act="edit">编辑信息</button>
          <button class="mini" data-act="newchapter">＋ 新章节</button>
          <button class="mini" data-act="writer">进写作台</button>
        </div>
      </div>
    </div>
    <div class="ov-sep"></div>
    <div class="ov-sub">章节（${state.chapters.length}）—— 点一章在右侧编辑</div>
    <div>${state.chapters.map((c) => `<div class="chapter-item${state.library.chapterId === c.id ? " active" : ""}" data-chapter="${c.id}">
        <span class="t">${escapeHtml(c.title || "无标题")}</span><span class="w">${c.words || 0} 字</span>
      </div>`).join("") || `<div class="catalog-empty">还没有章节</div>`}</div>`;
  $("#bookOverlay").hidden = false;
}

function closeOverlay(alsoClosePreview) {
  const ov = $("#bookOverlay");
  if (ov) ov.hidden = true;
  state.library.bookId = null;
  if (alsoClosePreview) { showPreview(false); state.library.chapterId = null; }
  renderCatalog();
}

function syncWriterEditor(c) {
  const t = $("#chapterTitle"), b = $("#content");
  if (t) t.value = c.title || "";
  if (b) b.value = c.content || "";
}

function loadPreviewChapter(cid) {
  if (!state.chapters || !state.chapters.length) return;
  const c = state.chapters.find((x) => x.id === cid) || state.chapters[0];
  state.chapter = c;
  state.library.chapterId = c.id;
  const sel = $("#previewChapter");
  if (sel) sel.innerHTML = state.chapters.map((x) => `<option value="${x.id}"${x.id === c.id ? " selected" : ""}>${escapeHtml(x.title || "无标题")}</option>`).join("");
  const t = $("#previewTitle"), b = $("#previewContent");
  if (t) t.value = c.title || "";
  if (b) b.value = c.content || "";
  const w = $("#previewWords");
  if (w) w.textContent = countWords(c.content) + " 字";
  const s = $("#previewState");
  if (s) s.textContent = "已就绪";
  state.lastLen = countWords(c.content);
  syncWriterEditor(c);
}

let previewTimer = null;
function schedulePreviewSave() {
  const s = $("#previewState");
  if (s) s.textContent = "编辑中…";
  clearTimeout(previewTimer);
  previewTimer = setTimeout(previewSaveNow, 700);
}

async function previewSaveNow() {
  if (!state.chapter) return;
  const content = $("#previewContent") ? $("#previewContent").value : "";
  const title = $("#previewTitle") ? $("#previewTitle").value.trim() : "";
  Object.assign(state.chapter, {
    content, title, words: countWords(content), updatedAt: new Date().toISOString(),
  });
  await chapters.save(state.chapter);
  state.chapters = state.chapters.map((c) => (c.id === state.chapter.id ? state.chapter : c));
  const w = $("#previewWords");
  if (w) w.textContent = countWords(content) + " 字";
  const s = $("#previewState");
  if (s) s.textContent = "已保存 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
  syncWriterEditor(state.chapter);
  renderChapterList();
  renderCatalog();
  renderStatsPanel();
}

/* ---------- 视图切换 ---------- */

function showView(name) {
  const lib = $("#viewLibrary"), wr = $("#viewWriter"), cp = $("#viewCorpus");
  if (lib) lib.hidden = name !== "library";
  if (wr) wr.hidden = name !== "writer";
  if (cp) cp.hidden = name !== "corpus";
  // 顶栏三个页面按钮：当前所在页面高亮成「标签页」
  for (const [bid, key] of [["navLibrary", "library"], ["navWriter", "writer"], ["navCorpus", "corpus"]]) {
    const b = document.getElementById(bid);
    if (b) b.classList.toggle("nav-on", name === key);
  }
  state.view = name;
  if (name === "library") { renderCatalog(); renderStatsPanel(); }
  if (name === "corpus") { renderCorpus(); }
}

/* ---------- 3. 左侧统计缩略条 ---------- */

async function renderStatsPanel() {
  const counts = await bookWordCounts();
  const totalWords = Object.values(counts).reduce((s, c) => s + c.words, 0);
  const totalChapters = Object.values(counts).reduce((s, c) => s + c.chapters, 0);
  const d = await kv.get("daily", { date: today(), count: 0 });
  const dc = d.date === today() ? d.count : 0;
  const goal = state.settings?.dailyGoal ?? 3000;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("statTotal", totalWords);
  set("statToday", dc);
  set("statBooks", state.books.length);
  set("statChapters", totalChapters);
  set("statGoalText", `${dc} / ${goal}`);
  const bar = document.getElementById("statGoalBar");
  if (bar) bar.style.width = Math.min(100, goal ? (dc / goal) * 100 : 0) + "%";

  const hist = await kv.get("dailyHistory", {});
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    days.push({ k, v: hist[k] || 0 });
  }
  const mx = Math.max(1, ...days.map((x) => x.v));
  const sp = document.getElementById("spark");
  if (sp) {
    sp.innerHTML = days.map((x, i) =>
      `<i class="${i === 6 ? "today" : ""}" style="height:${Math.max(3, Math.round((x.v / mx) * 100))}%" title="${x.k}: ${x.v} 字"></i>`
    ).join("");
  }
  set("sparkMax", `峰值 ${mx} 字/天`);
  await renderStatsExtra(counts, totalWords, totalChapters);
}

/* ---------- 作品信息编辑 ---------- */

let editingBook = null;
let pendingCover; // undefined=不改, null=移除, string=新封面

function setCoverPreview(book) {
  const el = $("#bookCoverPreview");
  if (!el) return;
  if (book && book.cover) { el.style.background = ""; el.innerHTML = `<img src="${book.cover}" alt="">`; }
  else { el.innerHTML = ""; el.style.background = colorFor(book && book.title); el.textContent = (((book && book.title) || "书").trim().slice(0, 1) || "书"); }
}

function makeCover(file, w, h) {
  w = w || 240; h = h || 320;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      const s = Math.max(w / img.width, h / img.height);
      const dw = img.width * s, dh = img.height * s;
      g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = URL.createObjectURL(file);
  });
}

function openBookDialog(book) {
  if (!book) return;
  editingBook = book;
  pendingCover = undefined;
  $("#bookTitle").value = book.title || "";
  $("#bookAuthor").value = book.author || "";
  $("#bookSummary").value = book.summary || "";
  setCoverPreview(book);
  $("#bookDialog").showModal();
}

/* ---------- 书库事件绑定 ---------- */

function initLibrary() {
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  on("#navLibrary", "click", () => showView("library"));
  on("#navWriter", "click", () => showView("writer"));

  on("#statToggle", "click", () => {
    const bar = $("#statBar"), panel = $("#statPanel");
    const open = !bar.classList.contains("open");
    bar.classList.toggle("open", open);
    panel.hidden = !open;
    if (open) renderStatsPanel();
  });

  on("#catalog", "click", (e) => {
    const row = e.target.closest("[data-book]");
    if (row) selectBook(row.dataset.book);
  });

  on("#overlayMask", "click", () => { if (!justActivatedWindow()) closeOverlay(true); });

  on("#overlayCard", "click", async (e) => {
    const ch = e.target.closest("[data-chapter]");
    if (ch) {
      loadPreviewChapter(ch.dataset.chapter);
      $("#bookOverlay").hidden = true;
      state.library.bookId = state.book ? state.book.id : null;
      renderCatalog();
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) {
      // 第 5 条：再次点击浮层上的书目详情，直接进入写作台
      if (e.target.closest(".ov-head")) {
        $("#bookOverlay").hidden = true;
        showView("writer");
        if (state.chapter) selectChapter(state.chapter.id);
      }
      return;
    }
    const a = act.dataset.act;
    if (a === "edit") openBookDialog(state.book);
    else if (a === "newchapter") {
      const n = state.chapters.length + 1;
      const c = newChapterObj(n);
      await chapters.save(c);
      state.chapters.push(c);
      renderOverlay();
      loadPreviewChapter(c.id);
    } else if (a === "writer") {
      $("#bookOverlay").hidden = true;
      showView("writer");
      if (state.chapter) selectChapter(state.chapter.id);
    }
  });

  on("#previewChapter", "change", (e) => { previewSaveNow().then(() => loadPreviewChapter(e.target.value)); });
  on("#previewTitle", "input", schedulePreviewSave);
  // 二级菜单：章节标题默认只读，双击才可编辑
  const pt = $("#previewTitle");
  if (pt) {
    pt.addEventListener("dblclick", () => { pt.readOnly = false; pt.focus(); pt.select(); });
    pt.addEventListener("blur", () => { pt.readOnly = true; previewSaveNow(); });
    pt.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); pt.blur(); }
      else if (e.key === "Escape") {
        if (state.chapter) pt.value = state.chapter.title || "";
        pt.blur();
      }
    });
  }
  on("#previewContent", "input", async () => {
    const len = countWords($("#previewContent").value);
    await dailyAdd(len - state.lastLen);
    state.lastLen = len;
    const w = $("#previewWords");
    if (w) w.textContent = len + " 字";
    schedulePreviewSave();
  });
  on("#previewSave", "click", previewSaveNow);
  on("#previewOpenWriter", "click", () => { showView("writer"); if (state.chapter) selectChapter(state.chapter.id); });

  on("#libSearch", "input", () => renderCatalog());
  on("#libSearch", "keydown", (e) => {
    if (e.key === "Escape") { e.target.value = ""; renderCatalog(); }
  });
  on("#libSearchClear", "click", () => {
    const el = document.getElementById("libSearch");
    if (el) { el.value = ""; el.focus(); }
    renderCatalog();
  });

  on("#libNewBook", "click", async () => {
    const b = {
      id: id("bk_"), title: "新作品", author: "", summary: "",
      cover: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await books.save(b);
    await loadBooks(b.id);
    state.chapter = null;
    await loadChapters();
    await loadCards();
    await renderCatalog();
    openBookDialog(b);
  });

  on("#bookCoverFile", "change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      pendingCover = await makeCover(f);
      setCoverPreview({ title: $("#bookTitle").value, cover: pendingCover });
    } catch (err) { alert("封面处理失败：" + err.message); }
  });
  on("#bookCoverRemove", "click", () => { pendingCover = null; setCoverPreview({ title: $("#bookTitle").value, cover: "" }); });

  on("#bookSave", "click", async () => {
    if (!editingBook) return;
    editingBook.title = $("#bookTitle").value.trim() || "未命名";
    editingBook.author = $("#bookAuthor").value.trim();
    editingBook.summary = $("#bookSummary").value.trim();
    if (pendingCover !== undefined) editingBook.cover = pendingCover;
    editingBook.updatedAt = new Date().toISOString();
    await books.save(editingBook);
    await loadBooks(editingBook.id);
    state.book = state.books.find((x) => x.id === editingBook.id) || state.book;
    await renderCatalog();
    if (state.library.bookId) renderOverlay();
    editingBook = null; pendingCover = undefined;
  });

  on("#bookDelete", "click", async () => {
    if (!editingBook) return;
    if (!confirm(`删除《${editingBook.title}》及其全部章节？此操作不可撤销。`)) return;
    for (const c of await chapters.of(editingBook.id)) await chapters.remove(c.id);
    for (const k of await cards.of(editingBook.id)) await cards.remove(k.id);
    await books.remove(editingBook.id);
    editingBook = null;
    closeOverlay(true);
    state.book = null; state.chapter = null;
    await loadBooks();
    await loadChapters();
    await loadCards();
    await renderCatalog();
    await renderStatsPanel();
  });
}

/* ==================================================================
   语料库 / 风格画像 / RAG（采集 → 索引 → 生成时注入）
   ================================================================== */

async function loadCorpus() {
  const docs = await corpus.all();
  const allChunks = await chunks.all();
  state.corpusDocs = docs;
  state.corpusIndex = buildIndex(allChunks);
  state.styleProfile = await kv.get("styleProfile", null);
  state.ragEnabled = await kv.get("ragEnabled", true);
  return { docs, chunks: allChunks };
}

function corpusStats() {
  const docs = state.corpusDocs || [];
  const words = docs.reduce((s, d) => s + (d.words || 0), 0);
  const n = state.corpusIndex ? state.corpusIndex.docs.length : 0;
  return { docs: docs.length, words, chunks: n };
}

async function renderCorpus() {
  const st = corpusStats();
  const el = $("#corpusStat");
  if (el) el.textContent = `${st.docs} 篇 · ${st.words} 字 · ${st.chunks} 片段`;

  renderStyleBox();
  const cb = $("#ragEnabled");
  if (cb) cb.checked = !!state.ragEnabled;

  const ul = $("#corpusList");
  if (ul) {
    const docs = (state.corpusDocs || []).slice().sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));
    ul.innerHTML = docs.length
      ? docs.map((d) => `<li data-doc="${d.id}" class="${state.corpusDoc && state.corpusDoc.id === d.id ? "corpus-list-item active" : "corpus-list-item"}"><span class="t">${escapeHtml(d.title || "未命名")}</span>
          <span style="color:var(--ink-3);font-size:11px">${d.words || 0} 字</span>
          <button class="x" data-delcorpus="${d.id}" title="删除">✕</button></li>`).join("")
      : `<li><span class="t" style="color:var(--ink-3)">还没有语料</span></li>`;
  }
  // 右侧详情常驻：没有选中、也不是新建草稿时，自动选第一条，避免右侧空白
  if (!state.corpusDoc && !state.corpusNewDraft) {
    const first = (state.corpusDocs || [])[0];
    if (first) openCorpusDoc(first.id);
  }
}

/** 采集一个作品的全部章节 */
async function collectBook(book) {
  const list = (await chapters.of(book.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const parts = [];
  for (const c of list) {
    const full = await chapters.get(c.id);
    const t = (full && full.content) || "";
    if (t.trim()) parts.push(t);
  }
  const text = parts.join("\n\n");
  if (!text.trim()) return { added: 0, words: 0 };
  return collectText(text, `《${book.title}》`, "book:" + book.id);
}

/** 采集一段文本：写 corpus + chunks，并重建索引与画像 */
async function collectText(text, title, source) {
  const t = String(text || "").trim();
  if (!t) return { added: 0, words: 0 };
  const words = t.replace(/\s+/g, "").length;
  const doc = {
    id: id("doc_"), title: title || "未命名", source: source || "manual",
    words, chars: t.length, addedAt: new Date().toISOString(),
    text: t.length > 800000 ? t.slice(0, 800000) : t,
  };
  await corpus.save(doc);

  const pieces = chunkText(t);
  for (const p of pieces) {
    await chunks.save({ id: id("ck_"), docId: doc.id, text: p, len: p.length });
  }
  await rebuildStyle();
  await loadCorpus();
  await renderCorpus();
  return { added: 1, words, pieces: pieces.length };
}

/** 依据全部语料重算风格画像 */
async function rebuildStyle() {
  const docs = await corpus.all();
  const allChunks = await chunks.all();
  if (!docs.length || !allChunks.length) {
    await kv.set("styleProfile", null);
    state.styleProfile = null;
    return null;
  }
  const sample = allChunks.map((c) => c.text);
  const profile = analyzeStyle(sample.slice(0, 4000).join("\n\n"));
  await kv.set("styleProfile", profile);
  state.styleProfile = profile;
  return profile;
}

async function clearCorpus() {
  if (!confirm("清空全部语料与风格画像？此操作不可撤销。")) return;
  for (const d of await corpus.all()) {
    await chunks.removeByDoc(d.id);
    await corpus.remove(d.id);
  }
  await kv.set("styleProfile", null);
  await loadCorpus();
  await renderCorpus();
}

/** 生成前取回注入块 */
function ragBlockFor(text) {
  if (!state.ragEnabled || !state.styleProfile) return { block: "", hits: [] };
  const hits = search(state.corpusIndex, String(text || "").slice(-800), 5);
  return { block: buildRagBlock(state.styleProfile, hits), hits };
}

function initCorpusUI() {
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  on("#navCorpus", "click", () => showView("corpus"));

  on("#colCurrentBook", "click", async () => {
    if (!state.book) { alert("先在书库选一本书。"); return; }
    setSave("采集中…");
    const r = await collectBook(state.book);
    setSave("已就绪");
    alert(r.words ? `已采集《${state.book.title}》：${r.words} 字，${r.pieces} 个片段。` : "这本书还没有正文内容。");
  });

  on("#colAllBooks", "click", async () => {
    setSave("采集中…");
    let docs = 0, words = 0;
    for (const b of state.books) {
      const r = await collectBook(b);
      docs += r.added; words += r.words;
    }
    setSave("已就绪");
    alert(`采集完成：${docs} 篇，共 ${words} 字。`);
  });

  on("#colPaste", "click", async () => {
    const t = prompt("粘贴要采集的文本（你自己的作品）：");
    if (!t || !t.trim()) return;
    const title = (prompt("给这段语料起个名字：", "粘贴语料") || "粘贴语料").trim();
    const r = await collectText(t, title, "manual");
    alert(`已采集 ${r.words} 字。`);
  });

  on("#colTxt", "click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".txt,text/plain";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const t = await f.text();
      const r = await collectText(t, f.name.replace(/\.txt$/i, ""), "file");
      alert(`已从 ${f.name} 采集 ${r.words} 字。`);
    };
    inp.click();
  });

  on("#colClear", "click", clearCorpus);
  on("#ragSelfTest", "click", runSelfTest);
  on("#corpusDocSave", "click", saveCorpusDoc);
  on("#corpusDocNew", "click", newCorpusDoc);
  on("#corpusDocDelete", "click", deleteCorpusDoc);

  on("#ragEnabled", "change", async (e) => {
    state.ragEnabled = e.target.checked;
    await kv.set("ragEnabled", state.ragEnabled);
  });

  on("#ragSearch", "click", () => {
    const q = $("#ragQuery") ? $("#ragQuery").value.trim() : "";
    const box = $("#ragHits");
    if (!q) { if (box) box.innerHTML = ""; return; }
    const hits = search(state.corpusIndex, q, 6);
    if (box) {
      box.innerHTML = hits.length
        ? hits.map((h) => `<div class="rag-hit"><span class="sc">score ${h.score.toFixed(2)}</span>${escapeHtml(h.chunk.text.slice(0, 260))}${h.chunk.text.length > 260 ? "……" : ""}</div>`).join("")
        : `<div class="rag-hit">没有命中，先采集一些语料。</div>`;
    }
  });

  on("#corpusList", "click", async (e) => {
    const del = e.target.closest("[data-delcorpus]");
    if (del) {
      e.stopPropagation();
      if (!confirm("删除这条语料？")) return;
      const did = del.dataset.delcorpus;
      if (state.corpusDoc && state.corpusDoc.id === did) state.corpusDoc = null;
      await chunks.removeByDoc(did);
      await corpus.remove(did);
      const t = $("#corpusDocTitle"), x = $("#corpusDocText"), s = $("#corpusDocState");
      if (t) t.value = ""; if (x) x.value = ""; if (s) s.textContent = "";
      await rebuildStyle();
      await loadCorpus();
      await renderCorpus();
      return;
    }
    const li = e.target.closest("[data-doc]");
    if (li) openCorpusDoc(li.dataset.doc);
  });
}

/* ---------- 设置增强：测试连通性 ---------- */
function initSettingsExtras() {
  const btn = document.getElementById("testConn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const baseUrl = document.getElementById("baseUrl").value.trim();
    const apiKey = document.getElementById("apiKey").value.trim();
    const model = document.getElementById("model").value.trim();
    if (!baseUrl || !apiKey || !model) { alert("请先填写 Base URL / API Key / 模型。"); return; }
    btn.disabled = true; btn.textContent = "测试中…";
    const t0 = Date.now();
    try {
      const out = await chat([{ role: "user", content: "回复两个字：正常" }],
        { baseUrl, apiKey, model, maxTokens: 16, temperature: 0 });
      alert(`✅ 连接成功（${Date.now() - t0} ms）\n模型返回：${String(out).slice(0, 80)}`);
    } catch (e) {
      alert(`❌ 连接失败：\n${e.message}\n\n常见原因：\n· Base URL 结尾要带 /v1\n· 密钥无效或余额不足\n· 该域名未授权（扩展详情页 → 网站访问权限）`);
    } finally {
      btn.disabled = false; btn.textContent = "测试连接";
    }
  });
}

/* ==================================================================
   本次新增：主题 / 排版格式 / 标题标记 / logo 回家 / 弹窗外点关闭 / 统计补充
   ================================================================== */

const FONT_STACK = {
  song: '"Songti SC", SimSun, "Noto Serif SC", serif',
  hei: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  kai: '"Kaiti SC", KaiTi, STKaiti, "楷体", serif',
  fang: 'FangSong, "FangSong_GB2312", "仿宋", serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const DEFAULT_TYPESET = { font: "song", size: 16, line: 1.8, indent: true, indentChars: 2 };

const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- 2) 主题 ---------- */

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

async function applyTheme(name, custom) {
  const cur = state.theme || (await kv.get("theme", { name: "default", custom: "" }));
  const th = { name: name || cur.name || "default", custom: custom !== undefined ? custom : (cur.custom || "") };
  document.documentElement.dataset.theme = th.name === "custom" ? "default" : th.name;
  const root = document.documentElement;
  if (th.name === "custom" && th.custom) {
    const rgb = hexToRgb(th.custom);
    root.style.setProperty("--accent", th.custom);
    if (rgb) root.style.setProperty("--accent-2", `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.14)`);
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-2");
  }
  state.theme = th;
  await kv.set("theme", th);
  document.querySelectorAll(".theme-dot").forEach((d) => {
    d.classList.toggle("active", d.dataset.theme === th.name || (th.name === "custom" && d.dataset.theme === "default"));
  });
  const tc = document.getElementById("themeCustom");
  if (tc && th.custom) tc.value = th.custom;
}

/* ---------- 1) 排版格式 ---------- */

function paintTypeset() {
  const ts = state.typeset || DEFAULT_TYPESET;
  for (const sel of ["#content", "#previewContent"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.style.fontFamily = FONT_STACK[ts.font] || FONT_STACK.song;
    el.style.fontSize = (ts.size || 16) + "px";
    el.style.lineHeight = String(ts.line || 1.8);
    if (typeof renderMarks === "function") renderMarks();   // 排版变化后镜像需重新对齐
    // 注意：不再用 CSS text-indent —— <textarea> 只能缩进第一行，
    // 段落级缩进改为写入真实的「　」字符（见 effectiveIndent / normalizeIndent）
  }
}

function syncFmtUI() {
  const ts = state.typeset || DEFAULT_TYPESET;
  document.querySelectorAll('.fmtbar [data-fmt="font"]').forEach((s) => { s.value = ts.font; });
  document.querySelectorAll('.fmtbar [data-fmt="size"]').forEach((s) => { s.value = String(ts.size); });
  document.querySelectorAll('.fmtbar [data-fmt="line"]').forEach((s) => { s.value = String(ts.line); });
  document.querySelectorAll('.fmtbar [data-fmt="indent"]').forEach((c) => { c.checked = !!ts.indent; });
  document.querySelectorAll('.fmtbar [data-fmt="indentChars"]').forEach((i) => { i.value = String(ts.indentChars ?? 2); });
}

async function applyTypeset(patch) {
  state.typeset = { ...(state.typeset || DEFAULT_TYPESET), ...(patch || {}) };
  paintTypeset();
  syncFmtUI();
  await kv.set("typeset", state.typeset);
}

/* ---------- 1) 标题标记 ---------- */

function insertHead(level) {
  const ta = state.activeEditor || document.getElementById("content");
  if (!ta) return;
  const val = ta.value;
  const pos = ta.selectionStart != null ? ta.selectionStart : val.length;
  const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
  let lineEnd = val.indexOf("\n", pos);
  if (lineEnd < 0) lineEnd = val.length;
  const line = val.slice(lineStart, lineEnd);
  const stripped = line.replace(/^#{1,6}\s*/, "");
  const prefix = level === 0 ? "" : "#".repeat(level) + " ";
  ta.value = val.slice(0, lineStart) + prefix + stripped + val.slice(lineEnd);
  ta.focus();
  const np = lineStart + prefix.length;
  ta.setSelectionRange(np, np + stripped.length);
  ta.dispatchEvent(new Event("input"));
}

/* ---------- 5) 所有弹窗：点外面就关闭（回到前置页面） ---------- */

/* 整个浏览器窗口不在最前面时，第一次点击只是"把窗口激活"，
   不应该顺手把弹窗也关掉 —— 否则从别的程序切回来，点一下就丢掉了当前菜单。

   判定方式：监听 blur 记一个标记，"回到前台后的第一次点击"直接吞掉并清标记。
   不用"距 focus 多少毫秒"这种时间窗口 —— 那在不同机器 / CI 上会时灵时不灵。
   只认 blur，也天然避开了"页面刚打开时的 focus 事件"被误伤。 */
let windowWasBlurred = false;
window.addEventListener("blur", () => { windowWasBlurred = true; });

/** 这次点击是不是"用来把窗口唤醒"的那一下（最多只会命中一次） */
function justActivatedWindow() {
  if (!windowWasBlurred) return false;
  windowWasBlurred = false;
  return true;
}

function enableDialogBackdropClose() {
  document.querySelectorAll("dialog").forEach((dlg) => {
    dlg.addEventListener("click", (e) => {
      if (e.target !== dlg) return;        // 只处理命中 backdrop 的点击
      if (justActivatedWindow()) return;   // 刚被激活的那一下，忽略
      dlg.close();
    });
  });
}

/* ---------- 6) 左侧拉动条：自动补充统计 ---------- */

async function renderStatsExtra(counts, totalWords, totalChapters) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const hist = await kv.get("dailyHistory", {});

  // 本周（周一起）
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  let week = 0;
  for (let i = dow; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); week += hist[dateKey(d)] || 0; }

  // 连续码字天数（今天为 0 则从昨天起算）
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const v = hist[dateKey(d)] || 0;
    if (v > 0) streak++;
    else if (i === 0) continue;
    else break;
  }

  set("statWeek", week);
  set("statStreak", streak);
  set("statAvg", totalChapters ? Math.round(totalWords / totalChapters) : 0);
  set("statLongest", Object.values(hist).reduce((m, v) => Math.max(m, v || 0), 0));

  // 作品字数排行
  const rank = document.getElementById("statRank");
  if (rank) {
    const rows = (state.books || [])
      .map((b) => ({ title: b.title || "未命名", w: (counts[b.id] || {}).words || 0 }))
      .sort((a, b) => b.w - a.w).slice(0, 5);
    const max = Math.max(1, ...rows.map((r) => r.w));
    rank.innerHTML = rows.length
      ? rows.map((r) => `<div class="ri"><span>${escapeHtml(r.title)}</span><span>${r.w}</span></div>
          <div class="bar"><i style="width:${Math.round((r.w / max) * 100)}%"></i></div>`).join("")
      : `<div class="ri"><span>还没有作品</span><span>0</span></div>`;
  }
}

/* ---------- 初始化 ---------- */

function initFxUI() {
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  // 3) logo 盒子 -> 回主界面
  on("#brandHome", "click", () => showView("library"));

  // 1) 格式栏（两处共用 data-* 委托）
  document.querySelectorAll(".fmtbar").forEach((bar) => {
    bar.addEventListener("change", (e) => {
      const k = e.target.dataset.fmt;
      if (!k) return;
      let v;
      if (k === "indent") v = e.target.checked;
      else if (k === "indentChars") v = Math.max(0, Math.min(8, parseInt(e.target.value, 10) || 0));
      else if (k === "size") v = parseInt(e.target.value, 10);
      else if (k === "line") v = parseFloat(e.target.value);
      else v = e.target.value;
      applyTypeset({ [k]: v });
    });
    bar.addEventListener("click", (e) => {
      const h = e.target.closest("[data-head]");
      if (h) { insertHead(parseInt(h.dataset.head, 10)); return; }
      const act = e.target.closest("[data-fmt-act]");
      if (act && act.dataset.fmtAct === "normalize") normalizeCurrentChapter();
    });
  });
  // 记住最后聚焦的编辑器（给标题按钮用）
  for (const sel of ["#content", "#previewContent"]) {
    const el = document.querySelector(sel);
    if (el) {
      el.addEventListener("focus", () => { state.activeEditor = el; });
      bindAutoIndent(el);
    }
  }

  // 2) 主题选择
  document.querySelectorAll(".theme-dot").forEach((d) => {
    d.addEventListener("click", () => applyTheme(d.dataset.theme));
  });
  on("#themeCustom", "input", (e) => applyTheme("custom", e.target.value));
  on("#hideScrollbars", "change", async (e) => {
    const v = !!e.target.checked;
    document.documentElement.classList.toggle("hide-sb", v);
    state.hideScrollbars = v;
    await kv.set("hideScrollbars", v);
  });

  // 5) 弹窗外点关闭
  enableDialogBackdropClose();
  enableDialogDrag();
}

/* ---------- 自检：不调用任何模型，纯本地验证 RAG 链路 ---------- */
async function runSelfTest() {
  const box = $("#ragHits");
  const lines = [];
  const ok = (b) => (b ? "✔" : "✘");
  const st = corpusStats();
  lines.push(`【存储】${storageMode() === "ls" ? "localStorage 兼容模式" : "IndexedDB"}`);
  lines.push(`【语料】${st.docs} 篇 · ${st.words} 字 · ${st.chunks} 个片段 ${ok(st.docs > 0)}`);
  lines.push(`【画像】${state.styleProfile ? "已生成（平均句长 " + state.styleProfile.avgSentenceLen.toFixed(1) + " 字，对话占比 " + Math.round(state.styleProfile.dialogueRatio * 100) + "%）" : "未生成"} ${ok(!!state.styleProfile)}`);
  lines.push(`【索引】${state.corpusIndex && state.corpusIndex.docs.length ? state.corpusIndex.docs.length + " 块 / " + state.corpusIndex.idf.size + " 词汇" : "空"} ${ok(state.corpusIndex && state.corpusIndex.idf.size > 0)}`);

  // 检索自检：用当前正文尾部做查询
  const probe = ($("#previewContent") && $("#previewContent").value) || ($("#content") && $("#content").value) || "";
  const q = probe.slice(-300) || (state.styleProfile && state.styleProfile.topNgrams.slice(0, 5).map((x) => x.t).join("")) || "";
  if (q) {
    const hits = search(state.corpusIndex, q, 3);
    lines.push(`【检索】查询「${q.replace(/\s+/g, " ").slice(0, 24)}…」→ 命中 ${hits.length} 条 ${ok(hits.length > 0)}`);
    hits.forEach((h, i) => lines.push(`   ${i + 1}. score ${h.score.toFixed(2)}  ${h.chunk.text.slice(0, 30)}…`));
  } else {
    lines.push("【检索】没有可用查询文本（先写一点正文）");
  }

  const ready = st.chunks > 0 && !!state.styleProfile;
  lines.push("");
  lines.push(ready ? "结论：RAG 链路就绪，点「生成」时会自动注入风格与范例。" : "结论：还没就绪，先采集语料。");

  if (box) box.innerHTML = `<div class="rag-hit" style="white-space:pre-wrap">${escapeHtml(lines.join("\n"))}</div>`;
}

/* ==================================================================
   Agent 模式（人在环）：自主取证 → 分段写 → 自检 → 修订 → 草稿待采纳
   ================================================================== */

function currentEditorText() {
  const pane = $("#previewPane");
  const p = $("#previewContent");
  if (p && pane && !pane.hidden && p.value) return p.value;
  const c = $("#content");
  return c ? c.value : "";
}

function agentTools() {
  const bid = state.book ? state.book.id : null;
  return {
    get_book_meta: {
      desc: "获取当前作品信息（书名/作者/梗概）", params: [],
      run: async () => state.book ? { title: state.book.title, author: state.book.author, summary: state.book.summary } : {},
    },
    get_outline: {
      desc: "获取本书大纲卡片（把控情节走向）", params: [],
      run: async () => (await cards.of(bid, "outline")).map((c) => ({ title: c.title, body: (c.body || "").slice(0, 600) })),
    },
    get_roles: {
      desc: "获取角色卡（保持人设一致）", params: [],
      run: async () => (await cards.of(bid, "role")).map((c) => ({ title: c.title, body: (c.body || "").slice(0, 600) })),
    },
    get_settings_cards: {
      desc: "获取设定卡（世界观 / 规则）", params: [],
      run: async () => (await cards.of(bid, "setting")).map((c) => ({ title: c.title, body: (c.body || "").slice(0, 600) })),
    },
    get_chapter_list: {
      desc: "获取本书章节标题列表（了解写到哪了）", params: [],
      run: async () => (state.chapters || []).map((c) => c.title),
    },
    get_chapter_tail: {
      desc: "获取当前章已有正文的结尾，用于自然衔接", params: [],
      run: async () => ({ tail: currentEditorText().slice(-1200) }),
    },
    get_style_profile: {
      desc: "获取作者风格画像（句长 / 对话占比 / 高频用语）", params: [],
      run: async () => profileToText(state.styleProfile) || "（还没有语料画像）",
    },
    search_corpus: {
      desc: "按关键词检索作者过往作品，取得文风范例", params: ["query"],
      run: async (args) => {
        const hits = search(state.corpusIndex, (args && args.query) || "", 4);
        return hits.map((h) => h.chunk.text.slice(0, 220));
      },
    },
  };
}

let agentAbort = false;
let agentRunning = false;

async function runAgentFlow() {
  if (agentRunning) return;
  if (!state.book || !state.chapter) { alert("先在书库选一本书并打开一章。"); return; }
  if (!state.settings || !state.settings.apiKey) { alert("先在「设置」里配置模型与 API Key。"); return; }

  const goal = ($("#agentGoal").value || "").trim() || "帮我把这一章写完";
  const targetWords = parseInt($("#agentWords").value, 10) || 1500;
  const maxSteps = parseInt($("#agentSteps").value, 10) || 12;
  const maxRevise = parseInt($("#agentRevise").value, 10) || 0;

  agentAbort = false; agentRunning = true;
  $("#agentRun").disabled = true; $("#agentStop").disabled = false;
  $("#agentLog").innerHTML = ""; $("#agentDraft").value = ""; state.agentSteps = [];
  const st = $("#agentState"); if (st) st.textContent = "运行中…";

  const push = (s) => {
    (state.agentSteps || (state.agentSteps = [])).push(s);
    const box = $("#agentLog"); if (!box) return;
    const el = document.createElement("div");
    el.className = "agent-step" + (s.bad ? " bad" : (s.ok ? " ok" : ""));
    const ph = document.createElement("span");
    ph.className = "ph"; ph.textContent = s.phase || s.type || "";
    el.appendChild(ph);
    el.appendChild(document.createTextNode(s.text || ""));
    box.appendChild(el); box.scrollTop = box.scrollHeight;
    if (box.__sdUpdate) box.__sdUpdate();
  };

  try {
    const r = await runAgent({
      goal, targetWords, maxSteps, maxRevise,
      tools: agentTools(),
      callLLM: (msgs) => chat(msgs, { maxTokens: 2400 }),
      systemPrompt: state.settings.systemPrompt,
      bookTitle: state.book.title,
      chapterTitle: state.chapter.title,
      currentText: currentEditorText(),
      shouldStop: () => agentAbort,
      onStep: push,
    });
    state.lastAgent = r;   // 保留 base 与 issues，供「应用审稿意见」复用
    $("#agentDraft").value = r.draft || "";
    if (st) st.textContent = agentAbort ? "已停止（草稿保留）" : `完成 · 自检 ${r.score == null ? "—" : r.score}/10 · ${r.used} 步`;
  } catch (e) {
    push({ type: "error", text: "运行失败：" + e.message, bad: true });
    if (st) st.textContent = "失败";
  } finally {
    agentRunning = false;
    $("#agentRun").disabled = false; $("#agentStop").disabled = true;
  }
}

async function applyAgentDraft(mode) {
  const text = ($("#agentDraft").value || "").trim();
  if (!text) { alert("草稿是空的。"); return; }
  if (!state.chapter) { alert("没有打开的章节。"); return; }
  const cur = currentEditorText();
  const next = mode === "replace" ? text : (cur.trim() ? cur.replace(/\s+$/, "") + "\n\n" + text : text);
  Object.assign(state.chapter, { content: next, words: countWords(next), updatedAt: new Date().toISOString() });
  await chapters.save(state.chapter);
  state.chapters = state.chapters.map((c) => (c.id === state.chapter.id ? state.chapter : c));
  syncWriterEditor(state.chapter);
  const p = $("#previewContent");
  if (p && $("#previewPane") && !$("#previewPane").hidden) {
    p.value = next;
    const pw = $("#previewWords"); if (pw) pw.textContent = countWords(next) + " 字";
  }
  renderChapterList(); renderCatalog(); renderStatsPanel();
  const st = $("#agentState");
  if (st) st.textContent = mode === "replace" ? "已替换本章正文" : "已追加到本章正文";
}

function initAgentUI() {
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  on("#openAgent", "click", () => { resetDialog("agentDialog"); $("#agentDialog").showModal(); });
  on("#agentRun", "click", runAgentFlow);
  on("#agentStop", "click", () => { agentAbort = true; const st = $("#agentState"); if (st) st.textContent = "正在停止…"; });
  on("#agentAdoptAppend", "click", () => applyAgentDraft("append"));
  on("#agentAdoptReplace", "click", () => { if (confirm("用草稿替换本章正文？原内容会被覆盖。")) applyAgentDraft("replace"); });
  on("#agentLogCopy", "click", async () => {
    const steps = state.agentSteps || [];
    if (!steps.length) { alert("还没有执行记录。"); return; }
    const text = steps.map((s) => `[${s.phase || s.type || "-"}] ${s.text || ""}`).join("\n");
    const btn = $("#agentLogCopy");
    const done = () => { if (btn) { btn.textContent = "已复制"; setTimeout(() => { btn.textContent = "复制"; }, 1200); } };
    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); ta.remove(); done();
      } catch (e2) { alert("复制失败：" + (e2 && e2.message ? e2.message : e2)); }
    }
  });
  on("#agentCopy", "click", () => navigator.clipboard.writeText($("#agentDraft").value || ""));
  on("#agentApplyCritic", "click", async () => {
    const last = state.lastAgent;
    if (!last || !last.issues || !last.issues.length) {
      alert("没有可应用的审稿意见。请先跑一次 Agent，且本次草稿确实被指出了问题。");
      return;
    }
    const btn = $("#agentApplyCritic");
    const st = $("#agentState");
    const oldText = btn.textContent;
    btn.disabled = true; btn.textContent = "重写中…";
    if (st) st.textContent = "按审稿意见重写中…";
    try {
      const fixed = await applyCriticIssues({
        base: last.base,
        draft: $("#agentDraft").value,
        issues: last.issues,
        callLLM: (msgs) => chat(msgs, { maxTokens: 2400 }),
      });
      $("#agentDraft").value = fixed;
      // 追加一条日志，保持执行过程可追溯
      const box = $("#agentLog");
      if (box) {
        const el = document.createElement("div");
        el.className = "agent-step ok";
        const ph = document.createElement("span");
        ph.className = "ph"; ph.textContent = "revise";
        el.appendChild(ph);
        el.appendChild(document.createTextNode(`已按 ${last.issues.length} 条审稿意见重写（${fixed.replace(/\s/g, "").length} 字）`));
        box.appendChild(el); box.scrollTop = box.scrollHeight;
      }
      if (st) st.textContent = `已应用 ${last.issues.length} 条意见`;
    } catch (e) {
      alert("重写失败：" + e.message);
      if (st) st.textContent = "重写失败";
    } finally {
      btn.disabled = false; btn.textContent = oldText;
    }
  });
  on("#agentClose", "click", () => $("#agentDialog").close());
  on("#agentParamsBtn", "click", () => $("#agentParamsDialog").showModal());
  on("#agentParamsOk", "click", () => $("#agentParamsDialog").close());
}

/* ==================================================================
   语料库：结构化风格画像 + 右侧详情（查看/修改/新建/删除）+ 窗口拖动
   ================================================================== */

function renderStyleBox() {
  const box = $("#styleBox");
  if (!box) return;
  const p = state.styleProfile;
  if (!p || !p.charsNoSpace) {
    box.innerHTML = `<div class="style-empty">还没有语料。<br>点上方「采集本书」「采集全部作品」，或用「粘贴文本 / 导入 txt」，<br>也可以在右侧列表中选中条目查看与修改。</div>`;
    return;
  }
  const pct = (x) => Math.round((x || 0) * 100) + "%";
  const chipList = (arr) => arr.map((x) => `<span class="chip">${escapeHtml(x.t)}<b>${x.n}</b></span>`).join("");
  const pron = Object.entries(p.pronouns || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t, n }));
  const pu = Object.entries(p.punct || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => ({ t, n }));
  const ng = (p.topNgrams || []).slice(0, 28);

  box.innerHTML =
    `<div class="style-metrics">
       <div class="style-metric"><b>${(p.avgSentenceLen || 0).toFixed(1)} 字</b><span>平均句长</span></div>
       <div class="style-metric"><b>${pct(p.shortSentenceRatio)}</b><span>短句占比（≤15 字）</span></div>
       <div class="style-metric"><b>${Math.round(p.avgParagraphLen || 0)} 字</b><span>平均段长</span></div>
       <div class="style-metric"><b>${pct(p.dialogueRatio)}</b><span>对话占比</span></div>
     </div>` +
    (pron.length ? `<div class="style-block"><div class="lab">人称使用</div><div class="chips">${chipList(pron)}</div></div>` : "") +
    (pu.length ? `<div class="style-block"><div class="lab">标点习惯</div><div class="chips">${chipList(pu)}</div></div>` : "") +
    (ng.length ? `<div class="style-block"><div class="lab">高频用语（会写进提示词）</div><div class="chips">${chipList(ng)}</div></div>` : "") +
    `<details class="prompt-preview"><summary>查看实际注入的提示词</summary><pre>${escapeHtml(profileToText(p))}</pre></details>`;
}

function showCorpusDetail(on) {
  const body = document.querySelector(".corpus-body");
  if (body) body.classList.toggle("has-detail", !!on);
  const d = $("#corpusDetail");
  if (d) d.hidden = false;
}

function openCorpusDoc(docId) {
  const d = (state.corpusDocs || []).find((x) => x.id === docId);
  if (!d) return;
  state.corpusNewDraft = false;
  state.corpusDoc = d;
  showCorpusDetail(true);
  const t = $("#corpusDocTitle"), x = $("#corpusDocText"), s = $("#corpusDocState");
  if (t) t.value = d.title || "";
  if (x) x.value = d.text || "（这条语料是旧版本采集的，没有保存全文。重新采集一次即可编辑。）";
  if (s) s.textContent = `${d.words || 0} 字`;
  document.querySelectorAll("#corpusList li[data-doc]").forEach((li) => {
    li.classList.toggle("active", li.dataset.doc === docId);
  });
}

function newCorpusDoc() {
  state.corpusDoc = null;
  state.corpusNewDraft = true;
  showCorpusDetail(true);
  const t = $("#corpusDocTitle"), x = $("#corpusDocText"), s = $("#corpusDocState");
  if (t) t.value = "新语料";
  if (x) x.value = "";
  if (s) s.textContent = "未保存";
  document.querySelectorAll("#corpusList li[data-doc]").forEach((li) => li.classList.remove("active"));
  if (x) x.focus();
}

async function saveCorpusDoc() {
  const title = ($("#corpusDocTitle").value || "").trim() || "未命名";
  const text = $("#corpusDocText").value || "";
  if (!text.trim()) { alert("内容为空，先写点东西。"); return; }
  const s = $("#corpusDocState");
  if (s) s.textContent = "保存中…";

  let doc = state.corpusDoc;
  if (!doc) {
    doc = { id: id("doc_"), title, source: "manual", addedAt: new Date().toISOString() };
  }
  Object.assign(doc, {
    title, text, words: text.replace(/\s+/g, "").length, chars: text.length,
    addedAt: doc.addedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await corpus.save(doc);
  await chunks.removeByDoc(doc.id);
  for (const piece of chunkText(text)) {
    await chunks.save({ id: id("ck_"), docId: doc.id, text: piece, len: piece.length });
  }
  state.corpusDoc = doc;
  await rebuildStyle();
  await loadCorpus();
  await renderCorpus();
  if (s) s.textContent = `已保存 · ${doc.words} 字`;
}

async function deleteCorpusDoc() {
  const doc = state.corpusDoc;
  if (!doc) { alert("没有选中的语料。"); return; }
  if (!confirm(`删除语料「${doc.title}」？`)) return;
  await chunks.removeByDoc(doc.id);
  await corpus.remove(doc.id);
  state.corpusDoc = null;
  const t = $("#corpusDocTitle"), x = $("#corpusDocText"), s = $("#corpusDocState");
  if (t) t.value = "";
  if (x) x.value = "";
  if (s) s.textContent = "";
  await rebuildStyle();
  await loadCorpus();
  await renderCorpus();
}

/* ---- 4) 所有次级菜单可拖动（按住标题栏） ---- */

function enableDialogDrag() {
  document.querySelectorAll("dialog").forEach((dlg) => {
    if (dlg.dataset.dragReady) return;
    const handle = dlg.querySelector("h3");
    if (!handle) return;
    dlg.dataset.dragReady = "1";
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const nx = ox + (e.clientX - sx);
      const ny = oy + (e.clientY - sy);
      const w = dlg.offsetWidth;
      dlg.style.left = Math.max(-w + 100, Math.min(window.innerWidth - 100, nx)) + "px";
      dlg.style.top = Math.max(0, Math.min(window.innerHeight - 44, ny)) + "px";
    };
    const onUp = () => {
      dragging = false;
      dlg.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const r = dlg.getBoundingClientRect();
      dlg.style.margin = "0";
      dlg.style.inset = "auto";
      dlg.style.left = r.left + "px";
      dlg.style.top = r.top + "px";
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      dragging = true;
      dlg.classList.add("dragging");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault();
    });
  });
}

/* ---------- 滚动条：隐藏开关（持久化） ---------- */
async function applyScrollbars() {
  const hide = await kv.get("hideScrollbars", false);
  document.documentElement.classList.toggle("hide-sb", !!hide);
  const cb = document.getElementById("hideScrollbars");
  if (cb) cb.checked = !!hide;
  state.hideScrollbars = !!hide;
}

/* ==================================================================
   可滚动提示：内容还有时，边缘出现阴影 + 底部小箭头
   （解决"隐藏滚动条后使用者不知道能滚"的问题）
   ================================================================== */
function bindScrollHints() {
  const sel = [
    "#agentLog", "#agentDraft", "#corpusDocText", "#content", "#previewContent",
    "#aiOut", "#catalog", "#corpusList", "#chapterList", "#cardList",
    "#styleBox", "#ragHits", "#logList", "#historyList",
    ".corpus-col", ".corpus-detail",
  ].join(",");

  document.querySelectorAll(sel).forEach((el) => {
    if (el.dataset.sdReady) return;
    el.dataset.sdReady = "1";
    el.classList.add("sd-cue");

    const upd = () => {
      const more = el.scrollHeight - el.clientHeight - el.scrollTop > 6;
      const up = el.scrollTop > 6;
      el.classList.toggle("sd-more", more);
      el.classList.toggle("sd-up", up);
    };
    el.__sdUpdate = upd;

    el.addEventListener("scroll", upd, { passive: true });
    el.addEventListener("input", upd);
    window.addEventListener("resize", upd);
    try { new ResizeObserver(upd).observe(el); } catch (e) { /* 忽略 */ }

    setTimeout(upd, 80);
    setTimeout(upd, 500);
    upd();
  });
}

/* ==================================================================
   段落缩进：识别段落 + 自由字符数
   —— <textarea> 无法做段落级 CSS 缩进，所以用真实的全角空格「　」
      · 段首缩进：在段首写入 N 个「　」
      · 按 Enter 开新段时自动补缩进（空行不补）
      · 「整理」按钮：按当前设置规范化全文缩进
      · 「　」被 \s 匹配，不计入字数统计
   ================================================================== */

/** 当前生效的缩进字符数（0 表示不缩进） */
function effectiveIndent() {
  const ts = state.typeset || DEFAULT_TYPESET;
  if (!ts.indent) return 0;
  const n = parseInt(ts.indentChars, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(8, n)) : 2;
}

/** 把每段开头规范为 n 个全角空格；空行保持空行 */
function normalizeIndent(text, n) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      const body = line.replace(/^[　\s]+/, "");   // 去掉已有缩进
      if (!body.trim()) return "";                  // 空行不缩进
      return "　".repeat(n) + body;
    })
    .join("\n");
}

/** 对当前章节执行一次「整理缩进」 */
async function normalizeCurrentChapter() {
  const writer = $("#content");
  const preview = $("#previewContent");
  if (!writer && !preview) return;

  const n = effectiveIndent();
  const before = (writer && writer.value) || (preview && preview.value) || "";
  const after = normalizeIndent(before, n);

  for (const el of [writer, preview]) if (el) el.value = after;
  // 触发保存链路（写作台的 input 处理器会落库）
  if (writer) writer.dispatchEvent(new Event("input", { bubbles: true }));
  else if (preview) preview.dispatchEvent(new Event("input", { bubbles: true }));

  const st = $("#previewState");
  if (st) st.textContent = n > 0 ? `已按 ${n} 个字符整理缩进` : "已移除全部缩进";
}

/** 在编辑器里按 Enter 时，自动为新段落补缩进 */
function bindAutoIndent(el) {
  if (!el || el.dataset.indentReady) return;
  el.dataset.indentReady = "1";
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const n = effectiveIndent();
    if (n <= 0) return;

    // 判断当前段落是否有内容：空段落不补缩进（避免连续空行被塞满空格）
    const pos = el.selectionStart;
    const lineStart = el.value.lastIndexOf("\n", pos - 1) + 1;
    const curLine = el.value.slice(lineStart, pos).replace(/^[　\s]+/, "");
    const emptyPara = curLine.trim() === "";

    // 等浏览器把换行插入后再补缩进
    setTimeout(() => {
      if (emptyPara) return;
      const p = el.selectionStart;
      el.setRangeText("　".repeat(n), p, p, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, 0);
  });
}

/* ==================================================================
   查找替换
   · 本章/全书两种范围（改人名这类需求用「全书」）
   · textarea 无法做多段高亮，因此定位到当前匹配并选中
   ================================================================== */

function findOpts() {
  const g = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };
  const c = document.getElementById("findCase");
  return {
    q: g("findText", ""),
    rep: g("replaceText", ""),
    cs: !!(c && c.checked),
    scope: g("findScope", "chapter"),
  };
}

/** 当前正在编辑的 textarea */
function activeTextarea() {
  const el = state.activeEditor;
  if (el && document.contains(el)) return el;
  const p = document.getElementById("previewContent");
  if (p && document.getElementById("previewPane") && !document.getElementById("previewPane").hidden) return p;
  return document.getElementById("content");
}

/** 返回所有匹配的起始下标（不重叠） */
function findAllIndexes(text, q, cs) {
  const out = [];
  if (!q) return out;
  const hay = cs ? text : text.toLowerCase();
  const needle = cs ? q : q.toLowerCase();
  let i = 0;
  for (;;) {
    const p = hay.indexOf(needle, i);
    if (p < 0) break;
    out.push(p);
    i = p + needle.length;
  }
  return out;
}

function replaceInsensitive(text, q, rep) {
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(esc, "gi"), rep);
}

/** 把 textarea 滚动到指定下标附近 */
function scrollTextareaTo(ta, index) {
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const line = ta.value.slice(0, index).split("\n").length - 1;
  const target = line * lh;
  const h = ta.clientHeight;
  if (target < ta.scrollTop || target > ta.scrollTop + h - lh) {
    ta.scrollTop = Math.max(0, target - h / 2);
  }
}

function setFindCount(txt) {
  const el = document.getElementById("findCount");
  if (el) el.textContent = txt;
}

async function updateFindCount() {
  const { q, cs, scope } = findOpts();
  if (!q) { setFindCount(""); return; }
  if (scope === "book") {
    if (!state.book) { setFindCount(""); return; }
    let n = 0;
    for (const c of await chapters.of(state.book.id)) {
      const full = await chapters.get(c.id);
      n += findAllIndexes((full && full.content) || "", q, cs).length;
    }
    setFindCount(`全书 ${n} 处`);
  } else {
    const ta = activeTextarea();
    setFindCount(ta ? `${findAllIndexes(ta.value, q, cs).length} 处` : "");
  }
}

function findMove(dir) {
  const { q, cs } = findOpts();
  const ta = activeTextarea();
  if (!ta || !q) return;
  const hits = findAllIndexes(ta.value, q, cs);
  if (!hits.length) { setFindCount("未找到"); return; }

  const cur = dir > 0 ? (ta.selectionEnd || 0) : Math.max(0, (ta.selectionStart || 0) - 1);
  let target = dir > 0 ? hits.find((p) => p >= cur) : [...hits].reverse().find((p) => p < cur);
  if (target == null) target = dir > 0 ? hits[0] : hits[hits.length - 1];

  ta.focus();
  ta.setSelectionRange(target, target + q.length);
  scrollTextareaTo(ta, target);
  const idx = hits.indexOf(target) + 1;
  setFindCount(`${idx}/${hits.length} 处`);
}

function replaceOne() {
  const { q, rep, cs } = findOpts();
  const ta = activeTextarea();
  if (!ta || !q) return;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  const hit = cs ? sel === q : sel.toLowerCase() === q.toLowerCase();
  if (!hit) { findMove(1); return; }
  ta.setRangeText(rep, ta.selectionStart, ta.selectionEnd, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  findMove(1);
  updateFindCount();
}

async function replaceAll() {
  const { q, rep, cs, scope } = findOpts();
  if (!q) return;

  if (scope === "book") {
    if (!state.book) { alert("先选一本书。"); return; }
    if (!confirm(`把全书（${state.book.title}）中的「${q}」全部替换为「${rep}」？\n此操作会修改所有章节，不可撤销。`)) return;
    let total = 0, touched = 0;
    for (const c of await chapters.of(state.book.id)) {
      const full = await chapters.get(c.id);
      const content = (full && full.content) || "";
      const n = findAllIndexes(content, q, cs).length;
      if (!n) continue;
      const next = cs ? content.split(q).join(rep) : replaceInsensitive(content, q, rep);
      full.content = next;
      full.words = countWords(next);
      full.updatedAt = new Date().toISOString();
      await chapters.save(full);
      total += n; touched++;
      setFindCount(`替换中… ${total} 处`);
    }
    state.chapters = await chapters.of(state.book.id);
    if (state.chapter) {
      const cur = await chapters.get(state.chapter.id);
      state.chapter = cur;
      const ct = document.getElementById("content");
      const pt = document.getElementById("previewContent");
      if (ct) ct.value = cur.content || "";
      if (pt) pt.value = cur.content || "";
      state.lastLen = countWords(cur.content);
    }
    renderChapterList(); renderCatalog(); renderStats();
    setFindCount(`全书已替换 ${total} 处（${touched} 章）`);
    return;
  }

  const ta = activeTextarea();
  if (!ta) return;
  const n = findAllIndexes(ta.value, q, cs).length;
  if (!n) { setFindCount("未找到"); return; }
  if (!confirm(`在本章替换 ${n} 处？`)) return;
  ta.value = cs ? ta.value.split(q).join(rep) : replaceInsensitive(ta.value, q, rep);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  setFindCount(`本章已替换 ${n} 处`);
}

function openFindBar() {
  const bar = document.getElementById("findBar");
  if (!bar) return;
  const nb = document.getElementById("navFind");
  if (nb) nb.classList.add("on");
  bar.hidden = false;
  const inp = document.getElementById("findText");
  if (inp) { inp.focus(); inp.select(); }
  updateFindCount();
}

function closeFindBar() {
  const bar = document.getElementById("findBar");
  const nb2 = document.getElementById("navFind");
  if (nb2) nb2.classList.remove("on");
  if (bar) bar.hidden = true;
}

function initFindUI() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on("findNext", "click", () => findMove(1));
  on("findPrev", "click", () => findMove(-1));
  on("findReplace", "click", replaceOne);
  on("findReplaceAll", "click", replaceAll);
  on("findClose", "click", closeFindBar);
  on("findText", "input", updateFindCount);
  on("findText", "keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); findMove(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); closeFindBar(); }
  });
  on("findCase", "change", updateFindCount);
  on("findScope", "change", updateFindCount);

  // Ctrl+F / Ctrl+H 打开；Esc 关闭
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "f" || e.key === "F" || e.key === "h" || e.key === "H")) {
      e.preventDefault();
      if (state.view !== "writer") showView("writer");
      openFindBar();
    }
  });
}

/* ==================================================================
   Agent · 大纲梳理 UI
   ================================================================== */

let outlineAbort = false;
let outlineRunning = false;
let outlineResult = null;

function renderOutlineResult(r) {
  const box = document.getElementById("outlineResult");
  if (!box) return;
  if (!r) {
    box.innerHTML = '<div class="hint">点「开始梳理」后，结果会显示在这里。</div>';
    return;
  }
  const esc = escapeHtml;
  let html = "";

  // ① 与大纲不符 —— 放在最上面，并提供两个处置动作
  if (r.deviations && r.deviations.length) {
    html += `<div class="ov-block ov-warn"><div class="lab">与大纲不符（${r.deviations.length}）</div>` +
      `<ul class="ov-list">${r.deviations.map((d) => `<li>${esc(d.issue || d)}<span class="ov-advice">建议：${esc(d.advice || "待定")}</span></li>`).join("")}</ul>` +
      `<div class="row"><button class="mini primary" data-ovact="adjust">调整大纲以匹配剧情</button>` +
      `<button class="mini" data-ovact="fixplot">生成剧情修改建议</button></div>` +
      `<div id="ovActResult" class="ov-text" style="margin-top:8px"></div></div>`;
  }

  if (r.summary) {
    html += `<div class="ov-block"><div class="lab">现有剧情梳理</div><div class="ov-text">${esc(r.summary)}</div></div>`;
  }
  if (r.keyPoints && r.keyPoints.length) {
    html += `<div class="ov-block"><div class="lab">关键点记忆（${r.keyPoints.length}）</div>` +
      `<ul class="ov-list">${r.keyPoints.map((k) => `<li><b>${esc(k.chapter || "")}</b> ${esc(k.point || "")}</li>`).join("")}</ul></div>`;
  }
  if (r.directions && r.directions.length) {
    html += `<div class="ov-block"><div class="lab">拓展方向（${r.directions.length}）</div>` +
      r.directions.map((d, i) => `<div class="ov-dir"><b>${i + 1}. ${esc(d.title)}</b><p>${esc(d.desc)}</p></div>`).join("") +
      `</div>`;
  }
  if (r.outline && r.outline.length) {
    html += `<div class="ov-block"><div class="lab">建议大纲（${r.outline.length} 段）</div>` +
      r.outline.map((o) => `<div class="ov-outline"><b>${esc(o.title)}</b><pre>${esc(o.body)}</pre></div>`).join("") +
      `</div>`;
  }
  box.innerHTML = html || '<div class="hint">没有解析到内容。</div>';
}

async function runOutlineFlow() {
  if (outlineRunning) return;
  if (!state.book) { alert("先在书库选一本书。"); return; }
  if (!state.settings || !state.settings.apiKey) { alert("先在「设置」里配置模型与 API Key。"); return; }

  // 关键：先把「当前编辑器」里未落库的编辑保存掉（编辑是防抖保存的）
  try {
    const pane = document.getElementById("previewPane");
    if (pane && !pane.hidden) await previewSaveNow();
    else await doSave();
  } catch (e) { console.warn("梳理前保存失败（继续）:", e); }

  // 取出所有「有正文」的章节（按顺序）
  const all = [];
  for (const c of await chapters.of(state.book.id)) {
    const x = await chapters.get(c.id);
    if (x && (x.content || "").trim()) all.push(x);
  }
  if (!all.length) { alert("这本书还没有正文内容，先写几章再梳理。"); return; }

  // ---- 按范围确定本次要梳理的章节 ----
  const scope = (document.getElementById("outlineScope") || {}).value || "incremental";
  const cursorKey = `outlineCursor:${state.book.id}`;
  let target = all;

  if (scope === "incremental") {
    const cur = await kv.get(cursorKey, null);
    if (cur && cur.chapterId) {
      const idx = all.findIndex((c) => c.id === cur.chapterId);
      target = idx >= 0 ? all.slice(idx + 1) : all;
      if (!target.length) {
        alert(`上次已梳理到「${cur.title || "最后一章"}」，之后没有新章节。\n\n可以切换为「全部章节」重新梳理。`);
        return;
      }
    }
  } else if (scope === "recent") {
    const n = parseInt((document.getElementById("outlineRecent") || {}).value, 10) || 10;
    target = all.slice(-n);
  }

  outlineAbort = false; outlineRunning = true;
  const btn = document.getElementById("outlineRun");
  const st = document.getElementById("outlineState");
  const stopBtn = document.getElementById("outlineStop");
  const saveBtn = document.getElementById("outlineSaveCards");
  if (btn) btn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  if (saveBtn) saveBtn.disabled = true;
  const logBox = document.getElementById("outlineLog");
  if (logBox) logBox.innerHTML = "";
  if (st) st.textContent = `运行中…（本次 ${target.length} 章）`;

  const push = (s) => {
    const box = document.getElementById("outlineLog");
    if (!box) return;
    const el = document.createElement("div");
    el.className = "agent-step" + (s.bad ? " bad" : (s.ok ? " ok" : ""));
    const ph = document.createElement("span");
    ph.className = "ph"; ph.textContent = s.phase || s.type || "";
    el.appendChild(ph);
    el.appendChild(document.createTextNode(s.text || ""));
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    if (box.__sdUpdate) box.__sdUpdate();
  };

  try {
    const existing = await cards.of(state.book.id, "outline");
    const r = await runOutlineAgent({
      chapters: target,
      existingOutline: existing.map((c) => ({ title: c.title, body: c.body })),
      callLLM: (msgs) => chat(msgs, { maxTokens: 3000 }),
      bookTitle: state.book.title,
      shouldStop: () => outlineAbort,
      onStep: push,
    });
    outlineResult = r;
    renderOutlineResult(r);
    if (st) st.textContent = `完成 · ${r.directions.length} 个方向 · ${r.outline.length} 段大纲`;
    if (saveBtn) saveBtn.disabled = !r.outline.length;

    // 增量进度：记录本次梳理到的最后一章
    if (!outlineAbort) {
      const last = target[target.length - 1];
      await kv.set(cursorKey, { chapterId: last.id, title: last.title, at: new Date().toISOString(), count: target.length });
      await updateOutlineCursorLabel();
    }
  } catch (e) {
    push({ type: "error", text: e.message, bad: true });
    if (st) st.textContent = outlineAbort ? "已停止" : "失败";
  } finally {
    outlineRunning = false;
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }
}

async function saveOutlineCards() {
  if (!outlineResult || !outlineResult.outline.length) return;
  const n = outlineResult.outline.length;
  if (!confirm(`将写入 ${n} 张新的「大纲」卡片（不覆盖已有卡片），继续？`)) return;
  for (let i = 0; i < n; i++) {
    const o = outlineResult.outline[i];
    await cards.save({
      id: id("cd_"), bookId: state.book.id, type: "outline",
      title: o.title || `大纲 ${i + 1}`,
      body: o.body || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  state.cardType = "outline";
  document.querySelectorAll("#cardTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.card === "outline"));
  await loadCards();
  const st = document.getElementById("outlineState");
  if (st) st.textContent = `已写入 ${n} 张大纲卡片`;
}

function outlineToText(r) {
  const parts = [];
  if (r.summary) parts.push("【现有剧情梳理】\n" + r.summary);
  if (r.issues && r.issues.length) parts.push("【问题与偏差】\n" + r.issues.map((x, i) => `${i + 1}. ${x}`).join("\n"));
  if (r.directions && r.directions.length) parts.push("【拓展方向】\n" + r.directions.map((d, i) => `${i + 1}. ${d.title} —— ${d.desc}`).join("\n"));
  if (r.outline && r.outline.length) parts.push("【建议大纲】\n" + r.outline.map((o) => `${o.title}\n${o.body}`).join("\n\n"));
  return parts.join("\n\n");
}

async function updateOutlineCursorLabel() {
  const el = document.getElementById("outlineCursor");
  if (!el) return;
  if (!state.book) { el.textContent = ""; return; }
  const cur = await kv.get(`outlineCursor:${state.book.id}`, null);
  el.textContent = cur ? `上次梳理到：${cur.title || "—"}` : "尚未梳理过";
}

function initOutlineUI() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

  on("openOutlineAgent", "click", async () => {
    const d = document.getElementById("outlineDialog");
    if (!d) return;
    resetDialog("outlineDialog");
    await updateOutlineCursorLabel();
    d.showModal();
  });

  on("outlineRun", "click", runOutlineFlow);
  on("outlineStop", "click", () => {
    outlineAbort = true;
    const st = document.getElementById("outlineState");
    if (st) st.textContent = "正在停止…";
  });
  on("outlineSaveCards", "click", saveOutlineCards);
  on("outlineCopy", "click", () => {
    if (!outlineResult) { alert("还没有梳理结果。"); return; }
    navigator.clipboard.writeText(outlineToText(outlineResult));
  });
  on("outlineClose", "click", () => {
    const d = document.getElementById("outlineDialog");
    if (d) d.close();
  });

  // 重置增量进度
  on("outlineResetCursor", "click", async () => {
    if (!state.book) return;
    if (!confirm("清空增量进度？下次会从第一章重新梳理。")) return;
    await kv.set(`outlineCursor:${state.book.id}`, null);
    await updateOutlineCursorLabel();
  });

  // 大纲偏差的两个处置动作（结果区是动态渲染的，用事件委托）
  const box = document.getElementById("outlineResult");
  if (box && !box.dataset.delegated) {
    box.dataset.delegated = "1";
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ovact]");
      if (!b || !outlineResult) return;
      const act = b.dataset.ovact;
      const old = b.textContent;
      b.disabled = true; b.textContent = "处理中…";
      try {
        if (act === "adjust") {
          const existing = await cards.of(state.book.id, "outline");
          const outline = await reviseOutlineByDeviations({
            deviations: outlineResult.deviations || [],
            currentOutline: existing.map((c) => ({ title: c.title, body: c.body })),
            summary: outlineResult.summary,
            callLLM: (msgs) => chat(msgs, { maxTokens: 3000 }),
          });
          outlineResult.outline = outline;
          renderOutlineResult(outlineResult);
          const sb = document.getElementById("outlineSaveCards");
          if (sb) sb.disabled = false;
        } else {
          const text = await suggestPlotFixes({
            deviations: outlineResult.deviations || [],
            summary: outlineResult.summary,
            callLLM: (msgs) => chat(msgs, { maxTokens: 2500 }),
          });
          const out = document.getElementById("ovActResult");
          if (out) out.textContent = text; else alert(text);
          b.disabled = false; b.textContent = old;
        }
      } catch (err) {
        alert("处理失败：" + err.message);
        b.disabled = false; b.textContent = old;
      }
    });
  }
}

/* ==================================================================
   伏笔：卡片类型 foreshadow（标题=伏笔章节，内容=伏笔思路）
   · 设定区新增「伏笔」页签
   · 卡片列表 / 章节列表 悬停时浮出伏笔思路
   ================================================================== */

/** 按当前卡片类型，切换对话框的字段标签 */
function syncCardLabels() {
  const isFore = state.cardType === "foreshadow";
  const tl = document.getElementById("cardTitleLabel");
  const bl = document.getElementById("cardBodyLabel");
  const ti = document.getElementById("cardTitle");
  const bo = document.getElementById("cardBody");
  if (tl) tl.textContent = isFore ? "所属章节（可选）" : "标题";
  if (bl) bl.textContent = isFore ? "伏笔思路（打算怎么埋、什么时候回收）" : "内容";
  if (ti) ti.placeholder = isFore ? "例如：第三章 · 夜航（留空也行）" : "";
  if (bo) bo.placeholder = isFore ? "这条伏笔打算怎么埋、什么时候回收（悬停章节时会显示这段）" : "";
  const af = document.getElementById("cardAnchorField");
  if (af) af.hidden = !isFore;
  refreshAnchorMatch();
}

/** 单行截断：保留开头 head 字与结尾 tail 字，中间省略 */
function middleTruncate(s, head = 30, tail = 22) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= head + tail + 1) return t;
  return t.slice(0, head) + "…" + t.slice(-tail);
}

const CARD_TYPE_LABEL = { outline: "大纲", role: "角色", setting: "设定", foreshadow: "伏笔" };

/** 悬停浮窗：单行显示，标题弱化、内容（思路）高亮 */
function showHoverTip(target, title, body) {
  const el = document.getElementById("hoverTip");
  if (!el || !body) return;
  el.textContent = "";
  if (title) {
    const t = document.createElement("span");
    t.className = "tip-title";
    t.textContent = title;
    el.appendChild(t);
  }
  const b = document.createElement("span");
  b.className = "tip-body";
  b.textContent = middleTruncate(body);
  el.appendChild(b);
  el.hidden = false;
  const r = target.getBoundingClientRect();
  const w = el.offsetWidth || 360;
  el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + 12)) + "px";
  el.style.top = Math.min(window.innerHeight - 60, r.bottom + 6) + "px";
}

function hideHoverTip() {
  const el = document.getElementById("hoverTip");
  if (el) el.hidden = true;
}

/** 找出与某章相关的伏笔卡片：先看「所属章节」，再看正文里有没有它的伏笔文段 */
function foreshadowOfChapter(chapter) {
  if (!chapter) return null;
  const list = state.foreshadows || [];
  const t = chapter.title || "";
  const byTitle = t
    ? list.find((x) => x.title && (x.title === t || x.title.includes(t) || t.includes(x.title)))
    : null;
  if (byTitle) return byTitle;
  const body = normForMatch(chapter.content || "");
  if (!body) return null;
  return list.find((x) => {
    const probe = anchorsOf(x)[0];
    return !!probe && body.includes(probe);
  }) || null;
}

function initForeshadowUI() {
  // 卡片列表：大纲 / 角色 / 设定 / 伏笔 全部支持悬停浮窗
  const cardList = document.getElementById("cardList");
  if (cardList && !cardList.dataset.fsReady) {
    cardList.dataset.fsReady = "1";
    cardList.addEventListener("mouseover", async (e) => {
      const li = e.target.closest("[data-card-id]");
      if (!li) { hideHoverTip(); return; }
      try {
        const c = await cards.get(li.dataset.cardId);
        if (!c || !c.body) { hideHoverTip(); return; }
        const kind = CARD_TYPE_LABEL[c.type] || "卡片";
        showHoverTip(li, `${kind} · ${c.title || "未命名"}`, c.body);
      } catch { /* 忽略 */ }
    });
    cardList.addEventListener("mouseout", hideHoverTip);
  }

  // 章节列表：该章埋了伏笔时，悬停浮出思路
  const chList = document.getElementById("chapterList");
  if (chList && !chList.dataset.fsReady) {
    chList.dataset.fsReady = "1";
    chList.addEventListener("mouseover", (e) => {
      const li = e.target.closest("[data-id]");
      if (!li) { hideHoverTip(); return; }
      const c = (state.chapters || []).find((x) => x.id === li.dataset.id);
      const fs = foreshadowOfChapter(c);
      if (fs && fs.body) showHoverTip(li, `伏笔 · ${fs.title}`, fs.body);
      else hideHoverTip();
    });
    chList.addEventListener("mouseout", hideHoverTip);
  }

  // 伏笔弹窗：把正文里「真正选中的那一段」设为伏笔文段。
  // 不能拿"光标所在段落"当兜底：用户什么都没选时会被自动灌进同一段文字，
  // 看上去就像"点一下又冒出同一段、而且清不掉"。
  const pick = document.getElementById("anchorFromSel");
  if (pick && !pick.dataset.bound) {
    pick.dataset.bound = "1";
    pick.addEventListener("click", () => {
      const box = document.getElementById("cardAnchor");
      const hint = document.getElementById("anchorMatch");
      const txt = currentSelectionText();
      if (!txt) {
        if (hint) { hint.textContent = "⚠ 请先在正文里选中要标注的文字"; hint.style.color = "#c0392b"; }
        return;
      }

      if (box) box.value = txt;
      refreshAnchorMatch();
    });
  }
  // 「取消当前选中」：把正文里这段的伏笔标注去掉（虚线与点击浮窗都不再生效），
  // 但「伏笔文段」文本框里的文字保留。已保存的卡片会立刻落库，正文马上更新。
  const offBtn = document.getElementById("anchorOffBtn");
  if (offBtn && !offBtn.dataset.bound) {
    offBtn.dataset.bound = "1";
    offBtn.addEventListener("click", async () => {
      const sw = document.getElementById("anchorEnabled");
      if (sw) sw.checked = false;
      const hint = document.getElementById("anchorMatch");
      if (state.card) {
        Object.assign(state.card, { anchorOff: true, updatedAt: new Date().toISOString() });
        await cards.save(state.card);
        await loadCards();          // 重画镜像层 → 正文里的标记立刻消失
        if (hint) { hint.textContent = "已取消正文里的伏笔标注（文字保留）· 勾选「启用」可恢复"; hint.style.color = "#c0392b"; }
      } else {
        refreshAnchorMatch();
        if (hint) { hint.textContent = "已设为取消标注 · 点「保存」后正文里的标记会消失（文字保留）"; hint.style.color = "#c0392b"; }
      }
    });
  }

  const clearAnchor = document.getElementById("anchorClear");
  if (clearAnchor && !clearAnchor.dataset.bound) {
    clearAnchor.dataset.bound = "1";
    clearAnchor.addEventListener("click", () => {
      const box = document.getElementById("cardAnchor");
      if (box) box.value = "";
      const hint = document.getElementById("anchorMatch");
      // 关键：清空只是改了弹窗里的值，正文的虚线要等「保存」之后才会重画
      if (hint) { hint.textContent = "已清空 · 点「保存」后正文里的虚线才会消失"; hint.style.color = ""; }
    });
  }
  const aBox = document.getElementById("cardAnchor");
  if (aBox && !aBox.dataset.bound) {
    aBox.dataset.bound = "1";
    aBox.addEventListener("input", refreshAnchorMatch);
  }
  const aSw = document.getElementById("anchorEnabled");
  if (aSw && !aSw.dataset.bound) {
    aSw.dataset.bound = "1";
    aSw.addEventListener("change", refreshAnchorMatch);
  }
}

/** 写作台工具栏里的「查找」按钮：点一次开，再点一次关（按钮即开关） */
function initFindButton() {
  const b = document.getElementById("navFind");
  if (!b) return;
  b.addEventListener("click", () => {
    const bar = document.getElementById("findBar");
    if (!bar) return;
    if (bar.hidden) openFindBar(); else closeFindBar();
  });
}

/* ==================================================================
   伏笔标注视图：把段落渲染成可标注元素，匹配到的段落加虚线并可点击
   ================================================================== */

/* ==================================================================
   伏笔标注：镜像层 + 多片段匹配
   原理：在 textarea 正下方放一层镜像，文字透明、只画虚线；
        镜像的字体/行高/内边距在运行时从 textarea 的 computedStyle 复制，
        因此与正文逐像素对齐；文字变化时重画。
   ================================================================== */

/** 把「伏笔文段」拆成多条：只认 换行 与 分号。
 *  逗号不能当分隔符 —— 它是句子内部标点，一个选段会被拆成一堆短片段，
 *  短片段又容易在别的段落里再次命中，表现就是"只填了一段却标出好几段"。 */
function parseAnchors(anchor) {
  return String(anchor || "")
    .split(/[;；\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 匹配前先归一化：去掉所有空白（含全角空格），避免缩进/换行差异导致匹配不上 */
function normForMatch(s) {
  return String(s || "").replace(/[\s\u3000]+/g, "");
}

/** 一张伏笔卡片的匹配片段：只认「伏笔文段」。
 *  以前会拿「所属章节」兜底，结果清空「伏笔文段」后虚线仍然存在，
 *  用户会以为"清不掉"。现在虚线只跟「伏笔文段」绑定，清空即消失。 */
function anchorsOf(f) {
  if (f && f.anchorOff) return [];        // 停用：这段伏笔整体失效（文字仍在文本框里）
  return parseAnchors(f.anchor).map(normForMatch).filter(Boolean);
}

/** 找出与某段文字匹配的伏笔（命中任一片段即算） */
function matchForeshadow(text) {
  const t = normForMatch(text);
  if (!t) return null;
  return (state.foreshadows || []).find((f) => anchorsOf(f).some((a) => t.includes(a))) || null;
}

/** 统计当前正文章节里能被这批标注片段命中的段落数（弹窗即时反馈用） */
function countAnchorHits(anchor) {
  const anchors = parseAnchors(anchor).map(normForMatch).filter(Boolean);
  if (!anchors.length) return 0;
  const ta = document.getElementById("content");
  const paras = ((ta && ta.value) || "").split("\n");
  return paras.filter((p) => {
    const t = normForMatch(p);
    return !!t && anchors.some((a) => t.includes(a));
  }).length;
}

/** 刷新伏笔弹窗里的「能标中几段」提示 */
function refreshAnchorMatch() {
  const el = document.getElementById("anchorMatch");
  if (!el) return;
  const box = document.getElementById("cardAnchor");
  const sw = document.getElementById("anchorEnabled");
  if (sw && !sw.checked) {
    el.textContent = "已停用 · 正文里不会画线，文字仍保留（勾选左边方框可恢复）";
    el.style.color = "#c0392b";
    return;
  }
  if (!box || !box.value.trim()) {
    el.textContent = "填了标注片段，正文里才会出现虚线";
    el.style.color = "";
    return;
  }
  const n = countAnchorHits(box.value);
  el.textContent = n ? `✓ 当前章节可标出 ${n} 段` : "⚠ 当前章节没有包含这些片段的段落";
  el.style.color = n ? "var(--accent)" : "#c0392b";
}

/** 编辑器里当前选中的文字（没有选中就返回空串） */
function currentSelectionText() {
  const ta = document.getElementById("content");
  if (!ta) return "";
  return String(ta.value || "").slice(ta.selectionStart || 0, ta.selectionEnd || 0).trim();
}


/** 把 textarea 的实测样式复制到镜像层，保证对齐 */
function syncMirrorStyle() {
  const ta = document.getElementById("content");
  const mk = document.getElementById("contentMarks");
  if (!ta || !mk) return;
  const cs = getComputedStyle(ta);
  const keys = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
    "letterSpacing", "wordSpacing", "textIndent", "textTransform",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  ];
  for (const k of keys) mk.style[k] = cs[k];
  // textarea 的内容宽度不含滚动条，镜像要让出来，否则换行位置会不同
  const sbw = ta.offsetWidth - ta.clientWidth;
  mk.style.right = (sbw > 0 ? sbw : 0) + "px";
}

/** 重画镜像层：匹配到的段落加虚线 */
function renderMarks() {
  const ta = document.getElementById("content");
  const mk = document.getElementById("contentMarks");
  if (!ta || !mk) return;
  syncMirrorStyle();
  mk.innerHTML = (ta.value || "")
    .split("\n")
    .map((p) => {
      const hit = matchForeshadow(p);
      if (!hit) return `<div>${escapeHtml(p) || "&nbsp;"}</div>`;
      // 首行那两格缩进不该被画上下划线：缩进留在外面，只给正文文字加装饰，
      // 这样既不吃缩进、也不会因为多用一层元素而影响与 textarea 的对齐。
      const indent = (/^[ \t\u3000]*/.exec(p) || [""])[0];
      const rest = p.slice(indent.length);
      if (!rest) return `<div class="mk-para" data-fs="${hit.id}">${escapeHtml(p)}</div>`;
      return `<div class="mk-para" data-fs="${hit.id}">${escapeHtml(indent)}<span class="mk-u">${escapeHtml(rest)}</span></div>`;
    })
    .join("");
  mk.scrollTop = ta.scrollTop;
}

/** 光标所在的段落 */
function paragraphAtCaret(ta) {
  const pos = ta.selectionStart != null ? ta.selectionStart : 0;
  const v = ta.value || "";
  const start = v.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  let end = v.indexOf("\n", pos);
  if (end < 0) end = v.length;
  return { text: v.slice(start, end), start, end };
}

function initMarksUI() {
  const ta = document.getElementById("content");
  const mk = document.getElementById("contentMarks");
  if (!ta || !mk) return;

  ta.addEventListener("input", renderMarks);
  ta.addEventListener("scroll", () => { mk.scrollTop = ta.scrollTop; }, { passive: true });
  window.addEventListener("resize", renderMarks, { passive: true });

  // 点击正文：该段有伏笔时，浮出「文段缩略 + 伏笔思路」
  ta.addEventListener("click", () => {
    const { text } = paragraphAtCaret(ta);
    const f = matchForeshadow(text);
    if (!f) { hideHoverTip(); return; }
    showHoverTip(ta, `文段：${middleTruncate(text, 18, 12)}`, f.body || "（未填写伏笔思路）");
  });
  ta.addEventListener("blur", hideHoverTip);

  renderMarks();
}

/* ==================================================================
   导入文本：文件 / 粘贴 -> 追加 / 替换 / 按「第X章」自动分章
   ================================================================== */

/** 按「第X章」等标题切分；识别不到标题就整体作为一章 */
function splitChaptersByHeading(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!src) return [];
  const lines = src.split("\n");
  const re = /^[ \t]*第[ \t]*[0-9零一二三四五六七八九十百千万两]+[ \t]*[章节回卷篇]/;
  const heads = [];
  lines.forEach((ln, i) => { if (re.test(ln.trim())) heads.push({ i, title: ln.trim() }); });
  if (heads.length < 2) return [{ title: "导入内容", body: src }];

  const out = [];
  const preface = lines.slice(0, heads[0].i).join("\n").trim();
  if (preface) out.push({ title: "前言", body: preface });
  for (let k = 0; k < heads.length; k++) {
    const from = heads[k].i + 1;
    const to = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    out.push({ title: heads[k].title, body: lines.slice(from, to).join("\n").trim() });
  }
  return out;
}

function importSetState(msg) {
  const el = document.getElementById("importState");
  if (el) el.textContent = msg;
}

/** 导入文本：新建一本书；正文里的「第X章」自动拆成章节 */
async function runImport() {
  const text = (document.getElementById("importText") || {}).value || "";
  if (!text.trim()) { alert("内容为空：请先选择文件，或把文本粘贴到下面的框里。"); return; }
  const titleBox = document.getElementById("importBookTitle");
  const title = ((titleBox && titleBox.value) || "").trim() || "导入的作品";

  try {
    const parts = splitChaptersByHeading(text);
    if (!parts.length) { alert("没有解析到内容。"); return; }

    // 先把当前书的未保存改动落盘，再建新书
    await doSave();

    const book = {
      id: id("bk_"), title, author: "", summary: "", cover: "",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await books.save(book);

    let order = 0;
    for (const p of parts) {
      order++;
      await chapters.save({
        id: id("ch_"), bookId: book.id,
        title: p.title || `第 ${order} 章`,
        content: p.body, words: countWords(p.body), status: "draft", order,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }

    // 切到新书并回到书库，让它立刻出现在目录里
    await loadBooks(book.id);
    state.chapter = null;
    await loadChapters();
    await loadCards();
    await renderCatalog();
    await renderStatsPanel();

    const d = document.getElementById("importDialog");
    if (d) d.close();
    showView("library");
    const st = document.getElementById("saveState");
    if (st) st.textContent = `已导入《${book.title}》共 ${parts.length} 章`;
  } catch (e) {
    alert("导入失败：" + e.message);
  }
}

function initImportUI() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

  on("navImport", "click", () => {
    const d = document.getElementById("importDialog");
    if (!d) return;
    resetDialog("importDialog");
    d.showModal();
  });

  on("importPickFile", "click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".txt,.md,.text,text/plain";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const text = await f.text();
      const ta = document.getElementById("importText");
      if (ta) ta.value = text;
      const nf = document.getElementById("importFileName");
      if (nf) nf.textContent = `${f.name}（${text.replace(/\s/g, "").length} 字）`;
      const tb = document.getElementById("importBookTitle");
      if (tb && !tb.value.trim()) tb.value = f.name.replace(/\.[^.]+$/, "");
    };
    inp.click();
  });

  on("importClear", "click", () => {
    const ta = document.getElementById("importText");
    if (ta) ta.value = "";
    const nf = document.getElementById("importFileName");
    if (nf) nf.textContent = "";
    const tb = document.getElementById("importBookTitle");
    if (tb) tb.value = "";
    importSetState("");
  });

  on("importRun", "click", runImport);
  on("importClose", "click", () => {
    const d = document.getElementById("importDialog");
    if (d) d.close();
  });
}
