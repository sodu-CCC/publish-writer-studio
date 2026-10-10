# Writer Studio — Product Guide (English)

> A local-first AI workbench for serial fiction. It builds a retrieval-augmented (RAG) profile from **your own writing**, so the model's output sounds like **you**.
>
> Version: v0.1.0 ｜ Delivery: Chrome extension (Manifest V3) / local web app ｜ Requires: Chrome 114+ / Edge 114+

---

## Table of contents

1. [What this is](#1-what-this-is)
2. [Install & launch](#2-install--launch)
3. [Interface overview](#3-interface-overview)
4. [Feature reference](#4-feature-reference)
5. [Task-based how-tos](#5-task-based-how-tos)
6. [Storage & privacy](#6-storage--privacy)
7. [Keyboard shortcuts](#7-keyboard-shortcuts)
8. [FAQ](#8-faq)
9. [Disclaimer](#9-disclaimer)

---

## 1. What this is

A writing workbench that runs **entirely on your machine**. It is three things at once:

| Role | What it does |
|---|---|
| **Writing tool** | Library / chapter management / typography / foreshadowing marks / snapshots — replaces "a text editor plus a folder of files" |
| **Style engine** | Harvest your own drafts → compute a stylometric profile → inject it at generation time so the AI writes in your voice |
| **AI workbench** | Bring your own key, connect any OpenAI-compatible model; Agent mode plans, gathers, drafts, self-critiques and revises |

**For**: serial-fiction authors, teams that need one consistent voice, anyone who wants AI as a **co-pilot** rather than a ghostwriter.

**Not for**: people who want "one click, a whole novel". This is an **aid**, not an autopilot.

---

## 2. Install & launch

### Option A — Browser extension (recommended, no server)

1. Open `chrome://extensions/` (Edge: `edge://extensions/`)
2. Turn on **Developer mode**
3. Click **Load unpacked** and pick the project root (the folder containing `manifest.json`)
4. Click the **Writer Studio** toolbar icon → **open the full workbench**

> A Side Panel entry point is available too — handy when you want to write while browsing.

### Option B — Local web app

```bat
double-click start-server.bat
```

Or manually:

```bash
python serve.py            # starts at 5173; auto-increments if the port is taken
```

The console prints the actual URL (e.g. `http://127.0.0.1:5173/`). Open it in your browser.

> The web build ships a `/ai/chat` reverse proxy so the browser can reach model APIs without CORS problems.

**The two builds have separate data** (browsers isolate storage by origin) — see [section 6](#6-storage--privacy).

---

## 3. Interface overview

### Top bar

```
[Writer Studio]  Library   Workbench   Corpus  ────────  Ready  [Import] [Settings]
                    ↑ current page: the rounded box disappears, the label turns accent-coloured and slightly larger
```

- **Library / Workbench / Corpus** — the three main views; the logo also returns you to the Library
- **Import** — turn a whole manuscript into a **new book**
- **Settings** — model, theme, typography, backup

### Library

- Vertical book cards: cover, title, summary (auto-truncated)
- A **search box** at the top: filters by title / author / summary as you type, with a `hits / total` counter
- Click a book → **book overlay** (background dims) listing its chapters
- Click a chapter → the **preview editor** opens on the right (two-thirds width) and is directly editable

### Workbench (three columns)

```
┌────────────┬──────────────────────────────┬───────────┐
│ Books /    │ Format bar · Title · Body     │ AI assist │
│ Chapters   │ Status bar (words / goal)     │ Agent     │
│ Cards      │                               │           │
└────────────┴──────────────────────────────┴───────────┘
```

- Left: book switcher, chapter list (with a ● foreshadow badge), cards for Outline / Role / Setting / Foreshadow
- Middle: format bar (font, size, line-height, indent, headings) + the body editor
- Right: AI actions, Agent mode, corpus retrieval info

### Corpus

Corpus list and harvesting on the left, style profile and a retrieval self-test on the right.

---

## 4. Feature reference

### 4.1 Library & book management

- Create / rename / delete books; optional cover, author, summary
- Search across title / author / summary — case-insensitive, live filtering
- Chapter list inside the book overlay jumps straight into the preview editor

### 4.2 Chapters & writing

- Add/remove chapters, autosave (~0.7 s after you stop typing), status bar shows "Saved hh:mm:ss"
- Live word count, daily goal progress, 7-day trend, per-book word ranking
- **Snapshot history** — save a version manually, roll back any time

### 4.3 Typography

| Item | Options |
|---|---|
| Font | Song / Hei / Kai / FangSong / System |
| Size | 12–28 |
| Line height | 1.4 / 1.6 / 1.8 / 2.0 / 2.4 |
| **Paragraph indent** | 0–8 characters (written as real full-width spaces, so exports match) |
| Headings | Select a line and click Chapter / Sub-heading / Body to add or remove `#` |
| One-click tidy | Re-normalise indentation across the chapter |

> Pressing Enter starts a new paragraph and **auto-inserts the indent**. Blank lines are skipped so you don't get lines full of spaces.

### 4.4 Find & replace

Click **Find** at the right end of the workbench format bar (or press `Ctrl+F` / `Ctrl+H`):

- **Scope**: current chapter / **whole book**
- Previous / next, replace, **replace all**
- Optional case sensitivity
- Renaming a character across a whole book is a single pass

Press `Esc` or click the button again to collapse.

### 4.5 Cards

Four tabs: **Outline / Role / Setting / Foreshadow**. Each card has a title and a body; hovering a card shows a preview popover.

**Foreshadow** cards have two extra fields:

- **Foreshadow passage** — paste a passage from the body; this decides where the dashed underline is drawn
- **Chapter** — optional; only used to put a ● badge next to a chapter in the list

### 4.6 Foreshadow marking

- Body paragraphs matching the **foreshadow passage** get a **dashed underline hugging the text** (it never covers the two-space first-line indent)
- **Click** such a paragraph → a popover shows a truncated passage plus your foreshadow note
- One card can mark **several passages**: separate them with **newlines or semicolons** (commas are treated as ordinary punctuation)
- Each card can be individually **enabled / cancelled** — temporarily inert without losing the text

### 4.7 Corpus & style profile (RAG)

1. **Harvest** — from the current book, by pasting text, or by importing a `.txt`
2. **Profile** — average sentence length, short-sentence ratio, paragraph length, dialogue ratio, punctuation habits, person/pronoun distribution, frequent phrases
3. **Retrieval** — Chinese bigram tokenisation + a **BM25** inverted index, entirely local
4. **Injection** — generation automatically carries the profile plus Top-K similar passages

> The profile is only as good as what you feed it. To sound like you, feed it **your own real drafts**.

### 4.8 AI assist

**Configure**: Settings → pick a preset or fill in `Base URL` / `API Key` / `Model` → click **Test connection**.

Presets: DeepSeek / OpenAI / Qwen (DashScope) / Zhipu GLM / Kimi / SiliconFlow / local Ollama — or any OpenAI-compatible endpoint.

**Seven actions**: Continue / Polish / Expand / Condense / Chapter outline / Naming / Character card

**Handling the result**:

| Button | Behaviour |
|---|---|
| Insert at cursor | Replaces the selection if there is one, otherwise inserts |
| Replace selection | Replaces the selected text with the result |
| Copy | Copies to the clipboard only |

> Every result must be **accepted by you**. Nothing is written into your manuscript automatically — and nothing is ever published.

### 4.9 Agent mode (human-in-the-loop)

Give it one goal (default: "finish this chapter") and it works autonomously:

```
Plan   (decides which references it needs)
  -> Gather   (calls local tools)
  -> Draft    (writes in segments)
  -> Critic   (scores itself and lists problems)
  -> Revise   (rewrites only if needed)
  -> Draft for your review
```

Eight tools are exposed to the model: book meta / outline / role cards / setting cards / chapter list / current chapter tail / style profile / corpus retrieval.

Three guardrails: **max steps**, **revision round cap**, **stop at any time**.

### 4.10 Agent outline review

Reads what you've written → extracts only **major plot beats** → compares with your existing outline → flags deviations → proposes directions and a suggested outline.

- **Incremental**: by default only chapters written since the last run; progress is remembered and can be reset
- **Scope**: new only / all / last N chapters
- **Deviations**: choose "adjust the outline to match the story" or "suggest plot fixes"
- The suggested outline can be written into outline cards with one click

---

## 5. Task-based how-tos

### 5.1 Five-minute start

1. Library → **+ New book**, give it a title
2. Workbench → left panel "Cards": create at least one **Outline** card and one **Role** card (the Agent uses them)
3. Start writing in the body area
4. After a few thousand words → Corpus → **Harvest this book** → check the profile
5. Configure a model in Settings → pick "Continue" in the right column → if you like it, **Insert at cursor**

### 5.2 Daily writing

- Open the Workbench → click a chapter on the left and keep writing (autosave)
- Check the status bar at the bottom for words / today / goal
- `Snapshot` at the end of a session to keep a version
- Renaming a character or a term: **Find** → scope **whole book** → Replace all

### 5.3 Making the AI sound like you

1. Corpus → **Harvest this book** (or paste / import earlier work)
2. Check the profile: average sentence length, dialogue ratio, frequent phrases — does it match your instincts?
3. The profile and similar passages are **injected automatically** at generation time — nothing extra to do
4. Not close enough? Add more corpus. The more of you it reads, the more it sounds like you

### 5.4 Writing a whole chapter with the Agent

1. Prepare outline / role cards, and write a paragraph or two to set the tone
2. Right column → **Agent mode** → enter a goal (e.g. "continue to ~2000 words, end on a hook")
3. Click **Parameters**: target words / max steps / revision rounds
4. Click **Start** and watch the run log scroll
5. When it finishes, **read and edit** the draft on the right → `Append to chapter` or `Replace chapter`
6. If the Critic raised issues, click `Apply review notes` to rewrite accordingly

> The Agent only produces **a draft**. Until you accept it, not a single character of your manuscript changes.

### 5.5 Reviewing your outline

1. Workbench → Agent outline review
2. Pick a scope: new chapters only (default) / all / last N
3. Click **Start**
4. Read the sections: deviations → advice → key-beat memory → directions → suggested outline
5. On deviations, choose "adjust outline" or "suggest plot fixes"
6. Happy with it? `Write suggested outline into cards`

### 5.6 Planting and paying off foreshadowing

1. In the body, **select** the passage you want to mark
2. Left panel → **Foreshadow** tab → **+** — the passage field is prefilled from your selection
3. Fill in the note (how you'll plant it, when you'll pay it off)
4. Save → the paragraph gets a dashed underline, and **clicking it** shows your note
5. To mute it temporarily: click **Cancel current selection** (the text is kept)
6. To remove it for good: `Clear` the passage field → Save

### 5.7 Importing an existing manuscript

1. Top bar → **Import** → choose a `.txt` / `.md`, or paste directly
2. Fill in the **book title** (auto-filled from the filename)
3. Click **Import as new book** — headings like "Chapter 3" are split into chapters automatically
4. The app switches to the new book and returns you to the Library

### 5.8 Backup & migration

- **Settings → Export all data** → a JSON file (books, chapters, cards, snapshots, settings, corpus index)
- **Settings → Import backup** → restores over the top
- To move between the extension and web builds: export on one side, import on the other

---

## 6. Storage & privacy

**No backend, no account, no telemetry.** Manuscripts and API keys live only in your browser.

| Item | Detail |
|---|---|
| Primary store | **IndexedDB** (database `writer_studio`); falls back to `localStorage` automatically if unavailable |
| Object stores | `books` / `chapters` / `cards` / `snapshots` / `kv` (settings & stats) / `corpus` / `chunks` |
| API key | Stored locally, **never uploaded anywhere** (it is only sent to your chosen provider as an auth header when you make a request) |
| Web-build AI requests | Relay through the local `serve.py` `/ai/chat` endpoint (bound to 127.0.0.1 only) |

### Three traps worth knowing

1. **The web build and the extension do not share data** — browsers isolate storage per origin (`http://127.0.0.1:PORT` vs `chrome-extension://ID`).
2. **Changing the web port makes your data "disappear"** — `:5173` and `:5174` are different origins. **Stick to one port**, or use the extension.
3. **Clearing browser data really deletes it** — clearing site data or using private mode loses everything. **Export regularly.**

---

## 7. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + F` / `Ctrl + H` | Open find & replace (switches to the Workbench) |
| `Enter` (in the find box) | Next match |
| `Shift + Enter` (in the find box) | Previous match |
| `Esc` | Close the find bar / clear the library search |
| `Enter` (in the body) | New paragraph with auto-indent |

---

## 8. FAQ

**Is my API key safe?**
It is stored only in your browser and never uploaded by us. Note that it *is* sent as an auth header to the model provider **you configured** — its safety, pricing and data handling are governed by that provider.

**Can I use it without a model?**
Yes. Library, chapters, typography, foreshadowing, snapshots and the corpus profile all work offline; only AI / Agent features need a key.

**Will the AI write into my manuscript by itself?**
No. Every AI and Agent output stays in a draft area and must be **accepted by you**.

**The foreshadow underline isn't showing.**
Check three things: (1) is the **foreshadow passage** filled in (only this field is used — the chapter field is not); (2) does the text match the body exactly (leading/trailing whitespace is ignored); (3) is the "enable this mark" checkbox ticked.

**Chapter splitting looks wrong after import.**
Splitting looks for "Chapter N" style headings. If none are found, the whole file becomes a single chapter — split it manually in the chapter list.

**A model call fails.**
Use **Test connection** in Settings first; then verify the model name, the base URL (most need a `/v1` suffix), your balance and your network.

---

## 9. Disclaimer

**Please read this section in full before use. By using this software you acknowledge and accept all of the terms below.**

1. **Provided "AS IS".** This is open-source software provided "as is", without warranty of any kind, express or implied, including but not limited to warranties of **merchantability, fitness for a particular purpose, uninterrupted or error-free operation, or freedom from data loss**. The authors accept no liability for any direct, indirect, incidental, special or consequential damages arising from the use of, or inability to use, this software.

2. **Local storage — data loss is your risk.** All data lives in your own browser. Clearing browser data, switching devices, changing ports or origins, or a browser failure may cause **unrecoverable loss**. **Back up regularly using "Export all data."** The authors are not responsible for data loss.

3. **You are responsible for AI output.** This software only provides an interface to models; it **does not provide model services** and makes no guarantee about the **accuracy, originality, legality or fitness** of any generated content. AI can produce wrong, outdated, biased or inadvertently similar-to-others content — **always verify before publishing**.

4. **Comply with platform rules and the law.** If you use generated content for contracts, submissions or public release, you are responsible for complying with your platform's rules and with applicable regulations on **disclosing AI-generated content**. This software deliberately **does not** provide any feature to remove AI traces or to conceal, evade or misrepresent generated content. Do not use it to create or distribute unlawful material, or to infringe copyright, reputation or other rights.

5. **Third-party model services.** The model you connect is provided by a **third party**; its availability, pricing, billing, data handling and privacy policy are governed by that provider. Costs, downtime, account suspension or data issues arising from third-party services are not the responsibility of this project.

6. **Keys and accounts are your responsibility.** Keep your API key secure; do not share it or use it on shared devices. Consequences of a leaked or misused key rest with the user.

7. **Copyright stays with you.** This software is only a writing tool. **You own what you write** (or as agreed with your platform/employer); the project claims no rights over your manuscripts and does not upload them.

8. **No affiliation.** This is an independently developed open-source project. It has **no affiliation, partnership or endorsement** relationship with any third-party platform, model vendor or software product mentioned here. All names and trademarks belong to their respective owners.

9. **Changes.** This disclaimer may be updated between versions; the version in the repository is authoritative.

---

© 2026 Writer Studio · [MIT License](../LICENSE)