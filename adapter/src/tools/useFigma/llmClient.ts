import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { InterpreterOutput } from './primitives/types.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const SubmitPlanInput = z.object({ result: InterpreterOutput });

const SUBMIT_PLAN_TOOL = {
    name: 'submit_plan',
    description: 'Submit your plan or clarification request. Call this exactly once.',
    input_schema: z.toJSONSchema(SubmitPlanInput) as Anthropic.Tool.InputSchema
};

// Reuses this machine's Claude Code relay (user sign-off 2026-10-16) — only claude-sonnet-5
// is available through it, so unlike a normal "pick your model" default, this is the ONLY
// valid value right now, not merely the recommended one. Revisit if a dedicated Anthropic
// API key is added later (see docs/penpot-rpc-notes.md).
const DEFAULT_MODEL = 'claude-sonnet-5';

export class InterpreterError extends Error {}

export async function interpretInstruction(
    anthropicAuth: { authToken: string; baseUrl: string },
    contextBlock: string,
    instruction: string,
    model = DEFAULT_MODEL
): Promise<z.infer<typeof InterpreterOutput>> {
    const client = new Anthropic({ authToken: anthropicAuth.authToken, baseURL: anthropicAuth.baseUrl });
    const userMessage = `${contextBlock}\n\nInstruction: ${instruction}`;

    const call = (extra: Anthropic.MessageParam[] = []) =>
        client.messages.create({
            model,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: [SUBMIT_PLAN_TOOL],
            tool_choice: { type: 'tool', name: 'submit_plan' },
            messages: [{ role: 'user', content: userMessage }, ...extra]
        });

    const extractToolInput = (msg: Anthropic.Message): unknown => {
        const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (!block) throw new InterpreterError('Model did not call submit_plan');
        return block.input;
    };

    const firstResponse = await call();
    const firstInput = extractToolInput(firstResponse);
    const firstParsed = SubmitPlanInput.safeParse(firstInput);
    if (firstParsed.success) return firstParsed.data.result;

    // One bounded self-correction round-trip (plan Phase 3 failure-mode notes) — never loop.
    const toolUseBlock = firstResponse.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')!;
    const retryResponse = await call([
        { role: 'assistant', content: firstResponse.content },
        {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: toolUseBlock.id,
                    is_error: true,
                    content: `Your submit_plan input failed validation: ${firstParsed.error.message}. Call submit_plan again with corrected input.`
                }
            ]
        }
    ]);
    const retryInput = extractToolInput(retryResponse);
    const retryParsed = SubmitPlanInput.safeParse(retryInput);
    if (!retryParsed.success) {
        throw new InterpreterError(`Model's plan failed validation twice: ${retryParsed.error.message}`);
    }
    return retryParsed.data.result;
}
