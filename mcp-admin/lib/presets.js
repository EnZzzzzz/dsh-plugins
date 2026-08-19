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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COMPOSITION_FILE, renderPresetMetadata } from '@deepseek-ai/dsh-agent-presets';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
/** Preset id, matching the discovery contract (directory name). */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Display metadata file written next to the composition when provided. */
const METADATA_FILE = 'preset.yml';
/** The user-writable preset root this plugin manages. */
export function presetRoot() {
    return dshHomePath('.agent-presets');
}
function assertId(id) {
    if (!ID_PATTERN.test(id)) {
        throw new Error(`invalid preset id ${JSON.stringify(id)}: must match ${ID_PATTERN}`);
    }
}
/**
 * List the full preset roster (system and user trust).
 * @param presets - the harness agent-presets service.
 * @returns roster entries sorted by id.
 */
export async function listPresets(presets) {
    return (await presets.list())
        .map(preset => ({
        id: preset.id,
        trust: preset.trust,
        ...preset.name === undefined ? {} : { name: preset.name },
        ...preset.description === undefined ? {} : { description: preset.description },
        ...preset.broken === undefined ? {} : { broken: preset.broken },
    }))
        .sort((a, b) => a.id.localeCompare(b.id));
}
/**
 * Read a preset's composition text.
 * @param presets - the harness agent-presets service.
 * @param id - the preset to read.
 * @returns the `agent.cordis.yml` content.
 */
export async function readPreset(presets, id) {
    assertId(id);
    return presets.read(id);
}
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
export async function upsertPreset(presets, id, content, base, metadata) {
    assertId(id);
    const target = join(presetRoot(), id, COMPOSITION_FILE);
    if (!existsSync(target)) {
        const known = await presets.list();
        const existing = known.find(preset => preset.id === id);
        if (existing !== undefined && existing.trust !== 'user' && base !== id) {
            throw new Error(`preset ${JSON.stringify(id)} exists under ${existing.trust} trust; pass base: ${JSON.stringify(id)} to copy it into the user root before editing`);
        }
        if (base !== undefined) {
            // copy() authors the whole directory into the writable root.
            await presets.copy(base, id);
        }
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    if (metadata !== undefined) {
        const rendered = renderPresetMetadata(metadata);
        if (rendered !== undefined)
            writeFileSync(join(presetRoot(), id, METADATA_FILE), rendered, 'utf8');
    }
    let warning;
    try {
        // Recomputing the standing key validates that the composition loads.
        await presets.standingKeyFor(id);
    }
    catch (error) {
        warning = `written, but the composition fails to load: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { path: target, ...warning === undefined ? {} : { warning } };
}
/**
 * Delete a preset. The service refuses non-user-trust presets.
 * @param presets - the harness agent-presets service.
 * @param id - the preset to delete.
 */
export async function deletePreset(presets, id) {
    assertId(id);
    await presets.remove(id);
}
