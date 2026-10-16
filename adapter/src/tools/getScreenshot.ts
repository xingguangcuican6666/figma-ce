import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { PenpotRpcClient } from '../penpot/rpcClient.js';
import type { PenpotExportClient } from '../penpot/exportClient.js';
import { fetchFile, findPage, findShape } from '../penpot/fileData.js';
import type { Config } from '../config.js';

const ROOT_SHAPE_ID = '00000000-0000-0000-0000-000000000000';

export function registerGetScreenshotTool(
    server: McpServer,
    deps: { penpot: PenpotRpcClient; exporter: PenpotExportClient; config: Config }
): void {
    server.registerTool(
        'get_screenshot',
        {
            title: 'Get screenshot',
            description: 'Renders a node to a PNG image so the agent can visually check a design (or its own generated code against it).',
            inputSchema: {
                nodeId: z
                    .string()
                    .describe(
                        "Shape id to render — the page's own implicit root (all-zeros id) cannot be rendered directly; " +
                            'pass a real top-level frame/board id instead (call get_metadata first to find one).'
                    ),
                pageId: z.string().optional(),
                scale: z.number().min(0.01).max(4).default(1)
            }
        },
        async ({ nodeId, pageId, scale }) => {
            if (nodeId === ROOT_SHAPE_ID) {
                return {
                    content: [{ type: 'text', text: 'Cannot render the implicit page root directly — pass a real frame/shape id.' }],
                    isError: true
                };
            }
            const fileId = deps.config.penpot.targetFileId;
            if (!fileId) {
                return { content: [{ type: 'text', text: 'No PENPOT_TARGET_FILE_ID configured on this adapter.' }], isError: true };
            }
            const file = await fetchFile(deps.penpot, fileId);
            const page = findPage(file, pageId);
            const shape = findShape(page, nodeId);

            const result = await deps.exporter.exportShape({
                pageId: page.id,
                fileId,
                objectId: nodeId,
                type: 'png',
                scale,
                name: shape.name
            });
            const { bytes } = await deps.exporter.downloadAsset(result.uri, deps.config.penpot.accessToken);

            return {
                content: [
                    { type: 'text', text: `Screenshot of "${shape.name}" (${shape.type}), ${shape.width}×${shape.height}px at ${scale}x scale.` },
                    { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: result.mtype }
                ]
            };
        }
    );
}
