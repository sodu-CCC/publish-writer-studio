#!/usr/bin/env node
/**
 * Markdown → PDF
 *
 *   node tools/md2pdf.mjs <input.md> [output.pdf]
 *   node tools/md2pdf.mjs --all [输出目录]      # 转换 README 与 docs 下的全部 md
 *
 * 做法：用 marked 把 Markdown 解析成 HTML，再用 Chrome（Playwright）按打印样式
 * 输出 A4 PDF。中文依赖系统字体（微软雅黑 / 宋体 / PingFang），不需要额外字体文件。
 *
 * 依赖
 *   - @playwright/test（本仓库 devDependencies 里已有）
 *   - marked（不在依赖里，按下面顺序查找）
 *       1) import("marked")
 *       2) 环境变量 MARKED_PATH 指向的目录（可以是含 marked/ 的 node_modules，
 *          也可以直接是 marked 包目录）
 *     没找到时给出安装提示。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- marked 定位 ---------------- */

async function loadMarked() {
  try {
    return await import("marked");
  } catch { /* 继续找 */ }

  const base = process.env.MARKED_PATH;
  const candidates = base
    ? [path.join(base, "marked", "lib", "marked.esm.js"), path.join(base, "lib", "marked.esm.js")]
    : [];
  for (const c of candidates) {
    if (fs.existsSync(c)) return import(pathToFileURL(c).href);
  }

  console.error(
    "找不到 marked。任选其一：\n" +
    "  npm i -D marked\n" +
    "  或设置 MARKED_PATH 指向含 marked 的 node_modules 目录",
  );
  process.exit(2);
}

/* ---------------- Markdown → HTML ---------------- */
/*
 * marked 会把 <xxx> 当成 HTML 标签，而文档里会有 <your-username> 这类占位符，
 * 直接被吃掉会导致内容缺失。所以先把"不是已知 HTML 标签"的尖括号转义掉。
 */
const KNOWN_TAGS = new Set([
  "a", "b", "br", "code", "dd", "del", "details", "div", "dl", "dt", "em",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins",
  "kbd", "li", "ol", "p", "pre", "s", "span", "strong", "sub", "summary",
  "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

function escapeUnknownTags(md) {
  return md.replace(/<\/?([^>\s/]+)(\s[^>]*)?\/?>/g, (whole, name) => {
    const n = String(name).toLowerCase();
    if (n.startsWith("!--") || KNOWN_TAGS.has(n)) return whole;
    return whole.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  });
}

/* ---------------- 打印样式 ---------------- */

const FONT_CJK = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Source Han Sans SC","Noto Sans CJK SC","SimSun",sans-serif';
const FONT_LATIN = '"Segoe UI","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';

function pageHtml({ title, body, lang }) {
  const font = /^en/i.test(lang) ? FONT_LATIN : FONT_CJK;
  return `<!DOCTYPE html>
<html lang="${/^en/i.test(lang) ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 16mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 11pt/1.75 ${font}; color: #1f2328; }
  h1, h2, h3, h4 { line-height: 1.35; page-break-after: avoid; }
  h1 { font-size: 20pt; margin: 0 0 12pt; padding-bottom: 6pt; border-bottom: 2px solid #3b5bdb; }
  h2 { font-size: 15pt; margin: 18pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #d8dee4; }
  h3 { font-size: 12.5pt; margin: 14pt 0 6pt; }
  h4 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 0; padding-left: 20pt; }
  li { margin: 2pt 0; }
  li > ul, li > ol { margin: 2pt 0; }
  a { color: #3b5bdb; text-decoration: none; word-break: break-all; }
  hr { border: none; border-top: 1px solid #e4e8ee; margin: 14pt 0; }
  blockquote {
    margin: 8pt 0; padding: 6pt 12pt; border-left: 3pt solid #3b5bdb;
    background: #f5f7ff; color: #3a4250; page-break-inside: avoid;
  }
  blockquote > p { margin: 3pt 0; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #d8dee4; padding: 4pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f2f4f7; font-weight: 600; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt;
         background: #f6f8fa; padding: 1pt 3pt; border-radius: 3pt; }
  pre { background: #f6f8fa; border: 1px solid #e4e8ee; border-radius: 6pt;
        padding: 7pt 9pt; overflow-wrap: break-word; white-space: pre-wrap;
        page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  strong { font-weight: 600; }
  p, li { orphans: 3; widows: 3; }
</style>
</head>
<body>${body}</body>
</html>`;
}

/* ---------------- 主流程 ---------------- */

/** --all 模式下按"相对路径"生成不重名的文件名：
 *   README.md                  -> README.pdf
 *   docs/PRODUCT-GUIDE.zh.md   -> PRODUCT-GUIDE.zh.pdf
 *   docs/store/README.md       -> store-README.pdf
 *  （docs 前缀去掉，其余目录用 - 连接，避免根 README 与 docs/store/README 撞名） */
function outNameFor(src, used) {
  const rel = path.relative(ROOT, src).replace(/\\/g, "/");
  const parts = rel.replace(/\.md$/i, "").split("/");
  if (parts[0] === "docs") parts.shift();
  let name = parts.join("-");
  let n = 2;
  while (used.has(name)) name = `${parts.join("-")}-${n++}`;
  used.add(name);
  return name;
}

function collectAll() {
  const out = [path.join(ROOT, "README.md")];
  const docs = path.join(ROOT, "docs");
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(docs);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const all = argv[0] === "--all";
  const inputs = all ? collectAll() : argv.slice(0, 1);
  if (!inputs.length) {
    console.error("用法: node tools/md2pdf.mjs <input.md> [output.pdf] | --all [输出目录]");
    process.exit(2);
  }
  // --all：第二个参数是输出目录；单文件：第二个参数可以是 .pdf 文件，也可以是目录
  const arg2 = argv[1] || "";
  const explicitFile = !all && /[.]pdf$/i.test(arg2) ? path.resolve(arg2) : null;
  const outDir = all
    ? path.resolve(arg2 || path.join(ROOT, "output", "pdf"))
    : (explicitFile ? path.dirname(explicitFile) : path.resolve(arg2 || "."));
  fs.mkdirSync(outDir, { recursive: true });

  const { marked } = await loadMarked();
  marked.setOptions({ gfm: true, breaks: false });

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
  const page = await browser.newPage();

  const done = [];
  const usedNames = new Set();
  for (const input of inputs) {
    const src = path.resolve(input);
    if (!fs.existsSync(src)) { console.warn(`跳过（不存在）: ${src}`); continue; }
    const md = fs.readFileSync(src, "utf8");
    const body = marked.parse(escapeUnknownTags(md));
    const stem = path.basename(src, ".md");
    const lang = /\.(en|en-US|en-GB)$/i.test(stem) ? "en" : "zh";
    const title = (md.match(/^#\s+(.+)$/m) || [, stem])[1].replace(/[*`]/g, "").trim();
    const html = pageHtml({ title, body, lang });
    const out = explicitFile || path.join(outDir, `${all ? outNameFor(src, usedNames) : stem}.pdf`);

    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: out,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        `<div style="width:100%;font-size:8pt;color:#7a828e;padding:0 16mm;` +
        `display:flex;justify-content:space-between;font-family:${FONT_LATIN};">` +
        `<span>${title}</span>` +
        `<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    const size = fs.statSync(out).size;
    done.push({ file: out, size });
    console.log(`${path.basename(out)}  ${(size / 1024).toFixed(1)} KB`);
  }

  await browser.close();
  console.log(`\n完成 ${done.length} 个 → ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
