/**
 * dsh-mcp-admin — a Cordis plugin (and dsh bundle) that exposes skill and
 * agent-preset administration of a DeepSeek Harness host as an MCP server,
 * so a remote agent can review and modify this deployment's skills and
 * presets without shell access.
 *
 * The MCP endpoint rides the host's web server as a `/mcp` prefix route with
 * a stateless Streamable HTTP transport (one server instance per request).
 * The route sits outside the `/api` trust fence, so the configured bearer
 * token is the only guard — the plugin refuses to start without one. Writes
 * stay inside the user roots (`$DSH_HOME/skills`, `$DSH_HOME/.agent-presets`);
 * every mutation is appended to an audit log that the bundled Settings page
 * ("MCP 管理") polls through the `/mcp-admin` RPC channel. The page also
 * edits `publicUrl` (the address remote agents should dial), persisted as a
 * settings namespace and applied live.
 *
 * The plugin is a plain function plugin: named exports only, no default
 * export (see docs/postmortem/0001 in the harness repo).
 *
 * @module dsh-mcp-admin
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "mcp-admin";
/** The harness services this plugin requires before it activates. */
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /**
     * Bearer token guarding `/mcp`. REQUIRED and must be long and random
     * (e.g. `openssl rand -hex 32`): anyone with it can rewrite this host's
     * skills and presets. The plugin throws at load while empty.
     */
    token?: string;
    /** Audit log retention in records (oldest dropped first). Default 200. */
    auditLimit?: number;
    /**
     * Boot-time base for the public base URL setting (e.g.
     * `http://1.2.3.4:3080`). The Settings page overrides it at runtime; the
     * override persists to `$DSH_HOME/settings.yaml`.
     */
    publicUrl?: string;
}
/** The user-writable slice, editable from the Settings page. */
export interface McpAdminSettings {
    /**
     * Public base URL remote agents should dial (e.g. `http://1.2.3.4:3080`).
     * Empty falls back to the address the Settings page was opened with. A NAT
     * host cannot discover its own public IP, so tunnel users must set this.
     */
    publicUrl: string;
}
/** Schema for the settings namespace; optionality is expressed in the TS type. */
export declare const McpAdminSettingsSchema: z<McpAdminSettings>;
/**
 * Mount the MCP endpoint and the dashboard RPC channel.
 * @param ctx - the plugin context (host root scope).
 * @param config - see {@link Config}.
 */
export declare function apply(ctx: Context, config: Config): void;
