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
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
/** Fixed API base URL for every QR-code request (mirrors the SDK). */
const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';
/** Client-side timeout for the `get_bot_qrcode` request. */
const GET_QRCODE_TIMEOUT_MS = 5_000;
/** Client-side timeout for the long-poll `get_qrcode_status` request. */
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
/** Max automatic QR refreshes after `expired` before the flow gives up. */
const MAX_QR_REFRESH_COUNT = 3;
/**
 * Minimum wall time between status polls. The server may answer `wait`
 * instantly (or a transport error may short-circuit), and without this floor
 * the loop would hot-spin the WeChat API and starve the host event loop.
 */
const MIN_POLL_INTERVAL_MS = 1_000;
/** Normalize a raw account id to the filesystem-safe form the SDK uses. */
export function normalizeAccountId(raw) {
    return raw.trim().toLowerCase().replace(/[@.]/g, '-');
}
/** Resolve the OpenClaw state directory (mirrors the SDK). */
function resolveStateDir() {
    return process.env.OPENCLAW_STATE_DIR?.trim()
        || process.env.CLAWDBOT_STATE_DIR?.trim()
        || path.join(homedir(), '.openclaw');
}
/** Account ids registered by previous QR logins (the SDK's account index). */
export function listWeixinAccountIds() {
    const indexPath = path.join(resolveStateDir(), 'openclaw-weixin', 'accounts.json');
    try {
        if (!existsSync(indexPath))
            return [];
        const parsed = JSON.parse(readFileSync(indexPath, 'utf-8'));
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((id) => typeof id === 'string' && id.trim() !== '');
    }
    catch {
        return [];
    }
}
/** Persist a confirmed account exactly as the SDK's `saveWeixinAccount` does. */
function persistAccount(accountId, token, baseUrl, userId) {
    const weixinDir = path.join(resolveStateDir(), 'openclaw-weixin');
    const accountsDir = path.join(weixinDir, 'accounts');
    mkdirSync(accountsDir, { recursive: true });
    const data = { token, savedAt: new Date().toISOString() };
    if (baseUrl.length > 0)
        data.baseUrl = baseUrl;
    if (userId.length > 0)
        data.userId = userId;
    const filePath = path.join(accountsDir, `${accountId}.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    try {
        chmodSync(filePath, 0o600);
    }
    catch {
        // Best effort; a restrictive umask already covers most cases.
    }
    // The SDK registers the account as the sole entry of the index.
    writeFileSync(path.join(weixinDir, 'accounts.json'), JSON.stringify([accountId], null, 2), 'utf-8');
}
/**
 * Remove every persisted WeChat account credential, mirroring the SDK's
 * `clearAllWeixinAccounts`: delete each indexed account file and reset the
 * index to empty. After this, `isLoggedIn()` reports false and the next login
 * starts a fresh QR flow.
 */
export function clearWeixinAccounts() {
    const weixinDir = path.join(resolveStateDir(), 'openclaw-weixin');
    const accountsDir = path.join(weixinDir, 'accounts');
    for (const accountId of listWeixinAccountIds()) {
        try {
            rmSync(path.join(accountsDir, `${accountId}.json`), { force: true });
        }
        catch {
            // Best effort; the index reset below still leaves a consistent state.
        }
    }
    try {
        writeFileSync(path.join(weixinDir, 'accounts.json'), '[]', 'utf-8');
    }
    catch {
        // Best effort: a missing index is treated as "no accounts" everywhere.
    }
}
/**
 * Drives the QR-code login flow and keeps a JSON-safe status snapshot that the
 * RPC channel serves to the browser. One flow runs at a time; `start()` and
 * `stop()` are safe to call repeatedly.
 */
export class WeixinLoginManager {
    phase = 'idle';
    qrUrl;
    scanned = false;
    message;
    accountId;
    /** Cancels the in-flight flow; replaced on every start. */
    abort;
    /** Monotonic generation: a stale async flow never writes status. */
    generation = 0;
    onConnected;
    onDisconnected;
    constructor(options = {}) {
        this.onConnected = options.onConnected;
        this.onDisconnected = options.onDisconnected;
    }
    /** A JSON-safe snapshot of the current login state. */
    status() {
        return {
            phase: this.phase,
            ...this.qrUrl === undefined ? {} : { qrUrl: this.qrUrl },
            ...this.scanned ? { scanned: true } : {},
            ...this.message === undefined ? {} : { message: this.message },
            ...this.accountId === undefined ? {} : { accountId: this.accountId },
        };
    }
    /**
     * Begin (or restart) the QR login flow: fetches a fresh QR code, then
     * long-polls its status in the background until confirmed, expired past the
     * refresh budget, or cancelled. Returns immediately with the current status.
     */
    async start() {
        if (this.phase === 'connected') {
            return this.status();
        }
        this.abort?.abort();
        const abort = new AbortController();
        this.abort = abort;
        const generation = ++this.generation;
        this.phase = 'waiting';
        this.scanned = false;
        this.qrUrl = undefined;
        this.message = '正在获取二维码…';
        void this.runFlow(generation, abort);
        return this.status();
    }
    /** Cancel any in-flight login and return to the idle state. */
    stop() {
        this.abort?.abort();
        this.abort = undefined;
        this.generation += 1;
        if (this.phase === 'waiting') {
            this.phase = 'idle';
            this.qrUrl = undefined;
            this.scanned = false;
            this.message = undefined;
        }
    }
    /** Mark the bridge connected with an already-persisted account. */
    markConnected(accountId) {
        this.abort?.abort();
        this.abort = undefined;
        this.generation += 1;
        this.phase = 'connected';
        this.accountId = accountId ?? listWeixinAccountIds()[0];
        this.scanned = false;
        this.message = '已连接微信';
        this.qrUrl = undefined;
    }
    /**
     * Log out: cancel any in-flight flow, clear every persisted credential, and
     * return to the idle state so a fresh QR login can bind another account.
     * Fires `onDisconnected` so the host can stop the running monitor.
     */
    async logout() {
        this.abort?.abort();
        this.abort = undefined;
        this.generation += 1;
        clearWeixinAccounts();
        this.phase = 'idle';
        this.qrUrl = undefined;
        this.scanned = false;
        this.accountId = undefined;
        this.message = '已退出登录，可重新扫码绑定';
        await this.onDisconnected?.();
        return this.status();
    }
    /** The QR-code background flow; owns all status writes for one generation. */
    async runFlow(generation, abort) {
        const alive = () => generation === this.generation && !abort.signal.aborted;
        try {
            const first = await fetchQrCode(abort.signal);
            if (!alive())
                return;
            this.qrUrl = first.qrUrl;
            this.message = '请用手机微信扫描二维码';
            let qrcode = first.qrcode;
            let baseUrl = FIXED_BASE_URL;
            let refreshes = 0;
            while (alive()) {
                const pollStart = Date.now();
                const status = await pollQrStatus(baseUrl, qrcode, abort.signal);
                if (!alive())
                    return;
                const elapsed = Date.now() - pollStart;
                if (elapsed < MIN_POLL_INTERVAL_MS) {
                    await sleep(MIN_POLL_INTERVAL_MS - elapsed, abort.signal);
                    if (!alive())
                        return;
                }
                switch (status.status) {
                    case 'wait':
                        break;
                    case 'scaned':
                        if (!this.scanned) {
                            this.scanned = true;
                            this.message = '已扫码，请在手机上确认登录';
                        }
                        break;
                    case 'scaned_but_redirect':
                        if (typeof status.redirect_host === 'string' && status.redirect_host.length > 0) {
                            baseUrl = `https://${status.redirect_host}`;
                        }
                        break;
                    case 'expired': {
                        refreshes += 1;
                        if (refreshes > MAX_QR_REFRESH_COUNT) {
                            this.fail(generation, '二维码多次过期，请点击「刷新二维码」重试');
                            return;
                        }
                        try {
                            const next = await fetchQrCode(abort.signal);
                            if (!alive())
                                return;
                            qrcode = next.qrcode;
                            this.qrUrl = next.qrUrl;
                            this.scanned = false;
                            this.message = '二维码已刷新，请重新扫描';
                        }
                        catch (error) {
                            this.fail(generation, `刷新二维码失败：${messageOf(error)}`);
                            return;
                        }
                        break;
                    }
                    case 'confirmed': {
                        const { bot_token, ilink_bot_id, baseurl, ilink_user_id } = status;
                        if (typeof ilink_bot_id !== 'string' || ilink_bot_id.length === 0
                            || typeof bot_token !== 'string' || bot_token.length === 0) {
                            this.fail(generation, '登录确认缺少账号信息，请重试');
                            return;
                        }
                        const accountId = normalizeAccountId(ilink_bot_id);
                        persistAccount(accountId, bot_token, typeof baseurl === 'string' ? baseurl : '', typeof ilink_user_id === 'string' ? ilink_user_id : '');
                        this.phase = 'connected';
                        this.accountId = accountId;
                        this.scanned = false;
                        this.message = '已连接微信';
                        await this.onConnected?.(accountId);
                        return;
                    }
                    default:
                        // Unknown statuses are ignored; the SDK keeps polling.
                        break;
                }
            }
        }
        catch (error) {
            if (!alive())
                return;
            this.fail(generation, `登录失败：${messageOf(error)}`);
        }
    }
    /** Record a terminal failure for the current generation only. */
    fail(generation, message) {
        if (generation !== this.generation)
            return;
        this.phase = 'error';
        this.message = message;
        this.qrUrl = undefined;
        this.scanned = false;
    }
}
/** Fetch a fresh QR code from the WeChat login API. */
async function fetchQrCode(signal) {
    const controller = new AbortController();
    const onAbort = () => { controller.abort(); };
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), GET_QRCODE_TIMEOUT_MS);
    try {
        const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=3`, FIXED_BASE_URL);
        const response = await fetch(url.toString(), {
            method: 'GET',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`get_bot_qrcode ${response.status}: ${await response.text()}`);
        }
        const data = await response.json();
        const qrcode = data?.qrcode;
        const qrUrl = data?.qrcode_img_content;
        if (typeof qrcode !== 'string' || qrcode.length === 0
            || typeof qrUrl !== 'string' || qrUrl.length === 0) {
            throw new Error('get_bot_qrcode returned no usable QR payload');
        }
        return { qrcode, qrUrl };
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}
/**
 * Long-poll the QR status. A client-side timeout or transport failure returns
 * `{ status: 'wait' }` so the caller keeps polling; only the flow's own
 * cancellation propagates as an abort.
 */
async function pollQrStatus(baseUrl, qrcode, signal) {
    const controller = new AbortController();
    const onAbort = () => { controller.abort(); };
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
    try {
        const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, baseUrl);
        const response = await fetch(url.toString(), {
            method: 'GET',
            signal: controller.signal,
        });
        if (!response.ok)
            return { status: 'wait' };
        const data = await response.json();
        return typeof data === 'object' && data !== null ? data : {};
    }
    catch (error) {
        if (signal.aborted)
            throw error;
        return { status: 'wait' };
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}
/** Render an unknown thrown value as a message string. */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Abort-aware sleep used to pace status polls. */
function sleep(ms, signal) {
    if (signal?.aborted)
        return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}
