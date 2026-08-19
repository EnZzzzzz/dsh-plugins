# AGENTS.md

> **本仓库已归档。** 插件已拆分至独立仓库：[dsh-weixin-bridge](https://github.com/EnZzzzzz/dsh-weixin-bridge)、[dsh-mcp-admin](https://github.com/EnZzzzzz/dsh-mcp-admin)、[dsh-builtin-browser](https://github.com/EnZzzzzz/dsh-builtin-browser)。插件开发请前往对应仓库，本仓库仅供查阅。

本仓库原是个人维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集合，总体介绍见 [README.md](README.md)。

## 官方源码缓存（`.cache/deepseek-harness`）

写插件时，**官方源码是最重要的依据**：插件的扩展点、双面插件结构（host 半区 + 浏览器半区）、`cordis.patch.yml` 的注入方式，都应以官方仓库的文档与示例为准，而不是凭记忆。

官方源码克隆在本仓库的 `.cache/deepseek-harness`（浅克隆，已被 `.gitignore` 忽略，不会提交）。

**初次克隆本仓库后（或任何时候发现源码不在），先检查并补齐：**

```sh
if [ ! -d .cache/deepseek-harness ]; then
  git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git .cache/deepseek-harness
fi
```

开始任何插件开发/修改任务前，agent 应先确认该目录存在；不存在就执行上面的命令克隆。

需要更新到最新官方代码时：

```sh
git -C .cache/deepseek-harness pull --ff-only
```

### 写插件时优先查阅的内容

- 入门总纲：`docs/cookbook/extension-cookbook.md`（及 `.zh.md` 中文版）
- 运行时框架：`docs/cordis-primer.md`（及 `.zh.md`）
- 分步教程：`docs/cookbook/`（新增包 / 工具 / LLM 适配器等）
- 可直接照抄结构的示例：`examples/`（如 `acp-agent`、`mcp-memory`、`web-cordis`）与 `packages/extensions/`
- 整体架构：`README.zh.md`、`docs/development.md`

## 仓库结构

- `docs/`：各插件的设计文档（拆分前）
- 插件已拆分至独立仓库（见顶部归档说明）
