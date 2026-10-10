import { defineConfig } from '@playwright/test';

// E2E 目标：**网页版**（由 serve.py 提供）
//
// 为什么测网页版而不是扩展版：
//   Chrome 137+ 移除了 --load-extension 命令行开关，无法再自动加载未打包扩展。
//   而网页版跑的是同一套 app/ 代码（UI / 数据层 / RAG / Agent / LLM 适配），
//   覆盖了约 95% 的业务逻辑，且任何浏览器都能跑。
//   仅有扩展专属部分（Service Worker 代理、sidePanel）不在此覆盖范围，需人工验证。

const PORT = Number(process.env.PW_PORT || 5188);

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  retries: 1,   // 浏览器环境偶发抖动，重试一次

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // CI 用 Playwright 自带 Chromium；本地无下载环境可设 PW_CHANNEL=chrome 用系统 Chrome
    channel: process.env.PW_CHANNEL || "chromium",
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  // 服务器由 globalSetup 自己管理（Windows 上 Playwright 内置 webServer 无法可靠杀掉子进程）
  globalSetup: './tests/global-setup.js',
});
