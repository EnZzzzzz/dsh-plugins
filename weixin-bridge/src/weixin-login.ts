/**
 * WeChat QR-code login flow for the bridge, reimplemented from the
 * weixin-agent-sdk internals so the plugin can surface the QR code and live
 * status to the browser Settings page (the SDK's `login()` only prints the QR
 * to a terminal).
 *
 * This module owns the two API calls the SDK uses (`ilink/bot/get_bot_qrcode`
 * and `ilink/bot/get_qrcode_status`) and persists confirmed credentials in
 * the exact file layout the SDK's `start()` reads
 * (`~/.openclaw/openclaw-weixin/accounts/<id>.json` + `accounts.json`
 * index), so the SDK monitor picks the account up unchanged.
 *
 * @module dsh-weixin-bridge/weixin-login
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** Fixed API base URL for every QR-code request (mirrors the SDK). */
const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com'
/** Client-side timeout for the `get_bot_qrcode` request. */
const GET_QRCODE_TIMEOUT_MS = 5_000
/** Client-side timeout for the long-poll `get_qrcode_status` request. */
const QR_LONG_POLL_TIMEOUT_MS = 35_000
/** Max automatic QR refreshes after `expired` before the flow gives up. */
const MAX_QR_REFRESH_COUNT = 3
/**
 * Minimum wall time between status polls. The server may answer `wait`
 * instantly (or a transport error may short-circuit), and without this floor
 * the loop would hot-spin the WeChat API and starve the host event loop.
 */
const MIN_POLL_INTERVAL_MS = 1_000

/** One status response of the WeChat QR long poll. */
interface QrStatusResponse {
  status?: string
  redirect_host?: string
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
}

/** A freshly fetched QR code: its opaque id plus the scan payload URL. */
interface QrCode {
  qrcode: string
  qrUrl: string
}

/** Lifecycle phase of the bridge's WeChat login. */
export type WeixinLoginPhase = 'idle' | 'waiting' | 'connected' | 'error'

/** JSON-safe status snapshot served to the browser Settings page. */
export interface WeixinLoginStatus {
  phase: WeixinLoginPhase
  /** The login URL the user scans (rendered as a QR code client-side). */
  qrUrl?: string
  /** Whether the user has scanned the QR and must confirm on the phone. */
  scanned?: boolean
  /** Human-readable progress text. */
  message?: string
  /** Normalized account id once connected. */
  accountId?: string
}

/** Result of starting the login flow over the RPC channel. */
export type StartLoginResult = WeixinLoginStatus

/** Normalize a raw account id to the filesystem-safe form the SDK uses. */
export function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[@.]/g, '-')
}

/** Resolve the OpenClaw state directory (mirrors the SDK). */
function resolveStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim()
    || process.env.CLAWDBOT_STATE_DIR?.trim()
    || path.join(homedir(), '.openclaw')
}

