/**
 * MCP tool surface of dsh-mcp-admin: `skill_*` tools manage skill files under
 * the user skill root, `preset_*` tools manage agent presets under the user
 * preset root. Every mutation is recorded in the audit log that the Settings
 * dashboard reads. A fresh server is built per HTTP request (stateless
 * transport), so registrations close over only the long-lived dependencies.
 *
 * @module dsh-mcp-admin/mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import { z } from 'zod'
import { appendAudit } from './audit.js'
import { deletePreset, listPresets, readPreset, upsertPreset } from './presets.js'
import { deleteSkill, listSkills, readSkill, upsertSkill } from './skills.js'

/** Long-lived dependencies shared by every per-request server instance. */
export interface McpAdminDeps {
  /** The harness agent-presets service (preset list/read/copy/remove). */
  presets: AgentPresets
  /** Audit log retention in records. */
  auditLimit: number
}

const nameField = z.string().describe('Kebab-case name, e.g. "code-review".')
const idField = z.string().describe('Kebab-case preset id, e.g. "reviewer".')

/** Render a tool result as one JSON text block. */
function json(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** Render a thrown error as an MCP error result. */
function failure(error: unknown): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
}

/**
 * Build the MCP server with all eight tools registered.
 * @param deps - shared service handles and config.
 * @returns a connected-ready server (call `connect` with a transport).
 */
export function createMcpAdminServer(deps: McpAdminDeps): McpServer {
  const server = new McpServer(
    { name: 'dsh-mcp-admin', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.registerTool('skill_list', {
    description: 'List skills in the harness user skill root ($DSH_HOME/skills).',
    inputSchema: {},
  }, async () => {
    try {
      return json(listSkills())
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('skill_read', {
    description: 'Read one skill: full SKILL.md content plus bundled resource file names.',
    inputSchema: { name: nameField },
  }, async ({ name }) => {
    try {
      return json(readSkill(name))
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('skill_upsert', {
    description: 'Create or overwrite a skill. `content` is the full SKILL.md including YAML frontmatter with `name` and `description`. The harness watches the root, so the change is live for the next agent step.',
    inputSchema: {
      name: nameField,
      content: z.string().describe('Full SKILL.md content including frontmatter.'),
    },
  }, async ({ name, content }) => {
    try {
      const path = upsertSkill(name, content)
      appendAudit({ tool: 'skill_upsert', kind: 'skill', name, action: 'upsert', bytes: content.length }, content, deps.auditLimit)
      return json({ path })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('skill_delete', {
    description: 'Delete a skill from the user skill root.',
    inputSchema: { name: nameField },
  }, async ({ name }) => {
    try {
      deleteSkill(name)
      appendAudit({ tool: 'skill_delete', kind: 'skill', name, action: 'delete', bytes: 0 }, '', deps.auditLimit)
      return json({ deleted: name })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('preset_list', {
    description: 'List the agent preset roster (system and user trust), including broken markers.',
    inputSchema: {},
  }, async () => {
    try {
      return json(await listPresets(deps.presets))
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('preset_read', {
    description: 'Read a preset\'s agent.cordis.yml composition text.',
    inputSchema: { id: idField },
  }, async ({ id }) => {
    try {
      return json({ id, content: await readPreset(deps.presets, id) })
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('preset_upsert', {
    description: 'Create or overwrite a preset\'s composition in the user root ($DSH_HOME/.agent-presets). To edit a shipped (system trust) preset, pass its id as `base` to copy it into the user root first. The change applies to sessions created after the write; running sessions keep their composition.',
    inputSchema: {
      id: idField,
      content: z.string().describe('Full agent.cordis.yml composition text.'),
      base: z.string().optional().describe('Existing preset id to copy from when creating `id`. Required when overwriting a system-trust preset.'),
      displayName: z.string().optional().describe('Display name persisted to preset.yml.'),
      displayDescription: z.string().optional().describe('One-sentence description persisted to preset.yml.'),
    },
  }, async ({ id, content, base, displayName, displayDescription }) => {
    try {
      const metadata = displayName === undefined && displayDescription === undefined
        ? undefined
        : {
            ...displayName === undefined ? {} : { name: displayName },
            ...displayDescription === undefined ? {} : { description: displayDescription },
          }
      const result = await upsertPreset(deps.presets, id, content, base, metadata)
      appendAudit({ tool: 'preset_upsert', kind: 'preset', name: id, action: 'upsert', bytes: content.length }, content, deps.auditLimit)
      return json(result)
    } catch (error) {
      return failure(error)
    }
  })

  server.registerTool('preset_delete', {
    description: 'Delete a user-trust preset. System presets cannot be deleted.',
    inputSchema: { id: idField },
  }, async ({ id }) => {
    try {
      await deletePreset(deps.presets, id)
      appendAudit({ tool: 'preset_delete', kind: 'preset', name: id, action: 'delete', bytes: 0 }, '', deps.auditLimit)
      return json({ deleted: id })
    } catch (error) {
      return failure(error)
    }
  })

  return server
}
