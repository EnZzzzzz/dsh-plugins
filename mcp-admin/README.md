# dsh-mcp-admin

把 DeepSeek Harness 的 skill 与 Agent 预设管理暴露为 **MCP server** 的双面插件：远程 Agent 通过 MCP 协议直接修改服务器上的 skill / preset 配置，无需 SSH；host 半区记录审计日志，浏览器半区在 Settings 页提供「MCP 管理」看板展示最近的修改记录。

典型用途：在远程服务器上跑 `dsh web`，本地 Agent 连上 `http://<服务器>:3080/mcp`，形成「生产 → 评审 → 修改 → 再生产」的闭环。

## 架构

```
本地 Agent (MCP client)
   │  POST /mcp  (Authorization: Bearer <token>)
   ▼
dsh web (host 半区)
   ├── Streamable HTTP MCP server（stateless，每请求一个实例）
   │     ├── skill_list / skill_read / skill_upsert / skill_delete
   │     └── preset_list / preset_read / preset_upsert / preset_delete
   ├── 审计 JSONL：$DSH_HOME/mcp-admin/audit.jsonl
   └── RPC 通道 /mcp-admin（audit.list，trusted-host 围栏）
        ▲
浏览器 Settings「MCP 管理」看板（client 半区，5s 轮询）
```

- **skill 写入**：直接写 `$DSH_HOME/skills/<name>/SKILL.md`（目录 bundle；已有扁平 `<name>.md` 则原地覆盖保留形态）。harness 的 `skill-filesystem` provider watch 该目录，写完下一 agent step 即生效。
- **preset 写入**：写 `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`。覆盖 system trust 的 preset 必须先传 `base` 把它 copy 进 user root（防止无意中从零遮蔽内置 preset）。standing mount 的文件戳机制让改动对**新 session** 自动生效，无需重启；进行中的 session 不受影响。
- **审计**：每次写/删追加一条 JSONL（时间、工具、目标、动作、字节数、内容前 200 字符摘要），按 `auditLimit` 截断。

## 安装

```sh
dsh plugin --profile web add /path/to/dsh-plugins/mcp-admin
```

然后在 profile 的 `~/.dsh/profiles/web/cordis.patch.yml` 里配置 token（**必须**，否则插件拒绝启动）：

```yaml
- id: mcp-admin
  config:
    token: <openssl rand -hex 32 的输出>
    auditLimit: 200
```

## 配置

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `token` | string | （必填） | `/mcp` 端点的 bearer token，是唯一防线，务必长且随机 |
| `auditLimit` | number | 200 | 审计日志保留条数 |

## MCP client 配置示例

本地 Agent 的 MCP 配置（Streamable HTTP 类型）：

```json
{
  "mcpServers": {
    "dsh-admin": {
      "type": "http",
      "url": "http://<服务器>:3080/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

### 工具一览

| 工具 | 说明 |
|---|---|
| `skill_list` | 列出 user root 下的 skill（名称、描述、形态、路径） |
| `skill_read` | 读 SKILL.md 全文 + bundle 资源文件清单 |
| `skill_upsert` | 创建/覆盖 skill（校验 kebab-case 名与 frontmatter 的 `name`/`description`） |
| `skill_delete` | 删除 user root 下的 skill |
| `preset_list` | 列出全部 preset（含 trust 与 broken 标记） |
| `preset_read` | 读 preset 的 `agent.cordis.yml` 全文 |
| `preset_upsert` | 创建/覆盖 preset 组合；`base` 从现有 preset 复制；可选 `displayName`/`displayDescription` 写 `preset.yml`；写入后用 standing-mount 校验，加载失败会以 warning 返回 |
| `preset_delete` | 删除 user trust 的 preset（system 不可删） |

## 安全说明

- harness webserver 本身**无 TLS、无认证**；`/mcp` 在 `/api` 信任围栏之外，`token` 是唯一防线。泄露 token = 对方可以重写你的 skill 和 preset（间接远程代码执行）。
- 建议只在反代终结 TLS 后暴露，或配合 harness 的 `trusted-host` 机制限制来源。
- 所有写操作限定在 user root（`~/.dsh/skills`、`~/.dsh/.agent-presets`），不触碰内置 preset 与项目目录。
- 看板 RPC 通道（`/mcp-admin`）走 connection 的 `trusted-host` 围栏；审计记录不含 secret。

## 开发

```sh
pnpm install
pnpm run build        # host: tsc → lib/；client: tsdown → lib/client.js
pnpm run typecheck
```

client 半区的类型解析依赖本机 harness 源码树（`dsh-client-*` 未完整发布 npm），`tsconfig*.json` 里的 `paths` 硬编码指向 harness checkout；迁移机器时需要改这些路径。
