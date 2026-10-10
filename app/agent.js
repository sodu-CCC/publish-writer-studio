// 极简 Agent 内核：Plan → Gather(工具调用) → Draft → Critic → Revise → Finish
//
// 设计要点：
//  · 用 JSON 协议与模型交互（而不是原生 tools），因此任何 OpenAI 兼容端点都能用；
//  · 工具由「模型决定调哪个」，本地执行 —— 这是 Agent 与普通 Copilot 的分水岭；
//  · 强制人类在环：只产出草稿，绝不自动写入正文/自动发布；
//  · 有终止条件：最大步数、最大修订轮数、可随时中断。

export function extractJSON(text) {
  const s = String(text || "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const brief = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 90 ? s.slice(0, 90) + "…" : s;
};

/* ------------------------------------------------------------------
   写作规范：所有生成与审稿都必须遵守
   第 1 条专门解决「连续对话分不清谁在说话」的问题
   ------------------------------------------------------------------ */
export const WRITING_RULES = `【写作规范（必须严格遵守）】

一、对话归属必须清晰（最重要）
1. 每段对话都要让读者一眼看出说话人是谁。
2. 同一场景出现两个以上人物时，禁止连续三段以上只用「他」「她」指代说话人；
   必须周期性使用姓名，或用动作/称呼来标识（例：「……她说着，反手带上门。」）。
3. 代词「他」「她」只能指向前文最近出现、且唯一可能的同性人物；
   一旦存在歧义，必须改用姓名。
4. 人物初次登场或久未出场时，用姓名而非代词。
5. 自我介绍、身份信息等台词，应与动作或称呼绑定，避免读者需要回读才明白是谁在说。

二、其他
6. 对话与叙述交替，避免大段纯对话而无动作、无场景。
7. 保持人物语气可辨识：不同角色的用词、句长、口头禅应有差异。
8. 不用「他说」「她说」堆砌；优先用动作夹白（beat）替代部分提示语。
9. 只输出正文，不要标题、不要 Markdown、不要解释。`;

/** 组装"按审稿意见修订"的消息（runAgent 与「一键应用意见」共用） */
export function buildReviseMessages({ base, draft, issues }) {
  const list = (issues || []).map((x, i) => `${i + 1}. ${x}`).join("\n");
  return [
    { role: "system", content: base },
    {
      role: "user",
      content:
        `以下是一份小说草稿与审稿意见。请**针对每一条意见**修订，` +
        `并严格遵守写作规范（尤其是对话归属要清晰）。\n` +
        `只输出修订后的完整正文，不要解释、不要列提纲、不要 Markdown。\n\n` +
        `【草稿】\n${draft}\n\n【审稿意见】\n${list}`,
    },
  ];
}

/** 单独应用审稿意见（供「一键应用审稿意见」按钮使用） */
export async function applyCriticIssues({ base, draft, issues, callLLM }) {
  if (!issues || !issues.length) throw new Error("没有可应用的审稿意见");
  const fixed = await callLLM(buildReviseMessages({ base, draft, issues }));
  const text = String(fixed || "").trim();
  // 防御：模型不听话、把 JSON 当正文返回时，忽略
  if (text.startsWith("{") && extractJSON(text)) {
    throw new Error("模型返回的是 JSON，不是正文，已忽略");
  }
  return text;
}

export async function runAgent(opts) {
  const {
    goal, targetWords = 1500, maxSteps = 12, maxRevise = 1,
    tools = {}, callLLM, onStep, shouldStop, systemPrompt = "",
    bookTitle = "", chapterTitle = "", currentText = "",
  } = opts;

  const steps = [];
  const emit = (s) => {
    const e = { at: new Date().toISOString(), ...s };
    steps.push(e);
    try { onStep && onStep(e, steps); } catch { /* 忽略 UI 回调异常 */ }
  };
  const stop = () => (shouldStop ? shouldStop() : false);
  let used = 0;
  const budget = () => { used++; return used <= maxSteps; };

  const toolDesc = Object.entries(tools)
    .map(([k, v]) => `- ${k}(${(v.params || []).join(", ")}): ${v.desc}`)
    .join("\n") || "（无可用工具）";

  const base = [
    systemPrompt,
    `你是一个小说写作 Agent，正在帮助作者完成目标。`,
    `当前作品：《${bookTitle}》，当前章节：${chapterTitle || "（未命名）"}。`,
    `你可以调用的本地工具：\n${toolDesc}`,
    WRITING_RULES,
  ].filter(Boolean).join("\n\n");

  /* ---------- 1) PLAN ---------- */
  emit({ type: "phase", phase: "plan", text: "分析目标、制定计划…" });
  let plan = { think: "", need: [] };
  try {
    const raw = await callLLM([
      { role: "system", content: base + `\n\n本阶段你必须只输出 JSON，不要任何解释文字。` },
      { role: "user", content:
        `目标：${goal}\n\n` +
        `已有正文结尾（可能为空）：\n${String(currentText).slice(-600)}\n\n` +
        `请输出 JSON：{"think":"你的简短判断","need":[{"tool":"工具名","args":{}}]}\n` +
        `只列出你确实需要的工具，最多 6 个；不需要就返回空数组。` },
    ]);
    plan = extractJSON(raw) || plan;
    emit({ type: "plan", phase: "plan", text: plan.think || `计划调用 ${(plan.need || []).length} 个工具`, data: plan });
  } catch (e) {
    emit({ type: "error", phase: "plan", text: "计划阶段失败：" + e.message });
  }

  /* ---------- 2) GATHER（真正的工具调用） ---------- */
  const gathered = {};
  const need = Array.isArray(plan.need) ? plan.need.slice(0, 6) : [];
  if (!need.length) emit({ type: "tool", phase: "gather", text: "模型判断不需要额外资料" });
  for (const item of need) {
    if (stop()) { emit({ type: "stop", text: "用户已中断" }); break; }
    if (!budget()) { emit({ type: "limit", text: "达到最大步数，停止取资料" }); break; }
    const name = item.tool || item.name;
    const t = tools[name];
    if (!t) { emit({ type: "tool", phase: "gather", text: `跳过未知工具 ${name}`, bad: true }); continue; }
    emit({ type: "tool", phase: "gather", text: `调用工具 ${name}(${brief(item.args || {})})` });
    try {
      const r = await t.run(item.args || {});
      gathered[name] = r;
      emit({ type: "tool", phase: "gather", text: `${name} → ${brief(r)}`, data: r, ok: true });
    } catch (e) {
      emit({ type: "tool", phase: "gather", text: `${name} 失败：${e.message}`, bad: true });
    }
  }

  const contextBlock = Object.entries(gathered)
    .map(([k, v]) => `【${k}】\n${typeof v === "string" ? v : JSON.stringify(v, null, 1).slice(0, 1500)}`)
    .join("\n\n");

  /* ---------- 3) DRAFT（分段写） ---------- */
  emit({ type: "phase", phase: "draft", text: "开始写初稿…" });
  let draft = "";
  const segs = Math.max(1, Math.min(6, Math.ceil(targetWords / 500)));
  for (let i = 0; i < segs; i++) {
    if (stop()) { emit({ type: "stop", text: "用户已中断（草稿保留）" }); break; }
    if (!budget()) { emit({ type: "limit", text: "达到最大步数，提前结束" }); break; }
    emit({ type: "phase", phase: "draft", text: `写第 ${i + 1}/${segs} 段…` });
    try {
      const seg = await callLLM([
        { role: "system", content: base },
        { role: "user", content:
          `目标：${goal}\n\n${contextBlock ? "参考资料：\n" + contextBlock + "\n\n" : ""}` +
          `已写出：\n${draft || "（空）"}\n\n` +
          `请续写第 ${i + 1} 段（约 ${Math.ceil(targetWords / segs)} 字）。` +
          `注意：如果出现对话，必须按写作规范让读者清楚知道每句话是谁说的。直接输出正文。` },
      ]);
      draft += (draft ? "\n\n" : "") + String(seg || "").trim();
      emit({ type: "draft", phase: "draft", text: `已完成第 ${i + 1} 段（累计 ${draft.replace(/\s/g, "").length} 字）` });
    } catch (e) {
      emit({ type: "error", phase: "draft", text: `第 ${i + 1} 段生成失败：${e.message}` });
      break;
    }
  }

  /* ---------- 4) CRITIC + REVISE（反思闭环） ---------- */
  let score = null, issues = [];
  if (draft && !stop()) {
    for (let round = 0; round <= maxRevise; round++) {
      if (!budget()) { emit({ type: "limit", text: "达到最大步数，跳过自检" }); break; }
      emit({ type: "phase", phase: "critic", text: `第 ${round + 1} 轮自检…` });
      try {
        const raw = await callLLM([
          { role: "system", content: base + `\n\n本阶段你必须只输出 JSON。` },
          { role: "user", content:
            `目标：${goal}\n\n参考资料：\n${contextBlock.slice(0, 3000)}\n\n` +
            `刚写好的草稿：\n${draft}\n\n` +
            `请严格审稿，输出 JSON：{"score":0到10的整数,"issues":["问题1","问题2"],"verdict":"合格|需修改"}\n` +
            `逐条检查：\n` +
            `a. 对话归属 —— 能否一眼看出每句台词是谁说的？是否出现连续多段只用「他/她」导致歧义？\n` +
            `b. 人设 —— 言行是否符合角色设定？\n` +
            `c. 情节 —— 是否偏离大纲？\n` +
            `d. 节奏 —— 段落长短、对白密度是否合适？\n` +
            `e. 目标 —— 是否达成用户要求？` },
        ]);
        const cr = extractJSON(raw);
        if (!cr) { emit({ type: "critic", phase: "critic", text: "自检结果无法解析，跳过" }); break; }
        score = cr.score; issues = cr.issues || [];
        emit({ type: "critic", phase: "critic", text: `自检得分 ${score}/10${issues.length ? "，" + issues.length + " 个问题" : ""}`, data: cr });
        if (issues.length) issues.forEach((it) => emit({ type: "critic", phase: "critic", text: "· " + it }));
        if (score >= 8 || round === maxRevise) break;
        if (stop()) break;
        if (!budget()) { emit({ type: "limit", text: "达到最大步数，跳过修订" }); break; }
        emit({ type: "phase", phase: "revise", text: "按问题修订中…" });
        draft = await applyCriticIssues({ base, draft, issues, callLLM });
        emit({ type: "revise", phase: "revise", text: `修订完成（${draft.replace(/\s/g, "").length} 字）` });
      } catch (e) {
        // 修订失败不影响主流程，保留原草稿
        emit({ type: "error", phase: "critic", text: "自检/修订失败：" + e.message });
        break;
      }
    }
  }

  emit({ type: "done", text: `完成：草稿 ${draft.replace(/\s/g, "").length} 字，共 ${used} 步。未写入正文，等你确认。` });
  // base 一并返回：供 UI 的「一键应用审稿意见」复用同一套提示词
  return { draft, steps, score, issues, plan, used, base };
}


/* ==================================================================
   Agent · 大纲梳理（Map-Reduce 管线）
   与写正文的 ReAct 循环不同：这里需要先"读完"已写内容再归纳。
     1) 分批读取已写章节（每批 ~4000 字）
     2) 逐批提炼：关键事件 / 人物动作 / 伏笔
     3) 汇总，并与作者已有的大纲卡片对比
     4) 输出：现有剧情梳理 + 问题诊断 + 拓展方向 + 建议大纲
   ================================================================== */

export async function runOutlineAgent(opts) {
  const {
    chapters = [], existingOutline = [], callLLM, onStep, shouldStop,
    batchChars = 4000, bookTitle = "", maxBatches = 20,
  } = opts;

  const steps = [];
  const emit = (s) => {
    const e = { at: new Date().toISOString(), ...s };
    steps.push(e);
    try { onStep && onStep(e, steps); } catch { /* 忽略 UI 异常 */ }
  };
  const stop = () => (shouldStop ? shouldStop() : false);

  /* ---- 1) 只取有正文的章节，按字数分批 ---- */
  const valid = (chapters || []).filter((c) => (c.content || "").trim());
  if (!valid.length) throw new Error("这本书还没有正文内容，先写几章再梳理。");

  const batches = [];
  let cur = { titles: [], text: "" };
  for (const c of valid) {
    const piece = `【${c.title || "无标题"}】\n${c.content}\n`;
    if (cur.text && cur.text.length + piece.length > batchChars) {
      batches.push(cur);
      cur = { titles: [], text: "" };
    }
    cur.titles.push(c.title || "无标题");
    cur.text += piece;
  }
  if (cur.text) batches.push(cur);

  if (batches.length > maxBatches) {
    emit({ type: "limit", text: `内容较多（${batches.length} 批），只处理前 ${maxBatches} 批` });
    batches.length = maxBatches;
  }

  const totalWords = valid.reduce((s, c) => s + (c.content || "").replace(/\s/g, "").length, 0);
  emit({ type: "phase", phase: "gather", text: `共 ${valid.length} 章 / ${totalWords} 字，分成 ${batches.length} 批读取` });

  /* ---- 2) Map：逐批提炼 ---- */
  const summaries = [];
  for (let i = 0; i < batches.length; i++) {
    if (stop()) { emit({ type: "stop", text: "已停止" }); break; }
    emit({ type: "phase", phase: "map", text: `提炼第 ${i + 1}/${batches.length} 批（${batches[i].titles.slice(0, 3).join("、")}${batches[i].titles.length > 3 ? "…" : ""}）` });
    try {
      const raw = await callLLM([
        { role: "system", content: "你是资深网文编辑。只输出 JSON，不要任何解释。" },
        { role: "user", content:
          `阅读以下章节正文，**只提炼重大剧情关键点**：推进主线、改变人物关系、\n` +
          `埋下或回收伏笔的节点。日常描写、过场对白、重复信息一律忽略。\n` +
          `只输出 JSON：\n` +
          `{"events":["按时间顺序的重大剧情节点，每条一句话"],` +
          `"characters":["人物关系或处境发生的重大变化"],` +
          `"foreshadows":["新埋下或已回收的伏笔"]}\n\n` +
          `【正文】\n${batches[i].text}` },
      ]);
      const j = extractJSON(raw) || { events: [], characters: [], foreshadows: [] };
      summaries.push({ titles: batches[i].titles, ...j });
      emit({ type: "draft", phase: "map", text: `第 ${i + 1} 批完成：${(j.events || []).length} 个事件、${(j.foreshadows || []).length} 个伏笔`, ok: true });
    } catch (e) {
      emit({ type: "error", phase: "map", text: `第 ${i + 1} 批失败：${e.message}` });
    }
  }
  if (!summaries.length) throw new Error("没有任何批次成功提炼，请检查模型配置后重试。");

  /* ---- 3) Reduce：汇总 + 对比已有大纲 + 诊断 + 拓展 ---- */
  if (stop()) { emit({ type: "stop", text: "已停止" }); throw new Error("已停止"); }
  emit({ type: "phase", phase: "outline", text: "汇总梳理、对比已有大纲、生成拓展方向…" });

  const material = summaries
    .map((s, i) => `【第 ${i + 1} 段剧情】${s.titles.join("、")}\n关键事件：${(s.events || []).join("；")}\n人物：${(s.characters || []).join("；")}\n伏笔：${(s.foreshadows || []).join("；")}`)
    .join("\n\n");

  const existing = existingOutline.length
    ? existingOutline.map((c) => `【${c.title || "未命名"}】${c.body || ""}`).join("\n")
    : "（作者尚未建立大纲卡片）";

  const raw = await callLLM([
    { role: "system", content: "你是资深网文策划，擅长剧情梳理与世界观拓展。只输出 JSON，不要解释。" },
    { role: "user", content:
      `作品：《${bookTitle || "未命名"}》\n\n` +
      `=== 已写正文的分批梗概 ===\n${material}\n\n` +
      `=== 作者已有的大纲卡片 ===\n${existing}\n\n` +
      `请完成四件事，只输出 JSON：\n` +
      `{"summary":"用分幕或分阶段的列表梳理【已经写出来】的剧情，200-400 字",\n` +
      ` "keyPoints":[{"chapter":"涉及的章节","point":"一条重大剧情关键点"}],\n` +
      ` "deviations":[{"issue":"已写内容与既有大纲**不符**之处，或前后矛盾之处","advice":"调整大纲 或 修改剧情"}],\n` +
      ` "directions":[{"title":"方向名称","desc":"30-60 字，说明这个方向怎么走、张力在哪"}],\n` +
      ` "outline":[{"title":"分幕/分卷标题","body":"该部分的关键情节节点，3-6 条，含已写部分与后续"}]}\n\n` +
      `要求：\n` +
      `1. directions 给 3-5 个**互不相同**的走向，各有取舍，不要全是同一种套路；\n` +
      `2. outline 要给出**拓展后的完整大纲**，能直接作为继续创作的依据；\n` +
      `3. 不要复述原文，要归纳。` },
  ]);

  const result = extractJSON(raw);
  if (!result) throw new Error("模型没有返回可解析的 JSON，请重试或换一个模型");

  emit({ type: "done", text: `完成：梳理 ${summaries.length} 批 · ${(result.issues || []).length} 个问题 · ${(result.directions || []).length} 个拓展方向 · ${(result.outline || []).length} 段大纲` });

  return {
    summary: result.summary || "",
    keyPoints: result.keyPoints || [],
    deviations: result.deviations || [],   // 与大纲不符：UI 会据此询问「改大纲」还是「改剧情」
    directions: result.directions || [],
    outline: result.outline || [],
    summaries,
    steps,
  };
}


/* ------------------------------------------------------------------
   大纲偏差的两个处置动作（由 UI 的「调整大纲 / 修改剧情」按钮调用）
   ------------------------------------------------------------------ */

/** 以实际剧情为准，调整大纲 */
export async function reviseOutlineByDeviations({ deviations = [], currentOutline = [], summary = "", callLLM }) {
  if (!deviations.length) throw new Error("没有需要处理的不符之处");
  const dev = deviations.map((d, i) => `${i + 1}. ${d.issue || d}（建议：${d.advice || "待定"}）`).join("\n");
  const cur = currentOutline.length
    ? currentOutline.map((c) => `【${c.title || "未命名"}】${c.body || ""}`).join("\n")
    : "（暂无大纲卡片）";

  const raw = await callLLM([
    { role: "system", content: "你是资深网文策划。只输出 JSON。" },
    { role: "user", content:
      `作品的实际剧情与已有大纲出现偏差，作者选择**以实际剧情为准调整大纲**。\n\n` +
      `=== 实际剧情梳理 ===\n${summary}\n\n` +
      `=== 偏差清单 ===\n${dev}\n\n` +
      `=== 现有大纲 ===\n${cur}\n\n` +
      `请输出调整后的完整大纲，只输出 JSON：\n` +
      `{"outline":[{"title":"分幕/分卷标题","body":"关键情节节点，3-6 条"}]}` },
  ]);
  const j = extractJSON(raw);
  if (!j || !Array.isArray(j.outline) || !j.outline.length) throw new Error("模型未返回可解析的大纲");
  return j.outline;
}

/** 以大纲为准，给出修改剧情的具体方案 */
export async function suggestPlotFixes({ deviations = [], summary = "", callLLM }) {
  if (!deviations.length) throw new Error("没有需要处理的不符之处");
  const dev = deviations.map((d, i) => `${i + 1}. ${d.issue || d}`).join("\n");

  const raw = await callLLM([
    { role: "system", content: "你是资深网文编辑，擅长在不推翻既有剧情的前提下做最小改动。" },
    { role: "user", content:
      `作品实际剧情与既定大纲出现偏差，作者选择**改剧情以回到大纲**。\n\n` +
      `=== 实际剧情梳理 ===\n${summary}\n\n` +
      `=== 偏差清单 ===\n${dev}\n\n` +
      `请给出**具体可执行的修改方案**，不要泛泛而谈。每条包含：\n` +
      `① 改哪一章、哪一段；② 具体改成什么；③ 为什么这样改就能对上大纲。\n` +
      `直接输出编号列表正文。` },
  ]);
  return String(raw || "").trim();
}
