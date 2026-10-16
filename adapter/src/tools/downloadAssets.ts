import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { PenpotRpcClient } from '../penpot/rpcClient.js';
import type { PenpotExportClient, PenpotExportFormat } from '../penpot/exportClient.js';
import { fetchFile, findPage, findShape } from '../penpot/fileData.js';
import type { Config } from '../config.js';

const MAX_NODES = 20; // mirrors Figma's documented per-call cap

export function registerDownloadAssetsTool(
    server: McpServer,
    deps: { penpot: PenpotRpcClient; exporter: PenpotExportClient; config: Config }
): void {
    server.registerTool(
        'download_assets',
        {
            title: 'Download assets',
            description:
                `Exports up to ${MAX_NODES} nodes as downloadable images (PNG/JPG/SVG/PDF). ` +
                'Unlike get_screenshot this is for delivering/transferring assets, not just visual inspection. ' +
                'Note: raw (pre-render) source image fills are not yet implemented — every result here is a fresh render.',
            inputSchema: {
                nodeIds: z.array(z.string()).min(1).max(MAX_NODES),
                pageId: z.string().optional(),
                format: z.enum(['png', 'svg', 'pdf', 'jpeg', 'webp']).default('png'),
                scale: z.number().min(0.01).max(4).default(1)
            }
        },
        async ({ nodeIds, pageId, format, scale }) => {
            const fileId = deps.config.penpot.targetFileId;
            if (!fileId) {
                return { content: [{ type: 'text', text: 'No PENPOT_TARGET_FILE_ID configured on this adapter.' }], isError: true };
            }
            const file = await fetchFile(deps.penpot, fileId);
            const page = findPage(file, pageId);

            const results = await Promise.all(
                nodeIds.map(async nodeId => {
                    const shape = findShape(page, nodeId); // throws per-node if missing; fine-grained errors below instead
                    const exported = await deps.exporter.exportShape({
                        pageId: page.id,
                        fileId,
                        objectId: nodeId,
                        type: format as PenpotExportFormat,
                        scale,
                        name: shape.name
                    });
                    const { bytes, mtype } = await deps.exporter.downloadAsset(exported.uri, deps.config.penpot.accessToken);
                    return { nodeId, name: shape.name, mtype, bytes };
                })
            );

            return {
                content: [
                    { type: 'text', text: `Exported ${results.length} node(s) as ${format}.` },
                    ...results.map(r => ({ type: 'image' as const, data: Buffer.from(r.bytes).toString('base64'), mimeType: r.mtype }))
                ],
                structuredContent: {
                    assets: results.map(r => ({ nodeId: r.nodeId, name: r.name, mtype: r.mtype, sizeBytes: r.bytes.length }))
                }
            };
        }
    );
}
