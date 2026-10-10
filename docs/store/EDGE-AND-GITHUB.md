# 只走 Edge + GitHub：完整操作步骤

> 不花 $5 上 Chrome 商店的替代路线。两条腿：
> **GitHub Releases** 负责"把包发给所有人"，**Edge 加载项商店**负责"让用户一键装"。
>
> 按顺序做，全程约 **40 分钟**（不含商店审核等待）。

---

## 总览

| 步骤 | 做什么 | 耗时 |
|---|---|---|
| 0 | 替换文档里的占位符 | 5 min |
| 1 | 推到 GitHub | 10 min |
| 2 | 等 CI 跑绿 | 自动，约 3 min |
| 3 | 打 tag → 自动生成 Release zip | 2 min |
| 4 | 注册 Edge Partner Center（免费） | 5 min |
| 5 | Edge 后台上架填表 | 20 min |
| 6 | 审核通过 → 回填商店链接 | 1 min |

---

## 第 0 步 · 替换占位符（必做）

现在文档里有三种占位符，商店审核**不接受**它们：

| 占位符 | 出现在 |
|---|---|
| `sodu-CCC` | `README.md`（CI 徽章，两处） |
| `sodu-CCC` | `docs/store/listing.*.md`、`privacy-policy.*.md`、本文件 |
| `zhangxing0323@gmail.com` | `docs/store/listing.*.md` |

在 `E:\CodexWork\publish-writer-studio` 目录下，把下面三个变量换成你的信息后执行：

```powershell
$user = "你的GitHub用户名"
$mail = "你的邮箱"
$root = "E:\CodexWork\publish-writer-studio"
Get-ChildItem $root -Recurse -File -Include *.md |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
  ForEach-Object {
    $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
    $t = $t.Replace('sodu-CCC', $user).Replace('sodu-CCC', $user).Replace('sodu-CCC', $user).Replace('zhangxing0323@gmail.com', $mail).Replace('zhangxing0323@gmail.com', $mail)
    [System.IO.File]::WriteAllText($_.FullName, $t, (New-Object System.Text.UTF8Encoding($false)))
  }
Write-Host "占位符替换完成"
```

> 顺便把仓库地址里的 `writer-studio` 换成你实际用的仓库名（若你换了名字）。

---

## 第 1 步 · 推到 GitHub

1. 打开 https://github.com/new
2. Repository name 填 `writer-studio`
3. **不要**勾 "Add a README / .gitignore / license"（本地已有）
4. 点 **Create repository**

然后：

```bash
cd /d E:\CodexWork\publish-writer-studio
git add -A
git commit -m "docs: 替换占位符为实际仓库信息"
git remote add origin https://github.com/sodu-CCC/writer-studio.git
git push -u origin main
```

> 如果 git 报 `dubious ownership`，按提示执行一次：
> `git config --global --add safe.directory E:/CodexWork/publish-writer-studio`

---

## 第 2 步 · 等 CI 跑绿

到仓库 **Actions** 页，`CI` 工作流会自动跑三项：

```
静态自检（8 项） → ESLint → Playwright E2E（36 例）
```

看到绿色 ✅ 再往下走。红了就先修（本地用 `npm run ci` 复现）。

---

## 第 3 步 · 打 tag，自动产出 Release 包

```bash
cd /d E:\CodexWork\publish-writer-studio
git tag v0.1.0
git push origin v0.1.0
```

`Release` 工作流会：

1. 校验 **tag 与 `manifest.json` 里的 version 一致**（不一致会直接失败）
2. 打一个**只含运行时文件**的包 → `writer-studio-v0.1.0.zip`
   ```
   manifest.json
   background.js
   app/  (7 个文件)
   popup/ (2 个文件)
   icons/ (3 个文件)
   ```
3. 自动创建 GitHub Release 并挂上这个 zip

**这一个 zip 有两个用途**：

| 用途 | 怎么用 |
|---|---|
| 提交 Edge 商店 | 第 5 步直接上传它 |
| 让 Chrome 用户安装 | 用户下载解压 → `chrome://extensions/` → 开发者模式 → 加载已解压的扩展程序 |

### 建议在 Release 说明里贴这段"免商店安装"（模板）

```markdown
## 安装方式（无需商店）

1. 下载上面的 `writer-studio-vX.Y.Z.zip` 并**解压**
2. 打开 `chrome://extensions/`（Edge 用 `edge://extensions/`），打开右上角 **开发者模式**
3. 点 **加载已解压的扩展程序**，选中解压出来的文件夹（里面有 `manifest.json` 那一层）

> 本工具开源，代码可自行审阅。Chrome 启动时若提示"停用开发者模式扩展"，忽略即可。
> 想要一键安装，请到 **Microsoft Edge 加载项商店**搜索「码字工坊 / Writer Studio」。
```

---

## 第 4 步 · 注册 Edge 开发者（免费）

1. 打开 https://partner.microsoft.com/dashboard/microsoftedge/
2. 用 **Microsoft 账号**登录（没有就现注册，免费）
3. 填写开发者信息（姓名 / 邮箱 / 国家）
4. **不需要付费** —— Edge 加载项商店目前免费

> 注册信息会公开显示在商店页（开发者名称），想用笔名就填笔名。

---

## 第 5 步 · Edge 后台上架（逐字段对照）

登录后：**Create new extension** → 按下面四块填。

### 5.1 Packages（上传包）

| 字段 | 填什么 |
|---|---|
| Package | 上传第 3 步生成的 `writer-studio-v0.1.0.zip` |

上传后后台会自动读取 `manifest.json`，确认名称/版本/权限显示正确。

### 5.2 Properties（属性）

| 字段 | 填什么 | 来源 |
|---|---|---|
| Category | `Productivity`（生产力） | — |
| Support contact info | 你的邮箱 | — |
| **Privacy policy URL** | `https://github.com/sodu-CCC/writer-studio/blob/main/docs/store/privacy-policy.zh-CN.md` | 见下方提示 |
| Website URL | `https://github.com/sodu-CCC/writer-studio` | — |
| Mature content | `No` | — |

