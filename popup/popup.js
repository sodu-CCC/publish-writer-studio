import { books, kv } from "../app/db.js";

const today = () => new Date().toISOString().slice(0, 10);
const $ = (s) => document.querySelector(s);

async function refresh() {
  const d = await kv.get("daily", { date: today(), count: 0 });
  $("#today").textContent = d.date === today() ? d.count : 0;
  $("#bookCount").textContent = (await books.all()).length;
  $("#inboxCount").textContent = (await kv.get("inbox", [])).length;
}

$("#saveNote").addEventListener("click", async () => {
  const v = $("#note").value.trim();
  if (!v) return;
  const inbox = await kv.get("inbox", []);
  inbox.push({ at: new Date().toISOString(), text: v });
  await kv.set("inbox", inbox);
  $("#note").value = "";
  await refresh();
});

$("#openApp").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("app/index.html") }));
$("#openSide").addEventListener("click", async () => {
  const w = await chrome.windows.getCurrent();
  try { await chrome.sidePanel.open({ windowId: w.id }); window.close(); }
  catch (e) { chrome.tabs.create({ url: chrome.runtime.getURL("app/index.html") }); }
});

refresh();
