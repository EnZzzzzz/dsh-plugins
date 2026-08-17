/**
 * dsh-builtin-browser browser half: registers two additive slots that make up
 * the built-in browser UI:
 *
 *  - `sidebar.footer.action` (id `builtin-browser`): a small action beside
 *    Settings that toggles the browser panel open/closed.
 *  - `shell.overlay` (id `builtin-browser`): the floating browser panel
 *    itself — address bar, navigation buttons, and the page surface
 *    (`<webview>` inside the Electron Desktop shell, `<iframe>` otherwise).
 *
 * The two entries share one tiny external store (./store.ts) instead of a
 * context provider, because they render in different slots.
 *
 * Export discipline (packages/client/AGENTS.md): only `apply`/`inject` are
 * exported; the components and their props stay internal.
 *
 * @module dsh-builtin-browser/client
 */

// Type-only: pulls the slots shell's SlotMap merge (the 'sidebar.footer.action'
// and 'shell.overlay' entries are declared by ui-sidebar and ui-layout).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { BrowserPanel } from './BrowserPanel.js'
import { BrowserToggle } from './BrowserToggle.js'
import { browserStore, pageBrowserController } from './store.js'

/** Required services (cordis fiber inject): the slots registry. */
export const inject = ['slots']

/** Window slot the shell's executeJavaScript targets. */
const CONTROLLER_KEY = '__dshBrowser'

/**
 * Mount the built-in browser UI.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  // Detect the Electron shell: the shell's preload (desktop/preload.js)
  // exposes `window.desktopBridge`, which also carries the control port the
  // host half needs. Nothing here requires it — outside a shell the panel
  // degrades to an iframe.
  const desktopBridge = (globalThis as { desktopBridge?: { browserPort?: number } }).desktopBridge
  if (desktopBridge?.browserPort) {
    browserStore.setInShell(true)
  }

  // Publish the page-side controller the Desktop shell drives via
  // executeJavaScript (desktop/main.cjs). Owned by this fiber: removed when
  // the plugin stops or updates, so stale pages never answer commands.
  const win = globalThis as { [CONTROLLER_KEY]?: unknown }
  win[CONTROLLER_KEY] = pageBrowserController
  ctx.effect(() => () => {
    if (win[CONTROLLER_KEY] === pageBrowserController) {
      delete win[CONTROLLER_KEY]
    }
  })

  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'builtin-browser', order: 10, label: () => browserStore.get().open ? '关闭浏览器' : '内置浏览器' },
    BrowserToggle,
  ))

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'builtin-browser', order: 10, label: () => '内置浏览器' },
    BrowserPanel,
  ))
}
