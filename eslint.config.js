// ESLint 9 · Flat Config
// 注意：本项目「运行时」零依赖，这里只引入开发期工具（lint / e2e）。
export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        // 浏览器
        window: "readonly", document: "readonly", navigator: "readonly",
        location: "readonly", console: "readonly", fetch: "readonly",
        indexedDB: "readonly", localStorage: "readonly", sessionStorage: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", requestAnimationFrame: "readonly",
        alert: "readonly", confirm: "readonly", prompt: "readonly",
        URL: "readonly", Blob: "readonly", FileReader: "readonly", Image: "readonly",
        Event: "readonly", CustomEvent: "readonly", DOMParser: "readonly",
        ResizeObserver: "readonly", IntersectionObserver: "readonly", MutationObserver: "readonly",
        getComputedStyle: "readonly", matchMedia: "readonly", scrollTo: "readonly",
        HTMLElement: "readonly", HTMLInputElement: "readonly", Node: "readonly",
        performance: "readonly", crypto: "readonly", structuredClone: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly", atob: "readonly", btoa: "readonly",
        // WebExtension
        chrome: "readonly",
        // Worker / ES 内置
        self: "readonly", globalThis: "readonly",
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // ── 正确性（错误级）──
      "no-undef": "error",
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-self-assign": "error",
      "no-cond-assign": ["error", "except-parens"],
      "no-func-assign": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "use-isnan": "error",
      "valid-typeof": "error",

      // ── 代码质量（警告级）──
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "eqeqeq": ["warn", "smart"],
      "no-var": "warn",
      "prefer-const": ["warn", { destructuring: "all" }],
      "no-multiple-empty-lines": ["warn", { max: 2 }],

      // ── 关闭（本项目有意为之）──
      "no-console": "off",   // 客户端日志是功能的一部分
    },
  },

  // ── Node 侧文件（构建脚本 / 配置 / 测试）──
  {
    files: [
      "eslint.config.js",
      "playwright.config.js",
      "tools/**/*.mjs",
      "tests/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        // Node
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        fetch: "readonly",
        // 浏览器（page.evaluate 里会用到）
        window: "readonly",
        document: "readonly",
        MouseEvent: "readonly",
        KeyboardEvent: "readonly",
        Event: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        getComputedStyle: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
];
