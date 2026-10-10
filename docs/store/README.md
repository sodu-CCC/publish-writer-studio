# 商店上架材料包 · Store Submission Kit

> 「商店版本的产品文档」= **上架表单要填的东西**，不是 README。

> 🚀 **决定只走 Edge + GitHub（不花 $5）？** 直接看 → [`EDGE-AND-GITHUB.md`](EDGE-AND-GITHUB.md)
> 那是逐步操作手册：占位符替换 → 推 GitHub → 打 tag 出包 → Edge 后台逐字段填表 → 发新版。
> 这份清单把材料、流程、风险点一次说清。

---

## 一、商店到底要什么

| 材料 | 状态 | 位置 |
|---|---|---|
| 扩展打包 zip | ✅ 已生成 | `E:\CodexWork\writer-studio-v0.1.0.zip`（23 项，仅运行时代码） |
| 商店图标 128×128 | ✅ 已有 | `icons/icon128.png` |
| **截图**（至少 1 张，建议 5 张，**必须 1280×800 或 640×400**） | ✅ 已生成 5 张 | `docs/store/screenshots/` |
| **短描述**（≤132 字符） | ✅ 已写好 | `listing.zh-CN.md` / `listing.en.md` |
| **详细描述** | ✅ 已写好 | 同上 |
| **单一用途说明** | ✅ 已写好 | `permission-justifications.md` 第 0 节 |
| **每个权限的用途说明** | ✅ 已写好 | `permission-justifications.md` 第 2 节 |
| **隐私政策** | ✅ 已写好（中/英） | `privacy-policy.zh-CN.md` / `privacy-policy.en.md` |
| 隐私政策 **网址** | ⚠️ 需要你生成（见第三节） | — |
| 支持邮箱 / 主页 | ⚠️ 填你自己的 | — |
| **Edge 商店 Logo 300×300** | ✅ 已生成 | `docs/store/edge-store-logo-300.png` |
| 宣传图 440×280（可选，但能显著提升点击率） | ⚠️ 可选 | — |

### 已有的 5 张截图

| 文件 | 内容 |
|---|---|
| `01-library.png` | 书架：竖排书目 + 检索框 |
| `02-library-search.png` | 书架检索生效（`1 / 2 本`） |
| `03-workbench.png` | 写作台三栏：排版条 + 正文 |
| `04-foreshadow.png` | 伏笔虚线 + 点击浮出的思路浮窗 |
| `05-corpus.png` | 语料库与文风画像 |

---

## 二、提交前必须先做的 3 件事

### 1. 把占位符换成真实信息

需要替换的 `sodu-CCC` / `zhangxing0323@gmail.com`，会出现在：

- `README.md`（CI 徽章两处 `sodu-CCC`）
- `docs/store/listing.zh-CN.md` / `listing.en.md`（主页、支持邮箱、隐私政策网址）
- `docs/store/privacy-policy.zh-CN.md` / `.en.md`（Issue 链接）

一键替换（把两个值换成你自己的）：

```bash
cd /d E:\CodexWork\publish-writer-studio
```

然后用编辑器全局替换 `sodu-CCC` → 你的 GitHub 用户名，`sodu-CCC` → 同上，`zhangxing0323@gmail.com` → 你的邮箱。

### 2. 把代码推上 GitHub

见 `E:\CodexWork\docs\上传到GitHub.md`。

### 3. 拿到「隐私政策网址」

商店**要求一个可公开访问的 URL**（不是文件）。三个方案，推荐第一个：

**方案 A：GitHub Pages（推荐，专业且稳定）**

1. 仓库 → Settings → Pages
2. Source 选 `Deploy from a branch`，Branch 选 `main` / `root`，保存
3. 等 1 分钟，得到 `https://sodu-CCC.github.io/publish-writer-studio/`
4. 隐私政策网址就是：
   - 中文：`https://sodu-CCC.github.io/publish-writer-studio/docs/store/privacy-policy.zh-CN.html`
   - 英文：`https://sodu-CCC.github.io/publish-writer-studio/docs/store/privacy-policy.en.html`

