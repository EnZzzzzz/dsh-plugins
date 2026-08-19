/**
 * MCP 管理 settings page — the browser half of dsh-mcp-admin. It renders the
 * audit trail of skill/preset mutations performed through the plugin's MCP
 * endpoint, polled over the dedicated `/mcp-admin` RPC channel
 * (`connection.rpc.call`). Read-only by design: edits happen through MCP
 * tools, this page only shows what changed, when, and a content preview.
 *
 * @module dsh-mcp-admin/client/board
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

/** Owner props the settings shell supplies, plus the injected wire face. */
export interface McpAdminSectionProps {
  /** Close the settings panel. */
  close: () => void
  /** The browser wire client, injected by the plugin (see client/index.ts). */
  connection: ConnectionHandle
}

/** One audit record as served by the host over `/mcp-admin/audit.list`. */
interface AuditRecord {
  ts: string
  tool: string
  kind: 'skill' | 'preset'
  name: string
  action: 'upsert' | 'delete'
  bytes: number
  excerpt: string
}

/** Poll cadence while the page is mounted (the audit read is cheap). */
const POLL_INTERVAL_MS = 5_000

/**
 * Build the paste-ready MCP setup brief for another agent. The base URL is
 * the configured `publicUrl` when set (a NAT host cannot discover its own
 * public IP), otherwise the address this page was opened with — the pasted
 * config reaches the server the same way the user just did.
 */
function buildSetupBrief(baseUrl: string, token: string): string {
  const url = `${baseUrl}/mcp`
  return `# 配置远程 DeepSeek Harness 管理端点（dsh-mcp-admin）

把下面这个 MCP server 加进你的客户端配置（Streamable HTTP 类型），然后重启或重连 MCP：

\`\`\`json
{
  "mcpServers": {
    "dsh-admin": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
\`\`\`

如果你的客户端用别的配置格式，要素只有两个：
- URL：${url}
- 请求头：Authorization: Bearer ${token}

## 配置成功后你可以做什么

这是远程服务器上 DeepSeek Harness 的管理端点，提供 8 个工具：

- \`skill_list\` / \`skill_read\` / \`skill_upsert\` / \`skill_delete\` — 管理 skill（user root：~/.dsh/skills，写完即时热生效）
- \`preset_list\` / \`preset_read\` / \`preset_upsert\` / \`preset_delete\` — 管理 Agent 预设（改动对新建 session 生效；覆盖内置 preset 时先传 base 参数复制再改）

典型流程：用 skill_read / preset_read 评审当前配置 → 修改后 upsert → 开新 session 验证效果。
`
}

/** The settings page component; only exported for the plugin entry. */
export function McpAdminSection({ connection }: McpAdminSectionProps): ReactNode {
  const [records, setRecords] = useState<AuditRecord[]>([])
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  /** Setup brief rendered for manual copy when the clipboard API is unavailable (http:// pages). */
  const [manualCopy, setManualCopy] = useState<string>()
  const [setupError, setSetupError] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await connection.rpc.call('/mcp-admin', 'audit.list', {})
      if (result.ok) {
        setRecords(result.value as AuditRecord[])
        setError(undefined)
      } else {
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [connection])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const copySetup = useCallback(async (): Promise<void> => {
    setCopied(false)
    setManualCopy(undefined)
    setSetupError(undefined)
    try {
      const result = await connection.rpc.call('/mcp-admin', 'setup-info', {})
      if (!result.ok) {
        setSetupError(
          result.error.message.includes('unknown endpoint')
            ? '服务器上的插件版本过旧：请在服务器上 git pull 并重启 dsh web'
            : result.error.message,
        )
        return
      }
      const info = result.value as { token: string; publicUrl: string | null }
      const brief = buildSetupBrief(info.publicUrl ?? window.location.origin, info.token)
      try {
        // Clipboard API requires a secure context; http://<ip> pages fall back
        // to rendering the brief for manual selection.
        await navigator.clipboard.writeText(brief)
        setCopied(true)
      } catch {
        setManualCopy(brief)
      }
    } catch (cause) {
      setSetupError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [connection])

  return (
    <div style={{ padding: '0 4px' }}>
      <h2 style={{ margin: '0 0 12px' }}>MCP 管理</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--dsw-text-secondary, #888)' }}>
        通过 MCP 端点对 skill 与 Agent 预设的远程修改记录（最新在前，每 5 秒刷新）。
      </p>
      <div style={{ margin: '0 0 16px' }}>
        <button
          onClick={() => void copySetup()}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: '1px solid var(--dsw-border, #ddd)',
            background: 'var(--dsw-accent-soft, #e8f0fe)',
            cursor: 'pointer',
          }}
        >
          复制 MCP 配置说明
        </button>
        {copied && (
          <span style={{ marginLeft: '10px', color: 'var(--dsw-success, #18794e)' }}>
            已复制，直接粘贴给要配置的 Agent 即可
          </span>
        )}
        {setupError !== undefined && (
          <span style={{ marginLeft: '10px', color: 'var(--dsw-error, #c00)' }}>{setupError}</span>
        )}
      </div>
      {manualCopy !== undefined && (
        <div style={{ margin: '0 0 16px' }}>
          <p style={{ margin: '0 0 6px', color: 'var(--dsw-text-secondary, #888)' }}>
            当前页面不是安全上下文（http），浏览器禁止自动复制。请全选下面文本手动复制：
          </p>
          <textarea
            readOnly
            value={manualCopy}
            onFocus={(event) => event.target.select()}
            style={{
              width: '100%',
              height: '260px',
              boxSizing: 'border-box',
              fontSize: '12px',
              fontFamily: 'monospace',
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-border, #ddd)',
            }}
          />
        </div>
      )}
      {error !== undefined && (
        <p style={{ color: 'var(--dsw-error, #c00)' }}>读取失败：{error}</p>
      )}
      {error === undefined && records.length === 0 && (
        <p style={{ color: 'var(--dsw-text-secondary, #888)' }}>暂无修改记录。</p>
      )}
      {records.map((record, index) => (
        <div
          key={`${record.ts}-${index}`}
          style={{
            padding: '10px 0',
            borderBottom: '1px solid var(--dsw-border, #eee)',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--dsw-text-secondary, #888)', fontSize: '12px' }}>
              {new Date(record.ts).toLocaleString()}
            </span>
            <span
              style={{
                fontSize: '12px',
                padding: '1px 6px',
                borderRadius: '4px',
                background: record.kind === 'skill' ? 'var(--dsw-accent-soft, #e8f0fe)' : 'var(--dsw-warn-soft, #fef3e0)',
              }}
            >
              {record.kind === 'skill' ? 'Skill' : 'Preset'}
            </span>
            <strong>{record.name}</strong>
            <span style={{ color: record.action === 'delete' ? 'var(--dsw-error, #c00)' : 'inherit' }}>
              {record.action === 'delete' ? '删除' : '写入'}
            </span>
            {record.action === 'upsert' && (
              <span style={{ color: 'var(--dsw-text-secondary, #888)', fontSize: '12px' }}>
                {record.bytes} B
              </span>
            )}
            <span style={{ color: 'var(--dsw-text-secondary, #888)', fontSize: '12px' }}>
              {record.tool}
            </span>
          </div>
          {record.excerpt.length > 0 && (
            <pre
              style={{
                margin: '6px 0 0',
                padding: '8px',
                fontSize: '12px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: 'var(--dsw-surface-secondary, #f6f6f6)',
                borderRadius: '6px',
                maxHeight: '120px',
                overflow: 'hidden',
              }}
            >
              {record.excerpt}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
