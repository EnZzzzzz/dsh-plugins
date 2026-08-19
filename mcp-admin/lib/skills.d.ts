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
/** The user-writable skill root this plugin manages. */
export declare function skillRoot(): string;
/** One listed skill. */
export interface SkillInfo {
    name: string;
    description: string;
    /** `bundle` for `<name>/SKILL.md`, `flat` for `<name>.md`. */
    form: 'bundle' | 'flat';
    /** Absolute path of the markdown file. */
    path: string;
}
/**
 * List every skill in the user root.
 * @returns catalog entries sorted by name.
 */
export declare function listSkills(): SkillInfo[];
/**
 * Read one skill's markdown, plus the sibling file list for bundles.
 * @param name - the skill to read.
 * @returns file content and, for bundles, relative paths of extra resources.
 */
export declare function readSkill(name: string): {
    content: string;
    files: string[];
};
/**
 * Create or overwrite a skill, preserving the on-disk form it already has
 * (new skills are written as directory bundles).
 * @param name - kebab-case skill name; must match the frontmatter `name`.
 * @param content - full SKILL.md content including frontmatter.
 * @returns the written file path.
 */
export declare function upsertSkill(name: string, content: string): string;
/**
 * Delete a skill from the user root (bundle directory or flat file).
 * @param name - the skill to delete.
 */
export declare function deleteSkill(name: string): void;
