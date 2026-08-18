# SPEC: builtin-browser 元素拾取（vendor Selector + 直发 DSH 会话）

日期：2026-08-17（2026-08-17 修订：从"自写极简 picker"改为"整体 vendor Selector，仅加发送出口"）
状态：待评审
上游：[oil-oil/selector](https://github.com/oil-oil/selector)（MIT），vendored 快照钉在 commit `d57434c03675dccecdc1997a3a5f66674357d1f7`（2026-08-17 main）。

## 1. 背景与动机

builtin-browser 已在 dsh desktop 外壳里提供真 Chromium `<webview>` 面板和 6 个 `browser_*` agent 工具。断点在"人 → agent"的指认路径：用户想就页面上**某个具体元素**向 agent 提需求时，只能手打描述。

Selector 已经把这条路径的交互做成熟了：点选/多选/框选、父子兄弟键导航、per-element ✎ 指令标注、含 selector / 语义 locator / React 组件链与源码位置的结构化 prompt、设置面板与快捷键。它的终点是剪贴板（粘给外部 AI），而我们的 AI 就在同一窗口里——**复用它的全部交互与 UI，把出口从剪贴板改成直发 DSH 会话**，是本功能的全部增量。

## 2. 目标

1. 把 Selector 的页面内编辑器（交互、UI、样式、元数据提取、prompt 生成）vendor 进 builtin-browser 的 client 半区，经 `webview.executeJavaScript` 注入 guest 页面运行。
2. 浏览器面板工具栏加「拾取」按钮作为注入入口。
3. 在 Selector 的工具条上加一个「发送到会话」动作：把它生成的 prompt 文本（含用户标注的指令）直接发给当前 DSH 会话（等价于聊天输入框输入后回车），并自动收口（拆除编辑器、关闭浏览器面板）。

## 3. 非目标（明确不做）

- 不改 Selector 的核心交互逻辑与视觉设计——**最小补丁原则**：补丁只加出口（一个按钮 + 一个 HOST 方法），其余原样。
- 不改它的剪贴板/下载出口：⌘C 复制、⌘M Markdown、Sharingan 报告（剪贴板或 .md 下载）保持原生行为，与发送并存。
- 它的截图链路（`getDisplayMedia` 选屏器）不改道、不增强；`webview.capturePage()` 的截图工具是另一个独立特性。
- host 半区改动：不新增 agent 工具、不改控制端点协议、desktop 外壳零改动。
- iframe 降级模式下的拾取（普通 `dsh web` 标签页里按钮不显示，见 §5.3）。
- 跟随上游的自动同步机制：vendor 是快照，升级靠人工重 vendor 并重打补丁。

## 4. 交互形态（唯一确定形态）

### 4.1 入口按钮

- 位置：`BrowserPanel` 工具栏，「刷新 ⟳」之后、地址栏 `<input>` 之前。
- 形态：图标按钮 `⌖`，tooltip / aria-label「拾取元素发给助手」。
- 仅当 `browserStore.get().inShell === true` 时渲染。
- 编辑器激活期间按钮高亮（`aria-pressed=true` + 强调底色）；再次点击 = 拆除编辑器、退出选择模式。

### 4.2 选择模式（guest 页面内，Selector 原生 UI）

点击按钮后注入 Selector 编辑器，guest 页面表现完全由 Selector 决定，包括：

- hover 高亮框、选中覆盖层（角标 + ✎ 标注按钮 + Markdown 按钮）、点击选中 / Shift+Click 多选 / 拖拽框选、↑↓←→ DOM 导航、⌘Z undo、Esc 暂停/清除。
- 页面底部浮起它的工具条（chat panel）：Copy Prompt / 设置 / 关闭等。
- ✎ 标注弹层：每个选中元素可写一条自然语言指令，进 prompt 的 `instruction:` 行。
- 其设置面板里的 Pro 推广、截图相关项保留原样（不可用项它自己会降级/隐藏）；`HOST.initialLang` 注入 `'zh'`，`HOST.initialSettings` 不注入（用它的 localStorage 默认）。

### 4.3 发送出口（我们对 Selector 的唯一功能补丁）

- 在其 chat panel 的「Copy Prompt」按钮**左侧**加一个同级按钮「发送到会话」（样式复用它的按钮类，视觉上与原生按钮一致）。
- 点击 = 生成与它 ⌘C 完全相同的 prompt 文本（调用同一个 `buildPromptText()`，含全部选中元素与标注），但不写剪贴板，改调 `window.__SELECTOR_HOST__.sendPrompt(text)`。
- 无选中元素时按钮禁用（与其 Copy Prompt 的可用态一致）。
- Selector 自带的 ✕ 关闭按钮行为不变。

### 4.4 发送与收口（GUI 页面侧）

- guest 内 `sendPrompt(text)` 把文本写入 `window.__dshSelectorOutbox`；GUI 侧在编辑器激活期间每 500ms 经 `webview.executeJavaScript` 轮询取出（读出即清空）。
- 取到文本后：调 `session.prompt([{ type: 'text', text }], 'queue')` 发到**当前会话**。
- 成功后：经 `executeJavaScript` 调 `window.__SELECTOR_DESTROY__()` 拆除编辑器，关闭浏览器面板（`browserStore.setOpen(false)`），用户直接看到会话里消息发出。
- 无当前会话 / RPC 失败：**不拆编辑器、不关面板**，在浏览器面板工具栏下沿显示红色 toast（无会话：「没有活跃会话，请先新建会话」；RPC 错误：错误文本），4 秒自动消失。
- 拾取期间用户在地址栏导航：guest context 销毁，编辑器自然消失；GUI 侧在 `did-navigate`（或轮询发现注入物消失）时退出选择模式、按钮复位，静默无提示。

## 5. 契约与行为后果（依赖的框架/平台行为假设）

### 5.1 guest → GUI 的回传通道

- **通道选型**：`window.__dshSelectorOutbox` + GUI 侧 500ms `executeJavaScript` 短轮询。理由：guest 无 Node 集成（`ipcRenderer.sendToHost` 不可用）；`console-message` 事件虽免轮询，但会把协议混进日志流且丢失风险不可观测。轮询间隔内编辑器本身活跃，开销可忽略。
- **假设**：`executeJavaScript` 对同一 webview 可高频串行调用，返回 JSON 值；**依据**：Electron 官方文档 + 本项目 `browser_eval` 已走通同一通道（高频轮询未验证）。
- **验证方式**：Phase 1 spike——注入后 500ms 轮询 1 分钟，观察 webview 渲染/滚动无卡顿。
- **替代方案**（轮询有实测问题时启用）：guest 侧 `console.log` 带约定前缀 + GUI 监听 webview 的 `console-message` 事件。
- **✅ spike 结论（已回填）**：dev 实例（Electron 43 / Chrome 150）上对 github.com 连续 30 次执行同一 poll 表达式，`executeJavaScript` 往返 **min 0.2ms / avg 0.5ms / max 3.4ms**；500ms 轮询期间点选/框选/标注/webview 滚动均无可见卡顿，且每个 tick 用**单次** `executeJavaScript` 一次性取出 outbox 并探测 `.ai-editor-root` 存活。原通道选型成立，替代方案（console-message）不需要启用。

### 5.2 注入体积与 CSP

- Selector 装配后的 editor payload 约 260KB JS + 30KB CSS，一次 `executeJavaScript` 注入。**假设**：此体积的注入在 Electron 上无实际限制（依据：Electron 文档无体积限制记载，推断）。**验证**：spike 注入并计时。
- CSS 注入：Selector 样式是类驱动的（`editor.css` 1239 行），**必须**以 `<style>` 元素注入——`style-src` 不含 `unsafe-inline` 的站点会拒绝。**假设**：主流开发目标站点（localhost、github.com 等）允许内联样式（依据：github.com 的 `style-src` 含 `unsafe-inline`；Selector bookmarklet 同样依赖此行为并宣称 works everywhere）。**验证**：spike 在 github.com 注入，编辑器 UI 渲染正常即通过；不通过的站点属已知限制，写进 README，不做逐元素内联改写。
- JS 注入不受页面 `script-src` 限制（executeJavaScript 等同 DevTools 求值，本项目已验证）。
- **✅ spike 结论（已回填）**：实际装配 `editor.bundle.js` 249,408 B（≈244KB）+ `editor.css` 28,731 B（≈28KB），与估算一致。dev 实例上从点 ⌖ 到 guest 内 `.ai-editor-root` 出现 **≈38ms**，无体积限制迹象。github.com 注入后编辑器 UI 完整渲染（chat panel、设置面板、hover/选中覆盖层、发送按钮均正常），内联 `<style>` 生效——github.com 的 `style-src` 含 `unsafe-inline` 的假设成立；无需逐元素内联改写。

### 5.3 webview 专属 API 的可用边界

- `executeJavaScript` 只在 Electron `<webview>` 上存在；iframe 降级模式（`inShell === false`）无跨域注入能力。**后果**：入口按钮只在 `inShell` 时渲染——有意的能力分层，不做降级。
- React 源码位置（`source: file:line`）只在 React dev 构建存在（Selector 自身的 `_debugSource`/`_debugStack` 提取逻辑处理，生产构建静默省略）。

### 5.4 DSH 会话发送契约（已验证事实，非推断）

- client 半区经 `ctx.get('sessions')`（`@deepseek-ai/dsh-client-runtime` 的 `ISessions`）：`list.getSnapshot().current` 得当前 `SessionId`，`binding(id).session.prompt(content, mode)` 是编程式发消息的官方入口（等价输入框提交，含乐观 UI 与 `promptError` 镜像）。源码依据：`packages/client/runtime/src/client/contract/sessions.ts`、`packages/client/runtime/src/client/sessions/session.ts:190-207`。
- 单条 text 以 `/` 开头会被当 slash 命令——本功能不动用户文本的拼接待发路径由 Selector 生成的 prompt 固定以 `Page:` 开头，不触发该分支；**但要在发送前防御性检查 `text.startsWith('/')`，是则前置一个零宽说明行**（实现期确认 prompt 生成器不可能产出后删除该检查亦可）。
- `mode: 'queue'`：agent 忙时排队。subagent 会话 `prompt` 被拒（`agent-busy`）→ 走 §4.4 toast 错误路径，不做特殊路由。
- `ctx.get('sessions')` 在**发送时惰性解析**，不在 `apply` 时取定。`package.json` 的 `dsh.client.inject` 已含 `@deepseek-ai/dsh-client-runtime`，零新增依赖。动工第一步 `npm run typecheck` 验证 `Context.sessions` 类型合并在本插件 tsconfig.client.json 下可见。

### 5.5 Selector 的宿主接缝与退出钩子（已读源码确认）

- `window.__SELECTOR_HOST__`：core.js 在注入前读取，缺省 `{}` 全部走免费版降级分支。我们用到的字段：`initialLang`、`initialSettings`，以及**补丁新增**的 `sendPrompt`。
- 双注入守卫：页面已有 `.ai-editor-root` 时 Selector 软恢复（`__SELECTOR_ON_REACTIVATE__`），重复点入口按钮不叠加实例。
- 拆除钩子：`window.__SELECTOR_DESTROY__()`（core.js:218/273）完整移除注入物。
- 标注/选择状态存内存；设置存 guest origin 的 localStorage。

## 6. 发送的消息格式

就是 Selector ⌘C 的产物，原样发送，**不加额外包装头**（它的 `Page:` / `Query:` / 编号元素块 / `instruction:` 已是面向 AI 的结构化文本）。Sharingan 模式开启时其报告超剪贴板阈值会转为 .md 下载——发送出口始终发送它生成的剪贴板文本（此时为 abbreviated summary + 下载文件指引），与该模式的原生语义一致。

## 7. 实现要点（层面划分，非执行计划）

- **`builtin-browser/vendor/selector/`**（新增）：上游 `src/*.js`（7 个片段）、`assets/editor.css`、`LICENSE`（MIT 原文）、`NOTICE.md`（记录上游 commit `d57434c`、本地补丁清单）。装配脚本 `vendor/selector/build.mjs` 照搬其 `scripts/build.js` 的拼接逻辑，产出两个文本资产：`editor.bundle.js`、`editor.css`。
- **本地补丁**（打在 vendored 副本上，逐条记入 NOTICE.md）：
  1. `export.js`：chat panel 按钮区加「发送到会话」按钮（§4.3），handler 调 `HOST.sendPrompt(buildPromptText())`，无选中时禁用；
  2. 不加其他改动。
- **`src/client/picker-script.ts`**（新增）：注入编排。构建期把 `editor.bundle.js` 与 `editor.css` 作为文本资产打进 client bundle（tsdown 的 `?raw` 文本导入或等效机制，实现期验证 rolldown 的 raw 导入形态）。运行时注入顺序：①`__SELECTOR_HOST__` 种子（`initialLang:'zh'`、`sendPrompt` 写 outbox）②`<style>` 注入 CSS ③执行 editor JS。
- **`src/client/store.ts`**：`browserStore` 增加 `picking: boolean`、`toast: string | null` 及 action；拾取编排（注入 → 轮询 outbox → `session.prompt` → 拆编辑器/关面板/toast）放独立模块 `src/client/pick-flow.ts`，React 组件只读状态。
- **`src/client/BrowserPanel.tsx`**：工具栏加 §4.1 按钮（仅 inShell）+ toast 渲染条。
- **`src/client/index.ts`**：`apply` 注入惰性发送函数；`inject` 导出不变。
- **`package.json`**：`build:client` 前先跑 `vendor/selector/build.mjs`（script 串联）；`files` 加 `vendor`（发布产物含 license 文本）。
- host 半区、`cordis.patch.yml`、desktop 外壳：零改动。

## 8. 验收标准

1. desktop 外壳里打开面板 → 点 ⌖ → guest 出现 Selector 编辑器（高亮、工具条、设置面板原生渲染）；再点 ⌖ 或编辑器 ✕ → 完整拆除无残留。
2. 点选 + Shift 多选 + 框选 + ✎ 标注 + ↑↓ 导航均正常（Selector 原生交互回归）。
3. 点「发送到会话」→ 面板关闭、编辑器拆除、当前会话收到 Selector 格式的 prompt（含 `instruction:` 行）；⌘C/⌘M 原生出口不受影响。
4. 无活跃会话 / RPC 失败 = toast 报错且编辑器与面板保持；拾取中导航 = 静默退出。
5. github.com 注入冒烟通过（§5.2 结论回填本节）；localhost React dev 页面 prompt 含 `react:`/`source:` 行。
6. 轮询期间 webview 滚动/渲染无可见卡顿（§5.1 结论回填）。
7. 普通 `dsh web` 标签页：面板正常、无 ⌖ 按钮。
8. `npm run build && npm run typecheck` 通过；vendor 目录含 LICENSE 与 NOTICE.md。

### 8.1 实测回填（2026-08-17 desktop dev 实例 + CDP 驱动）

1. ✅ dev 实例（Electron 43）里 `window.__dshBrowser` 与 `desktopBridge{browserPort,isShell}` 就位；点 ⌖ → github.com 内 `.ai-editor-root`/chat panel/发送按钮出现（`__SELECTOR_HOST__{initialLang:'zh',sendPrompt}` 已种入，`<style>` 已注入），⌖ `aria-pressed=true`；再点 ⌖ 或 guest ✕ → 编辑器/覆盖层/`__SELECTOR_DESTROY__`/注入的 `<style>` **全部清除无残留**，⌖ 复位。
2. ✅ 点选（合成 click 命中 NavDropdown 按钮）→ 选中覆盖层 1 个 + 标签 1 个；发送按钮随之由禁用→启用（`updateTags` 同步）。框选/↑↓/Shift 为 Selector 原生交互，未改动，未回归。
3. ✅ 点「发送到会话」→ 发送按钮写 `window.__dshSelectorOutbox`，内容为 `Page: https://github.com/\n\n1. NavDropdown "Platform" <button> ... instruction: 把这个菜单改成蓝色`（含 `locator:`/`react:`/`props:`/`instruction:` 行）。**成功路径的 session.prompt→拆编辑器→关面板**在无凭据的临时 DSH_HOME 无法建会话，未端到端观测；其余链路（poll 消费 outbox→`sendToSession`→toast 错误分支；`stopPicking` 拆除；`setOpen(false)` 关面板）均已实测。
4. ✅ 无活跃会话：toast 显示「没有活跃会话，请先新建会话」，编辑器/面板保持、⌖ 仍 `aria-pressed=true`；拾取中 `loadURL` 导航 → 新页无编辑器、⌖ 复位、**无 toast**（静默退出）。
5. ✅ github.com 注入冒烟通过（见 §5.2 结论）。`react:` 行已实测（github.com 生产 React 也产出 `react: MarketingNavigation › UrlProvider › NavDropdown`）；`source:` 行需 React **dev** 构建（`_debugSource`/`_debugStack`），本地无 dev 服务器，逻辑经 `context.js` 源码确认、未实机。
6. ✅ 轮询往返 min 0.2/avg 0.5/max 3.4ms，无可见卡顿（见 §5.1 结论）。
7. ✅ 代码层确认：⌖ 按钮仅 `browserStore.get().inShell === true` 渲染，`inShell` 仅当 `desktopBridge?.browserPort` 存在时置位——普通 `dsh web` 标签页无 preload、无 ⌖。
8. ✅ `npm run build && npm run typecheck` 通过；`vendor/selector/` 含 `LICENSE`（MIT）与 `NOTICE.md`（上游 commit `d57434c` + 本地补丁清单）；`editor.bundle.js`/`editor.css` 由 `build.mjs` 产出并作为文本资产编进 client bundle（rolldown 无 `?raw`，用生成的 `src/client/selector-assets.ts`）。

## 9. 风险与开放问题

- **补丁漂移**：vendored 补丁（§7）靠 NOTICE.md 清单维护；上游升级需人工重放补丁。补丁越小越稳——这正是最小补丁原则的原因。
- **guest 焦点**：编辑器 textarea 聚焦在 guest 内，外层 GUI 的全局快捷键（如 ⌘K）可能竞争；Selector 的 ⌘C/⌘M 是 guest 内监听不受影响。若实测外层截获按键，选择模式期间给面板根元素加 keydown capture（实现期验证）。
- **SPA 导航**：Selector 自身靠 `__SELECTOR_ON_REACTIVATE__` 软恢复处理重复注入，但 webview 的真实导航会销毁注入物——按 §4.4 静默退出处理，不做跨导航保活（那是它 Pro 扩展的能力，需要外壳配合）。
- 编辑器在超大 DOM 页面上的性能未评估；Selector 生产使用面广，按可接受处理，实测卡顿再议。
