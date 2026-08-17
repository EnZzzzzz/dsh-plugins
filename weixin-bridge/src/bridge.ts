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

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, AgentSetup } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent as WeixinAgent, ChatRequest, ChatResponse } from 'weixin-agent-sdk'

/**
 * Minimal structural face of the `agentPresets` service the bridge consumes.
 * Declared locally (not imported from the package) so the plugin never drags a
 * second, version-drifted copy of the host's type graph into its build.
 */
interface AgentPresetsService {
  /** Resolve one preset by id, or the deployment default when omitted. */
  resolve(id?: string): Promise<{ id: string }>
  /** Compose one preset onto an agent's scope context (the factory setup). */
  mount(agentCtx: Context, id: string): Promise<unknown>
}

/** Structural face of the tools service's per-agent restriction (dsh-tools). */
interface ToolsRestrictFace {
  restrict(filter: { deny?: string[]; allow?: string[] }): unknown
}

/** Bridge configuration. */
export interface BridgeConfig {
  /** Provider route for created agents (must have a registered adapter at call time). */
  provider: string
  /** Model id interpreted by the selected provider adapter. */
  model: string
  /** Working directory for fresh sessions. */
  cwd: string
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
  /**
   * Upper bound for one chat turn. WeChat is non-interactive and the SDK
   * awaits `chat()` serially, so a stalled turn (an unanswerable interactive
   * tool, a pending approval nobody can grant) would otherwise wedge the whole
   * channel. Defaults to {@link TURN_TIMEOUT_MS}.
   */
  turnTimeoutMs?: number
}

/**
 * Default upper bound for one chat turn (see {@link BridgeConfig.turnTimeoutMs}).
 */
const TURN_TIMEOUT_MS = 5 * 60_000

/** Sentinel distinguishing a timed-out turn from ordinary processing errors. */
class TurnTimeoutError extends Error {
  constructor() {
    super('turn timed out')
    this.name = 'TurnTimeoutError'
  }
}

/** Abortable-free delay used for the turn timeout race. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Interactive tools that wait for a UI answer nobody can give on WeChat. */
const NON_INTERACTIVE_TOOL_DENYLIST = ['ask_user_question']

/** One WeChat conversation's live harness session. */
interface ConversationRecord {
  /** The owned harness agent plus its disposer. */
  handle: AgentHandle
  /** Serializes chat turns: a second message waits for the first to finish. */
  inflight: Promise<unknown>
}

/**
 * The WeChat-side agent plus its teardown, as built by {@link createWeixinAgent}.
 */
export interface WeixinAgentBridge {
  /** The agent object handed to `start()`. */
  agent: WeixinAgent
  /** Dispose every live harness session behind the bridge. */
  dispose(): Promise<void>
}

/**
 * Build the weixin-agent-sdk `Agent` implementation over a harness context.
 * @param ctx - Cordis context carrying the agent registry (`ctx.agents`).
 * @param config - provider/model/cwd selection for created agents.
 * @returns the WeChat-side agent object and its conversation teardown.
 */
