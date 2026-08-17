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
/** Lifecycle phase of the bridge's WeChat login. */
export type WeixinLoginPhase = 'idle' | 'waiting' | 'connected' | 'error';
/** JSON-safe status snapshot served to the browser Settings page. */
export interface WeixinLoginStatus {
    phase: WeixinLoginPhase;
    /** The login URL the user scans (rendered as a QR code client-side). */
    qrUrl?: string;
    /** Whether the user has scanned the QR and must confirm on the phone. */
    scanned?: boolean;
    /** Human-readable progress text. */
    message?: string;
    /** Normalized account id once connected. */
    accountId?: string;
}
/** Result of starting the login flow over the RPC channel. */
export type StartLoginResult = WeixinLoginStatus;
/** Normalize a raw account id to the filesystem-safe form the SDK uses. */
export declare function normalizeAccountId(raw: string): string;
/** Account ids registered by previous QR logins (the SDK's account index). */
export declare function listWeixinAccountIds(): string[];
/**
 * Remove every persisted WeChat account credential, mirroring the SDK's
 * `clearAllWeixinAccounts`: delete each indexed account file and reset the
 * index to empty. After this, `isLoggedIn()` reports false and the next login
 * starts a fresh QR flow.
 */
export declare function clearWeixinAccounts(): void;
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
    pid: number;
    startedAt: number;
}
/**
 * Claim the account's monitor lock for this process.
 * @param accountId - the SDK account id being monitored.
 * @returns the live pid of another process that already owns the lock, or
 *   `undefined` when this process may start the monitor (it either acquired
 *   the lock or a lock failure fell back to running).
 */
export declare function acquireMonitorLock(accountId: string): number | undefined;
/** Release the account's monitor lock when this process owns it. */
export declare function releaseMonitorLock(accountId: string): void;
/** Options accepted by {@link WeixinLoginManager}. */
export interface WeixinLoginManagerOptions {
    /** Invoked after a confirmed login (or an existing one) is persisted/ready. */
    onConnected?: (accountId: string) => void | Promise<void>;
    /** Invoked after {@link WeixinLoginManager.logout} clears the credentials. */
    onDisconnected?: () => void | Promise<void>;
}
/**
 * Drives the QR-code login flow and keeps a JSON-safe status snapshot that the
 * RPC channel serves to the browser. One flow runs at a time; `start()` and
 * `stop()` are safe to call repeatedly.
 */
export declare class WeixinLoginManager {
    private phase;
    private qrUrl;
    private scanned;
    private message;
    private accountId;
    /** Cancels the in-flight flow; replaced on every start. */
    private abort;
    /** Monotonic generation: a stale async flow never writes status. */
    private generation;
    private readonly onConnected?;
    private readonly onDisconnected?;
    constructor(options?: WeixinLoginManagerOptions);
    /** A JSON-safe snapshot of the current login state. */
    status(): WeixinLoginStatus;
    /**
     * Begin (or restart) the QR login flow: fetches a fresh QR code, then
     * long-polls its status in the background until confirmed, expired past the
     * refresh budget, or cancelled. Returns immediately with the current status.
     */
    start(): Promise<StartLoginResult>;
    /** Cancel any in-flight login and return to the idle state. */
    stop(): void;
    /** Mark the bridge connected with an already-persisted account. */
    markConnected(accountId?: string): void;
    /**
     * Log out: cancel any in-flight flow, clear every persisted credential, and
     * return to the idle state so a fresh QR login can bind another account.
     * Fires `onDisconnected` so the host can stop the running monitor.
     */
    logout(): Promise<WeixinLoginStatus>;
    /** The QR-code background flow; owns all status writes for one generation. */
    private runFlow;
    /** Record a terminal failure for the current generation only. */
    private fail;
}
