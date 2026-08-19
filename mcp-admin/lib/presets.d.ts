/**
 * Agent preset operations for the mcp-admin MCP tools. A preset is a directory
 * holding an `agent.cordis.yml` composition (plus optional `preset.yml`
 * display metadata). Reads go through `ctx.agentPresets`; writes go to the
 * user trust root `$DSH_HOME/.agent-presets` (USER_PRESET_DIR in
 * dsh-agent-presets/discovery.ts, not re-exported from the package index) —
 * the service deliberately accepts no composition text (copy-only authoring).
 * The standing-mount file stamp (mtime+size) makes writes take effect for the
 * next new session without a restart; running sessions keep their composition.
 *
 * @module dsh-mcp-admin/presets
 */
import { type AgentPresets } from '@deepseek-ai/dsh-agent-presets';
/** The user-writable preset root this plugin manages. */
export declare function presetRoot(): string;
/** One listed preset. */
export interface PresetInfo {
    id: string;
    trust: 'system' | 'user';
    name?: string;
    description?: string;
    /** Why the preset cannot compose, when broken. */
    broken?: string;
}
/**
 * List the full preset roster (system and user trust).
 * @param presets - the harness agent-presets service.
 * @returns roster entries sorted by id.
 */
export declare function listPresets(presets: AgentPresets): Promise<PresetInfo[]>;
/**
 * Read a preset's composition text.
 * @param presets - the harness agent-presets service.
 * @param id - the preset to read.
 * @returns the `agent.cordis.yml` content.
 */
export declare function readPreset(presets: AgentPresets, id: string): Promise<string>;
/**
 * Create or overwrite a preset in the user root. A preset that exists only
 * under system trust must be copied in first (`base` set to its id), so an
 * edit never silently shadows a shipped preset with from-scratch content.
 * @param presets - the harness agent-presets service.
 * @param id - target preset id in the user root.
 * @param content - full `agent.cordis.yml` composition text.
 * @param base - existing preset id to copy from when `id` is new.
 * @param metadata - optional display name/description persisted to `preset.yml`.
 * @returns the written composition path, plus a validation warning when the
 *   result fails the standing-mount check (the file stays — fix and retry).
 */
export declare function upsertPreset(presets: AgentPresets, id: string, content: string, base?: string, metadata?: {
    name?: string;
    description?: string;
}): Promise<{
    path: string;
    warning?: string;
}>;
/**
 * Delete a preset. The service refuses non-user-trust presets.
 * @param presets - the harness agent-presets service.
 * @param id - the preset to delete.
 */
export declare function deletePreset(presets: AgentPresets, id: string): Promise<void>;
