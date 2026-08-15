/**
 * dsh-weixin-bridge — a Cordis plugin (and dsh bundle) that exposes a live
 * DeepSeek Harness agent to WeChat through the official ClawBot channel
 * protocol, via the community `weixin-agent-sdk`.
 *
 * When `enabled`, the plugin starts the QR-code login flow. The QR code and
 * live status are served to the browser Settings page over a dedicated
 * `/weixin-bridge` RPC channel (registered on `ctx.connection`, loopback
 * only), so the user can scan from the page instead of the terminal. Once
 * confirmed, credentials are persisted in the SDK's own layout and the SDK
 * monitor takes over: every incoming WeChat message is bridged to a fresh
 * harness session created through `ctx.agents`, with replies streaming back
 * as committed assistant text.
 *
 * The plugin is a plain function plugin: named exports only, no default
 * export (see docs/postmortem/0001 in the harness repo).
 *
 * @module dsh-weixin-bridge
 */
import { isLoggedIn, start } from 'weixin-agent-sdk';
import { createWeixinAgent } from './bridge.js';
import { WeixinLoginManager } from './weixin-login.js';
export const name = 'weixin-bridge';
/** The harness services this plugin requires before it activates. */
export const inject = ['agents'];
/** Default provider/model mirror the shipped headless profile uses. */
export const ConfigDefaults = {
    enabled: true,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    cwd: process.cwd(),
};
/**
 * Mount the WeChat bridge.
 * @param ctx - Cordis context carrying the agent registry.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config = {}) {
    const enabled = config.enabled ?? ConfigDefaults.enabled;
    if (!enabled) {
        ctx.logger.info('[weixin-bridge] disabled; set enabled: true in cordis.yml to connect WeChat');
        return;
    }
    const bridgeConfig = {
        provider: config.provider ?? ConfigDefaults.provider,
        model: config.model ?? ConfigDefaults.model,
        cwd: config.cwd ?? ConfigDefaults.cwd,
        ...config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {},
    };
    const bridge = createWeixinAgent(ctx, bridgeConfig);
    const abort = new AbortController();
    /** Start the SDK monitor once a login is confirmed (or already exists). */
    const startMonitor = () => {
        try {
            const bot = start(bridge.agent, { abortSignal: abort.signal });
            ctx.logger.info('[weixin-bridge] WeChat connected; listening for messages');
            // Surface unrecoverable monitor errors without crashing the harness.
            void bot.wait().catch((error) => {
                ctx.logger.warn(`[weixin-bridge] monitor stopped: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
        catch (error) {
            ctx.logger.warn(`[weixin-bridge] failed to start the WeChat monitor: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const manager = new WeixinLoginManager({ onConnected: startMonitor });
    ctx.effect(() => {
        if (isLoggedIn()) {
            // An earlier login is already persisted; skip the QR flow entirely.
            manager.markConnected();
            startMonitor();
        }
        else {
            // Begin the QR flow immediately so the QR is ready when Settings opens.
            void manager.start();
        }
        // The browser half reads status and starts/stops logins through this
        // channel. It lives on `ctx.connection`, which web profiles provide via
        // `client-connection`; the deferred inject waits for the service without
        // blocking (or failing) compositions that never mount it.
        ctx.inject(['connection'], (connectionCtx) => {
            const connection = connectionCtx.connection;
            connection.rpc.handle('/weixin-bridge', async (endpoint, _payload, _signal) => {
                switch (endpoint) {
                    case 'status':
                        return { ok: true, value: manager.status() };
                    case 'start-login':
                        return { ok: true, value: await manager.start() };
                    case 'stop-login':
                        manager.stop();
                        return { ok: true, value: manager.status() };
                    default:
                        return {
                            ok: false,
                            error: {
                                code: 'internal',
                                message: `unknown endpoint: ${endpoint}`,
                                details: {},
                            },
                        };
                }
            }, { authority: 'loopback' });
        });
        return async () => {
            manager.stop();
            abort.abort();
            await bridge.dispose();
        };
    }, 'weixin-bridge.connection');
}
