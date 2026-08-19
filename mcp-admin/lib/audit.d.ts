/**
 * Audit trail for mcp-admin mutations. Every skill/preset write appends one
 * JSON line to `$DSH_HOME/mcp-admin/audit.jsonl`; the Settings dashboard polls
 * the newest records through the plugin's `/mcp-admin` RPC channel. The file
 * is truncated to the configured retention on every append — volume is tiny
 * (one line per MCP tool call), so read-rewrite truncation stays cheap.
 *
 * @module dsh-mcp-admin/audit
 */
/** One recorded mutation. */
export interface AuditRecord {
    /** ISO timestamp of the mutation. */
    ts: string;
    /** MCP tool that performed it (e.g. `skill_upsert`). */
    tool: string;
    /** Mutation target kind. */
    kind: 'skill' | 'preset';
    /** Skill name or preset id. */
    name: string;
    /** What happened to the target. */
    action: 'upsert' | 'delete';
    /** Written content size in bytes; 0 for deletes. */
    bytes: number;
    /** First characters of the written content, for the dashboard preview. */
    excerpt: string;
}
/** Absolute path of the audit log file. */
export declare function auditFile(): string;
/**
 * Append one record and truncate the log to `limit` entries.
 * @param record - the mutation to record, without timestamp/excerpt defaults.
 * @param content - the written content the excerpt is taken from ('' on delete).
 * @param limit - retention; older lines are dropped.
 */
export declare function appendAudit(record: Omit<AuditRecord, 'ts' | 'excerpt'>, content: string, limit: number): void;
/**
 * Read the newest records, latest first.
 * @param limit - maximum records returned.
 * @returns parsed records; an unreadable or absent log yields an empty list.
 */
export declare function listAudit(limit: number): AuditRecord[];
