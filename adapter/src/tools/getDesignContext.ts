import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { PenpotRpcClient } from '../penpot/rpcClient.js';
import { fetchFile, findPage, findShape, rootShape, type PenpotShape } from '../penpot/fileData.js';
import { extractTextContent } from '../penpot/fileData.js';
import type { Config } from '../config.js';

interface DesignNode {
    id: string;
    name: string;
    type: string;
    geometry?: { x: number; y: number; width: number; height: number; rotation?: number };
    hidden?: boolean;
    opacity?: number;
    blendMode?: string;
    fills?: unknown[];
    strokes?: unknown[];
    text?: string;
    appliedTokens?: Record<string, string>;
    componentId?: string;
    children?: DesignNode[];
}

function toDesignNode(page: ReturnType<typeof findPage>, shape: PenpotShape, depth: number, maxDepth: number): DesignNode {
    const node: DesignNode = { id: shape.id, name: shape.name, type: shape.type };
    if (shape.x !== undefined && shape.y !== undefined && shape.width !== undefined && shape.height !== undefined) {
        node.geometry = { x: shape.x, y: shape.y, width: shape.width, height: shape.height, rotation: shape.rotation };
    }
    if (shape.hidden) node.hidden = true;
    if (shape.opacity !== undefined && shape.opacity !== 1) node.opacity = shape.opacity;
    if (shape.blendMode && shape.blendMode !== 'normal') node.blendMode = shape.blendMode;
    if (shape.fills?.length) node.fills = shape.fills;
    if (shape.strokes?.length) node.strokes = shape.strokes;
    if (shape.appliedTokens && Object.keys(shape.appliedTokens).length) node.appliedTokens = shape.appliedTokens;
    if (shape.componentId) node.componentId = shape.componentId;
    const text = extractTextContent(shape);
    if (text) node.text = text;

    if (depth < maxDepth && shape.shapes?.length) {
        node.children = shape.shapes.map(childId => toDesignNode(page, findShape(page, childId), depth + 1, maxDepth));
    }
    return node;
}

/**
 * This is an intentional v1 simplification, not a literal copy of Figma's get_design_context:
 * Figma's real tool generates framework-specific code (React+Tailwind by default) server-side.
 * We instead return the cleaned-up structural/style data (geometry, fills, text, design-token
 * references) as JSON and let the calling AI client do its own code generation from it — the
 * plan calls this out explicitly rather than trying to hide it. See the approved plan, Phase 2.
 */
export function registerGetDesignContextTool(server: McpServer, deps: { penpot: PenpotRpcClient; config: Config }): void {
    server.registerTool(
        'get_design_context',
        {
            title: 'Get design context',
            description:
                'Returns structured design data (geometry, fills/strokes, text, design-token references, ' +
                'child hierarchy) for a node or the whole page, for the calling agent to turn into code itself. ' +
                'Unlike Figma, this does not generate framework code server-side — see tool notes.',
            inputSchema: {
                nodeId: z.string().optional().describe('Shape id to describe. Defaults to the whole page.'),
                pageId: z.string().optional().describe('Page id to look in. Defaults to the first/only page.'),
                maxDepth: z.number().int().min(0).max(30).default(12).describe('How many levels of children to include.')
            }
        },
        async ({ nodeId, pageId, maxDepth }) => {
            const fileId = deps.config.penpot.targetFileId;
            if (!fileId) {
                return { content: [{ type: 'text', text: 'No PENPOT_TARGET_FILE_ID configured on this adapter.' }], isError: true };
            }
            const file = await fetchFile(deps.penpot, fileId);
            const page = findPage(file, pageId);
            const shape = nodeId ? findShape(page, nodeId) : rootShape(page);

            const tree = toDesignNode(page, shape, 0, maxDepth);
            return {
                content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }],
                structuredContent: tree as unknown as Record<string, unknown>
            };
        }
    );
}
