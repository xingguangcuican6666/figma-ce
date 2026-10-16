import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { PenpotRpcClient } from '../../penpot/rpcClient.js';
import { fetchFile, findPage } from '../../penpot/fileData.js';
import type { Config } from '../../config.js';
import { requireWriteScope } from '../../auth/verifier.js';
import { buildContext } from './contextBuilder.js';
import { interpretInstruction, InterpreterError } from './llmClient.js';
import { executePlan } from './executor.js';
import { appendAuditEntry } from '../../logging/auditLog.js';

/**
 * Figma's real `use_figma` is one coarse, natural-language-driven tool (no granular
 * create_rectangle/set_fill-style tools) — the user's locked-in "strict shape" decision
 * means we mirror that externally, and keep the granular primitives entirely internal
 * (see src/tools/useFigma/primitives). This handler is the seam: NL in, Penpot
 * `update-file` changes out, NL + node ids back.
 */
export function registerUseFigmaTool(
    server: McpServer,
    deps: { penpot: PenpotRpcClient; config: Config }
): void {
    server.registerTool(
        'use_figma',
        {
            title: 'Use Figma',
            description:
                'General-purpose create, edit, and inspect. Describe what you want changed in natural ' +
                'language (e.g. "add a new frame", "update the button to use the correct fill color", ' +
                '"fix the auto-layout spacing"); this tool plans and applies the edit itself. ' +
                'Requires a read-write adapter token.',
            inputSchema: {
                instruction: z.string().min(1),
                pageId: z.string().optional()
            }
        },
        async ({ instruction, pageId }, extra) => {
            const clientId = extra.authInfo?.clientId ?? 'unknown';
            const timestamp = new Date().toISOString();

            try {
                requireWriteScope(extra.authInfo);
            } catch (err) {
                const message = (err as Error).message;
                await appendAuditEntry({ timestamp, clientId, instruction, outcome: 'error', errorMessage: message });
                return { content: [{ type: 'text', text: message }], isError: true };
            }

            const fileId = deps.config.penpot.targetFileId;
            if (!fileId) {
                return { content: [{ type: 'text', text: 'No PENPOT_TARGET_FILE_ID configured on this adapter.' }], isError: true };
            }
            if (!deps.config.anthropic) {
                return {
                    content: [{ type: 'text', text: 'No Anthropic credentials configured on this adapter — use_figma needs them to interpret instructions.' }],
                    isError: true
                };
            }

            const file = await fetchFile(deps.penpot, fileId);
            const page = findPage(file, pageId);
            const context = buildContext(file, page);
            const beforeRevn = file.revn;

            let interpreted;
            try {
                interpreted = await interpretInstruction(deps.config.anthropic, context, instruction);
            } catch (err) {
                if (err instanceof InterpreterError) {
                    await appendAuditEntry({ timestamp, clientId, instruction, outcome: 'error', beforeRevn, errorMessage: err.message });
                    return { content: [{ type: 'text', text: `Could not plan this instruction: ${err.message}` }], isError: true };
                }
                throw err;
            }

            if (interpreted.type === 'clarification_needed') {
                await appendAuditEntry({
                    timestamp,
                    clientId,
                    instruction,
                    outcome: 'clarification_requested',
                    summary: interpreted.question,
                    beforeRevn
                });
                return { content: [{ type: 'text', text: interpreted.question }] };
            }

            // Fail-closed: a failure here means NOTHING was applied (no partial state —
            // see executePlan, which builds the whole change batch before submitting any
            // of it). We deliberately do not auto-retry a mid-flight failure (plan notes).
            let result;
            try {
                result = await executePlan(deps.penpot, fileId, page, interpreted.operations, interpreted.summary);
            } catch (err) {
                await appendAuditEntry({
                    timestamp,
                    clientId,
                    instruction,
                    outcome: 'error',
                    summary: interpreted.summary,
                    operations: interpreted.operations,
                    beforeRevn,
                    errorMessage: (err as Error).message
                });
                throw err;
            }

            await appendAuditEntry({
                timestamp,
                clientId,
                instruction,
                outcome: 'plan_applied',
                summary: result.summary,
                operations: interpreted.operations,
                changeCount: result.changeCount,
                beforeRevn,
                afterRevn: result.newRevn,
                affectedNodeIds: result.affectedNodeIds
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: `${result.summary}\nApplied ${result.changeCount} change(s), file is now at revision ${result.newRevn}. Affected nodes: ${result.affectedNodeIds.join(', ') || '(none)'}`
                    }
                ],
                structuredContent: result as unknown as Record<string, unknown>
            };
        }
    );
}
