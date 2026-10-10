/**
 * E2E 全局启动：自己拉起本地服务器，并在测试结束后可靠地杀掉。
 *
 * 踩过的坑（都已在这里处理）：
 *   1) Playwright 内置 webServer 在 Windows 上杀不掉 python 子进程 → 自己管理
 *   2) Node 24 的 fetch(undici) 撞上 HTTP/1.0 短连接会断言崩溃 → 改用 node:http
 *   3) serve.py 在端口被占用时会自动跳到下一个端口，而测试固定连 PORT；
 *      上一轮服务器未完全退出时会导致整轮失败 → 启动前等端口释放，收尾时等到确实释放
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PW_PORT || 5188);
const URL_BASE = `http://127.0.0.1:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HTTP 探测：服务可用返回 true */
function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

/** TCP 探测：端口是否被占用 */
function isPortOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

async function waitFor(fn, timeoutMs, gapMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(gapMs);
  }
  return false;
}

export default async function globalSetup() {
  // ① 已有可用服务器 → 复用
  if (await probe(URL_BASE)) {
    console.log(`[e2e] 复用已运行的服务器 ${URL_BASE}`);
    return async () => {};
  }

  // ② 端口还被上一轮占着 → 等它释放（否则 serve.py 会跳到别的端口，测试就连不上了）
  if (await isPortOpen(PORT)) {
    const freed = await waitFor(async () => !(await isPortOpen(PORT)), 10_000);
    if (!freed) throw new Error(`端口 ${PORT} 一直被占用，请先关闭占用该端口的进程`);
  }

  // ③ 启动
  const proc = spawn('python', ['serve.py', String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });

  if (!(await waitFor(() => probe(URL_BASE), 20_000))) {
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    throw new Error(`本地服务器未能在 20 秒内就绪：${URL_BASE}（可能被其他进程占用端口）`);
  }
  console.log(`[e2e] 已启动本地服务器 ${URL_BASE} (pid=${proc.pid})`);

  // ④ 收尾：杀掉并确认端口释放
  return async () => {
    if (proc.exitCode === null) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    const closed = await waitFor(async () => !(await isPortOpen(PORT)), 5000, 150);
    console.log(closed ? '[e2e] 本地服务器已停止' : `[e2e] 警告：端口 ${PORT} 仍未释放`);
  };
}
