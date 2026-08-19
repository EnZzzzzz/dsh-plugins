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
 * ("MCP 管理") polls through the `/mcp-admin` RPC channel.
 *
 * The plugin is a plain function plugin: named exports only, no default
 * export (see docs/postmortem/0001 in the harness repo).
 *
 * @module dsh-mcp-admin
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { listAudit } from './audit.js';
import { createMcpAdminServer } from './mcp-server.js';
export const name = 'mcp-admin';
/** The harness services this plugin requires before it activates. */
export const inject = ['webServer', 'agentPresets'];
/** Read a JSON request body; non-JSON yields undefined (the transport reports it). */
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    if (chunks.length === 0)
        return undefined;
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        return undefined;
    }
}
/**
 * Mount the MCP endpoint and the dashboard RPC channel.
 * @param ctx - the plugin context (host root scope).
 * @param config - see {@link Config}.
 */
export function apply(ctx, config) {
    const token = config.token ?? '';
    if (token.length === 0) {
        throw new Error('mcp-admin: config.token is empty. Set a long random bearer token in the profile cordis.patch.yml — it is the only guard on /mcp.');
    }
    const auditLimit = config.auditLimit ?? 200;
    const handler = async (req, res) => {
        if (req.headers.authorization !== `Bearer ${token}`) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
        }
        // Stateless mode: no session state, so only POST carries meaning.
        if (req.method !== 'POST') {
            res.writeHead(405, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'method not allowed' }));
            return;
        }
        const body = await readBody(req);
        const server = createMcpAdminServer({ presets: ctx.agentPresets, auditLimit });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
    };
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/mcp', handler }), 'mcp-admin: /mcp route');
    // The Settings dashboard reads the audit trail over this channel. Deferred
    // inject: compositions without the connection service (non-web profiles)
    // simply skip the dashboard channel. 'trusted-host' authority — remote
    // browsers on declared trusted hosts may read; the audit trail carries no
    // secrets.
    ctx.inject(['connection'], (apiCtx) => {
        apiCtx.connection.rpc.handle('/mcp-admin', async (endpoint, _payload, _signal) => {
            switch (endpoint) {
                case 'audit.list':
                    return { ok: true, value: listAudit(auditLimit) };
                default:
                    return {
                        ok: false,
                        error: { code: 'internal', message: `unknown endpoint: ${endpoint}`, details: {} },
                    };
            }
        }, { authority: 'trusted-host' });
    });
}
