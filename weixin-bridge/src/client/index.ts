/**
 * dsh-weixin-bridge browser half: registers one Settings page (id
 * `social-channels`, after Agent presets) through the open `settings.section`
 * slot. The page drives the host's QR login over the dedicated
 * `/weixin-bridge` RPC channel: it shows the live QR code, polls status, and
 * lets the user start/refresh/cancel the connection without touching the
 * terminal.
 *
 * Export discipline (packages/client/AGENTS.md): only `apply`/`inject` are
 * exported; the component and its props stay internal.
 *
 * @module dsh-weixin-bridge/client
 */

// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { SocialChannelsSection } from './SocialChannelsSection.js'

/** Required services (cordis fiber inject): the slots registry and the wire. */
export const inject = ['slots', 'connection']

/**
 * Mount the Social Channels settings page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'social-channels',
    order: 30,
    label: () => '社交渠道',
    inject: () => ({ connection }),
  }, SocialChannelsSection))
}
