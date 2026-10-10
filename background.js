// 码字工坊 · 后台服务进程（MV3 service worker）
// 职责：1) 打开侧边面板  2) 代理 AI 请求（规避浏览器 CORS，密钥只存在本地）

const APP_URL = "app/index.html";

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (e) {
    console.warn("sidePanel init skipped:", e);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  // 有 popup 时该事件不触发；保留给禁用 popup 的场景
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    console.warn(e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  switch (msg.type) {
    case "open-app": {
      chrome.tabs.create({ url: chrome.runtime.getURL(APP_URL) });
      sendResponse({ ok: true });
      return false;
    }
    case "open-side-panel": {
      const windowId = sender?.tab?.windowId;
      (windowId != null
        ? chrome.sidePanel.open({ windowId })
        : Promise.resolve()
      ).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case "ai-chat": {
      aiChat(msg.payload).then(
        (data) => sendResponse({ ok: true, data }),
        (err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) })
      );
      return true; // 异步
    }
    case "ping":
      sendResponse({ ok: true, pong: true });
      return false;
    default:
      return false;
  }
});

/**
 * 以 OpenAI 兼容协议调用外部模型。
 * payload: { baseUrl, apiKey, model, messages, temperature, maxTokens }
 */
async function aiChat(payload) {
  const { baseUrl, apiKey, model, messages } = payload || {};
  if (!baseUrl || !apiKey || !model) throw new Error("缺少 baseUrl / apiKey / model");
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages 为空");

  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: typeof payload.temperature === "number" ? payload.temperature : 0.8,
      max_tokens: typeof payload.maxTokens === "number" ? payload.maxTokens : 1200,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error("HTTP " + res.status + " " + text.slice(0, 400));
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("返回不是合法 JSON：" + text.slice(0, 200));
  }
  const content =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.text ??
    "";
  return { content: String(content), raw: json };
}
