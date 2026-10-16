import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { PenpotRpcClient } from '../penpot/rpcClient.js';
import { buildSparseOutline, fetchFile, findPage, findShape } from '../penpot/fileData.js';
import type { Config } from '../config.js';

export function registerGetMetadataTool(server: McpServer, deps: { penpot: PenpotRpcClient; config: Config }): void {
    server.registerTool(
        'get_metadata',
        {
            title: 'Get metadata',
            description:
                'Returns a sparse outline of a node (id, name, type, position, size) and its descendants. ' +
                "Call without nodeId to list the file's pages first.",
            inputSchema: {
                nodeId: z.string().optional().describe('Shape id to outline. Omit to list the pages in the target file.'),
                pageId: z.string().optional().describe('Page id to look in. Defaults to the first/only page.')
            }
        },
        async ({ nodeId, pageId }) => {
            const fileId = deps.config.penpot.targetFileId;
            if (!fileId) {
                return { content: [{ type: 'text', text: 'No PENPOT_TARGET_FILE_ID configured on this adapter.' }], isError: true };
            }
            const file = await fetchFile(deps.penpot, fileId);

            if (!nodeId) {
                const pages = Object.values(file.data.pagesIndex).map(p => ({ id: p.id, name: p.name }));
                return {
                    content: [{ type: 'text', text: JSON.stringify({ pages }, null, 2) }],
                    structuredContent: { pages }
                };
            }

            const page = findPage(file, pageId);
            findShape(page, nodeId); // throws a clear error if the id doesn't exist
            const xml = buildSparseOutline(page, nodeId);
            return { content: [{ type: 'text', text: xml }] };
        }
    );
}
