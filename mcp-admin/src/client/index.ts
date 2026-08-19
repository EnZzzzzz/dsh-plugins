/**
 * dsh-mcp-admin browser half: registers one Settings page (id `mcp-admin`,
 * after Agent presets) through the open `settings.section` slot. The page
 * polls the host's mutation audit log over the dedicated `/mcp-admin` RPC
 * channel and renders what remote MCP clients changed.
 *
 * Export discipline (packages/client/AGENTS.md): only `apply`/`inject` are
 * exported; the component and its props stay internal.
 *
 * @module dsh-mcp-admin/client
 */

// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { McpAdminSection } from './McpAdminSection.js'

/** Required services (cordis fiber inject): the slots registry and the wire. */
export const inject = ['slots', 'connection']

/**
 * Mount the MCP 管理 settings page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-admin',
    order: 40,
    label: () => 'MCP 管理',
    inject: () => ({ connection }),
  }, McpAdminSection))
}
