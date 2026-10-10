# 权限用途说明 · Permission Justifications

> Chrome Web Store 的「隐私规范 / Privacy practices」页会**逐条**要求填写权限用途。
> 下表左边是权限名，右边可直接粘贴（中英各一份，商店用哪个语言就贴哪个）。

---

## 0. 单一用途说明 · Single purpose

**中文（直接粘贴）**

```
本扩展只有一个用途：作为本地优先的小说写作工作台，帮助作者管理作品与章节、
排版正文、标注伏笔，并可选地调用作者自己配置的大模型来完成续写、润色与大纲梳理。
所有数据保存在本机，扩展不收集任何用户数据。
```

**English (paste directly)**

```
This extension has a single purpose: to serve as a local-first writing workbench for
fiction authors — managing books and chapters, typesetting text, marking foreshadowing,
and optionally calling the large language model that the user configures themselves for
continuation, polishing and outline review. All data stays on the user's device and the
extension collects no user data.
```

---

## 1. 远程代码 · Remote code

**用不用远程代码？答：不用（No）。**

```
不使用远程代码。所有 HTML / JS / CSS 均打包在扩展内，不加载、不执行任何远程脚本，
不使用 eval / new Function 动态执行外部代码。
```

```
No remote code. All HTML/JS/CSS is bundled in the package; no remote script is loaded or
executed, and no eval / new Function is used to execute externally fetched code.
```

---

## 2. 权限逐条说明

| 权限 | 中文说明（粘贴用） | English (paste) |
|---|---|---|
| `storage` | 在本机浏览器中保存作品、章节、设定卡片、快照、语料与设置，以便离线使用。数据不离开设备。 | Stores books, chapters, cards, snapshots, corpus and settings in the browser's local storage so the extension works offline. Data never leaves the device. |
| `unlimitedStorage` | 长篇小说的正文与本地语料索引很容易超过扩展默认存储配额；此权限仅用于放宽本机存储上限，数据仍只在本机。 | Long novels and the local corpus index easily exceed the default extension storage quota. This permission only raises the on-device quota; data still stays local. |
| `sidePanel` | 工作台以浏览器侧边栏形式呈现，方便作者一边查阅资料一边写作。 | Renders the workbench in the browser side panel so the author can write alongside other references. |
| `downloads` | 导出功能：把单本书导出为 .txt、把全部数据导出为 JSON 备份，需要触发浏览器下载。 | Used by the export feature: exporting a book as .txt and exporting a full JSON backup both require triggering a browser download. |
| `clipboardWrite` | 「复制」按钮：把 AI 生成的结果、执行日志复制到剪贴板，便于粘贴到作者自己的编辑器中。 | Used by the Copy buttons: copying AI output and the agent run log to the clipboard so the author can paste it into their own editor. |

### 主机权限（host_permissions）

| 主机 | 中文说明 | English |
|---|---|---|
| `https://api.openai.com/*` | 仅在用户主动点击「生成」时，把提示词发送到用户自己配置的 OpenAI 端点。 | Sends the prompt to the user-configured OpenAI endpoint, only when the user clicks Generate. |
| `https://api.deepseek.com/*` | 同上，用于 DeepSeek。 | Same as above, for DeepSeek. |
| `https://dashscope.aliyuncs.com/*` | 同上，用于通义千问。 | Same as above, for Qwen (DashScope). |
| `https://open.bigmodel.cn/*` | 同上，用于智谱 GLM。 | Same as above, for Zhipu GLM. |
| `https://api.moonshot.cn/*` | 同上，用于 Kimi。 | Same as above, for Kimi. |
| `https://api.siliconflow.cn/*` | 同上，用于硅基流动。 | Same as above, for SiliconFlow. |
| `http://localhost/*`、`http://127.0.0.1/*` | 连接用户**本机**运行的大模型服务（如 Ollama），或本机网页版服务；均为回环地址，不出本机。 | Connects to a model server running **on the user's own machine** (e.g. Ollama) or the local web build. Loopback only; nothing leaves the machine. |

### 可选主机权限（optional_host_permissions）

| 主机 | 说明 |
|---|---|
| `https://*/*` | 用户可自行填写任意 OpenAI 兼容的自建/第三方端点。此权限**仅在用户主动添加自定义端点时**才会请求，不在安装时索取。 |

```
Allows the user to configure any OpenAI-compatible custom endpoint they prefer.
This permission is requested only at the moment the user adds a custom endpoint,
never at install time.
```

---

## 3. 数据使用声明（Privacy practices 表单怎么选）

| 表单问题 | 建议填写 | 理由 |
|---|---|---|
| 是否收集用户数据？ | **是**（如实勾选，见下） | 扩展会在用户主动触发时把**用户自己提供的文本**发送给第三方模型服务商 |
| 收集哪些类型？ | **User activity / 用户生成的内容** 中的「其他」（写作内容） | 即提示词与命中的风格片段 |
| 用途 | **App functionality / 功能实现** | 唯一用途就是完成用户请求的写作功能 |
| 是否用于广告？ | 否 | — |
| 是否出售给第三方？ | 否 | — |
| 是否用于信用/借贷？ | 否 | — |
| 数据传输是否加密？ | 是（HTTPS） | — |

> ⚠️ **不要勾"不收集"**。虽然开发者看不到任何数据，但扩展确实会把用户内容发往第三方服务商。
> Chrome 审核会因为"声明与行为不符"直接驳回——如实声明反而更容易过。

---

## 4. 审核员可能会追问的点（提前准备说辞）

| 审核问题 | 回答要点 |
|---|---|
| 为什么要 `unlimitedStorage`？ | 长篇小说正文 + 本地 BM25 索引体积大；数据仍全部在本机 |
| 为什么需要那么多主机权限？ | 用户可自选模型厂商；这些是内置预设的直连地址，仅在用户点击生成时使用 |
| 为什么会把数据发给第三方？ | 这是**用户自己配置的**大模型服务，属于核心功能；不是开发者服务器 |
| 有没有收集分析数据？ | 没有。无 Analytics、无遥测、无崩溃上报 |
| 有没有远程代码？ | 没有。全部代码打包在扩展内 |
| API Key 怎么存的？ | 明文存在浏览器本地存储，由浏览器同源隔离保护；不上传开发者服务器 |