> ⚠️ GitHub Pages 对 `.md` 会当纯文本处理，链接打开是源码。
> 两个办法：① 把 `.md` 复制一份为 `.html` 加个简单页面壳；② 直接用方案 B 的 GitHub 渲染页。

**方案 B：GitHub 自带渲染页（最省事，够用）**

直接用仓库里的文件，打开就是渲染好的 Markdown：

```
https://github.com/sodu-CCC/publish-writer-studio/blob/main/docs/store/privacy-policy.zh-CN.md
```

> 商店审核**接受** GitHub 的文件页作为隐私政策网址（内容公开、可直接访问即可）。
> 想更正式就用方案 A。

**方案 C：Notion / Gist / 个人网站**
把 `privacy-policy.zh-CN.md` 内容粘过去，用那个页面地址。

---

## 三、Chrome Web Store 提交流程

1. 注册开发者账号：https://chrome.google.com/webstore/devconsole
   - **一次性 $5** 注册费（需国际支付）
2. **New item** → 上传 `writer-studio-v0.1.0.zip`
3. 填 **Store listing** 页
   - Name / Short description / Detailed description → 从 `listing.zh-CN.md` 复制
   - Category：`Productivity`
   - Language：`中文（简体）`
   - Store icon：已随包上传（也可单独传 128×128）
   - **Screenshots**：上传 `docs/store/screenshots/` 里的 5 张
4. 填 **Privacy practices** 页 —— ⚠️ **最容易卡审核的一页**
   - Single purpose：从 `permission-justifications.md` 第 0 节复制
   - 逐条权限理由：从第 2 节复制
   - 远程代码：选 **No**
   - 数据使用：按第 3 节的表格如实勾选（**不要勾"不收集"**）
   - Privacy policy URL：填第三节拿到的地址
5. 填 **Distribution**：公开 / 可见地区
6. 提交审核 → 通常 **1–3 个工作日**（首次可能更久）

---

## 四、Microsoft Edge 加载项商店

| 项 | 说明 |
|---|---|
| 注册 | https://partner.microsoft.com/dashboard/microsoftedge/ |
| 费用 | **免费**（不用 $5） |
| 审核 | 通常 1–7 个工作日 |
| 材料 | 与 Chrome 基本一致：zip、图标、截图、描述、隐私政策 URL |
| **最大优势** | **国内可直接访问**，你和用户都不需要梯子 |

> 本项目无需任何修改即可在 Edge 运行（Chromium 内核）。
> 若 Edge 审核建议移除 `minimum_chrome_version` 字段，删掉即可。

---

## 五、常见驳回原因（提前规避）

| 驳回理由 | 本项目的应对 |
|---|---|
| 「隐私声明与实际行为不符」 | 已在 `permission-justifications.md` 第 3 节给了如实勾选的指引；**务必按"收集用户内容"来声明** |
| 「权限过度申请」 | 每个权限都有逐条理由；`optional_host_permissions` 不在安装时索取 |
| 「缺少单一用途」 | 已写好单一用途说明 |
| 「含远程代码」 | 全量代码打包，无 eval、无远程脚本 |
| 「描述堆砌关键词」 | 详细描述写成了功能清单，没有关键词堆砌 |
| 「截图尺寸不符」 | 5 张全部实测 **1280×800** |
| 「未提供隐私政策 URL」 | 走第三节任一方案 |

---

## 六、发版更新怎么做

改代码 → 同步更新 `manifest.json` 的 `version` → 提交 → 打 tag：

```bash
git tag v0.1.1
git push origin v0.1.1
```

`.github/workflows/release.yml` 会校验 tag 与 manifest 版本一致，并自动打包 Release。
商店端回到开发者后台，**上传新的 zip + 提交新版本**即可（描述与截图不用重填）。

---

## 七、术语对照

| 商店里的字段 | 对应材料 |
|---|---|
| Short description | `listing.*.md` 的「短描述」 |
| Detailed description | 同上的「详细描述」 |
| Single purpose | `permission-justifications.md` 第 0 节 |
| Permission justification | `permission-justifications.md` 第 2 节 |
| Privacy policy URL | `privacy-policy.*.md` 的公网地址 |
| Screenshots | `screenshots/*.png` |