> **隐私政策 URL 只要能被公开访问即可**，GitHub 的文件页就是公开可访问的 ✓
> 前提：**仓库必须是 Public**（Private 仓库的链接审核员打不开，一定会被驳回）。
> 想更正式，可开 GitHub Pages（Settings → Pages → main / root），地址形如
> `https://sodu-CCC.github.io/writer-studio/`，内容同样用 `docs/store/privacy-policy.zh-CN.md`。

### 5.3 Store listing（商店展示）

| 字段 | 填什么 | 限制 | 来源 |
|---|---|---|---|
| Display name | `码字工坊 Writer Studio` | ≤ 45 | — |
| Short description | 复制「短描述」那一行 | **≤ 132 字符**（我们的是 66） | `listing.zh-CN.md` |
| Description | 复制「详细描述」整块 | ≤ 10000 | `listing.zh-CN.md` |
| **Store logo** | 上传图片 | **必须 300×300** | `docs/store/edge-store-logo-300.png` ✅ 已生成 |
| Small promotional tile | 可选 | 440×280 | 不做也行 |
| Large promotional tile | 可选 | 1400×560 | 不做也行 |
| **Screenshots** | 上传 5 张 | **1280×800 或 640×480**，1–10 张 | `docs/store/screenshots/*.png` ✅ 已生成，实测 1280×800 |

### 5.4 Notes for certification（给审核员的话）

这块**建议一定要填**，能显著提高过审率。直接粘贴：

```
本扩展是一个本地优先的小说写作工作台，源码开源在 GitHub 仓库首页。

权限用途简述：
- storage / unlimitedStorage：在用户本机保存作品、章节、语料与设置，数据不出本机
- sidePanel：把工作台显示在浏览器侧边栏
- downloads：导出 .txt 与全量 JSON 备份
- clipboardWrite：复制 AI 结果到剪贴板
- 主机权限：仅在用户主动点击「生成」时，把提示词发送到用户自己配置的模型服务商；
  localhost/127.0.0.1 用于连接用户本机的模型服务（如 Ollama）

其它说明：
- 无内容脚本，不读取任何网页内容
- 无远程代码，所有 JS/CSS 均打包在扩展内
- 无分析、无遥测、无广告；开发者不收集任何数据
- 不使用 AI 功能时，扩展不产生任何网络请求
```

同时把 `docs/store/permission-justifications.md` 的第 0 节（单一用途）与第 2 节（逐条权限理由）也一并填到对应输入框。

### 5.5 提交

点 **Submit for review** → 状态变 `In review`，通常 **1–7 个工作日**。

---

## 第 6 步 · 通过之后

1. 拿到商店链接（形如 `https://microsoftedge.microsoft.com/addons/detail/xxxx`）
2. 回填到仓库 `README.md` 顶部（建议放在 CI 徽章下面），例如：

```markdown
[![Edge Add-ons](https://img.shields.io/badge/Edge-安装-blue)](https://microsoftedge.microsoft.com/addons/detail/xxxx)
```

3. 顺手在 GitHub Release 说明里也贴上这个链接

---

## 之后怎么发新版

```
1. 改代码
2. 更新 manifest.json 里的 version（如 0.1.1）
3. git commit && git push
4. git tag v0.1.1 && git push origin v0.1.1     ← 自动出新的 Release zip
5. Edge 后台 → 你的扩展 → Update → 上传新 zip → Submit
   （描述、截图、隐私政策不用重填）
```

> ⚠️ 版本号规则：`manifest.json` 用 `0.1.1`（三段），tag 用 `v0.1.1`。
> Release 工作流会校验两者一致，不一致直接失败。

---

## 常见卡点速查

| 现象 | 原因 / 解决 |
|---|---|
| 隐私政策 URL 审核员打不开 | 仓库是 Private → 改成 **Public** |
| 截图被拒 | 尺寸必须是 1280×800 或 640×480；我们的 5 张已实测合规 |
| Logo 被拒 | Edge 商店 Logo 必须是 **300×300** 方形 → 用 `edge-store-logo-300.png` |
| "权限理由不充分" | 用 `permission-justifications.md` 的逐条说明，别只写"功能需要" |
| "隐私声明与实际行为不符" | 表单里**要如实声明会把用户内容发给第三方模型服务**，不要勾"不收集" |
| Release 工作流失败 | 多半是 tag 与 manifest 版本不一致 |
| 用户装不上（Chrome） | 确认是「加载已解压」，且选的是**含 manifest.json 的那一层文件夹** |

---

## 材料清单（都在 `docs/store/`）

| 材料 | 文件 |
|---|---|
| 商店文案（中文） | `listing.zh-CN.md` |
| 商店文案（英文，可选） | `listing.en.md` |
| 隐私政策（中文） | `privacy-policy.zh-CN.md` |
| 隐私政策（英文，可选） | `privacy-policy.en.md` |
| 单一用途 + 权限理由 | `permission-justifications.md` |
| Edge 商店 Logo 300×300 | `edge-store-logo-300.png` |
| 截图 5 张 1280×800 | `screenshots/*.png` |