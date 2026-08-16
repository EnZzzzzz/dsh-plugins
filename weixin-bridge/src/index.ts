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
 * The bridge's config (provider/model/cwd/maxTokens) is registered as a
 * settings namespace (`weixin-bridge`) so the Settings page can read and edit
 * it; edits persist to `$DSH_HOME/settings.yaml` and apply to new sessions
 * immediately via the namespace's watch.
 *
 * The plugin is a plain function plugin: named exports only, no default
 * export (see docs/postmortem/0001 in the harness repo).
 *
 * @module dsh-weixin-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: brings the `Context.connection` merge (HostConnectionHandle) into
// this program so the deferred inject callback is fully typed.
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SettingsNamespace, SettingsScope } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { isLoggedIn, start, type Bot } from 'weixin-agent-sdk'
import { createWeixinAgent, type BridgeConfig } from './bridge.js'
import { WeixinLoginManager } from './weixin-login.js'

export const name = 'weixin-bridge'

/** The harness services this plugin requires before it activates. */
export const inject = ['agents']

/** Plugin configuration. Every field is optional; defaults come from {@link ConfigDefaults}. */
export interface Config extends Partial<BridgeConfig> {
  /** Whether the bridge auto-starts on plugin load. Set false to install without connecting. */
  enabled?: boolean
}

/**
 * The default session working directory: the invoking directory, unless it is
 * the filesystem root — GUI-launched desktop apps start with cwd `/` (or a
 * drive root on Windows), where no harness session should ever work — in
 * which case `~/dsf` is used instead.
 */
function defaultCwd(): string {
  const cwd = process.cwd()
  return cwd === path.parse(cwd).root ? path.join(homedir(), 'dsf') : cwd
}

/** Expand a leading `~/` in a user-supplied path (what the shell would do). */
function expandHome(input: string): string {
  return input === '~' || input.startsWith('~/') ? path.join(homedir(), input.slice(1)) : input
}

/** Default provider/model mirror the shipped headless profile uses. */
export const ConfigDefaults: Required<Omit<Config, 'maxTokens'>> & Pick<Config, 'maxTokens'> = {
  enabled: true,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  cwd: defaultCwd(),
}

/** The user-writable slice of the bridge config (the settings namespace value). */
export interface WeixinBridgeSettings {
  /** Provider route for created agents. */
  provider: string
  /** Model id interpreted by the selected provider adapter. */
  model: string
  /** Working directory for fresh sessions. */
  cwd: string
  /** Maximum output tokens per request; unset defers to the provider. */
  maxTokens?: number
}

/** Settings namespace id of this bridge's config surface. */
const WEIXIN_BRIDGE_SETTINGS_NAMESPACE = 'weixin-bridge' as SettingsNamespace

/** Schema for the settings namespace; optionality is expressed in the TS type. */
export const WeixinBridgeSettingsSchema: z<WeixinBridgeSettings> = z.object({
  provider: z.string(),
  model: z.string(),
  cwd: z.string(),
  maxTokens: z.natural(),
})

