/**
 * Writer Studio · E2E 冒烟测试（网页版）
 *
 * 在真实浏览器中打开 http://127.0.0.1:<port>/ ，像真人一样操作，
 * 验证核心链路可用 —— 这是静态检查覆盖不到的部分。
 */
import { test, expect } from '@playwright/test';

// 这些噪声不算缺陷
const IGNORABLE = /favicon|DevTools|Autofill|Download the React/i;

/** 打开工作台并收集控制台/页面错误 */
async function openApp(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // 记录所有 4xx/5xx 响应，并带上 URL（便于定位）
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });

  await page.goto('/');
  await waitForBoot(page);
  return errors;
}

/** 等待应用启动完成；失败时把顶部提示带进报错 */
async function waitForBoot(page) {
  const bar = page.locator('#bootBar');
  try {
    await expect(bar).toBeHidden({ timeout: 20_000 });
  } catch {
    const txt = await bar.textContent().catch(() => '(读取失败)');
    throw new Error(`应用未能完成启动，顶部提示为：「${txt}」`);
  }
}

/** 断言无控制台错误 */
function expectNoErrors(errors) {
  const fatal = errors.filter((e) => !IGNORABLE.test(e));
  expect(fatal, '不应出现控制台/页面错误').toEqual([]);
}

test.describe('Writer Studio 冒烟测试', () => {

  test('1. 工作台能打开，书库页渲染且无启动错误', async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator('#viewLibrary')).toBeVisible();
    await expect(page.locator('#brandHome')).toContainText('码字工坊');
    await expect(page.locator('#catalog')).toBeVisible();
    expectNoErrors(errors);
  });

  test('2. 新建作品后目录出现卡片', async ({ page }) => {
    const errors = await openApp(page);

    const before = await page.locator('#catalog .book-row').count();

    await page.locator('#libNewBook').click();
    await expect(page.locator('#bookDialog')).toBeVisible();      // 作品信息弹窗

    await page.locator('#bookDialog button[value="close"]').click();
    await expect(page.locator('#bookDialog')).toBeHidden();

    await expect(page.locator('#catalog .book-row')).toHaveCount(before + 1);
    expectNoErrors(errors);
  });

  test('3. 三视图切换正常（含点 logo 回主界面）', async ({ page }) => {
    const errors = await openApp(page);

    await page.locator('#navWriter').click();
    await expect(page.locator('#viewWriter')).toBeVisible();
    await expect(page.locator('#viewLibrary')).toBeHidden();

    await page.locator('#navCorpus').click();
    await expect(page.locator('#viewCorpus')).toBeVisible();

    await page.locator('#brandHome').click();                     // 点 logo 回主界面
    await expect(page.locator('#viewLibrary')).toBeVisible();
    await expect(page.locator('#viewCorpus')).toBeHidden();

    expectNoErrors(errors);
  });

  test('4. 正文输入后字数实时更新', async ({ page }) => {
    const errors = await openApp(page);

    await page.locator('#navWriter').click();
    await page.locator('#content').fill('雾从海上来的时候，是凌晨三点四十。');
    await expect(page.locator('#wordCount')).toContainText('字');

    const txt = (await page.locator('#wordCount').textContent()) || '0';
    expect(parseInt(txt, 10)).toBeGreaterThan(10);

    expectNoErrors(errors);
  });

  test('5. 主题切换写入 html[data-theme]', async ({ page }) => {
    const errors = await openApp(page);

    await page.locator('#btnSettings').click();
    await expect(page.locator('#settingsDialog')).toBeVisible();

    await page.locator('.theme-dot[data-theme="green"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'green');

    await page.keyboard.press('Escape');
    expectNoErrors(errors);
  });

  test('6. 语料库自检可运行（本地，不调用模型）', async ({ page }) => {
    const errors = await openApp(page);

    await page.locator('#navCorpus').click();
    await expect(page.locator('#viewCorpus')).toBeVisible();

    await page.locator('#ragSelfTest').click();
    await expect(page.locator('#ragHits')).toContainText(/语料|索引|结论/);

    expectNoErrors(errors);
  });

  test('7. 次级菜单可打开并支持点外部关闭', async ({ page }) => {
    const errors = await openApp(page);

    await page.locator('#btnSettings').click();
    await expect(page.locator('#settingsDialog')).toBeVisible();

    // 点击 backdrop（dialog 本体）应关闭 —— 必须点在对话框【外】，backdrop 才在元素框之外
    const box = await page.locator("#settingsDialog").boundingBox();
    const clickX = box && box.x > 20 ? box.x - 10 : 2;
    const clickY = box && box.y > 20 ? box.y - 10 : 2;
    await page.mouse.click(clickX, clickY);
    await expect(page.locator('#settingsDialog')).toBeHidden();

    expectNoErrors(errors);
  });

  test('8. 段落缩进：整理后每段自动缩进，且不计入字数', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    // 三段正文，中间留一个空行
    await page.locator('#content').fill('第一段内容。\n\n第二段内容。\n第三段内容。');

    // 点写作台的「整理」（默认缩进 2 个字符）
    await page.locator('#viewWriter .fmtbar [data-fmt-act="normalize"]').click();

    const val = await page.locator('#content').inputValue();
    const lines = val.split('\n');
    expect(lines[0].startsWith('　　'), '第 1 段应缩进').toBe(true);
    expect(lines[1], '空行不应缩进').toBe('');
    expect(lines[2].startsWith('　　'), '第 2 段应缩进').toBe(true);
    expect(lines[3].startsWith('　　'), '第 3 段应缩进').toBe(true);

    // 全角空格应被排除在字数之外
    const txt = (await page.locator('#wordCount').textContent()) || '0';
    const n = parseInt(txt, 10);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(val.length);   // 缩进字符未计入

    expectNoErrors(errors);
  });

  test('9. 查找替换：本章定位与全部替换', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();
    await page.locator('#content').fill('陈砚走进屋子。陈砚看着窗外。');
    await page.locator('#content').dispatchEvent('input');

    // Ctrl+F 打开查找栏
    await page.locator('#content').click();
    await page.keyboard.press('Control+f');
    await expect(page.locator('#findBar')).toBeVisible();

    await page.locator('#findText').fill('陈砚');
    await page.locator('#replaceText').fill('陈默');
    await expect(page.locator('#findCount')).toContainText('2 处');

    // 全部替换（confirm 需要接受）
    page.once('dialog', (d) => d.accept());
    await page.locator('#findReplaceAll').click();
    await expect(page.locator('#content')).toHaveValue('陈默走进屋子。陈默看着窗外。');
    await expect(page.locator('#findCount')).toContainText('已替换');

    expectNoErrors(errors);
  });

  test('10. 「查找」是写作台的下级功能：按钮嵌在写作台工具栏里，点一次开再点一次关', async ({ page }) => {
    const errors = await openApp(page);

    // 顶栏里不再有「查找」，它已经嵌进写作台
    await expect(page.locator('.topbar #navFind')).toHaveCount(0);
    await expect(page.locator('#viewWriter #navFind')).toHaveCount(1);

    await page.locator('#navWriter').click();
    await page.locator('#navFind').click();
    await expect(page.locator('#findBar')).toBeVisible();
    await expect(page.locator('#navFind')).toHaveClass(/on/);   // 按钮进入按下态

    // 再点一次应收起（按钮即开关）
    await page.locator('#navFind').click();
    await expect(page.locator('#findBar')).toBeHidden();
    await expect(page.locator('#navFind')).not.toHaveClass(/on/);

    expectNoErrors(errors);
  });

  test('11. 伏笔：新建后悬停浮出伏笔思路', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    await page.locator('#cardTabs .tab[data-card="foreshadow"]').click();
    await expect(page.locator('#cardTabs .tab[data-card="foreshadow"]')).toHaveClass(/active/);

    await page.locator('#newCard').click();
    await expect(page.locator('#cardDialog')).toBeVisible();
    // 伏笔类型下字段标签应改变（「伏笔文段」提到最前，避免填错框）
    await expect(page.locator('#cardAnchorField')).toBeVisible();
    await expect(page.locator('#cardTitleLabel')).toHaveText('所属章节（可选）');
    await expect(page.locator('#cardBodyLabel')).toContainText('伏笔思路');

    await page.locator('#cardTitle').fill('第 1 章 主线');
    await page.locator('#cardBody').fill('船票其实是他自己寄的，为了引开注意力');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('#cardList')).toContainText('第 1 章 主线');

    // 悬停 → 浮出伏笔思路
    await page.locator('#cardList li').first().hover();
    await expect(page.locator('#hoverTip')).toBeVisible();
    await expect(page.locator('#hoverTip')).toContainText('船票其实是他自己寄的');

    expectNoErrors(errors);
  });

  test('12. 大纲 / 角色 / 设定 卡片同样支持悬停浮窗', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    // 建一张「角色」卡片
    await page.locator('#cardTabs .tab[data-card="role"]').click();
    await page.locator('#newCard').click();
    await expect(page.locator('#cardTitleLabel')).toHaveText('标题');   // 非伏笔类型标签不变
    await page.locator('#cardTitle').fill('陈砚');
    await page.locator('#cardBody').fill('前海事调查员，寡言，习惯用动作代替解释');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();

    await page.locator('#cardList li').first().hover();
    await expect(page.locator('#hoverTip')).toBeVisible();
    await expect(page.locator('#hoverTip')).toContainText('角色 · 陈砚');
    await expect(page.locator('#hoverTip .tip-body')).toContainText('前海事调查员');

    expectNoErrors(errors);
  });

  test('13. 伏笔标注：正文中匹配段落加虚线，点击浮出思路（支持多片段）', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    // 正文：两段分别含不同片段
    await page.locator('#content').fill('雾从海上来。\n\n陈砚盯着第七根灯柱，那灯不亮。\n\n他摸到一把黄铜钥匙。\n\n他走了。');
    await page.locator('#content').dispatchEvent('input');

    // 建伏笔：要标两处，用「分号」分隔（逗号只算片段内部标点，不当分隔符）
    await page.locator('#cardTabs .tab[data-card="foreshadow"]').click();
    await page.locator('#newCard').click();
    await page.locator('#cardTitle').fill('第 1 章');
    await page.locator('#cardAnchor').fill('第七根灯柱；黄铜钥匙');
    await page.locator('#cardBody').fill('这盏灯其实是信号灯，钥匙是旧案的线索');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();

    // 镜像层里应该有 2 段被标注（多片段各自命中）
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(2);
    await expect(page.locator('#contentMarks .mk-para').first()).toContainText('第七根灯柱');
    await expect(page.locator('#contentMarks .mk-para').nth(1)).toContainText('黄铜钥匙');

    // 点第二段 → 浮出「文段缩略 + 伏笔思路」
    await page.locator('#content').evaluate((el) => {
      const idx = el.value.indexOf('第七根灯柱');
      el.focus();
      el.setSelectionRange(idx, idx);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('#hoverTip')).toBeVisible();
    await expect(page.locator('#hoverTip .tip-title')).toContainText('文段：');      // 文段缩略
    await expect(page.locator('#hoverTip .tip-body')).toContainText('这盏灯其实是信号灯'); // 思路为主体

    expectNoErrors(errors);
  });

  test('14. 导入文本：直接新建一本书，且不动原有作品', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    // 原有作品里写点东西，确认导入不会碰它
    await page.locator('#content').fill('原有正文，不该被改动。');
    await page.locator('#content').dispatchEvent('input');
    const oldBook = await page.locator('#bookSelect').inputValue();

    await page.locator('#navImport').click();
    await expect(page.locator('#importDialog')).toBeVisible();
    // 不再有「导入方式」下拉
    await expect(page.locator('#importMode')).toHaveCount(0);
    await page.locator('#importBookTitle').fill('导入的新书');
    await page.locator('#importText').fill('雾从海上来，码头空着。');
    await page.locator('#importRun').click();
    await expect(page.locator('#importDialog')).toBeHidden();

    // 回到书库、新书出现，且当前作品已切到新书
    await expect(page.locator('#catalog')).toContainText('导入的新书');
    const newBook = await page.locator('#bookSelect').inputValue();
    expect(newBook).not.toBe(oldBook);

    // 切回原作品，原稿仍在
    await page.locator('#navWriter').click();
    await page.locator('#bookSelect').selectOption(oldBook);
    await expect(page.locator('#content')).toHaveValue('原有正文，不该被改动。');
    expectNoErrors(errors);
  });

  test('15. 导入文本：新书里按「第X章」自动分章', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navImport').click();
    await page.locator('#importBookTitle').fill('分章导入');
    await page.locator('#importText').fill('第一章 起雾\n雾从海上来，码头空着。\n\n第二章 夜航\n船票一直在口袋里。');
    await page.locator('#importRun').click();
    await expect(page.locator('#importDialog')).toBeHidden();
    await expect(page.locator('#catalog')).toContainText('分章导入');

    await page.locator('#navWriter').click();
    await expect(page.locator('#chapterList li')).toHaveCount(2);
    await expect(page.locator('#chapterList')).toContainText('第一章 起雾');
    await expect(page.locator('#chapterList')).toContainText('第二章 夜航');
    // 第一章正文已经进了编辑器
    await expect(page.locator('#content')).toHaveValue(/雾从海上来/);
    expectNoErrors(errors);
  });

  test('16. 伏笔弹窗：实时提示能标中几段，并可一键取正文选中', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    await page.locator('#content').fill('雾从海上来。\n\n陈砚盯着第七根灯柱，那灯不亮。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card="foreshadow"]').click();
    await page.locator('#newCard').click();

    // 片段在正文里不存在 → 明确提示，避免「以为加了其实没标上」
    await page.locator('#cardAnchor').fill('根本不存在的句子');
    await expect(page.locator('#anchorMatch')).toContainText('没有包含');

    // 换成正文里的真实片段 → 立刻提示可标中 1 段
    await page.locator('#cardAnchor').fill('第七根灯柱');
    await expect(page.locator('#anchorMatch')).toContainText('可标出 1 段');

    // 一键取「正文里选中的文字」
    await page.locator('#cardAnchor').fill('');
    await page.locator('#content').evaluate((el) => {
      const i = el.value.indexOf('第七根灯柱');
      el.setSelectionRange(i, i + 5);
    });
    await page.locator('#anchorFromSel').click();
    await expect(page.locator('#cardAnchor')).toHaveValue('第七根灯柱');

    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(1);
    expectNoErrors(errors);
  });

  test('17. 伏笔：虚线只认「伏笔文段」——只填所属章节不画线，且保存时会提醒', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    const para = '他走过去。灯柱底下没人。水泥地是湿的，只有他一个人的脚印。';
    await page.locator('#content').fill('　　雾从海上来。\n\n　　' + para + '\n\n　　他转身走了。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    // 故意只填「所属章节」，把「伏笔文段」留空
    await page.locator('#cardTitle').fill(para);
    await page.locator('#cardBody').fill('在三章之后回收');
    await expect(page.locator('#cardAnchor')).toHaveValue('');

    let warned = '';
    page.once('dialog', (d) => { warned = d.message(); d.accept(); });
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    expect(warned).toContain('伏笔文段');

    // 虚线不再拿「所属章节」兜底 —— 这里不该出现任何虚线
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(0);
    expectNoErrors(errors);
  });

  test('18. 伏笔虚线：不覆盖首行两格缩进', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    await page.locator('#content').fill('　　他走过去。灯柱底下没人。');
    await page.locator('#content').dispatchEvent('input');
    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    await page.locator('#cardAnchor').fill('他走过去');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();

    const mk = page.locator('#contentMarks .mk-para').first();
    await expect(mk).toHaveCount(1);
    // 缩进留在 span 外面，span 里只有正文文字
    await expect(mk.locator('.mk-u')).toHaveText('他走过去。灯柱底下没人。');
    // 装饰只在内层：外层没有下划线，所以首行两格缩进不会被画上
    expect(await mk.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
    expect(await mk.locator('.mk-u').evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');
    expectNoErrors(errors);
  });

  test('19. 伏笔文段：正文没选中时「取当前选中」不乱灌文本，且可一键清空', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();
    await page.locator('#content').fill('　　他走过去。灯柱底下没人。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();

    // 光标停在开头、没有任何选中 → 不应填入内容
    await page.locator('#content').evaluate((el) => el.setSelectionRange(0, 0));
    await page.locator('#anchorFromSel').click();
    await expect(page.locator('#cardAnchor')).toHaveValue('');
    await expect(page.locator('#anchorMatch')).toContainText('请先在正文里选中');

    // 真正选中文字后 → 能取到
    await page.locator('#content').evaluate((el) => {
      const i = el.value.indexOf('灯柱底下没人');
      el.setSelectionRange(i, i + 6);
    });
    await page.locator('#anchorFromSel').click();
    await expect(page.locator('#cardAnchor')).toHaveValue('灯柱底下没人');

    // 一键清空
    await page.locator('#anchorClear').click();
    await expect(page.locator('#cardAnchor')).toHaveValue('');
    expectNoErrors(errors);
  });

  test('20. 次级菜单：每次打开都回到干净状态，不残留上一次的内容', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    // Agent 弹窗：改目标 → 关闭 → 重开应回到初始值
    await page.locator('#openAgent').click();
    await expect(page.locator('#agentDialog')).toBeVisible();
    await page.locator('#agentGoal').fill('临时写点什么');
    await page.locator('#agentClose').click();
    await expect(page.locator('#agentDialog')).toBeHidden();
    await page.locator('#openAgent').click();
    await expect(page.locator('#agentGoal')).toHaveValue('帮我把这一章写完');
    await page.locator('#agentClose').click();

    // 导入弹窗：填内容 → 关闭 → 重开应清空
    await page.locator('#navImport').click();
    await page.locator('#importBookTitle').fill('临时书名');
    await page.locator('#importText').fill('临时内容');
    await page.locator('#importClose').click();
    await expect(page.locator('#importDialog')).toBeHidden();
    await page.locator('#navImport').click();
    await expect(page.locator('#importBookTitle')).toHaveValue('');
    await expect(page.locator('#importText')).toHaveValue('');
    await page.locator('#importClose').click();

    // 伏笔卡片弹窗：填了伏笔文段 → 关闭 → 重开应清空
    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    await page.locator('#cardAnchor').fill('残留测试');
    await page.locator('#cardDialog').evaluate((d) => d.close());
    await page.locator('#newCard').click();
    await expect(page.locator('#cardAnchor')).toHaveValue('');
    await page.locator('#cardDialog').evaluate((d) => d.close());
    expectNoErrors(errors);
  });
  test('21. 伏笔：一个含逗号的选段只标出 1 段（逗号不再当分隔符）', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    const para = '他走过去。灯柱底下没人。水泥地是湿的，只有他一个人的脚印。';
    await page.locator('#content').fill('　　' + para + '\n\n　　第二段完全无关，但里面又提了一次只有他一个人的脚印。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    await page.locator('#cardAnchor').fill(para);
    // 提示与实际标注必须一致：只有 1 段
    await expect(page.locator('#anchorMatch')).toContainText('可标出 1 段');

    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(1);
    expectNoErrors(errors);
  });

  test('22. 伏笔：清空伏笔文段并保存后，正文里的虚线必须消失', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    await page.locator('#content').fill('　　他走过去。灯柱底下没人。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    await page.locator('#cardAnchor').fill('灯柱底下没人');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(1);

    // 重新打开这张卡片 → 清空文段 → 保存
    await page.locator('#cardList li').first().click();
    await expect(page.locator('#cardDialog')).toBeVisible();
    await page.locator('#anchorClear').click();
    await expect(page.locator('#cardAnchor')).toHaveValue('');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();

    // 虚线必须真的消失，而不是清不掉
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(0);
    expectNoErrors(errors);
  });

  test('23. 顶栏：导入在设置左侧；当前页面按钮高亮成标签页', async ({ page }) => {
    const errors = await openApp(page);

    // 「导入」紧挨在「设置」左边
    const order = await page.evaluate(() => [...document.querySelectorAll('.topbar > button')].map((b) => b.id));
    expect(order.indexOf('navImport')).toBe(order.indexOf('btnSettings') - 1);

    // 初始在书架
    await expect(page.locator('#navLibrary')).toHaveClass(/nav-on/);
    await expect(page.locator('#navWriter')).not.toHaveClass(/nav-on/);

    // 切页面 → 高亮跟着走，且只有一个
    await page.locator('#navWriter').click();
    await expect(page.locator('#navWriter')).toHaveClass(/nav-on/);
    await expect(page.locator('#navLibrary')).not.toHaveClass(/nav-on/);
    await page.locator('#navCorpus').click();
    await expect(page.locator('#navCorpus')).toHaveClass(/nav-on/);
    await expect(page.locator('#navWriter')).not.toHaveClass(/nav-on/);
    expect(await page.locator('.topbar button.nav-on').count()).toBe(1);

    // 当前页：圆角矩形框整体消失（边框+底色透明），文字换主题色并整体微放大
    await page.locator('#navWriter').click();
    const st = await page.evaluate(() => {
      const on = getComputedStyle(document.getElementById('navWriter'));
      const off = getComputedStyle(document.getElementById('navLibrary'));
      return {
        onBorder: on.borderTopColor, offBorder: off.borderTopColor,
        onBg: on.backgroundColor, offBg: off.backgroundColor,
        onColor: on.color, offColor: off.color,
        onTf: on.transform, offTf: off.transform,
      };
    });
    expect(st.onBorder).toBe('rgba(0, 0, 0, 0)');        // 框线消失
    expect(st.offBorder).not.toBe('rgba(0, 0, 0, 0)');   // 其它页仍有框线
    expect(st.onBg).toBe('rgba(0, 0, 0, 0)');            // 底色也去掉
    expect(st.onColor).not.toBe(st.offColor);            // 文字换成主题色
    expect(st.onTf).not.toBe('none');                    // 整体微放大
    expect(st.offTf).toBe('none');

    // 放大用的是 transform（不参与布局）→ 切页面时旁边按钮不能动
    await page.locator('#navLibrary').click();
    const p1 = await page.locator('#navCorpus').boundingBox();
    await page.locator('#navWriter').click();
    const p2 = await page.locator('#navCorpus').boundingBox();
    expect(Math.abs(p2.x - p1.x)).toBeLessThan(0.5);
    expectNoErrors(errors);
  });

  test('24. 伏笔：取消勾选「启用」后这段失效（不画线），但文字保留', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    await page.locator('#content').fill('　　他走过去。灯柱底下没人。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    await page.locator('#cardAnchor').fill('灯柱底下没人');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(1);

    // 重新打开 → 取消勾选「启用」→ 保存
    await page.locator('#cardList li').first().click();
    await expect(page.locator('#anchorEnabled')).toBeChecked();
    await page.locator('#anchorEnabled').uncheck();
    await expect(page.locator('#anchorMatch')).toContainText('已停用');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();

    // 虚线消失，但文本框里的文字还在
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(0);
    await page.locator('#cardList li').first().click();
    await expect(page.locator('#cardAnchor')).toHaveValue('灯柱底下没人');
    await expect(page.locator('#anchorEnabled')).not.toBeChecked();

    // 再勾回来 → 恢复画线
    await page.locator('#anchorEnabled').check();
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(1);
    expectNoErrors(errors);
  });

  test('25. 次级菜单：刚从后台切回来的那一下点击，不该关掉菜单', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();
    await page.locator('#openAgent').click();
    await expect(page.locator('#agentDialog')).toBeVisible();

    const box = await page.locator('#agentDialog').boundingBox();
    const cx = box.x > 20 ? box.x - 10 : 2;
    const cy = box.y > 20 ? box.y - 10 : 2;

    // 模拟「浏览器窗口刚被激活」那一瞬间
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.mouse.click(cx, cy);
    await expect(page.locator('#agentDialog')).toBeVisible();   // 不该被顺手关掉

    // 过了保护窗口后，正常点黑暗处应该能关
    await page.waitForTimeout(600);
    await page.mouse.click(cx, cy);
    await expect(page.locator('#agentDialog')).toBeHidden();
    expectNoErrors(errors);
  });

  test('26. 伏笔：点「取消当前选中」立刻去掉正文里的标记（文字保留）', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();

    await page.locator('#content').fill('　　他走过去。灯柱底下没人。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    await page.locator('#cardAnchor').fill('灯柱底下没人');
    await page.locator('#cardSave').click();
    await expect(page.locator('#cardDialog')).toBeHidden();
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(1);

    // 重新打开这张卡片 → 点「取消当前选中」
    await page.locator('#cardList li').first().click();
    await expect(page.locator('#cardDialog')).toBeVisible();
    await page.locator('#anchorOffBtn').click();

    // 不用再点保存，正文里的标记就应该立刻消失
    await expect(page.locator('#contentMarks .mk-para')).toHaveCount(0);
    // 文字保留在文本框里
    await expect(page.locator('#cardAnchor')).toHaveValue('灯柱底下没人');
    await expect(page.locator('#anchorMatch')).toContainText('已取消');
    await expect(page.locator('#anchorEnabled')).not.toBeChecked();
    expectNoErrors(errors);
  });

  test('27. 伏笔：弹窗开着也能在正文里选字，再点「取当前选中」（非模态）', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#navWriter').click();
    await page.locator('#content').fill('　　他走过去。灯柱底下没人。水泥地是湿的。');
    await page.locator('#content').dispatchEvent('input');

    await page.locator('#cardTabs .tab[data-card=foreshadow]').click();
    await page.locator('#newCard').click();
    await expect(page.locator('#cardDialog')).toBeVisible();
    // 非模态：:modal 不成立，所以正文没有被 inert，能选字
    expect(await page.locator('#cardDialog').evaluate((el) => el.matches(':modal'))).toBe(false);

    // 用真实鼠标在正文里拖选
    const box = await page.locator('#content').boundingBox();
    const y = box.y + 24;
    await page.mouse.move(box.x + 44, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 170, y, { steps: 10 });
    await page.mouse.up();

    // 弹窗仍然开着，且选区有效
    await expect(page.locator('#cardDialog')).toBeVisible();
    const sel = await page.locator('#content').evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
    expect(sel.length).toBeGreaterThan(0);

    await page.locator('#anchorFromSel').click();
    await expect(page.locator('#cardAnchor')).toHaveValue(sel.trim());   // 取用时两端空白会被去掉
    await expect(page.locator('#anchorMatch')).toContainText('可标出 1 段');
    expectNoErrors(errors);
  });

  test('28. 书架检索：按书名/作者过滤，计数与清空都正确', async ({ page }) => {
    const errors = await openApp(page);

    const addBook = async (title, author) => {
      await page.locator('#libNewBook').click();
      await expect(page.locator('#bookDialog')).toBeVisible();
      await page.locator('#bookTitle').fill(title);
      await page.locator('#bookAuthor').fill(author || '');
      await page.locator('#bookSave').click();
      await expect(page.locator('#bookDialog')).toBeHidden();
    };
    await addBook('夜航', '甲');
    await addBook('雾岗', '乙');

    const total = await page.locator('#catalog .book-row').count();
    expect(total).toBe(3);        // 含默认的「我的第一本书」
    await expect(page.locator('#catalogCount')).toContainText('3 本');

    // 按书名过滤
    await page.locator('#libSearch').fill('夜航');
    await expect(page.locator('#catalog .book-row')).toHaveCount(1);
    await expect(page.locator('#catalog')).toContainText('夜航');
    await expect(page.locator('#catalogCount')).toContainText('1 / 3 本');

    // 按作者过滤（证明检索覆盖作者字段）
    await page.locator('#libSearch').fill('乙');
    await expect(page.locator('#catalog .book-row')).toHaveCount(1);
    await expect(page.locator('#catalog')).toContainText('雾岗');

    // 搜不到 → 明确空状态
    await page.locator('#libSearch').fill('根本不存在的书名');
    await expect(page.locator('#catalog .book-row')).toHaveCount(0);
    await expect(page.locator('#catalog')).toContainText('没有匹配');

    // 清空 → 恢复全部
    await page.locator('#libSearchClear').click();
    await expect(page.locator('#catalog .book-row')).toHaveCount(3);
    await expect(page.locator('#catalogCount')).toContainText('3 本');
    await expect(page.locator('#libSearch')).toHaveValue('');
    expectNoErrors(errors);
  });

});

