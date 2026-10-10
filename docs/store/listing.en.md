# Store Listing (English) · Writer Studio

> Copy straight into the Chrome Web Store / Edge Add-ons forms.
> Limits: short description **132** characters, detailed description **16000**.

---

## Basics

| Field | Value |
|---|---|
| Name | `Writer Studio` |
| Category | Productivity |
| Language | English |
| Homepage | `https://github.com/sodu-CCC/writer-studio` |
| Support email | `zhangxing0323@gmail.com` |
| Privacy policy URL | `https://github.com/sodu-CCC/writer-studio/blob/main/docs/store/privacy-policy.en.md` (or a GitHub Pages URL — see the store checklist) |

---

## Short description (≤132 characters)

```
Local-first fiction writing workbench: library, chapters, typography, foreshadowing marks, on-device RAG style profile, AI Agent.
```

---

## Detailed description

```
Writer Studio is a writing workbench for serial fiction that runs entirely on your own machine. No account, no backend, no telemetry — your manuscripts and your API key stay in your browser.

It is three things at once: a writing tool, a style engine, and an AI workbench.

━━━━━━━━━━━━━━━━━━━━
WRITING WORKBENCH
━━━━━━━━━━━━━━━━━━━━
· Library: vertical book list (cover / title / summary) with live search across title, author and summary
· Chapters: add and remove, autosave, live word count, daily goal, 7-day trend, per-book ranking
· Snapshots: save a version by hand and roll back any time
· Cards: Outline / Role / Setting / Foreshadow, with hover previews
· Typography: font, size, line height, paragraph indent (0–8 characters), heading markers, one-click re-indent
· Themes: default / eye-care green / eye-care blue / dark, plus a custom accent colour
· Import & export: import .txt / .md straight into a new book (chapters split automatically); export a single book as .txt or back up everything as JSON

FIND & REPLACE
One button in the workbench toolbar. Search and replace across the current chapter or the whole book — renaming a character across hundreds of pages is a single pass.

FORESHADOWING MARKS
Select a passage, write down your foreshadowing note, and that paragraph gets a dashed underline hugging the text. Click the paragraph later to recall why you planted it. One card can mark several passages, and each card can be enabled or muted individually.

━━━━━━━━━━━━━━━━━━━━
RAG STYLE MATCHING · THE CORE
━━━━━━━━━━━━━━━━━━━━
· Harvest your own drafts as the corpus
· A stylometric profile is computed locally: average sentence length, short-sentence ratio, paragraph length, dialogue ratio, punctuation habits, pronoun distribution, recurring phrases
· Chinese bigram tokenisation plus a BM25 inverted index — retrieval happens entirely on your device, no corpus is ever uploaded
· At generation time the profile and the most similar past passages are injected automatically, so the model writes in your voice instead of a generic one

━━━━━━━━━━━━━━━━━━━━
AI ASSIST · BRING YOUR OWN KEY
━━━━━━━━━━━━━━━━━━━━
· DeepSeek / OpenAI / Qwen / Zhipu GLM / Kimi / SiliconFlow / local Ollama, or any OpenAI-compatible endpoint
· Seven actions: continue, polish, expand, condense, chapter outline, naming, character card
· Every result must be accepted by you — nothing is ever written into your manuscript automatically
· "Insert at cursor" replaces your selection when there is one, matching normal editor behaviour

AGENT MODE (HUMAN-IN-THE-LOOP)
Give it one goal and it decides which references to pull, writes in segments, critiques and scores itself, then revises:
  Plan → Gather → Draft → Critic → Revise → draft for your review
Eight local tools are exposed to the model (book meta, outline, role cards, setting cards, chapter list, chapter tail, style profile, corpus retrieval).
Three guardrails: max steps, revision-round cap, stop at any time.

AGENT OUTLINE REVIEW
Reads what you have written, extracts only major plot beats, compares them against your existing outline, flags deviations and proposes directions and a suggested outline. Supports incremental review (only chapters written since the last run by default), and each deviation can be handled by either "adjust the outline" or "suggest plot fixes".

━━━━━━━━━━━━━━━━━━━━
PRIVACY AND DESIGN BOUNDARIES
━━━━━━━━━━━━━━━━━━━━
· Local-only: manuscripts and keys live in your browser (IndexedDB); no backend, no telemetry
· Bring your own key: you obtain and configure the model; this extension does not provide model services
· No third-party site injection: no content scripts, it never reads the pages you visit
· Never publishes, never writes back on its own: AI output only lands in an editor box
· No "remove AI traces" feature: nothing that hides, evades or misrepresents generated content
· Local AI call log, so you can disclose AI usage where a platform requires it

⚠️ Note: prompt text (and matched style snippets) are sent to the model provider you configure only when you click Generate. No click, no network request.

An independently developed open-source project (MIT). Not affiliated with any third-party platform or model vendor.
```
