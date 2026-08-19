/**
 * Skill file operations for the mcp-admin MCP tools. Skills live as plain
 * files under the user root `$DSH_HOME/skills`: a directory bundle
 * `<name>/SKILL.md` (the form upserts create) or a flat `<name>.md`. The
 * harness `skill-filesystem` provider watches this root, so writes take effect
 * on the next agent pre-step without a restart.
 *
 * Only the user root is touched — project and bundled roots stay read-only
 * from this plugin.
 *
 * @module dsh-mcp-admin/skills
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
/** Kebab-case skill name, matching the harness discovery contract. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** The user-writable skill root this plugin manages. */
export function skillRoot() {
    return dshHomePath('skills');
}
/** Extract `name`/`description` from YAML frontmatter (line-based, enough for catalog fields). */
function parseFrontmatter(content) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match)
        return {};
    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
        const field = /^([a-zA-Z-]+):\s*(.*)$/.exec(line);
        if (!field)
            continue;
        const value = field[2].trim().replace(/^['"]|['"]$/g, '');
        if (field[1] === 'name')
            fields.name = value;
        if (field[1] === 'description')
            fields.description = value;
    }
    return fields;
}
/** Resolve the markdown file for `name`, or undefined when absent from the user root. */
function locate(name) {
    const bundle = join(skillRoot(), name, 'SKILL.md');
    if (existsSync(bundle))
        return { form: 'bundle', path: bundle };
    const flat = join(skillRoot(), `${name}.md`);
    if (existsSync(flat))
        return { form: 'flat', path: flat };
    return undefined;
}
function assertName(name) {
    if (!NAME_PATTERN.test(name)) {
        throw new Error(`invalid skill name ${JSON.stringify(name)}: must match ${NAME_PATTERN}`);
    }
}
/**
 * List every skill in the user root.
 * @returns catalog entries sorted by name.
 */
export function listSkills() {
    const root = skillRoot();
    if (!existsSync(root))
        return [];
    const infos = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const file = entry.isDirectory()
            ? join(root, entry.name, 'SKILL.md')
            : entry.name.endsWith('.md') ? join(root, entry.name) : undefined;
        if (file === undefined || !existsSync(file))
            continue;
        const name = entry.isDirectory() ? entry.name : entry.name.slice(0, -'.md'.length);
        const frontmatter = parseFrontmatter(readFileSync(file, 'utf8'));
        infos.push({
            name,
            description: frontmatter.description ?? '',
            form: entry.isDirectory() ? 'bundle' : 'flat',
            path: file,
        });
    }
    return infos.sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * Read one skill's markdown, plus the sibling file list for bundles.
 * @param name - the skill to read.
 * @returns file content and, for bundles, relative paths of extra resources.
 */
export function readSkill(name) {
    assertName(name);
    const found = locate(name);
    if (!found)
        throw new Error(`skill ${JSON.stringify(name)} not found under ${skillRoot()}`);
    const files = found.form === 'bundle'
        ? readdirSync(join(skillRoot(), name)).filter(file => file !== 'SKILL.md')
        : [];
    return { content: readFileSync(found.path, 'utf8'), files };
}
/**
 * Create or overwrite a skill, preserving the on-disk form it already has
 * (new skills are written as directory bundles).
 * @param name - kebab-case skill name; must match the frontmatter `name`.
 * @param content - full SKILL.md content including frontmatter.
 * @returns the written file path.
 */
export function upsertSkill(name, content) {
    assertName(name);
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) {
        throw new Error('skill content must carry YAML frontmatter with `name` and `description`');
    }
    if (frontmatter.name !== name) {
        throw new Error(`frontmatter name ${JSON.stringify(frontmatter.name)} does not match ${JSON.stringify(name)}`);
    }
    const found = locate(name);
    const target = found?.path ?? join(skillRoot(), name, 'SKILL.md');
    // Bundle upserts need the `<name>/` directory; flat upserts only the root.
    mkdirSync(found?.form === 'flat' ? skillRoot() : join(skillRoot(), name), { recursive: true });
    writeFileSync(target, content, 'utf8');
    return target;
}
/**
 * Delete a skill from the user root (bundle directory or flat file).
 * @param name - the skill to delete.
 */
export function deleteSkill(name) {
    assertName(name);
    const found = locate(name);
    if (!found)
        throw new Error(`skill ${JSON.stringify(name)} not found under ${skillRoot()}`);
    rmSync(found.form === 'bundle' ? join(skillRoot(), name) : found.path, { recursive: true });
}