export function createWeixinAgent(ctx: Context, config: BridgeConfig): WeixinAgentBridge {
  const conversations = new Map<string, ConversationRecord>()

  // Collect committed assistant text per session while the loop runs; the
  // conversation's chat() drains this buffer after quiescence.
  const pending = new Map<string, string[]>()
  ctx.on('session/event', (session, event: SessionEvent) => {
    if (event.type !== 'assistant/message') return
    const buffer = pending.get(session.header.id)
    if (buffer === undefined) return
    for (const block of event.data.message.content) {
      if (block.type === 'text' && block.text.length > 0) buffer.push(block.text)
    }
  })

  /** Create the harness session behind a conversation on first message. */
  const ensureConversation = async (conversationId: string): Promise<ConversationRecord> => {
    const existing = conversations.get(conversationId)
    if (existing !== undefined) return existing

    // Compose the deployment's default agent preset, exactly like the web app
    // does: presets own the tool schemas (bash, fs, …). Without one the agent
    // gets no tools, the model falls back to emitting <tool_calls> text, and
    // nothing ever executes.
    const presets = ctx.get('agentPresets') as AgentPresetsService | undefined
    let agentPreset: string | undefined
    let setup: AgentSetup | undefined
    if (presets !== undefined) {
      const resolved = await presets.resolve()
      agentPreset = resolved.id
      setup = async (agentCtx: Context): Promise<void> => {
        await presets.mount(agentCtx, resolved.id)
        // WeChat has no interactive surface: hide tools that wait for a UI
        // answer (ask_user_question) so a turn can never hang on one.
        const tools = (agentCtx as unknown as { tools?: ToolsRestrictFace }).tools
        if (tools !== undefined) {
          try {
            tools.restrict({ deny: NON_INTERACTIVE_TOOL_DENYLIST })
          } catch (error) {
            // A composition without the tool (or a newer scope API) must not
            // break session setup; the timeout safety net still applies.
            ctx.logger?.warn?.(`[weixin-bridge] tool restriction skipped: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
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
    })
    const record: ConversationRecord = { handle, inflight: Promise.resolve() }
    conversations.set(conversationId, record)
    return record
  }

  /** Serialize one turn behind the conversation's in-flight turn. */
  const enqueue = (
    conversationId: string,
    turn: () => Promise<ChatResponse>,
  ): Promise<ChatResponse> => {
    const record = conversations.get(conversationId)
    if (record === undefined) return Promise.resolve({ text: '会话尚未就绪，请稍候重试。' })
    const next = record.inflight.then(turn)
    // Keep the chain alive on failure so a rejected turn never wedges the queue.
    record.inflight = next.catch(() => {})
    return next
  }

  /** Render a media attachment as advisory text; v1 does not forward content. */
  const renderMedia = (media: NonNullable<ChatRequest['media']>): string => {
    const labels: Record<NonNullable<ChatRequest['media']>['type'], string> = {
      image: '图片', audio: '语音', video: '视频', file: '文件',
    }
    const name = media.fileName === undefined || media.fileName === '' ? '' : `（${media.fileName}）`
    return `\n[收到${labels[media.type]}附件${name}，当前版本不转发媒体内容]`
  }

  const chat = async (request: ChatRequest): Promise<ChatResponse> => {
    const { conversationId } = request
    if (request.text.trim().length === 0 && request.media === undefined) {
      return { text: '收到空消息。' }
    }
    const text = `${request.text}${request.media === undefined ? '' : renderMedia(request.media)}`
    let record: ConversationRecord | undefined
    try {
      record = await ensureConversation(conversationId)
      // `await` so a rejecting turn (timeout) is caught by this try/catch.
      return await enqueue(conversationId, async () => {
        const agent = record!.handle.agent
        // A disposed agent cannot accept the item; recreate on the next message.
        if (ctx.agents.get(agent.id) !== agent) {
          return { text: '会话已重置，请再发一次。' }
        }
        const message = createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        })
        const buffer: string[] = []
        pending.set(agent.session.id, buffer)
        try {
          agent.followup(message)
          // WeChat is a non-interactive channel: a turn that stalls on an
          // unanswerable interactive tool or approval would otherwise wedge
          // the SDK monitor forever (it awaits chat() serially). Time out and
          // let the caller cancel the turn instead.
          const timeout = sleep(config.turnTimeoutMs ?? TURN_TIMEOUT_MS).then(() => {
            throw new TurnTimeoutError()
          })
          // Mark the timeout branch handled so a normal finish never leaks
          // an unhandled rejection from the losing race arm.
          timeout.catch(() => {})
          await Promise.race([agent.whenIdle(), timeout])
        } finally {
          pending.delete(agent.session.id)
        }
        const reply = buffer.join('').trim()
        return reply.length > 0 ? { text: reply } : { text: '（无回复）' }
      })
    } catch (error) {
      if (error instanceof TurnTimeoutError && record !== undefined) {
        // Un-wedge the conversation: cancel the stuck turn so the next
        // message starts a fresh turn instead of queueing behind a hung one.
        try {
          record.handle.agent.cancel({ kind: 'user' })
        } catch {
          // Best effort; the session is recreated on the next message anyway.
        }
        return { text: '处理超时，请再发一次。' }
      }
      return { text: `处理失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  return {
    agent: { chat },
    dispose: async () => {
      const records = [...conversations.values()]
      conversations.clear()
      await Promise.allSettled(records.map(record => record.handle.dispose()))
    },
  }
}
