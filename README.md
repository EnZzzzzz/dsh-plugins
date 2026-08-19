# dsh-plugins（已归档）

> **本仓库已于 2026-08-19 拆分归档。** 3 个插件已迁移到各自的独立仓库，后续开发请前往对应仓库：
>
> - [`dsh-weixin-bridge`](https://github.com/EnZzzzzz/dsh-weixin-bridge) —— 把 Harness agent 接到微信 ClawBot 通道的双面插件（host 半区 + Settings 页面）
> - [`dsh-mcp-admin`](https://github.com/EnZzzzzz/dsh-mcp-admin) —— 把 skill / Agent 预设管理暴露为 MCP server 的双面插件（bearer token 认证的 `/mcp` 端点 + Settings「MCP 管理」修改记录看板）
> - [`dsh-builtin-browser`](https://github.com/EnZzzzzz/dsh-builtin-browser) —— 内置浏览器插件
>
> 本仓库保留 `docs/` 下的设计文档与拆分前的完整 git 历史，仅供查阅。

个人维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集合。

DSH 的插件体系基于 Cordis：一个插件是一个 dsh bundle（`package.json` 声明 `dsh.bundle`），由 `cordis.patch.yml` 注入到 profile 的组合树中，可以同时包含 host 半区（Node 侧逻辑）和浏览器半区（Web UI，通过客户端槽位注册页面）。

## 目录结构

| 路径 | 说明 |
|---|---|
| `docs/` | 各插件的设计文档（拆分前） |
| `clash-verge-nodes.yaml` | 其他用途的配置备份，与插件无关 |

## DeepSeek Harness 官方仓库

**仓库地址：<https://github.com/deepseek-ai/deepseek-harness>**

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
```

官方仓库本身就是学习插件创建方法的最佳教材。建议按以下顺序阅读：

1. **扩展烹饪书** —— 插件开发的入门总纲，从零讲清楚扩展点与双面插件结构：
   - [`docs/extension-cookbook.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/extension-cookbook.md) / [`中文版`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/extension-cookbook.zh.md)
2. **Cordis 入门** —— 插件运行时的底层框架（依赖注入、生命周期、patch 机制）：
   - [`docs/cordis-primer.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-primer.md) / [`中文版`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-primer.zh.md)
3. **分步教程**（`docs/cookbook/`，均有中文版）：
   - [`adding-a-package.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-a-package.md) —— 新增一个包（插件骨架）
   - [`adding-a-tool.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-a-tool.md) —— 新增一个 agent 工具
   - [`adding-an-llm-adapter.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-an-llm-adapter.md) —— 新增 LLM 适配器
4. **官方示例插件**（`examples/`，如 `acp-agent`、`headless-agent`、`jsonrpc-agent`、`mcp-memory`、`web-cordis`、`web-schedule`），以及 [`packages/extensions/`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/extensions) 下的扩展包源码 —— 直接照抄结构最快。
5. **开发文档**：[`docs/development.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/development.md) / [`中文版`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/development.zh.md)，仓库根目录的 [`README.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/README.zh.md) 有整体架构介绍。

## 社区资源

- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) —— DSH 插件精选列表
- [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) —— DSH 生态整理（插件、工具、基础设施）

## 安装插件

```sh
# 以 dsh-weixin-bridge 为例（详见各仓库 README）
dsh plugin --profile web add /path/to/dsh-weixin-bridge
```
