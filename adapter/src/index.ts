import type { Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { loadConfig } from './config.js';
import { PenpotRpcClient } from './penpot/rpcClient.js';
import { PenpotExportClient } from './penpot/exportClient.js';
import { TokenStore } from './auth/tokenStore.js';
import { createVerifier } from './auth/verifier.js';
import { createServer } from './mcp/server.js';

const config = loadConfig();

const penpot = new PenpotRpcClient(config.penpot.baseUrl, config.penpot.accessToken);
const exporter = new PenpotExportClient(
    config.penpot.baseUrl,
    config.penpot.botEmail,
    config.penpot.botPassword,
    config.penpot.botProfileId
);
const tokenStore = new TokenStore({
    readonlyToken: config.adapterTokens.readonly,
    readwriteToken: config.adapterTokens.readwrite
});
const auth = requireBearerAuth({ verifier: createVerifier(tokenStore) });

const app = createMcpExpressApp({ host: config.host });

function jsonRpcError(res: Response, status: number, message: string): void {
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

app.post('/mcp', auth, async (req: Request, res: Response) => {
    try {
        const server = createServer({ penpot, exporter, config });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
            transport.close();
            server.close();
        });
    } catch (err) {
        console.error('Error handling MCP request:', err);
        if (!res.headersSent) {
            jsonRpcError(res, 500, 'Internal server error');
        }
    }
});

app.get('/mcp', auth, (_req: Request, res: Response) => {
    jsonRpcError(res, 405, 'Method not allowed. This adapter runs stateless Streamable HTTP (POST only).');
});

app.delete('/mcp', auth, (_req: Request, res: Response) => {
    jsonRpcError(res, 405, 'Method not allowed. This adapter runs stateless Streamable HTTP (POST only).');
});

app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(config.port, config.host, () => {
    console.log(`figma-shape-adapter listening on http://${config.host}:${config.port}/mcp`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
