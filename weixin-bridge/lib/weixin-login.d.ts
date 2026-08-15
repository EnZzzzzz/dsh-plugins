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
/** Options accepted by {@link WeixinLoginManager}. */
export interface WeixinLoginManagerOptions {
    /** Invoked after a confirmed login (or an existing one) is persisted/ready. */
    onConnected?: (accountId: string) => void | Promise<void>;
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
    /** The QR-code background flow; owns all status writes for one generation. */
    private runFlow;
    /** Record a terminal failure for the current generation only. */
    private fail;
}
