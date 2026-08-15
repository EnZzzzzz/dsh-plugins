/**
 * Social Channels settings page — the browser half's main surface. Unlike the
 * static v1 orientation page, it drives the host's WeChat QR login over the
 * dedicated `/weixin-bridge` RPC channel (`connection.rpc.call`): it shows the
 * live QR code, polls status while mounted, and offers start / refresh /
 * cancel actions. No terminal needed.
 *
 * @module dsh-weixin-bridge/client
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import qrcode from 'qrcode-generator'

/** Owner props the settings shell supplies, plus the injected wire face. */
export interface SocialChannelsSectionProps {
  /** Close the settings panel. */
  close: () => void
  /** The browser wire client, injected by the plugin (see client/index.ts). */
  connection: ConnectionHandle
}

/** JSON-safe login snapshot served by the host over `/weixin-bridge/status`. */
interface LoginStatus {
  phase: 'idle' | 'waiting' | 'connected' | 'error'
  qrUrl?: string
  scanned?: boolean
  message?: string
  accountId?: string
}

/** Poll cadence while the page is mounted (status is cheap to re-read). */
const POLL_INTERVAL_MS = 1_500

/** Render one login URL as an SVG QR code (no canvas, no network). */
function QrCode({ url, size }: { url: string; size: number }): ReactNode {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background: '#fff',
        borderRadius: '8px',
        padding: '10px',
        boxSizing: 'border-box',
      }}
      // The generated SVG is trusted, static content (module-local render).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** One information row: label plus rendered value or note. */
function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div style={{ display: 'flex', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--dsw-border, #eee)' }}>
      <div style={{ width: '120px', flexShrink: 0, color: 'var(--dsw-text-secondary, #888)' }}>{label}</div>
      <div>{children}</div>
    </div>
  )
}

/** Inline action button matching the settings shell's quiet chrome. */
function ActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-border, #d0d0d0)',
        background: 'var(--dsw-surface, #fff)',
        color: 'var(--dsw-text, #222)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  )
}

/**
 * Interactive WeChat connection page: live QR code + status, driven through
 * the `/weixin-bridge` RPC channel.
 */
export function SocialChannelsSection(props: SocialChannelsSectionProps): ReactNode {
  const { connection } = props
  const [status, setStatus] = useState<LoginStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [callError, setCallError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await connection.rpc.call('/weixin-bridge', 'status', {})
      if (result.ok) {
        setStatus(result.value as LoginStatus)
        setCallError(undefined)
      } else {
        setCallError(result.error.message)
      }
    } catch (error) {
      setCallError(error instanceof Error ? error.message : String(error))
    }
  }, [connection])

  // Load on mount and keep polling while the page is open, so a scan on the
  // phone flips the page to connected without any page reload.
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const startLogin = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await connection.rpc.call('/weixin-bridge', 'start-login', {})
      if (result.ok) {
        setStatus(result.value as LoginStatus)
        setCallError(undefined)
      } else {
        setCallError(result.error.message)
      }
    } catch (error) {
      setCallError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [connection])

  const cancelLogin = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await connection.rpc.call('/weixin-bridge', 'stop-login', {})
      if (result.ok) {
        setStatus(result.value as LoginStatus)
        setCallError(undefined)
      }
    } catch (error) {
      setCallError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [connection])

  const phase = status?.phase ?? 'idle'
  const message = status?.message
  return (
    <div style={{ padding: '0 4px' }}>
      <h2 style={{ margin: '0 0 12px' }}>社交渠道</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--dsw-text-secondary, #888)' }}>
        连接微信，让 Harness 的 agent 通过微信收发消息。扫码即可连接，无需终端。
      </p>

      {callError !== undefined && (
        <p style={{ margin: '0 0 12px', color: '#c0392b' }}>
          与主进程通信失败：{callError}
        </p>
      )}

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div style={{ flexShrink: 0 }}>
          {phase === 'waiting' && status?.qrUrl !== undefined
            ? <QrCode url={status.qrUrl} size={200} />
            : (
              <div
                style={{
                  width: '200px',
                  height: '200px',
                  border: '1px dashed var(--dsw-border, #d0d0d0)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--dsw-text-secondary, #888)',
                  fontSize: '13px',
                  padding: '8px',
                  textAlign: 'center',
                  boxSizing: 'border-box',
                }}
              >
                {phase === 'connected' ? '已连接 ✓' : phase === 'error' ? '连接失败' : '尚未开始登录'}
              </div>
            )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Row label="状态">
            {phase === 'waiting'
              ? (status?.scanned === true ? '已扫码，请在手机上确认登录' : '等待扫码…')
              : phase === 'connected'
                ? '已连接'
                : phase === 'error'
                  ? '失败'
                  : '未连接'}
          </Row>
          <Row label="说明">
            {message ?? '打开设置页后点击「开始连接」生成二维码。'}
          </Row>
          {status?.accountId !== undefined && <Row label="账号">{status.accountId}</Row>}
          <Row label="插件">dsh-weixin-bridge（host 桥接 + 浏览器页面）</Row>
          <Row label="消息类型">文本（图片/语音/视频/文件暂不转发内容，仅附说明）</Row>
          <Row label="会话模型">一个微信会话对应一个 Harness session，多轮对话保留历史</Row>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {phase === 'idle' && (
              <ActionButton onClick={() => { void startLogin() }} disabled={busy}>
                开始连接
              </ActionButton>
            )}
            {phase === 'waiting' && (
              <ActionButton onClick={() => { void startLogin() }} disabled={busy}>
                刷新二维码
              </ActionButton>
            )}
            {phase === 'error' && (
              <ActionButton onClick={() => { void startLogin() }} disabled={busy}>
                重试
              </ActionButton>
            )}
            {phase === 'waiting' && (
              <ActionButton onClick={() => { void cancelLogin() }} disabled={busy}>
                取消登录
              </ActionButton>
            )}
          </div>

          <p style={{ margin: '16px 0 0', color: 'var(--dsw-text-secondary, #888)', fontSize: '12px', lineHeight: 1.6 }}>
            提示：扫码连接使用个人微信号，存在账号风险，请自行评估。重启后会话映射会重建；主动发消息暂未实现。
          </p>
        </div>
      </div>
    </div>
  )
}
