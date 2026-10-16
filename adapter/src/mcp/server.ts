import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PenpotRpcClient } from '../penpot/rpcClient.js';
import type { PenpotExportClient } from '../penpot/exportClient.js';
import type { Config } from '../config.js';
import { registerWhoamiTool } from '../tools/whoami.js';
import { registerGetMetadataTool } from '../tools/getMetadata.js';
import { registerGetDesignContextTool } from '../tools/getDesignContext.js';
import { registerGetVariableDefsTool } from '../tools/getVariableDefs.js';
import { registerGetScreenshotTool } from '../tools/getScreenshot.js';
import { registerDownloadAssetsTool } from '../tools/downloadAssets.js';
import { registerUseFigmaTool } from '../tools/useFigma/index.js';

export interface ServerDeps {
    penpot: PenpotRpcClient;
    exporter: PenpotExportClient;
    config: Config;
}

/**
 * Builds a fresh McpServer with every tool registered. Called once per incoming HTTP
 * request (see src/index.ts) — this adapter runs Streamable HTTP in stateless mode, so
 * there is no session-scoped state to worry about here; each request gets its own
 * server+transport pair that is torn down when the response closes.
 */
export function createServer(deps: ServerDeps): McpServer {
    const server = new McpServer({ name: 'figma-shape-adapter', version: '0.1.0' }, { capabilities: { logging: {} } });

    registerWhoamiTool(server, deps);
    registerGetMetadataTool(server, deps);
    registerGetDesignContextTool(server, deps);
    registerGetVariableDefsTool(server, deps);
    registerGetScreenshotTool(server, deps);
    registerDownloadAssetsTool(server, deps);
    registerUseFigmaTool(server, deps);
    // Phase 3 (remaining): create_new_file, upload_assets

    return server;
}
