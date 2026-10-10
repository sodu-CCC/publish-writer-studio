#!/usr/bin/env node
/**
 * Writer Studio · 项目自检（本地与 CI 共用）
 *   用法:  node tools/check.mjs
 *
 * 检查项：
 *   1. JavaScript 语法（node --check）
 *   2. Python 语法（若环境有 python）
 *   3. manifest.json 合法性与必需字段
 *   4. DOM 选择器一致性（JS 里引用的 #id 必须存在于 HTML）
 *   5. 资源引用完整性（import / src / href 指向的文件必须存在）
 *   6. 硬编码密钥扫描
 *   7. 禁止文件扫描（逆向产物、测试数据、本地产物）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const pass = (m) => console.log(`  \u2705 ${m}`);
const fail = (m) => { console.log(`  \u274c ${m}`); failures++; };
const head = (m) => console.log(`\n${m}`);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const read = (p) => fs.readFileSync(p, "utf8");
const files = walk(ROOT);

/* ---------- 1. JavaScript 语法 ---------- */
head("[1/8] JavaScript 语法");
const jsFiles = files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status === 0) pass(rel(f));
  else fail(`${rel(f)}\n${(r.stderr || "").split("\n").slice(0, 4).join("\n")}`);
}

/* ---------- 2. Python 语法 ---------- */
head("[2/8] Python 语法");
const pyFiles = files.filter((f) => f.endsWith(".py"));
if (!pyFiles.length) pass("无 Python 文件，跳过");
else {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  const py = probe.status === 0 ? "python3" : (spawnSync("python", ["--version"], { encoding: "utf8" }).status === 0 ? "python" : null);
  if (!py) pass("环境无 Python，跳过（CI 会装）");
  else for (const f of pyFiles) {
    const r = spawnSync(py, ["-c", `import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())`, f], { encoding: "utf8" });
    if (r.status === 0) pass(rel(f));
    else fail(`${rel(f)}\n${(r.stderr || "").split("\n").slice(0, 4).join("\n")}`);
  }
}

/* ---------- 3. manifest.json ---------- */
head("[3/8] manifest.json");
const mfPath = path.join(ROOT, "manifest.json");
if (!fs.existsSync(mfPath)) fail("缺少 manifest.json");
else {
  try {
    const m = JSON.parse(read(mfPath));
    const need = ["manifest_version", "name", "version", "description"];
    const miss = need.filter((k) => m[k] === undefined);
    if (miss.length) fail("缺少字段: " + miss.join(", "));
    else if (m.manifest_version !== 3) fail("manifest_version 必须为 3（MV3）");
    else pass(`manifest_version=3, name="${m.name}", version=${m.version}`);

    // 引用的图标必须存在
    const icons = { ...(m.icons || {}), ...((m.action && m.action.default_icon) || {}) };
    for (const [size, p] of Object.entries(icons)) {
      if (fs.existsSync(path.join(ROOT, p))) pass(`图标 ${size}: ${p}`);
      else fail(`图标缺失 ${size}: ${p}`);
    }
    // 声明的权限应尽量少
    if (Array.isArray(m.permissions)) pass(`permissions (${m.permissions.length}): ${m.permissions.join(", ")}`);
  } catch (e) { fail("manifest.json 解析失败: " + e.message); }
}

