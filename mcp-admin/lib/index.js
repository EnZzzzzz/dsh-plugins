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
import z from '@deepseek-ai/schemastery';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { listAudit } from './audit.js';
import { createMcpAdminServer } from './mcp-server.js';
export const name = 'mcp-admin';
/** The harness services this plugin requires before it activates. */
export const inject = ['webServer', 'agentPresets'];
/** Settings namespace id of this plugin's config surface. */
const MCP_ADMIN_SETTINGS_NAMESPACE = 'mcp-admin';
/** Schema for the settings namespace; optionality is expressed in the TS type. */
export const McpAdminSettingsSchema = z.object({
    publicUrl: z.string().description('远程 Agent 访问本服务的地址，如 http://1.2.3.4:3080；留空则跟随你打开本页的地址'),
});
/** Strip trailing slashes; empty string normalizes to undefined. */
function normalizePublicUrl(value) {
    return value?.replace(/\/+$/, '') || undefined;
}
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
    // Mutable runtime setting: setup-info reads it per call, so Settings page
    // edits apply without a restart.
    let runtimePublicUrl = normalizePublicUrl(config.publicUrl);
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
    // The Settings dashboard reads the audit trail, the setup payload, and the
    // editable settings over this channel. Deferred inject: compositions
    // without these services (non-web profiles) simply skip the channel.
    // 'trusted-host' authority — remote browsers on declared trusted hosts may
    // read. `setup-info` returns the bearer token: anyone who can open the Web
    // UI can already drive agents through `/api`, so handing the token to the
    // same audience adds no new exposure.
    ctx.inject(['connection', 'settings'], (apiCtx) => {
        const scope = apiCtx.settings.register(MCP_ADMIN_SETTINGS_NAMESPACE, McpAdminSettingsSchema, {
            // The boot-time cordis config is the composition base; the user layer
            // (settings.yaml, written by the page) overrides it.
            base: { publicUrl: config.publicUrl ?? '' },
            applies: 'live',
        });
        runtimePublicUrl = normalizePublicUrl(scope.get().publicUrl);
        apiCtx.effect(() => scope.watch((next) => { runtimePublicUrl = normalizePublicUrl(next.publicUrl); }), 'mcp-admin: settings watch');
        apiCtx.connection.rpc.handle('/mcp-admin', async (endpoint, payload, _signal) => {
            switch (endpoint) {
                case 'audit.list':
                    return { ok: true, value: listAudit(auditLimit) };
                case 'setup-info':
                    return { ok: true, value: { token, publicUrl: runtimePublicUrl ?? null } };
                case 'get-config':
                    return { ok: true, value: scope.get() };
                case 'set-config': {
                    const patch = payload?.patch;
                    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
                        return {
                            ok: false,
                            error: { code: 'internal', message: 'set-config requires a JSON object patch', details: {} },
                        };
                    }
                    try {
                        await scope.update(patch);
                    }
                    catch (error) {
                        return {
                            ok: false,
                            error: {
                                code: 'internal',
                                message: error instanceof Error ? error.message : String(error),
                                details: {},
                            },
                        };
                    }
                    return { ok: true, value: scope.get() };
                }
                default:
                    return {
                        ok: false,
                        error: { code: 'internal', message: `unknown endpoint: ${endpoint}`, details: {} },
                    };
            }
        }, { authority: 'trusted-host' });
    });
}
