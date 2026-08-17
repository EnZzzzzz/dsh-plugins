/**
 * Social Channels settings page — the browser half's main surface. It drives
 * the host's WeChat QR login over the dedicated `/weixin-bridge` RPC channel
 * (`connection.rpc.call`): live QR code, status polling, and start / refresh /
 * cancel actions. It also reads and edits the bridge's config (provider,
 * model, cwd, maxTokens) through `get-config` / `set-config`, persisted by the
 * host into the settings document and applied to new sessions immediately.
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

/** The bridge config served over `/weixin-bridge/get-config`. */
interface BridgeConfig {
  provider: string
  model: string
  cwd: string
  maxTokens?: number
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

/** One labelled config input row. */
function ConfigField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
}): ReactNode {
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '6px 0' }}>
      <div style={{ width: '120px', flexShrink: 0, color: 'var(--dsw-text-secondary, #888)' }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={hint}
        style={{
          flex: 1,
          minWidth: 0,
          padding: '6px 10px',
          borderRadius: '6px',
          border: '1px solid var(--dsw-border, #d0d0d0)',
          background: 'var(--dsw-surface, #fff)',
          color: 'var(--dsw-text, #222)',
          font: 'inherit',
        }}
      />
    </div>
  )
}

/**
 * Interactive WeChat connection page: live QR code + status and editable
 * bridge config, driven through the `/weixin-bridge` RPC channel.
 */
export function SocialChannelsSection(props: SocialChannelsSectionProps): ReactNode {
  const { connection } = props
  const [status, setStatus] = useState<LoginStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [callError, setCallError] = useState<string | undefined>(undefined)

  // Config editing state.
  const [configInput, setConfigInput] = useState<BridgeConfig | undefined>(undefined)
  const [configError, setConfigError] = useState<string | undefined>(undefined)
  const [configSaved, setConfigSaved] = useState(false)

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

  const refreshConfig = useCallback(async (): Promise<void> => {
    try {
      const result = await connection.rpc.call('/weixin-bridge', 'get-config', {})
      if (result.ok) {
        setConfigInput(result.value as BridgeConfig)
        setConfigError(undefined)
      } else {
        setConfigError(result.error.message)
      }
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error))
    }
  }, [connection])

  // Load status + config on mount; keep polling status while the page is open
  // so a scan on the phone flips the page to connected without a reload.
  useEffect(() => {
    void refresh()
    void refreshConfig()
    const timer = setInterval(() => { void refresh() }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh, refreshConfig])

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

  /** Log out and clear credentials so a different WeChat account can be bound. */
  const logout = useCallback(async (): Promise<void> => {
    if (!window.confirm('退出登录将清除当前微信的登录凭证，之后需要重新扫码绑定另一个账号。确定退出吗？')) {
      return
    }
    setBusy(true)
    try {
      const result = await connection.rpc.call('/weixin-bridge', 'logout', {})
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

  /** Open the Host's native OS folder chooser and fill the cwd field. */
  const pickCwd = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const response = await connection.api.host.pickDirectory({})
      if (response.result.ok) {
        const picked = response.result.value.path
        if (picked !== null) {
          setConfigInput(prev => prev === undefined ? prev : { ...prev, cwd: picked })
          setConfigError(undefined)
        }
      } else {
        setConfigError(`选择目录失败：${response.result.error.message}`)
      }
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [connection])

  const saveConfig = useCallback(async (): Promise<void> => {
    if (configInput === undefined) return
    setBusy(true)
    setConfigSaved(false)
    try {
      const patch: Record<string, unknown> = {
        provider: configInput.provider.trim(),
        model: configInput.model.trim(),
        cwd: configInput.cwd.trim(),
      }
      const maxTokens = Number(configInput.maxTokens)
      if (Number.isInteger(maxTokens) && maxTokens > 0) patch.maxTokens = maxTokens
      const result = await connection.rpc.call('/weixin-bridge', 'set-config', { patch })
      if (result.ok) {
        setConfigInput(result.value as BridgeConfig)
        setConfigError(undefined)
        setConfigSaved(true)
      } else {
        setConfigError(result.error.message)
      }
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [connection, configInput])

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
            {phase === 'connected' && (
              <ActionButton onClick={() => { void logout() }} disabled={busy}>
                退出并重新绑定
              </ActionButton>
            )}
          </div>

          <p style={{ margin: '16px 0 0', color: 'var(--dsw-text-secondary, #888)', fontSize: '12px', lineHeight: 1.6 }}>
            提示：扫码连接使用个人微信号，存在账号风险，请自行评估。重启后会话映射会重建；主动发消息暂未实现。
          </p>
        </div>
      </div>

      <h3 style={{ margin: '20px 0 8px' }}>配置</h3>
      <p style={{ margin: '0 0 8px', color: 'var(--dsw-text-secondary, #888)', fontSize: '12px' }}>
        修改 provider / model / cwd / maxTokens。保存后持久化到设置文档，对<strong>新的微信会话</strong>立即生效（已在进行的会话不受影响）。
      </p>
      {configError !== undefined && (
        <p style={{ margin: '0 0 8px', color: '#c0392b' }}>配置读写失败：{configError}</p>
      )}
      {configInput === undefined
        ? <p style={{ color: 'var(--dsw-text-secondary, #888)' }}>加载配置中…</p>
        : (
          <div style={{ maxWidth: '480px' }}>
            <ConfigField
              label="provider"
              hint="模型路由，如 deepseek-official"
              value={configInput.provider}
              onChange={(provider) => setConfigInput(prev => prev === undefined ? prev : { ...prev, provider })}
            />
            <ConfigField
              label="model"
              hint="模型名，如 deepseek-v4-flash"
              value={configInput.model}
              onChange={(model) => setConfigInput(prev => prev === undefined ? prev : { ...prev, model })}
            />
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '6px 0' }}>
              <div style={{ width: '120px', flexShrink: 0, color: 'var(--dsw-text-secondary, #888)' }}>cwd</div>
              <input
                type="text"
                readOnly
                value={configInput.cwd}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--dsw-border, #d0d0d0)',
                  background: 'var(--dsw-surface, #fff)',
                  color: 'var(--dsw-text, #222)',
                  font: 'inherit',
                  opacity: 0.85,
                }}
              />
              <ActionButton onClick={() => { void pickCwd() }} disabled={busy}>
                选择目录…
              </ActionButton>
            </div>
            <ConfigField
              label="maxTokens"
              hint="留空使用默认"
              type="number"
              value={configInput.maxTokens === undefined ? '' : String(configInput.maxTokens)}
              onChange={(maxTokens) => setConfigInput(prev => prev === undefined
                ? prev
                : { ...prev, maxTokens: maxTokens.trim() === '' ? undefined : Number(maxTokens) })}
            />
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
              <ActionButton onClick={() => { void saveConfig() }} disabled={busy}>
                保存配置
              </ActionButton>
              {configSaved && <span style={{ color: '#2e7d32', fontSize: '13px' }}>已保存 ✓</span>}
            </div>
          </div>
        )}
    </div>
  )
}