/** Account ids registered by previous QR logins (the SDK's account index). */
export function listWeixinAccountIds(): string[] {
  const indexPath = path.join(resolveStateDir(), 'openclaw-weixin', 'accounts.json')
  try {
    if (!existsSync(indexPath)) return []
    const parsed: unknown = JSON.parse(readFileSync(indexPath, 'utf-8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  } catch {
    return []
  }
}

/** Persist a confirmed account exactly as the SDK's `saveWeixinAccount` does. */
function persistAccount(
  accountId: string,
  token: string,
  baseUrl: string,
  userId: string,
): void {
  const weixinDir = path.join(resolveStateDir(), 'openclaw-weixin')
  const accountsDir = path.join(weixinDir, 'accounts')
  mkdirSync(accountsDir, { recursive: true })
  const data: Record<string, string> = { token, savedAt: new Date().toISOString() }
  if (baseUrl.length > 0) data.baseUrl = baseUrl
  if (userId.length > 0) data.userId = userId
  const filePath = path.join(accountsDir, `${accountId}.json`)
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  try {
    chmodSync(filePath, 0o600)
  } catch {
    // Best effort; a restrictive umask already covers most cases.
  }
  // The SDK registers the account as the sole entry of the index.
  writeFileSync(path.join(weixinDir, 'accounts.json'), JSON.stringify([accountId], null, 2), 'utf-8')
}

/**
 * Remove every persisted WeChat account credential, mirroring the SDK's
 * `clearAllWeixinAccounts`: delete each indexed account file and reset the
 * index to empty. After this, `isLoggedIn()` reports false and the next login
 * starts a fresh QR flow.
 */
export function clearWeixinAccounts(): void {
  const weixinDir = path.join(resolveStateDir(), 'openclaw-weixin')
  const accountsDir = path.join(weixinDir, 'accounts')
  for (const accountId of listWeixinAccountIds()) {
    try {
      rmSync(path.join(accountsDir, `${accountId}.json`), { force: true })
    } catch {
      // Best effort; the index reset below still leaves a consistent state.
    }
  }
  try {
    writeFileSync(path.join(weixinDir, 'accounts.json'), '[]', 'utf-8')
  } catch {
    // Best effort: a missing index is treated as "no accounts" everywhere.
  }
}

/**
 * One account's monitor lock: which process owns the WeChat long-poll for the
 * account. Because the SDK's sync cursor is a single shared file per account
 * (`~/.openclaw/openclaw-weixin/accounts/<id>.sync.json`), running the
 * harness twice (e.g. a relaunched desktop app whose old sidecar survived)
 * makes every instance poll the SAME account with the SAME cursor — each
 * inbound message is then delivered to every instance and the user gets one
 * reply per instance. The lock keeps exactly one monitor per account.
 */
export interface MonitorLockState {
  pid: number
  startedAt: number
}

/** Path of the account monitor lock, next to the SDK's sync-buf file. */
function monitorLockPath(accountId: string): string {
  return path.join(resolveStateDir(), 'openclaw-weixin', 'accounts', `${accountId}.monitor.lock`)
}

/** True when `pid` belongs to a live process on this host. */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user: treat as
    // alive. Any other error (ESRCH …) means it is gone.
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/**
 * Claim the account's monitor lock for this process.
 * @param accountId - the SDK account id being monitored.
 * @returns the live pid of another process that already owns the lock, or
 *   `undefined` when this process may start the monitor (it either acquired
 *   the lock or a lock failure fell back to running).
 */
export function acquireMonitorLock(accountId: string): number | undefined {
  const filePath = monitorLockPath(accountId)
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    let holderPid: number | undefined
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const pid = (parsed as MonitorLockState).pid
        if (Number.isInteger(pid) && pid !== process.pid && isPidAlive(pid)) {
          holderPid = pid
        }
      }
    } catch {
      // Missing or unparsable lock file = free to take.
    }
    if (holderPid !== undefined) return holderPid
    writeFileSync(filePath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }, null, 2), 'utf-8')
    return undefined
  } catch {
    // A lock failure must never take the channel down: proceed without the
    // lock (duplicate replies may recur, but the channel keeps working).
    return undefined
  }
}

/** Release the account's monitor lock when this process owns it. */
export function releaseMonitorLock(accountId: string): void {
  const filePath = monitorLockPath(accountId)
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (typeof parsed === 'object' && parsed !== null
      && (parsed as MonitorLockState).pid === process.pid) {
      rmSync(filePath, { force: true })
    }
  } catch {
    // Nothing to release.
  }
}

/** Options accepted by {@link WeixinLoginManager}. */
export interface WeixinLoginManagerOptions {
  /** Invoked after a confirmed login (or an existing one) is persisted/ready. */
  onConnected?: (accountId: string) => void | Promise<void>
  /** Invoked after {@link WeixinLoginManager.logout} clears the credentials. */
  onDisconnected?: () => void | Promise<void>
}

