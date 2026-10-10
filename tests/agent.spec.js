/**
 * Writer Studio · Agent 全流程 E2E
 *
 * 用 page.route() 拦截 /ai/chat，返回伪造的模型响应 ——
 * 因此**不需要任何真实 API Key** 就能验证 Agent 的完整链路。
 */
import { test, expect } from '@playwright/test';

/* ---------------- 伪造的模型响应 ---------------- */

const PLAN = '```json\n{"think":"先取大纲与角色，再写一段","need":[{"tool":"get_book_meta","args":{}},{"tool":"get_outline","args":{}},{"tool":"get_chapter_tail","args":{}}]}\n```';
const CRITIC = '{"score":6,"issues":["对白偏少，节奏略平"],"verdict":"需修改"}';
const SEGMENT = '雨还在下。他把伞收起来，靠在门边，没有进去。';
const FIXED = '雨还在下。他把伞收起来，靠在门边，没有进去。\n\n“进来吧。”里面的人说。\n\n他没动。“先说清楚。”\n\n门开了。';
const FIXED_AGAIN = FIXED + '\n\n（这是第二次按审稿意见重写的结果）';

/** 拦截 AI 接口；返回 { calls, prompts, reviseCount } */
async function mockAI(page) {
  const calls = [];
  const prompts = [];
  const state = { reviseCount: 0 };

  await page.route('**/ai/chat', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const messages = body.messages || [];
    const text = JSON.stringify(messages);
    const last = (messages[messages.length - 1] || {}).content || '';

    prompts.push(text);
    let content;
    if (last.includes('"need"')) content = PLAN;
    else if (last.includes('请严格审稿')) content = CRITIC;
    else if (last.includes('只输出修订后的完整正文')) {
      state.reviseCount += 1;
      content = state.reviseCount === 1 ? FIXED : FIXED_AGAIN;
    } else if (last.includes('请续写第')) content = SEGMENT;
    else content = '（mock：未识别的请求）';

    calls.push(content.slice(0, 20));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }),
    });
  });

  return { calls, prompts, state };
}

/** 配好假 Key（Agent 会检查 apiKey 非空） */
async function configureFakeModel(page) {
  await page.locator('#btnSettings').click();
  await expect(page.locator('#settingsDialog')).toBeVisible();
  await page.locator('#baseUrl').fill('http://127.0.0.1:5188/v1');
  await page.locator('#apiKey').fill('sk-test-not-a-real-key');
  await page.locator('#model').fill('mock-model');
  await page.locator('#saveSettings').click();
  await expect(page.locator('#settingsDialog')).toBeHidden();
}

const IGNORABLE = /favicon|DevTools|Autofill|Download the React/i;

async function openApp(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('/');
  await expect(page.locator('#bootBar')).toBeHidden({ timeout: 20_000 });
  return errors;
}

/** 打开 Agent 并把参数收紧（更快、更确定） */
async function openAgent(page, words = '500') {
  await page.locator('#openAgent').click();
  await expect(page.locator('#agentDialog')).toBeVisible();
  await page.locator('#agentParamsBtn').click();
  await expect(page.locator('#agentParamsDialog')).toBeVisible();
  await page.locator('#agentWords').fill(words);
  await page.locator('#agentSteps').fill('8');
  await page.locator('#agentRevise').fill('1');
  await page.locator('#agentParamsOk').click();
  await expect(page.locator('#agentParamsDialog')).toBeHidden();
}

