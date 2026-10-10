# Privacy Policy · Writer Studio

**Last updated: 2026-10-09** ｜ Applies to: v0.1.0 and later

---

## The short version

**The developer collects none of your data.** Your manuscripts, notes, corpus and API key live in your own browser. The only time anything leaves your device is when **you** click Generate — and then it goes to the model provider **you** configured.

---

## 1. Who provides this extension

Writer Studio is an independently developed open-source project released under the MIT licence, with its source publicly available on GitHub. It is **not** a product of, and has **no affiliation with**, any company or third-party platform.

---

## 2. What we do NOT collect

None of the following exists:

- ❌ No account, no sign-in
- ❌ No analytics (no Google Analytics, no Sentry, no instrumentation of any kind)
- ❌ No telemetry, no crash reporting
- ❌ No advertising, no trackers, no third-party cookies
- ❌ We do not read or modify the web pages you visit (**this extension has no content scripts**)
- ❌ Nothing is sent to the developer's servers (this project **has no servers**)
- ❌ We never sell, share or transfer your data to third parties
- ❌ Your data is never used for advertising, creditworthiness or anything unrelated to writing

---

## 3. Data stored on your own device

The following is kept in your browser's local storage (IndexedDB, falling back to localStorage) and **never leaves your device**:

| Data | Notes |
|---|---|
| Books and chapter text | everything you write |
| Cards | outline / role / setting / foreshadow, including the foreshadow passages |
| Snapshots | versions you save manually |
| Corpus and search index | text you harvested plus the local BM25 index |
| Settings | model name, base URL, temperature, typography, theme |
| **API key** | the model key you entered |
| AI call log | action, model name, character count, timestamp (so you can disclose AI usage where required) |

**How to delete**: use the in-app delete buttons, "clear corpus", your browser's "clear site data", or uninstall the extension. Deletion is **irreversible** — please export a backup first.

---

## 4. What leaves your device

**In exactly one situation: when you click Generate / Start.**

The extension then sends the following over HTTPS **directly to the model provider you configured in Settings**:

- your prompt (e.g. the selected passage, a continue-writing instruction, the tail of the chapter)
- when RAG injection is on, the matched "style profile + most similar past passages"
- the API key you configured (as an auth header, for that provider to authenticate you)

**The developer cannot see any of this.** Requests go from your browser straight to that provider; they pass through no server operated by this project.

> In the web build (`serve.py`), requests first pass through a proxy running on **your own machine** at `127.0.0.1` before being forwarded. That proxy binds to the loopback address only, and its source ships with this project so you can review it.

**Third-party providers**: the model vendor you choose (for example DeepSeek, OpenAI, Alibaba Cloud, Zhipu, Moonshot, SiliconFlow, or your own OpenAI-compatible endpoint) will handle those requests under **its own** privacy policy. Please read the terms of the service you use. If you use a local Ollama instance, nothing leaves your machine at all.

> ⚠️ **No click, no request**: if you never use the AI features, this extension makes no network requests.

---

## 5. Permissions and why they exist

Every permission this extension requests exists purely to deliver the features described above; each one is justified in
[Permission justifications](permission-justifications.md). The guiding principle is **least privilege**, and there is no permission that would let us read page content.

---

## 6. Limited Use disclosure (Chrome Web Store)

Our use of your data is limited to providing the extension's **single, publicly stated purpose**: a local-first writing workbench for fiction. We do not:

- transfer your data to third parties **except** as necessary to provide that purpose (i.e. the model call *you* initiate against a provider *you* configured);
- use your data for personalised advertising;
- use your data for creditworthiness or lending purposes;
- sell your data.

---

## 7. Security

- The project **has no servers**, so there is no server-side breach surface.
- Your API key is stored in plain text in your browser's local storage, protected by the browser's **origin isolation**. Do not store keys on shared devices; if you suspect a leak, revoke and regenerate the key with your provider.
- Traffic to model providers uses HTTPS.

---

## 8. Children's privacy

This extension is not directed at children under 13 (or the age defined in your jurisdiction) and does not knowingly collect information from them.

---

## 9. Changes to this policy

This policy may be updated between versions. **The version in this repository is authoritative**; material changes will be noted in the release notes.

---

## 10. Contact

For privacy questions, please open an issue in the project repository:

`https://github.com/sodu-CCC/writer-studio/issues`

---

> ⚖️ This privacy policy is a **statement of fact**, not legal advice. If your jurisdiction imposes additional requirements (GDPR, PIPL, etc.), evaluate them yourself.