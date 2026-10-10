// RAG 内核：切块 / 分词 / 风格画像 / BM25 检索 / 提示词组装
// 全部本地计算，不依赖任何外部服务。

export const STOP = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
  "会", "着", "没有", "看", "好", "自己", "这", "那", "他", "她", "它", "们", "个", "与", "及", "或", "而", "但", "却", "又",
  "还", "把", "被", "让", "给", "为", "以", "于", "对", "从", "向", "之", "其", "此", "该", "地", "得", "过", "吗", "呢", "吧",
  "啊", "哦", "嗯", "什么", "怎么", "因为", "所以", "如果", "不过", "已经", "可以", "这样", "那样", "时候", "现在", "然后", "只是",
]);

/* ---------- 分词：中文二元组 + 英文数字词 ---------- */
export function tokenize(text) {
  const s = String(text || "");
  const out = [];
  const latin = s.match(/[A-Za-z0-9_]{2,}/g) || [];
  for (const w of latin) out.push(w.toLowerCase());
  const segs = s.replace(/[^\u4e00-\u9fff]+/g, " ").split(/\s+/).filter(Boolean);
  for (const seg of segs) {
    if (seg.length === 1) { out.push(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
  }
  return out;
}

export function termFreq(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/* ---------- 切块 ---------- */
export function chunkText(text, size = 420, overlap = 80) {
  const s = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!s) return [];
  const paras = s.split(/\n+/).map((p) => p.replace(/^[。，、；：！？…—\s]+/, "").trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  const flush = () => { const t = buf.trim(); if (t) chunks.push(t); buf = ""; };
  for (const p of paras) {
    if (buf && buf.length + p.length + 1 > size) {
      flush();
      if (overlap > 0) {
        const last = chunks[chunks.length - 1] || "";
        buf = last.slice(Math.max(0, last.length - overlap)) + "\n";
      }
    }
    buf += (buf ? "\n" : "") + p;
    while (buf.length > size * 1.6) { const t = buf.slice(0, size); chunks.push(t); buf = buf.slice(size - overlap); }
  }
  flush();
  return chunks
    .map((c) => c.replace(/^[。，、；：！？…—\s]+/, "").trim())
    .filter((c) => c.length >= 12);
}

/* ---------- 风格画像 ---------- */
const CJK = /[\u4e00-\u9fff]/;

export function analyzeStyle(texts) {
  const all = (Array.isArray(texts) ? texts : [texts]).join("\n\n");
  const chars = all.length;
  const charsNoSpace = all.replace(/\s+/g, "").length;

  // 句子
  const rawSentences = all.split(/[。！？…\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const sentLens = rawSentences.map((s) => s.replace(/\s+/g, "").length).filter((n) => n > 0);
  const sentences = sentLens.length;
  const avgSentenceLen = sentences ? sentLens.reduce((a, b) => a + b, 0) / sentences : 0;
  const shortSentenceRatio = sentences ? sentLens.filter((n) => n <= 15).length / sentences : 0;

  // 段落
  const paras = all.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const paragraphs = paras.length;
  const avgParagraphLen = paragraphs ? paras.reduce((a, b) => a + b.replace(/\s+/g, "").length, 0) / paragraphs : 0;

  // 对话占比
  let dialogueChars = 0;
  const dlg = all.match(/[“「][^”」]{0,2000}[”」]/g) || [];
  for (const d of dlg) dialogueChars += d.replace(/\s+/g, "").length;
  const dialogueRatio = charsNoSpace ? dialogueChars / charsNoSpace : 0;

  // 标点
  const punctKeys = ["，", "。", "！", "？", "；", "：", "—", "…", "“", "、"];
  const punct = {};
  for (const k of punctKeys) punct[k] = (all.match(new RegExp(k, "g")) || []).length;

  // 人称
  const pronouns = {};
  for (const k of ["我", "你", "他", "她", "它", "我们", "你们", "他们"]) {
    pronouns[k] = (all.match(new RegExp(k, "g")) || []).length;
  }

  // 高频用语（2~3 字，去停用词）
  const segs = all.replace(/[^\u4e00-\u9fff]+/g, " ").split(/\s+/).filter(Boolean);
  const ng = new Map();
  for (const seg of segs) {
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const t = seg.slice(i, i + n);
        if (n === 2 && (STOP.has(t) || STOP.has(t[0]) || STOP.has(t[1]))) continue;
        if (CJK.test(t[0]) === false) continue;
        ng.set(t, (ng.get(t) || 0) + 1);
      }
    }
  }
  const minCount = Math.max(3, Math.floor(charsNoSpace / 20000));
  const topNgrams = [...ng.entries()]
    .filter(([t, c]) => c >= minCount && t.length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([t, n]) => ({ t, n }));

  return {
    chars, charsNoSpace, sentences, avgSentenceLen, shortSentenceRatio,
    paragraphs, avgParagraphLen, dialogueRatio, punct, pronouns, topNgrams,
    computedAt: new Date().toISOString(),
  };
}

export function profileToText(p) {
  if (!p || !p.charsNoSpace) return "";
  const pct = (x) => Math.round(x * 100) + "%";
  const L = [];
  L.push("【作者风格画像（由本人作品统计得出，请严格贴合）】");
  L.push(`- 平均句长 ${p.avgSentenceLen.toFixed(1)} 字；短句（≤15 字）占比 ${pct(p.shortSentenceRatio)}`);
  L.push(`- 平均段长 ${p.avgParagraphLen.toFixed(0)} 字，共 ${p.paragraphs} 段`);
  L.push(`- 对话占比 ${pct(p.dialogueRatio)}`);
  const pr = p.pronouns || {};
  const top = Object.entries(pr).sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, n]) => n > 0);
  if (top.length) L.push(`- 人称使用：${top.map(([k, n]) => `${k}(${n})`).join(" ")}`);
  const pu = p.punct || {};
  const puTop = Object.entries(pu).sort((a, b) => b[1] - a[1]).slice(0, 6).filter(([, n]) => n > 0);
  if (puTop.length) L.push(`- 标点习惯：${puTop.map(([k, n]) => `「${k}」×${n}`).join("，")}`);
  if (p.topNgrams && p.topNgrams.length) {
    L.push(`- 高频用语（尽量自然地复用）：${p.topNgrams.slice(0, 24).map((x) => x.t).join("、")}`);
  }
  L.push("要求：模仿上述句长节奏、段落密度、标点与用词习惯；不要改变设定与情节走向。");
  return L.join("\n");
}

