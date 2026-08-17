/**
 * WeChat-to-harness bridge: adapts the weixin-agent-sdk Agent interface to
 * `ctx.agents` (the same programmatic surface the ACP bridge drives).
 *
 * Each WeChat conversation (the SDK's `conversationId`) maps to one live
 * harness agent session, so multi-turn chat keeps history. Committed assistant
 * text is collected through `session/event` while the turn runs and returned
 * as the WeChat reply when the agent reaches quiescence (`whenIdle`).
 *
 * @module dsh-weixin-bridge/bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent as WeixinAgent } from 'weixin-agent-sdk';
/** Bridge configuration. */
export interface BridgeConfig {
    /** Provider route for created agents (must have a registered adapter at call time). */
    provider: string;
    /** Model id interpreted by the selected provider adapter. */
    model: string;
    /** Working directory for fresh sessions. */
    cwd: string;
    /** Maximum output tokens for each conversation-model request. */
    maxTokens?: number;
    /**
     * Upper bound for one chat turn. WeChat is non-interactive and the SDK
     * awaits `chat()` serially, so a stalled turn (an unanswerable interactive
     * tool, a pending approval nobody can grant) would otherwise wedge the whole
     * channel. Defaults to {@link TURN_TIMEOUT_MS}.
     */
    turnTimeoutMs?: number;
}
/**
 * The WeChat-side agent plus its teardown, as built by {@link createWeixinAgent}.
 */
export interface WeixinAgentBridge {
    /** The agent object handed to `start()`. */
    agent: WeixinAgent;
    /** Dispose every live harness session behind the bridge. */
    dispose(): Promise<void>;
}
/**
 * Build the weixin-agent-sdk `Agent` implementation over a harness context.
 * @param ctx - Cordis context carrying the agent registry (`ctx.agents`).
 * @param config - provider/model/cwd selection for created agents.
 * @returns the WeChat-side agent object and its conversation teardown.
 */
export declare function createWeixinAgent(ctx: Context, config: BridgeConfig): WeixinAgentBridge;
