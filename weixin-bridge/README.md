# dsh-weixin-bridge

把 DeepSeek Harness 的 agent 接到微信的官方 ClawBot 通道（`@tencent-weixin/openclaw-weixin` 协议），通过社区 SDK [`weixin-agent-sdk`](https://github.com/wong2/weixin-agent-sdk) 实现。扫码登录个人微信号后，每个微信会话对应一个 Harness agent 会话，多轮对话保留历史。

双面插件：host 半区跑微信桥（`lib/index.js`）并暴露 `/weixin-bridge` RPC 通道，浏览器半区注册 Settings → **社交渠道** 页面（`lib/client.js`，通过 `settings.section` 开放槽位，与模型/插件/Agent预设平级，排在最后）。在 web profile 里打开设置页就能看到二维码、直接扫码连接，不需要看终端。不需要改 Harness 源码。

> 非官方项目：`weixin-agent-sdk` 是腾讯官方 OpenClaw 微信插件的社区改造版。接入使用个人微信号，存在账号风险，请自行评估。

> 构建环境依赖：client 类型校验需要本机存在 Harness checkout（`/Users/en/Documents/proj/public/deepseek-harness`），因为 `dsh-client-*` 的部分传递依赖（如 `@deepseek-ai/dsh-compact`）未发布到 npm，无法作为 npm 依赖安装。

## 安装

本包是一个 dsh bundle（`package.json` 声明 `dsh.bundle`）。装进某个 profile：

```sh
# 从包目录执行（或任意包含本包的目录）
dsh plugin --profile web add /Users/en/Documents/proj/my/dsh-plugins/weixin-bridge
```

首次使用会初始化 profile（`@deepseek-ai/dsh-base`），pnpm 链接本包，并把它的 `cordis.patch.yml` 追加进 `dsh.profile.bundles`。

也可以装进独立 profile：

```sh
dsh plugin --profile weixin add /Users/en/Documents/proj/my/dsh-plugins/weixin-bridge
dsh --profile weixin
```

## 使用

1. 启动 web profile（如 `dsh --profile web`），插件 `enabled: true` 时自动发起登录。
2. 打开设置 → **社交渠道**：页面直接显示二维码和实时状态。
3. 用手机微信扫码并确认授权，页面自动变为「已连接」。
4. 给该微信号发消息，agent 处理后在微信里收到回复。

> 不是 web profile（如 `dsh --profile weixin`）时，`ctx.connection` 不存在，页面扫码不可用，退回终端扫码：启动后终端仍会打印二维码并等待扫码。

每次消息走 `ctx.agents.create`（provider/model 取插件 config），回复收集提交后的 assistant 文本（`session/event` + `whenIdle`）。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: weixin-bridge
  config:
    enabled: true
    provider: deepseek-official
    model: deepseek-v4-flash
    cwd: /your/workspace
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 设为 `false` 只安装不连接 |
| `provider` | `deepseek-official` | 模型路由 |
| `model` | `deepseek-v4-flash` | 模型名 |
| `cwd` | 启动目录（桌面 App 为 `/` 时用 `~/dsf`） | 新建会话的工作目录 |
| `maxTokens` | — | 每次请求最大输出 token |

所有字段均可选；未配置时用默认值（`enabled: true`、`provider: deepseek-official`、`model: deepseek-v4-flash`、`cwd` 取启动目录，桌面 App 启动目录为根目录时回落到 `~/dsf`）。配置也可以在设置页的「配置」区块直接编辑（持久化到 `$DSH_HOME/settings.yaml`，对新会话立即生效；`~/` 前缀会自动展开）。

## 设置里的"社交渠道"页

浏览器半区在 Settings 注册 `social-channels` 页（`order: 30`，排在 Agent预设之后）。页面驱动 host 半区的扫码登录：

- **实时二维码**：用 `qrcode-generator` 在浏览器本地把登录链接渲染成 SVG 二维码，不走任何外部图片服务。
- **状态轮询**：页面打开期间每 1.5s 调一次 `/weixin-bridge/status`，扫码、手机上确认、连接成功都会即时反映到页面上。
- **操作**：未连接时可「开始连接」，等待时可「刷新二维码」「取消登录」，失败可「重试」。

通信走宿主提供的通用 RPC 通道（`ctx.connection.rpc.handle('/weixin-bridge', …)`，loopback 权限），不依赖 apiproxy 的 allowlist，也不需要改 Harness 源码。

## 行为与限制

- **文本为主**：图片/语音/视频/文件附件当前不转发内容，只在提示文本里附一句说明。
- **会话映射**：一个微信 `conversationId` 对应一个 Harness session，agent 空闲后保持存活，多轮对话连续。重启后映射丢失（每次启动新建会话）。同一会话的并发创建是单飞的（single-flight），不会因为两条消息几乎同时到达而开出两个平行会话。
- **单实例监控（防重复回复）**：SDK 的长轮询游标是每个账号一份共享文件（`~/.openclaw/openclaw-weixin/accounts/<id>.sync.json`）。如果同时跑着两个 Harness 实例（例如桌面 App 重启后旧 sidecar 没被杀掉、或重复 `dsh --profile web`），每个实例都会用同一个游标轮询同一个账号，每条消息被投递给 N 个实例 → 每个实例回一条，用户就收到 N 条重复回复。插件现在按账号持有跨进程监控锁（`<id>.monitor.lock`，带 pid）：已有另一个存活实例在监听时，本实例跳过监控并告警。另外桥接层对 3 秒内重复投递的相同消息做了去重兜底，即使上游重放也不会重复回复。若仍出现重复回复，先退出所有 App 实例再重新打开一个。
- **主动发消息**：未实现；`Bot.sendMessage` 依赖入站 `context_token`（约 24h 时效），需要先收到过该账号的消息。SDK 的 `start()` 返回的 `Bot` 支持 `sendMessage`，后续版本可加定时提醒等能力。
- **权限**：agent 的 bash/文件操作受 profile 的 sandbox 策略约束（默认 `workspace-write` + ask）。
- **非交互渠道**：微信会话组合默认 agent preset（同 web 会话），但隐藏需要 UI 回答的 `ask_user_question` 工具；单轮处理超过 5 分钟（`turnTimeoutMs` 可调）会取消该轮并提示重发，避免交互卡死把整个通道挂起。
- **依赖**：需要 profile 组合里有 agent 工厂与 agent-presets（`@deepseek-ai/dsh-base` + `dsh-web-app` 自带）。若目标 profile 没有 agent 服务，桥接会因注入失败而无法激活。
- **页面扫码**：需要 profile 组合里有 `client-connection`（web profile 自带）。其他 profile 退回终端扫码；已登录过（`~/.openclaw/openclaw-weixin` 有账号）时跳过扫码直接连接。
- **退出/换号**：设置页在已连接状态显示「退出并重新绑定」——清除 `~/.openclaw/openclaw-weixin` 下的全部凭证并停掉微信监听，回到未连接状态后可重新扫码绑定另一个微信号。与手动删除目录不同，退出后无需重启 profile。

## 开发

```sh
pnpm install
pnpm run build       # host: tsc → lib/；client: tsdown → lib/client.js
pnpm run typecheck   # host + client 两侧类型检查（client 需要本机 Harness checkout）
pnpm run build:host     # 只编 host
pnpm run build:client   # 只编 client
```

host 依赖已发布到 npm（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-session`、`weixin-agent-sdk`）。client 半区的类型通过 tsconfig `paths` 映射到本机 Harness checkout 的 `lib/types`（`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-connection` 等未完整发布到 npm，见下）；运行时浏览器从自身平台模块表解析这些包，不需要安装。二维码渲染用 `qrcode-generator`（纯 JS，打进 client bundle）。
