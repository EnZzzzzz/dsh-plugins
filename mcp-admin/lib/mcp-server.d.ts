/**
 * MCP tool surface of dsh-mcp-admin: `skill_*` tools manage skill files under
 * the user skill root, `preset_*` tools manage agent presets under the user
 * preset root. Every mutation is recorded in the audit log that the Settings
 * dashboard reads. A fresh server is built per HTTP request (stateless
 * transport), so registrations close over only the long-lived dependencies.
 *
 * @module dsh-mcp-admin/mcp-server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets';
/** Long-lived dependencies shared by every per-request server instance. */
export interface McpAdminDeps {
    /** The harness agent-presets service (preset list/read/copy/remove). */
    presets: AgentPresets;
    /** Audit log retention in records. */
    auditLimit: number;
}
/**
 * Build the MCP server with all eight tools registered.
 * @param deps - shared service handles and config.
 * @returns a connected-ready server (call `connect` with a transport).
 */
export declare function createMcpAdminServer(deps: McpAdminDeps): McpServer;