test.describe('Agent 全流程（mock 模型）', () => {

  test('1. 能跑完 Plan → 工具 → Draft → Critic → Revise，并产出草稿', async ({ page }) => {
    const errors = await openApp(page);
    const { calls } = await mockAI(page);
    await configureFakeModel(page);

    await page.locator('#navWriter').click();
    await page.locator('#content').fill('雾从海上来的时候，是凌晨三点四十。');
    await openAgent(page);

    await page.locator('#agentGoal').fill('帮我把这一章写完');
    await page.locator('#agentRun').click();

    const log = page.locator('#agentLog');
    await expect(log).toContainText('分析目标、制定计划', { timeout: 30_000 });
    await expect(log).toContainText('调用工具 get_book_meta');
    await expect(log).toContainText('调用工具 get_outline');
    await expect(log).toContainText('写第 1/1 段');
    await expect(log).toContainText('自检得分 6/10');
    await expect(log).toContainText('修订完成');
    await expect(log).toContainText('未写入正文', { timeout: 30_000 });

    const draft = await page.locator('#agentDraft').inputValue();
    expect(draft).toContain('门开了');
    expect(draft).not.toContain('score');       // 审稿 JSON 不能污染草稿

    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });

  test('2. 人在环：未点采纳前，正文不得被改动', async ({ page }) => {
    const errors = await openApp(page);
    await mockAI(page);
    await configureFakeModel(page);

    await page.locator('#navWriter').click();
    await page.locator('#content').fill('原有正文。');
    await openAgent(page);

    await page.locator('#agentRun').click();
    await expect(page.locator('#agentLog')).toContainText('未写入正文', { timeout: 30_000 });

    expect(await page.locator('#content').inputValue()).toBe('原有正文。');

    await page.locator('#agentAdoptAppend').click();
    await expect(page.locator('#content')).toHaveValue(/原有正文。[\s\S]*门开了/);
    await expect(page.locator('#agentState')).toContainText('已追加');

    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });

  test('3. 提示词必须包含「对话归属」规范（防止分不清谁在说话）', async ({ page }) => {
    const errors = await openApp(page);
    const { prompts } = await mockAI(page);
    await configureFakeModel(page);

    await page.locator('#navWriter').click();
    await openAgent(page);
    await page.locator('#agentRun').click();
    await expect(page.locator('#agentLog')).toContainText('未写入正文', { timeout: 30_000 });

    const all = prompts.join('\n');
    // 规范必须随每一次生成/审稿一起发给模型
    expect(all).toContain('对话归属必须清晰');
    expect(all).toContain('禁止连续三段以上只用');
    // 审稿清单里也要检查对话归属
    expect(all).toContain('能否一眼看出每句台词是谁说的');

    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });

  test('4. 一键应用审稿意见：按 issues 重写草稿', async ({ page }) => {
    const errors = await openApp(page);
    await mockAI(page);
    await configureFakeModel(page);

    await page.locator('#navWriter').click();
    await openAgent(page);
    await page.locator('#agentRun').click();
    await expect(page.locator('#agentLog')).toContainText('未写入正文', { timeout: 30_000 });

    // 首次跑完，草稿来自第一次修订
    expect(await page.locator('#agentDraft').inputValue()).not.toContain('第二次');

    // 点「应用审稿意见」→ 走第二次修订
    await page.locator('#agentApplyCritic').click();

    await expect(page.locator('#agentDraft')).toHaveValue(/第二次按审稿意见重写/, { timeout: 20_000 });
    await expect(page.locator('#agentLog')).toContainText('已按 1 条审稿意见重写');
    await expect(page.locator('#agentState')).toContainText('已应用 1 条意见');

    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });

  test('5. 大纲梳理：读正文 → 梳理/问题/方向/建议大纲 → 写入卡片', async ({ page }) => {
    const errors = await openApp(page);

    // 针对大纲梳理的两阶段 mock：先分批提炼，再汇总输出
    const summaryReply = '{"events":["陈砚赴约发现钥匙"],"characters":["陈砚：赴约"],"foreshadows":["钥匙的来历"]}';
    const outlineReply = '{"summary":"第一幕：陈砚赴约，发现黄铜钥匙，牵出旧案。","keyPoints":[{"chapter":"第一章","point":"陈砚赴约并发现钥匙"}],"deviations":[{"issue":"钥匙的来历在正文中未交代","advice":"修改剧情"}],"directions":[{"title":"顺藤摸瓜","desc":"循钥匙追查旧案"},{"title":"反向陷阱","desc":"发现约他的人是饵"}],"outline":[{"title":"第一幕 · 线索","body":"1. 赴约\\n2. 发现钥匙"},{"title":"第二幕 · 真相","body":"1. 追查白鹭\\n2. 父亲旧案翻案"}]}';

    await page.route('**/ai/chat', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const msgs = body.messages || [];
      const last = (msgs[msgs.length - 1] || {}).content || '';
      const content = last.includes('提炼剧情要素') ? summaryReply : outlineReply;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) });
    });

    await configureFakeModel(page);

    // 准备正文（大纲梳理需要有内容）
    await page.locator('#navWriter').click();
    await page.locator('#content').fill('雾从海上来。陈砚站在第七根灯柱下，手里捏着半张船票。');
    await page.locator('#content').dispatchEvent('input');

    // 打开大纲梳理
    await page.locator('#openOutlineAgent').click();
    await expect(page.locator('#outlineDialog')).toBeVisible();
    await page.locator('#outlineRun').click();

    // 结果区应出现四大块
    const result = page.locator('#outlineResult');
    await expect(result).toContainText('现有剧情梳理', { timeout: 30_000 });
    await expect(result).toContainText('与大纲不符');
    await expect(result).toContainText('关键点记忆');
    await expect(result).toContainText('拓展方向');
    await expect(result).toContainText('建议大纲');
    await expect(result).toContainText('顺藤摸瓜');
    await expect(page.locator('#outlineState')).toContainText('完成');

    // 写入大纲卡片
    page.once('dialog', (d) => d.accept());
    await page.locator('#outlineSaveCards').click();
    await expect(page.locator('#outlineState')).toContainText('已写入 2 张');

    // 左侧设定里应出现这两张卡片
    await page.locator('#outlineDialog button:has-text("关闭")').click();
    await expect(page.locator('#cardList')).toContainText('第一幕 · 线索');

    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });

  test('6. 大纲梳理：增量进度可记录、无新章节时提示、可重置', async ({ page }) => {
    const errors = await openApp(page);

    await page.route('**/ai/chat', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const msgs = body.messages || [];
      const last = (msgs[msgs.length - 1] || {}).content || '';
      const content = last.includes('提炼剧情要素')
        ? '{"events":["陈砚赴约"],"characters":[],"foreshadows":[]}'
        : '{"summary":"s","keyPoints":[],"deviations":[],"directions":[{"title":"A","desc":"d"}],"outline":[{"title":"T","body":"b"}]}';
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) });
    });

    await configureFakeModel(page);
    await page.locator('#navWriter').click();
    await page.locator('#content').fill('第一章的正文内容，写点什么。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#openOutlineAgent').click();
    await expect(page.locator('#outlineCursor')).toContainText('尚未梳理过');

    // 第一次梳理（默认增量，无进度 → 全部）
    await page.locator('#outlineRun').click();
    await expect(page.locator('#outlineState')).toContainText('完成', { timeout: 30_000 });
    await expect(page.locator('#outlineCursor')).toContainText('上次梳理到');

    // 再点一次：没有新章节，应弹提示
    const msg = await new Promise((resolve) => {
      page.once('dialog', (d) => { resolve(d.message()); d.accept(); });
      page.locator('#outlineRun').click();
    });
    expect(msg).toContain('没有新章节');

    // 重置进度
    page.once('dialog', (d) => d.accept());
    await page.locator('#outlineResetCursor').click();
    await expect(page.locator('#outlineCursor')).toContainText('尚未梳理过');

    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });

  test('7. 跑完 Agent 后关闭再打开：执行过程 / 草稿 / 状态都应清空', async ({ page }) => {
    const errors = await openApp(page);
    await mockAI(page);
    await configureFakeModel(page);

    await page.locator('#navWriter').click();
    await page.locator('#content').fill('雾从海上来的时候，是凌晨三点四十。');
    await openAgent(page);
    await page.locator('#agentRun').click();
    await expect(page.locator('#agentState')).toContainText('完成', { timeout: 30_000 });

    // 跑完确实有内容
    expect(await page.locator('#agentLog .agent-step').count()).toBeGreaterThan(0);
    await expect(page.locator('#agentDraft')).not.toHaveValue('');

    // 关闭再打开 → 干净
    await page.locator('#agentClose').click();
    await expect(page.locator('#agentDialog')).toBeHidden();
    await page.locator('#openAgent').click();
    await expect(page.locator('#agentDialog')).toBeVisible();
    await expect(page.locator('#agentLog .agent-step')).toHaveCount(0);
    await expect(page.locator('#agentDraft')).toHaveValue('');
    await expect(page.locator('#agentState')).toHaveText('');
    await expect(page.locator('#agentGoal')).toHaveValue('帮我把这一章写完');
    await page.locator('#agentClose').click();

    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });

  test('8. AI「插入到光标」：有选区时应替换选区，不该把原文再留一份', async ({ page }) => {
    const errors = await openApp(page);
    await page.route('**/ai/chat', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '润色后的这一段。' } }] }),
    }));
    await configureFakeModel(page);

    await page.locator('#navWriter').click();
    await page.locator('#content').fill('原始的一段文字，需要被润色。');
    await page.locator('#content').dispatchEvent('input');

    // 选中整段，润色后点「插入到光标」
    await page.locator('#content').evaluate((el) => el.setSelectionRange(0, el.value.length));
    await page.locator('#aiActions button[data-action=polish]').click();
    await page.locator('#aiRun').click();
    await expect(page.locator('#aiOut')).toContainText('润色后的这一段。');
    await page.locator('#aiAppend').click();

    // 结果必须只有润色后的那一段，不能再把原文带出来
    await expect(page.locator('#content')).toHaveValue('润色后的这一段。');

    expect(errors.filter((e) => !IGNORABLE.test(e))).toEqual([]);
  });
});

