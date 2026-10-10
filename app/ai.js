// 外部 AI 适配层（自带密钥 / BYO-Key）
// 设计原则（合规）：
//  - 只产出「建议」，绝不自动发布、绝不自动回写任何第三方网站；
//  - 所有 AI 生成都会写入本地「AI 使用日志」，方便按平台要求主动声明；
//  - 不提供任何「隐藏 / 去除 AI 痕迹」的功能。

import { kv } from "./db.js";

const DEFAULT_SETTINGS = {
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  temperature: 0.85,
  maxTokens: 1200,
  contextChars: 1500,
  systemPrompt:
    "你是一位资深中文网络小说写作助手。文风自然、口语化、有画面感，避免翻译腔和 AI 腔。" +
    "只输出正文或所需内容，不要解释，不要加标题，不要用 Markdown 代码块。",
};

const PRESETS = [
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { label: "月之暗面 Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { label: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
  { label: "本地 Ollama", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
];

export const isExtension = () =>
  typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;

export async function getSettings() {
  const s = await kv.get("aiSettings", null);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await kv.set("aiSettings", next);
  return next;
}
export { PRESETS, DEFAULT_SETTINGS };

/** 记录一次 AI 使用，供作者按平台规则声明 */
export async function logAI(entry) {
  const list = await kv.get("aiLog", []);
  list.push({ at: new Date().toISOString(), ...entry });
  if (list.length > 500) list.splice(0, list.length - 500);
  await kv.set("aiLog", list);
}
export const getAILog = () => kv.get("aiLog", []);

/** 统一的对话调用：扩展内走 background（免 CORS），网页版直接 fetch */
export async function chat(messages, opts = {}) {
  const s = await getSettings();
  const payload = {
    baseUrl: opts.baseUrl || s.baseUrl,
    apiKey: opts.apiKey || s.apiKey,
    model: opts.model || s.model,
    temperature: typeof opts.temperature === "number" ? opts.temperature : s.temperature,
    maxTokens: opts.maxTokens || s.maxTokens,
    messages,
  };
  if (!payload.apiKey) throw new Error("还没有配置 API Key（点右下角「设置」）");

  if (isExtension()) {
    const res = await chrome.runtime.sendMessage({ type: "ai-chat", payload });
    if (!res) throw new Error("后台进程无响应，请重新加载扩展");
    if (!res.ok) throw new Error(res.error || "调用失败");
    return res.data.content;
  }

  // ---- 网页版：优先走本机代理 /ai/chat（绕开浏览器 CORS）----
  const viaHttp = typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:");
  if (viaHttp) {
    let r;
    try {
      r = await fetch("/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error("连不上本地代理 /ai/chat（请确认用 启动本地服务.bat 打开的页面，而不是直接双击 html）");
    }
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch {
      throw new Error("本地代理返回的不是 JSON（HTTP " + r.status + "）：" + text.slice(0, 200));
    }
    if (!r.ok || (j && j.error)) {
      throw new Error((j && j.error && j.error.message) || ("代理 HTTP " + r.status));
    }
    return String((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "");
  }

  // ---- file:// 打开时无法走代理，只能直连（通常会被 CORS 拦掉）----
  const url = payload.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const r2 = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + payload.apiKey },
    body: JSON.stringify({
      model: payload.model, messages: payload.messages,
      temperature: payload.temperature, max_tokens: payload.maxTokens,
    }),
  });
  const text2 = await r2.text();
  if (!r2.ok) throw new Error("HTTP " + r2.status + " " + text2.slice(0, 300));
  const j2 = JSON.parse(text2);
  return String(j2?.choices?.[0]?.message?.content ?? "");
}

/** 写作动作模板 */
export const ACTIONS = {
  continue: {
    label: "续写",
    build: (ctx) => [
      { role: "system", content: ctx.systemPrompt },
      {
        role: "user",
        content:
          `下面是《${ctx.bookTitle || "未命名"}》${ctx.chapterTitle ? "·" + ctx.chapterTitle : ""} 的正文结尾。` +
          `请顺着这个风格与情节继续写约 ${ctx.words || 300} 字。\n\n【正文结尾】\n${ctx.text}\n\n【续写】`,
      },
    ],
  },
  polish: {
    label: "润色",
    build: (ctx) => [
      { role: "system", content: ctx.systemPrompt },
      { role: "user", content: `请润色下面这段文字，保持原意与叙事视角，只输出润色后的正文：\n\n${ctx.text}` },
    ],
  },
  expand: {
    label: "扩写",
    build: (ctx) => [
      { role: "system", content: ctx.systemPrompt },
      { role: "user", content: `请把下面这段扩写到约两倍篇幅，补足细节、动作与感官描写，保持原意：\n\n${ctx.text}` },
    ],
  },
  condense: {
    label: "缩写",
    build: (ctx) => [
      { role: "system", content: ctx.systemPrompt },
      { role: "user", content: `请把下面这段精简到约一半篇幅，保留关键情节与信息：\n\n${ctx.text}` },
    ],
  },
  outline: {
    label: "章纲",
    build: (ctx) => [
      { role: "system", content: ctx.systemPrompt },
      { role: "user", content: `请为这一章写一个分场大纲（3–6 个要点），并给出一个悬念钩子：\n\n${ctx.text}` },
    ],
  },
  names: {
    label: "起名",
    build: (ctx) => [
      { role: "system", content: ctx.systemPrompt },
      { role: "user", content: `请给出 10 个中文网文风格的名字（人物/功法/地名各若干），风格：${ctx.text || "仙侠"}。只输出列表。` },
    ],
  },
  rolecard: {
    label: "角色卡",
    build: (ctx) => [
      { role: "system", content: ctx.systemPrompt },
      { role: "user", content: `请根据以下信息生成一张角色卡（姓名、身份、外貌、性格、目标、秘密、说话风格）：\n\n${ctx.text}` },
    ],
  },
};
