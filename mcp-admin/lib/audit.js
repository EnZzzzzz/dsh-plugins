/**
 * Audit trail for mcp-admin mutations. Every skill/preset write appends one
 * JSON line to `$DSH_HOME/mcp-admin/audit.jsonl`; the Settings dashboard polls
 * the newest records through the plugin's `/mcp-admin` RPC channel. The file
 * is truncated to the configured retention on every append — volume is tiny
 * (one line per MCP tool call), so read-rewrite truncation stays cheap.
 *
 * @module dsh-mcp-admin/audit
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
/** Absolute path of the audit log file. */
export function auditFile() {
    return dshHomePath('mcp-admin', 'audit.jsonl');
}
/** Characters kept of the written content for the dashboard preview. */
const EXCERPT_LENGTH = 200;
/**
 * Append one record and truncate the log to `limit` entries.
 * @param record - the mutation to record, without timestamp/excerpt defaults.
 * @param content - the written content the excerpt is taken from ('' on delete).
 * @param limit - retention; older lines are dropped.
 */
export function appendAudit(record, content, limit) {
    const file = auditFile();
    mkdirSync(dirname(file), { recursive: true });
    const line = JSON.stringify({
        ...record,
        ts: new Date().toISOString(),
        excerpt: content.slice(0, EXCERPT_LENGTH),
    });
    appendFileSync(file, line + '\n', 'utf8');
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > limit) {
        writeFileSync(file, lines.slice(-limit).join('\n') + '\n', 'utf8');
    }
}
/**
 * Read the newest records, latest first.
 * @param limit - maximum records returned.
 * @returns parsed records; an unreadable or absent log yields an empty list.
 */
export function listAudit(limit) {
    const file = auditFile();
    if (!existsSync(file))
        return [];
    return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .reverse()
        .map(line => JSON.parse(line));
}
