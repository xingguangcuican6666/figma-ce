import { z } from 'zod/v4';

/**
 * Internal primitive operations the `use_figma` interpreter may emit. These are NEVER
 * exposed as separate MCP tools (the user's locked-in "strict shape" decision — see the
 * approved plan) — they exist only so the LLM's hallucination surface is a small, typed
 * vocabulary instead of Penpot's raw (undocumented) change schema.
 */

const fillColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a 6-digit hex color like #12161c');

export const CreateNodeOp = z.object({
    op: z.literal('create_node'),
    parentId: z.string().describe('Id of the frame/group this new node is placed inside'),
    type: z.enum(['frame', 'rect', 'circle', 'text']),
    name: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    fillColor: fillColor.optional(),
    cornerRadius: z.number().nonnegative().optional().describe('rect/frame only'),
    text: z.string().optional().describe('text type only: the text content')
});

export const UpdateNodePropertiesOp = z.object({
    op: z.literal('update_node_properties'),
    nodeId: z.string(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    fillColor: fillColor.optional(),
    opacity: z.number().min(0).max(1).optional(),
    text: z.string().optional().describe('text nodes only: replaces the text content')
});

export const DeleteNodeOp = z.object({
    op: z.literal('delete_node'),
    nodeId: z.string()
});

export const MoveNodeOp = z.object({
    op: z.literal('move_node'),
    nodeId: z.string(),
    newParentId: z.string(),
    index: z.number().int().nonnegative().optional().describe('position among the new parent’s children; appended to the end if omitted')
});

export const SetAutoLayoutOp = z.object({
    op: z.literal('set_auto_layout'),
    nodeId: z.string().describe('must be a frame'),
    direction: z.enum(['row', 'column']),
    gap: z.number().nonnegative().optional(),
    padding: z.number().nonnegative().optional().describe('applied equally to all four sides'),
    justifyContent: z.enum(['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly']).optional(),
    alignItems: z.enum(['start', 'center', 'end', 'stretch']).optional()
});

export const AddPageOp = z.object({
    op: z.literal('add_page'),
    name: z.string()
});

export const PrimitiveOp = z.discriminatedUnion('op', [
    CreateNodeOp,
    UpdateNodePropertiesOp,
    DeleteNodeOp,
    MoveNodeOp,
    SetAutoLayoutOp,
    AddPageOp
]);
export type PrimitiveOp = z.infer<typeof PrimitiveOp>;

/**
 * The interpreter's top-level structured output: either a plan, or — when the
 * instruction is ambiguous (which node? which value?) — a clarification request instead
 * of a guess. Built in from day one per the plan, not bolted on later.
 */
export const InterpreterOutput = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('plan'),
        summary: z.string().describe('one sentence describing what this plan will do, for the tool response'),
        operations: z.array(PrimitiveOp).min(1)
    }),
    z.object({
        type: z.literal('clarification_needed'),
        question: z.string().describe('a specific question whose answer would resolve the ambiguity')
    })
]);
export type InterpreterOutput = z.infer<typeof InterpreterOutput>;