/**
 * Drives the QR-code login flow and keeps a JSON-safe status snapshot that the
 * RPC channel serves to the browser. One flow runs at a time; `start()` and
 * `stop()` are safe to call repeatedly.
 */
export class WeixinLoginManager {
  private phase: WeixinLoginPhase = 'idle'
  private qrUrl: string | undefined
  private scanned = false
  private message: string | undefined
  private accountId: string | undefined
  /** Cancels the in-flight flow; replaced on every start. */
  private abort: AbortController | undefined
  /** Monotonic generation: a stale async flow never writes status. */
  private generation = 0
  private readonly onConnected?: (accountId: string) => void | Promise<void>
  private readonly onDisconnected?: () => void | Promise<void>

  constructor(options: WeixinLoginManagerOptions = {}) {
    this.onConnected = options.onConnected
    this.onDisconnected = options.onDisconnected
  }

  /** A JSON-safe snapshot of the current login state. */
  status(): WeixinLoginStatus {
    return {
      phase: this.phase,
      ...this.qrUrl === undefined ? {} : { qrUrl: this.qrUrl },
      ...this.scanned ? { scanned: true } : {},
      ...this.message === undefined ? {} : { message: this.message },
      ...this.accountId === undefined ? {} : { accountId: this.accountId },
    }
  }

  /**
   * Begin (or restart) the QR login flow: fetches a fresh QR code, then
   * long-polls its status in the background until confirmed, expired past the
   * refresh budget, or cancelled. Returns immediately with the current status.
   */
  async start(): Promise<StartLoginResult> {
    if (this.phase === 'connected') {
      return this.status()
    }
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    const generation = ++this.generation
    this.phase = 'waiting'
    this.scanned = false
    this.qrUrl = undefined
    this.message = '正在获取二维码…'
    void this.runFlow(generation, abort)
    return this.status()
  }

  /** Cancel any in-flight login and return to the idle state. */
  stop(): void {
    this.abort?.abort()
    this.abort = undefined
    this.generation += 1
    if (this.phase === 'waiting') {
      this.phase = 'idle'
      this.qrUrl = undefined
      this.scanned = false
      this.message = undefined
    }
  }

  /** Mark the bridge connected with an already-persisted account. */
  markConnected(accountId?: string): void {
    this.abort?.abort()
    this.abort = undefined
    this.generation += 1
    this.phase = 'connected'
    this.accountId = accountId ?? listWeixinAccountIds()[0]
    this.scanned = false
    this.message = '已连接微信'
    this.qrUrl = undefined
  }

  /**
   * Log out: cancel any in-flight flow, clear every persisted credential, and
   * return to the idle state so a fresh QR login can bind another account.
   * Fires `onDisconnected` so the host can stop the running monitor.
   */
  async logout(): Promise<WeixinLoginStatus> {
    this.abort?.abort()
    this.abort = undefined
    this.generation += 1
    clearWeixinAccounts()
    this.phase = 'idle'
    this.qrUrl = undefined
    this.scanned = false
    this.accountId = undefined
    this.message = '已退出登录，可重新扫码绑定'
    await this.onDisconnected?.()
    return this.status()
  }