/* ---------- 4. DOM 选择器一致性 ---------- */
head("[4/8] DOM 选择器一致性");
const pairs = [
  ["app/app.js", "app/index.html"],
  ["popup/popup.js", "popup/popup.html"],
];
const collectIds = (html, jsPath) => {
  const set = new Set([...read(path.join(ROOT, html)).matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  // 也接受由 JS 动态创建的元素（模板字符串里出现 id="xxx"）
  if (jsPath && fs.existsSync(path.join(ROOT, jsPath))) {
    for (const m of read(path.join(ROOT, jsPath)).matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) set.add(m[1]);
  }
  return set;
};
const collectRefs = (js) => {
  const t = read(path.join(ROOT, js));
  const s = new Set();
  for (const re of [/\$\("#([A-Za-z0-9_-]+)"\)/g, /getElementById\("([A-Za-z0-9_-]+)"\)/g, /querySelector\("#([A-Za-z0-9_-]+)"\)/g]) {
    for (const m of t.matchAll(re)) s.add(m[1]);
  }
  return s;
};
for (const [js, html] of pairs) {
  if (!fs.existsSync(path.join(ROOT, js)) || !fs.existsSync(path.join(ROOT, html))) { pass(`${js} / ${html} 不存在，跳过`); continue; }
  const refs = collectRefs(js), ids = collectIds(html, js);
  const missing = [...refs].filter((x) => !ids.has(x));
  if (missing.length) fail(`${js} 引用了 ${html} 中不存在的 id: ${missing.join(", ")}`);
  else pass(`${js} 引用 ${refs.size} 个 id，全部存在`);
}

/* ---------- 5. 资源引用完整性 ---------- */
head("[5/8] 资源引用完整性");
let broken = 0;
for (const f of files.filter((x) => /\.(js|html|css)$/.test(x))) {
  const dir = path.dirname(f);
  const t = read(f);
  const refs = [
    ...[...t.matchAll(/\bfrom\s+"(\.[^"]+)"/g)].map((m) => m[1]),
    ...[...t.matchAll(/\bsrc="(\.[^"]+)"/g)].map((m) => m[1]),
    ...[...t.matchAll(/\bhref="(\.[^"]+)"/g)].map((m) => m[1]),
  ];
  for (const r of refs) {
    if (r.includes("${")) continue; // 模板字符串，跳过
    const target = path.resolve(dir, r.split("?")[0]);
    if (!fs.existsSync(target)) { fail(`${rel(f)} -> ${r} 不存在`); broken++; }
  }
}
if (!broken) pass("所有 import / src / href 均可解析");

/* ---------- 6. 硬编码密钥 ---------- */
head("[6/8] 硬编码密钥扫描");
const secretRe = /sk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|apikey|secret|token)\s*[:=]\s*["'][^"']{16,}["']/gi;
let secrets = 0;
for (const f of files.filter((x) => /\.(js|mjs|html|css|json|py|md|txt)$/.test(x))) {
  const t = read(f);
  for (const m of t.matchAll(secretRe)) {
    // 放行文档占位符与测试夹具（fake key / mock key 等）
    if (/your|example|placeholder|xxx|<.*>|fake|test|mock|dummy|not-a-real|change-?me/i.test(m[0])) continue;
    fail(`${rel(f)} 疑似硬编码密钥: ${m[0].slice(0, 24)}...`); secrets++;
  }
}
if (!secrets) pass("未发现硬编码密钥");

/* ---------- 7. 禁止文件 ---------- */
head("[7/8] 禁止文件扫描");
// [正则, 说明, 级别]  级别 "error" = 绝不能提交；"warn" = 已被 .gitignore 覆盖
const forbidden = [
  [/\.asar$/i, "asar 归档（可能含他人代码）", "error"],
  [/\.asar\.unpacked\//i, "asar 解包目录", "error"],
  [/\.(node|pdb)$/i, "原生二进制/调试符号", "error"],
  [/^authorwrite-analysis\//i, "逆向分析产物", "error"],
  [/_testdata\//i, "测试数据", "warn"],
  [/^server-url\.txt$/i, "本地运行产物", "warn"],
  [/\.(log|sqlite|db)$/i, "日志/数据库", "warn"],
];
let bad = 0;
for (const f of files) {
  const r = rel(f);
  for (const [re, why, level] of forbidden) {
    if (!re.test(r)) continue;
    if (level === "error") { fail(`禁止提交 ${r} —— ${why}`); bad++; }
    else if (!/^\.gitignore$/.test(r)) console.log(`  \u26a0\ufe0f  忽略(已在 .gitignore) ${r} —— ${why}`);
  }
}
if (!bad) pass("未发现必须禁止的文件");

/* ---------- 8. 扩展命名限制 ---------- */
head("[8/8] 扩展命名限制（Chrome/Edge 不允许 _ 开头的名字）");
const badNames = [];
for (const f of files) {
  const r = rel(f);
  if (r.split("/").some((seg) => seg.startsWith("_"))) badNames.push(r);
}
if (badNames.length) {
  badNames.slice(0, 10).forEach((x) => fail(`Chrome 会拒绝加载：${x} —— 文件名不能以 _ 开头（保留给系统）`));
  if (badNames.length > 10) fail(`...还有 ${badNames.length - 10} 个`);
} else {
  pass("未发现 _ 开头的文件/目录");
}

/* ---------- 结果 ---------- */
console.log("\n" + "=".repeat(52));
if (failures === 0) { console.log("  \u2705 全部检查通过，可以提交/打包"); process.exit(0); }
console.log(`  \u274c 共 ${failures} 项失败，请修复后再提交`); process.exit(1);

