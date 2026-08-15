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
import type { Context } from '@deepseek-ai/cordis';
import { type BridgeConfig } from './bridge.js';
export declare const name = "weixin-bridge";
/** The harness services this plugin requires before it activates. */
export declare const inject: string[];
/** Plugin configuration. Every field is optional; defaults come from {@link ConfigDefaults}. */
export interface Config extends Partial<BridgeConfig> {
    /** Whether the bridge auto-starts on plugin load. Set false to install without connecting. */
    enabled?: boolean;
}
/** Default provider/model mirror the shipped headless profile uses. */
export declare const ConfigDefaults: Required<Omit<Config, 'maxTokens'>> & Pick<Config, 'maxTokens'>;
/**
 * Mount the WeChat bridge.
 * @param ctx - Cordis context carrying the agent registry.
 * @param config - resolved plugin configuration.
 */
export declare function apply(ctx: Context, config?: Config): void;
