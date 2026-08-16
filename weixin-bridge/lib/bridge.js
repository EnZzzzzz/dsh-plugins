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
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
/**
 * Build the weixin-agent-sdk `Agent` implementation over a harness context.
 * @param ctx - Cordis context carrying the agent registry (`ctx.agents`).
 * @param config - provider/model/cwd selection for created agents.
 * @returns the WeChat-side agent object and its conversation teardown.
 */
export function createWeixinAgent(ctx, config) {
    const conversations = new Map();
    // Collect committed assistant text per session while the loop runs; the
    // conversation's chat() drains this buffer after quiescence.
    const pending = new Map();
    ctx.on('session/event', (session, event) => {
        if (event.type !== 'assistant/message')
            return;
        const buffer = pending.get(session.header.id);
        if (buffer === undefined)
            return;
        for (const block of event.data.message.content) {
            if (block.type === 'text' && block.text.length > 0)
                buffer.push(block.text);
        }
    });
    /** Create the harness session behind a conversation on first message. */
    const ensureConversation = async (conversationId) => {
        const existing = conversations.get(conversationId);
        if (existing !== undefined)
            return existing;
        // Compose the deployment's default agent preset, exactly like the web app
        // does: presets own the tool schemas (bash, fs, …). Without one the agent
        // gets no tools, the model falls back to emitting <tool_calls> text, and
        // nothing ever executes.
        const presets = ctx.get('agentPresets');
        let agentPreset;
        let setup;
        if (presets !== undefined) {
            const resolved = await presets.resolve();
            agentPreset = resolved.id;
            setup = async (agentCtx) => {
                await presets.mount(agentCtx, resolved.id);
            };
        }
        const handle = await ctx.agents.create({
            sessionId: SessionId(randomUUID()),
            meta: {
                cwd: config.cwd,
                ...agentPreset === undefined ? {} : { agentPreset },
            },
            agentOptions: {
                ...config.provider !== '' ? { provider: config.provider } : {},
                ...config.model !== '' ? { model: config.model } : {},
                ...config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {},
            },
            ...setup === undefined ? {} : { setup },
        });
        const record = { handle, inflight: Promise.resolve() };
        conversations.set(conversationId, record);
        return record;
    };
    /** Serialize one turn behind the conversation's in-flight turn. */
    const enqueue = (conversationId, turn) => {
        const record = conversations.get(conversationId);
        if (record === undefined)
            return Promise.resolve({ text: '会话尚未就绪，请稍候重试。' });
        const next = record.inflight.then(turn);
        // Keep the chain alive on failure so a rejected turn never wedges the queue.
        record.inflight = next.catch(() => { });
        return next;
    };
    /** Render a media attachment as advisory text; v1 does not forward content. */
    const renderMedia = (media) => {
        const labels = {
            image: '图片', audio: '语音', video: '视频', file: '文件',
        };
        const name = media.fileName === undefined || media.fileName === '' ? '' : `（${media.fileName}）`;
        return `\n[收到${labels[media.type]}附件${name}，当前版本不转发媒体内容]`;
    };
    const chat = async (request) => {
        const { conversationId } = request;
        if (request.text.trim().length === 0 && request.media === undefined) {
            return { text: '收到空消息。' };
        }
        const text = `${request.text}${request.media === undefined ? '' : renderMedia(request.media)}`;
        try {
            const record = await ensureConversation(conversationId);
            return enqueue(conversationId, async () => {
                const agent = record.handle.agent;
                // A disposed agent cannot accept the item; recreate on the next message.
                if (ctx.agents.get(agent.id) !== agent) {
                    return { text: '会话已重置，请再发一次。' };
                }
                const message = createUserMessage({
                    content: [{ type: 'text', text }],
                    source: { kind: 'user' },
                });
                const buffer = [];
                pending.set(agent.session.id, buffer);
                try {
                    agent.followup(message);
                    await agent.whenIdle();
                }
                finally {
                    pending.delete(agent.session.id);
                }
                const reply = buffer.join('').trim();
                return reply.length > 0 ? { text: reply } : { text: '（无回复）' };
            });
        }
        catch (error) {
            return { text: `处理失败：${error instanceof Error ? error.message : String(error)}` };
        }
    };
    return {
        agent: { chat },
        dispose: async () => {
            const records = [...conversations.values()];
            conversations.clear();
            await Promise.allSettled(records.map(record => record.handle.dispose()));
        },
    };
}
