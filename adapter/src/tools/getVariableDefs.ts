import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { PenpotRpcClient } from '../penpot/rpcClient.js';
import { fetchFile, findPage, findShape, walkSubtree, type PenpotToken } from '../penpot/fileData.js';
import type { Config } from '../config.js';

/**
 * Penpot's token model (W3C design-tokens-style `$value`/`$type`/`$description` sets grouped
 * into themes) isn't semantically 1:1 with Figma's Variables (collections/modes) — we return
 * what Penpot actually has rather than faking Figma's shape. See the approved plan's note on
 * get_variable_defs for why.
 */
export function registerGetVariableDefsTool(server: McpServer, deps: { penpot: PenpotRpcClient; config: Config }): void {
    server.registerTool(
        'get_variable_defs',
        {
            title: 'Get variable/token definitions',
            description:
                'Returns the design tokens (colors, spacing, typography, etc.) defined in the file. ' +
                'If nodeId is given, scopes to tokens actually referenced (via appliedTokens) by that ' +
                'node and its descendants; otherwise returns every token set.',
            inputSchema: {
                nodeId: z.string().optional().describe('Shape id to scope tokens to. Omit for the whole file.'),
                pageId: z.string().optional()
            }
        },
        async ({ nodeId, pageId }) => {
            const fileId = deps.config.penpot.targetFileId;
            if (!fileId) {
                return { content: [{ type: 'text', text: 'No PENPOT_TARGET_FILE_ID configured on this adapter.' }], isError: true };
            }
            const file = await fetchFile(deps.penpot, fileId);
            const tokensLib = file.data.tokensLib ?? {};
            const tokenSets = Object.fromEntries(
                Object.entries(tokensLib).filter(([key]) => !key.startsWith('$'))
            ) as Record<string, Record<string, PenpotToken>>;

            if (!nodeId) {
                return {
                    content: [{ type: 'text', text: JSON.stringify(tokenSets, null, 2) }],
                    structuredContent: tokenSets
                };
            }

            const page = findPage(file, pageId);
            findShape(page, nodeId);
            const usedTokenNames = new Set<string>();
            for (const shape of walkSubtree(page, nodeId)) {
                for (const tokenName of Object.values(shape.appliedTokens ?? {})) {
                    usedTokenNames.add(tokenName);
                }
            }

            const scoped: Record<string, Record<string, PenpotToken>> = {};
            for (const [setName, tokens] of Object.entries(tokenSets)) {
                const matches = Object.fromEntries(Object.entries(tokens).filter(([name]) => usedTokenNames.has(name)));
                if (Object.keys(matches).length) scoped[setName] = matches;
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(scoped, null, 2) }],
                structuredContent: scoped
            };
        }
    );
}
