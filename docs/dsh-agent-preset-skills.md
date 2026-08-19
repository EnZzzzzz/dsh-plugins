# dsh Agent Preset 与 Skill 集合配置

调研日期：2026-08-19
源码路径：`/Volumes/DataDrive/proj/public/deepseek-harness`

## 结论

dsh 的 skill **不是全通用的**。skill registry 本体在 host 组合里只有一个，但内部按 scope 分层（global 层 + 每个 agent preset 一层）。preset 里挂载的 `skill-filesystem` provider 会注册进该 preset 自己的层，只有该 preset 的 agent 能看到它发现的 skill。因此可以给某个 preset 指定独有的 skill 集。

## 分层模型

- registry 本体只在 host 组合挂载一次：`packages/bundle/base/cordis.patch.yml:237`
- 内部用 `ScopedLayers<SkillLayer>` 存层：`packages/skill/skill/src/index.ts:363`
- 注册落哪层由调用上下文的 scope 决定（`registerProvider()` / `register()`，`skill/src/index.ts:391-461`）：
  - 无 scope（host 行、仓库插件）→ global 层
  - preset standing mount → 该 preset 的层
- 每个 agent 通过 `bindScopeParent(agentKey, standingKey)` 加入 preset 的 scope 链：`packages/preset/agent-presets/src/index.ts:286`
- 读取时合并（`collectFresh()`，`skill/src/index.ts:552-566`）：先 global 层，再沿 scope 链从远祖到精确 scope，**同名者近层无条件覆盖远层**（不看 rank）

## 如何给 preset 配独有 skill 集

在 preset 的 `agent.cordis.yml`（如 `~/.dsh/.agent-presets/<name>/agent.cordis.yml`）中配置 `skill-filesystem`：

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false      # 关掉 project/user 默认根
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

`baseUrl` 是 preset 自己的目录，所以 `skills/` 随 preset 走。内置参考例子：`apps/cli/config/agent-presets/cordis/agent.cordis.yml:255-259`。

### `skill-filesystem` Config 字段

定义于 `packages/skill/skill-filesystem/src/index.ts:49-89`：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `providerName` | `filesystem` | 同层内唯一 |
| `includeDefaultRoots` | `true` | 是否扫描 project/user 默认根 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 用户级根之一 |
| `agentsHome` | `$DSH_AGENTS_HOME` 或 `~/.agents` | 用户级根之一 |
| `customSkillDirs` | `[]` | 额外根，rank 300 |
| `bundledSkillDir` | `$DSH_BUNDLED_SKILL_DIR` | 内置根，rank 600 |
| `watch*` | — | chokidar 热更新监控相关 |

没有 `roots`/`paths` 字段名，对应物是 `customSkillDirs`。另外 preset 里的插件也可以通过 `ctx.skills.register()` 直接注册 runtime skill，同样落在 preset 层。

### Skill 文件格式

- 目录包：`<root>/<name>/SKILL.md`
- 平铺文件：`<root>/<name>.md`
- YAML frontmatter 必填 `name` + `description`，可选 `whenToUse`、`disable-model-invocation`、`user-invocable`、`metadata`
- 解析逻辑：`skill-filesystem/src/index.ts:793-835`

## 默认根与合并规则

默认根（`roots()`，`skill-filesystem/src/index.ts:241-261`）与 rank：

| rank | 来源 |
|---|---|
| 100 | project `<git-root>/.dsh/skills` |
| 200 | project `<git-root>/.agents/skills` |
| 250 | runtime（`ctx.skills.register()`） |
| 300 | `customSkillDirs` |
| 400 | user `~/.dsh/skills`（跳过 `.system` 子目录） |
| 500 | user `~/.agents/skills` |
| 600 | bundled |

合并优先级：

- **跨层（layer > rank）**：合并顺序 global → 最远祖先 → … → 精确 scope；同名时近层（preset）无条件覆盖远层（global）
- **层内（rank → provider 注册顺序 → provider 内顺序）**：同名第一个赢，后续跳过并 warn（`collectLayer`，`skill/src/index.ts:568-583`）

即同层内 project > runtime > custom > user > bundled。

## 部署形态注意

- `web-app` bundle 把 host 的 `skill-filesystem` 行 **disabled**（`packages/bundle/web-app/cordis.patch.yml:330-331`），改由每个 preset 自己挂（如 `standard/agent.cordis.yml:83-87`）。所以用户级 skill（`~/.dsh/skills`）是由各 preset 层的 provider 分别发现的
- 若 base bundle 的 host 行启用，则进 global 层，对所有 agent 可见

## 屏蔽/过滤全局 skill 的手段

没有"按名字排除"的机制。只有三种：

1. 不挂 `skill-filesystem` / `tool-skill` —— 该 preset 的 agent 完全没有 skill 能力
2. `includeDefaultRoots: false` —— 本 preset 的 provider 只扫 `customSkillDirs`；在 web 部署（host 行已禁用）下等价于"preset 独占 skill 集"。但若 host 有全局 provider，其条目仍经 global 层合并进来
3. 同名遮蔽 —— 在 preset 层注册同名 skill，近层覆盖全局层

## 缓存与热更新

- `snapshot()`/`list()`/`get()` 按 `(cwd, scope 链, revision)` 缓存（`skill/src/index.ts:520-550`）
- 任何注册/注销或 provider `invalidate()`（chokidar watcher 触发）会 bump revision 并广播 `skills/change` 事件；`tool-skill` 在每个 step 前重建会话 catalog（`packages/skill/tool-skill/src/index.ts:133,222`）

## 对本仓库 design preset 的建议

当前 `~/.dsh/.agent-presets/design/agent.cordis.yml` 的 `skill-filesystem` 用默认配置，design agent 会看到 project + `~/.dsh/skills` + `~/.agents/skills` 全部 skill。如需专用 skill 集：

1. 在 `~/.dsh/.agent-presets/design/skills/` 放专用 skill
2. 按上文写法配置 `includeDefaultRoots: false` + `customSkillDirs`（用 `baseUrl` 相对路径）