/**
 * Mount the WeChat bridge.
 * @param ctx - Cordis context carrying the agent registry.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const enabled = config.enabled ?? ConfigDefaults.enabled
  if (!enabled) {
    ctx.logger.info('[weixin-bridge] disabled; set enabled: true in cordis.yml to connect WeChat')
    return
  }

  // Mutable runtime config: new conversations read it at create time, so the
  // settings surface can change cwd/provider/model without a restart.
  const runtimeConfig: BridgeConfig = {
    provider: config.provider ?? ConfigDefaults.provider,
    model: config.model ?? ConfigDefaults.model,
    cwd: config.cwd ?? ConfigDefaults.cwd,
    ...config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {},
  }

  // Ensure the working directory exists so fresh sessions can actually start
  // in it (best effort; a custom cwd pointing elsewhere is the user's call).
  try {
    mkdirSync(runtimeConfig.cwd, { recursive: true })
  } catch {
    // Ignore: an unusable cwd surfaces at session creation, not at boot.
  }

  /** Fold one resolved settings value onto the live bridge config. */
  const applyResolvedConfig = (value: WeixinBridgeSettings): void => {
    runtimeConfig.provider = value.provider
    runtimeConfig.model = value.model
    runtimeConfig.cwd = value.cwd
    runtimeConfig.maxTokens = value.maxTokens
  }

  const bridge = createWeixinAgent(ctx, runtimeConfig)
  const abort = new AbortController()

  /** Start the SDK monitor once a login is confirmed (or already exists). */
  const startMonitor = (): void => {
    try {
      const bot: Bot = start(bridge.agent, { abortSignal: abort.signal })
      ctx.logger.info('[weixin-bridge] WeChat connected; listening for messages')
      // Surface unrecoverable monitor errors without crashing the harness.
      void bot.wait().catch((error: unknown) => {
        ctx.logger.warn(`[weixin-bridge] monitor stopped: ${error instanceof Error ? error.message : String(error)}`)
      })
    } catch (error) {
      ctx.logger.warn(`[weixin-bridge] failed to start the WeChat monitor: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const manager = new WeixinLoginManager({ onConnected: startMonitor })

  ctx.effect(() => {
    if (isLoggedIn()) {
      // An earlier login is already persisted; skip the QR flow entirely.
      manager.markConnected()
      startMonitor()
    } else {
      // Begin the QR flow immediately so the QR is ready when Settings opens.
      void manager.start()
    }

    // The browser half drives login and config through this channel. It needs
    // both the connection service (web profiles) and the settings service
    // (base bundle); the deferred inject waits for them without blocking (or
    // failing) compositions that never mount them.
    ctx.inject(['connection', 'settings'], (apiCtx) => {
      const scope = apiCtx.settings.register(
        WEIXIN_BRIDGE_SETTINGS_NAMESPACE,
        WeixinBridgeSettingsSchema,
        {
          // The boot-time cordis config is the composition base; the user
          // layer (settings.yaml, written by the page) overrides it.
          base: {
            provider: runtimeConfig.provider,
            model: runtimeConfig.model,
            cwd: runtimeConfig.cwd,
            ...runtimeConfig.maxTokens === undefined ? {} : { maxTokens: runtimeConfig.maxTokens },
          },
          applies: 'live',
        },
      )
      applyResolvedConfig(scope.get())
      apiCtx.effect(
        () => scope.watch((next) => applyResolvedConfig(next)),
        'weixin-bridge: settings watch',
      )

      apiCtx.connection.rpc.handle('/weixin-bridge', async (endpoint, payload, _signal) => {
        switch (endpoint) {
          case 'status':
            return { ok: true, value: manager.status() }
          case 'start-login':
            return { ok: true, value: await manager.start() }
          case 'stop-login':
            manager.stop()
            return { ok: true, value: manager.status() }
          case 'get-config':
            return { ok: true, value: scope.get() }
          case 'set-config': {
            const patch = (payload as { patch?: unknown } | null | undefined)?.patch
            if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
              return {
                ok: false,
                error: { code: 'internal', message: 'set-config requires a JSON object patch', details: {} },
              }
            }
            try {
              const normalized = { ...patch as Record<string, unknown> }
              if (typeof normalized.cwd === 'string' && normalized.cwd.length > 0) {
                // The settings document stores paths verbatim; expand `~/` so a
                // `~/dsf` typed in the page becomes a real absolute path.
                normalized.cwd = expandHome(normalized.cwd)
              }
              await scope.update(normalized)
            } catch (error) {
              return {
                ok: false,
                error: {
                  code: 'internal',
                  message: error instanceof Error ? error.message : String(error),
                  details: {},
                },
              }
            }
            return { ok: true, value: scope.get() }
          }
          default:
            return {
              ok: false,
              error: {
                code: 'internal',
                message: `unknown endpoint: ${endpoint}`,
                details: {},
              },
            }
        }
      }, { authority: 'loopback' })
    })

    return async () => {
      manager.stop()
      abort.abort()
      await bridge.dispose()
    }
  }, 'weixin-bridge.connection')
}