/* ---------- BM25 索引 ---------- */
export function buildIndex(chunks) {
  const docs = [];
  const df = new Map();
  for (const c of chunks) {
    const terms = termFreq(tokenize(c.text));
    let len = 0;
    for (const v of terms.values()) len += v;
    docs.push({ chunk: c, terms, len });
    for (const t of terms.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length || 1;
  const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  const idf = new Map();
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  return { docs, idf, avgdl, N };
}

export function search(index, query, k = 5) {
  if (!index || !index.docs.length) return [];
  const q = termFreq(tokenize(query));
  const k1 = 1.5, b = 0.75;
  const scored = [];
  for (const d of index.docs) {
    let s = 0;
    for (const [t, qtf] of q) {
      const tf = d.terms.get(t);
      if (!tf) continue;
      const idf = index.idf.get(t) || 0;
      s += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.len) / index.avgdl))) * Math.min(qtf, 3);
    }
    if (s > 0) scored.push({ score: s, chunk: d.chunk });
  }
  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, k);
}

/* ---------- 组装注入块 ---------- */
export function buildRagBlock(profile, hits) {
  const parts = [];
  const pt = profileToText(profile);
  if (pt) parts.push(pt);
  if (hits && hits.length) {
    parts.push("【作者过往文风范例（取自本人作品，仅供模仿语感，不要照抄情节）】");
    hits.forEach((h, i) => {
      const t = h.chunk.text.replace(/\s+/g, " ").slice(0, 220);
      parts.push(`${i + 1}. ${t}${h.chunk.text.length > 220 ? "……" : ""}`);
    });
  }
  return parts.join("\n");
}