  /** The QR-code background flow; owns all status writes for one generation. */
  private async runFlow(generation: number, abort: AbortController): Promise<void> {
    const alive = (): boolean => generation === this.generation && !abort.signal.aborted
    try {
      const first = await fetchQrCode(abort.signal)
      if (!alive()) return
      this.qrUrl = first.qrUrl
      this.message = '请用手机微信扫描二维码'
      let qrcode = first.qrcode
      let baseUrl = FIXED_BASE_URL
      let refreshes = 0
      while (alive()) {
        const pollStart = Date.now()
        const status = await pollQrStatus(baseUrl, qrcode, abort.signal)
        if (!alive()) return
        const elapsed = Date.now() - pollStart
        if (elapsed < MIN_POLL_INTERVAL_MS) {
          await sleep(MIN_POLL_INTERVAL_MS - elapsed, abort.signal)
          if (!alive()) return
        }
        switch (status.status) {
          case 'wait':
            break
          case 'scaned':
            if (!this.scanned) {
              this.scanned = true
              this.message = '已扫码，请在手机上确认登录'
            }
            break
          case 'scaned_but_redirect':
            if (typeof status.redirect_host === 'string' && status.redirect_host.length > 0) {
              baseUrl = `https://${status.redirect_host}`
            }
            break
          case 'expired': {
            refreshes += 1
            if (refreshes > MAX_QR_REFRESH_COUNT) {
              this.fail(generation, '二维码多次过期，请点击「刷新二维码」重试')
              return
            }
            try {
              const next = await fetchQrCode(abort.signal)
              if (!alive()) return
              qrcode = next.qrcode
              this.qrUrl = next.qrUrl
              this.scanned = false
              this.message = '二维码已刷新，请重新扫描'
            } catch (error) {
              this.fail(generation, `刷新二维码失败：${messageOf(error)}`)
              return
            }
            break
          }
          case 'confirmed': {
            const { bot_token, ilink_bot_id, baseurl, ilink_user_id } = status
            if (typeof ilink_bot_id !== 'string' || ilink_bot_id.length === 0
              || typeof bot_token !== 'string' || bot_token.length === 0) {
              this.fail(generation, '登录确认缺少账号信息，请重试')
              return
            }
            const accountId = normalizeAccountId(ilink_bot_id)
            persistAccount(
              accountId,
              bot_token,
              typeof baseurl === 'string' ? baseurl : '',
              typeof ilink_user_id === 'string' ? ilink_user_id : '',
            )
            this.phase = 'connected'
            this.accountId = accountId
            this.scanned = false
            this.message = '已连接微信'
            await this.onConnected?.(accountId)
            return
          }
          default:
            // Unknown statuses are ignored; the SDK keeps polling.
            break
        }
      }
    } catch (error) {
      if (!alive()) return
      this.fail(generation, `登录失败：${messageOf(error)}`)
    }
  }

  /** Record a terminal failure for the current generation only. */
  private fail(generation: number, message: string): void {
    if (generation !== this.generation) return
    this.phase = 'error'
    this.message = message
    this.qrUrl = undefined
    this.scanned = false
  }
}

/** Fetch a fresh QR code from the WeChat login API. */
async function fetchQrCode(signal: AbortSignal): Promise<QrCode> {
  const controller = new AbortController()
  const onAbort = (): void => { controller.abort() }
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), GET_QRCODE_TIMEOUT_MS)
  try {
    const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=3`, FIXED_BASE_URL)
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`get_bot_qrcode ${response.status}: ${await response.text()}`)
    }
    const data: unknown = await response.json()
    const qrcode = (data as { qrcode?: unknown })?.qrcode
    const qrUrl = (data as { qrcode_img_content?: unknown })?.qrcode_img_content
    if (typeof qrcode !== 'string' || qrcode.length === 0
      || typeof qrUrl !== 'string' || qrUrl.length === 0) {
      throw new Error('get_bot_qrcode returned no usable QR payload')
    }
    return { qrcode, qrUrl }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Long-poll the QR status. A client-side timeout or transport failure returns
 * `{ status: 'wait' }` so the caller keeps polling; only the flow's own
 * cancellation propagates as an abort.
 */
async function pollQrStatus(
  baseUrl: string,
  qrcode: string,
  signal: AbortSignal,
): Promise<QrStatusResponse> {
  const controller = new AbortController()
  const onAbort = (): void => { controller.abort() }
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS)
  try {
    const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, baseUrl)
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) return { status: 'wait' }
    const data: unknown = await response.json()
    return typeof data === 'object' && data !== null ? data as QrStatusResponse : {}
  } catch (error) {
    if (signal.aborted) throw error
    return { status: 'wait' }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** Render an unknown thrown value as a message string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Abort-aware sleep used to pace status polls. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
