import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InterpreterOutput, PrimitiveOp } from '../../src/tools/useFigma/primitives/types.js';

/**
 * Pure schema/logic unit tests for the use_figma interpreter's contract — no network,
 * no Penpot, no Anthropic call. These catch schema drift/typos independently of whether
 * a real LLM call can be exercised (see docs/penpot-rpc-notes.md for why that's currently
 * blocked on an ANTHROPIC_API_KEY decision).
 */

test('InterpreterOutput accepts a well-formed plan', () => {
    const result = InterpreterOutput.safeParse({
        type: 'plan',
        summary: 'Add a rectangle',
        operations: [{ op: 'create_node', parentId: 'p1', type: 'rect', name: 'r', x: 0, y: 0, width: 10, height: 10 }]
    });
    assert.ok(result.success, result.success ? undefined : result.error.message);
});

test('InterpreterOutput accepts a well-formed clarification request', () => {
    const result = InterpreterOutput.safeParse({ type: 'clarification_needed', question: 'Which button do you mean?' });
    assert.ok(result.success);
});

test('InterpreterOutput rejects a plan with zero operations (must ask or act, never a no-op plan)', () => {
    const result = InterpreterOutput.safeParse({ type: 'plan', summary: 'nothing', operations: [] });
    assert.equal(result.success, false);
});

test('InterpreterOutput rejects an unknown discriminator', () => {
    const result = InterpreterOutput.safeParse({ type: 'do_something_else' });
    assert.equal(result.success, false);
});

test('PrimitiveOp rejects a fill color that is not a 6-digit hex', () => {
    const result = PrimitiveOp.safeParse({
        op: 'update_node_properties',
        nodeId: 'n1',
        fillColor: 'blue'
    });
    assert.equal(result.success, false);
});

test('PrimitiveOp rejects set_auto_layout on an invalid direction value (hallucination guard)', () => {
    const result = PrimitiveOp.safeParse({ op: 'set_auto_layout', nodeId: 'n1', direction: 'diagonal' });
    assert.equal(result.success, false);
});

test('PrimitiveOp accepts each of the six real primitives with their minimal required fields', () => {
    const cases = [
        { op: 'create_node', parentId: 'p', type: 'frame', name: 'f', x: 0, y: 0, width: 1, height: 1 },
        { op: 'update_node_properties', nodeId: 'n' },
        { op: 'delete_node', nodeId: 'n' },
        { op: 'move_node', nodeId: 'n', newParentId: 'p' },
        { op: 'set_auto_layout', nodeId: 'n', direction: 'row' },
        { op: 'add_page', name: 'Page 2' }
    ];
    for (const c of cases) {
        const result = PrimitiveOp.safeParse(c);
        assert.ok(result.success, `${c.op} should validate: ${result.success ? '' : result.error.message}`);
    }
});
