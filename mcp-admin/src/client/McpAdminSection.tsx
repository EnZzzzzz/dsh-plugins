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

/** The settings page component; only exported for the plugin entry. */
export function McpAdminSection({ connection }: McpAdminSectionProps): ReactNode {
  const [records, setRecords] = useState<AuditRecord[]>([])
  const [error, setError] = useState<string>()

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

  return (
    <div style={{ padding: '0 4px' }}>
      <h2 style={{ margin: '0 0 12px' }}>MCP 管理</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--dsw-text-secondary, #888)' }}>
        通过 MCP 端点对 skill 与 Agent 预设的远程修改记录（最新在前，每 5 秒刷新）。
      </p>
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
