import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PenpotRpcClient } from '../../src/penpot/rpcClient.js';
import { fetchFile, findPage, findShape } from '../../src/penpot/fileData.js';
import { executePlan } from '../../src/tools/useFigma/executor.js';
import type { PrimitiveOp } from '../../src/tools/useFigma/primitives/types.js';

/**
 * Exercises the write path's Penpot mechanics (changes.ts builders + submitChanges'
 * revn/vern handling + the actual `update-file` RPC) directly, WITHOUT the LLM
 * interpreter — this is deliberately a separate test from the interpreter's own tests
 * because this is the part the plan flagged as the biggest real risk (Penpot's raw
 * shape/change schema is reverse-engineered, not documented), and it doesn't need an
 * Anthropic API key to run. See docs/penpot-rpc-notes.md for the schema this proves out.
 */

const BASE_URL = process.env.PENPOT_BASE_URL ?? 'http://localhost:9001';
const TOKEN = process.env.PENPOT_ACCESS_TOKEN;
const FILE_ID = process.env.PENPOT_TARGET_FILE_ID;
if (!TOKEN || !FILE_ID) throw new Error('PENPOT_ACCESS_TOKEN and PENPOT_TARGET_FILE_ID must be set (source .env before running)');

const penpot = new PenpotRpcClient(BASE_URL, TOKEN);
let rootFrameId: string;

before(async () => {
    const file = await fetchFile(penpot, FILE_ID);
    const page = findPage(file);
    const root = findShape(page, '00000000-0000-0000-0000-000000000000');
    rootFrameId = root.shapes?.[0] ?? '';
    assert.ok(rootFrameId, 'fixture file must have at least one top-level frame to create test nodes under');
});

test('create_node -> update_node_properties -> delete_node round-trips against the real Penpot instance', async () => {
    const file = await fetchFile(penpot, FILE_ID);
    const page = findPage(file);
    const revnBefore = file.revn;

    const createOp: PrimitiveOp = {
        op: 'create_node',
        parentId: rootFrameId,
        type: 'rect',
        name: 'integration-test-rect',
        x: 5000,
        y: 5000,
        width: 40,
        height: 20,
        fillColor: '#ff00ff'
    };
    const createResult = await executePlan(penpot, FILE_ID, page, [createOp], 'create test rect');
    assert.equal(createResult.changeCount, 1);
    assert.equal(createResult.newRevn, revnBefore + 1, 'reported revn must be the NEW revision, not the pre-update one Penpot\'s RPC returns');
    const newNodeId = createResult.affectedNodeIds[0]!;

    // Verify it actually landed with the right geometry/fill.
    const afterCreate = await fetchFile(penpot, FILE_ID);
    const pageAfterCreate = findPage(afterCreate);
    assert.equal(afterCreate.revn, revnBefore + 1);
    const created = findShape(pageAfterCreate, newNodeId);
    assert.equal(created.name, 'integration-test-rect');
    assert.equal(created.type, 'rect');
    assert.equal(created.x, 5000);
    assert.equal(created.width, 40);
    assert.deepEqual(created.fills, [{ fillColor: '#ff00ff', fillOpacity: 1 }]);

    const updateOp: PrimitiveOp = {
        op: 'update_node_properties',
        nodeId: newNodeId,
        name: 'integration-test-rect-renamed',
        fillColor: '#00ff00'
    };
    await executePlan(penpot, FILE_ID, pageAfterCreate, [updateOp], 'rename and recolor test rect');

    const afterUpdate = await fetchFile(penpot, FILE_ID);
    const pageAfterUpdate = findPage(afterUpdate);
    const updated = findShape(pageAfterUpdate, newNodeId);
    assert.equal(updated.name, 'integration-test-rect-renamed');
    assert.deepEqual(updated.fills, [{ fillColor: '#00ff00', fillOpacity: 1 }]);

    const deleteOp: PrimitiveOp = { op: 'delete_node', nodeId: newNodeId };
    await executePlan(penpot, FILE_ID, pageAfterUpdate, [deleteOp], 'remove test rect');

    const afterDelete = await fetchFile(penpot, FILE_ID);
    const pageAfterDelete = findPage(afterDelete);
    assert.equal(pageAfterDelete.objects[newNodeId], undefined, 'deleted node should no longer be in the objects map');
    assert.ok(!pageAfterDelete.objects[rootFrameId]!.shapes?.includes(newNodeId), 'deleted node should be removed from its parent’s children list too');
});

test('set_auto_layout only accepts frames', async () => {
    const file = await fetchFile(penpot, FILE_ID);
    const page = findPage(file);
    // rootFrameId's first child in the fixture file is a real frame — but pick any
    // non-frame if this fixture ever changes, so the assertion is about the *rejection*,
    // not a specific id.
    const nonFrame = Object.values(page.objects).find(o => o.type !== 'frame' && o.id !== '00000000-0000-0000-0000-000000000000');
    assert.ok(nonFrame, 'fixture file should contain at least one non-frame shape');

    const op: PrimitiveOp = { op: 'set_auto_layout', nodeId: nonFrame!.id, direction: 'row' };
    await assert.rejects(() => executePlan(penpot, FILE_ID, page, [op], 'should fail'), /auto-layout can only be set on a frame/);
});

test('set_auto_layout applies real flex fields to a frame, then cleans up', async () => {
    const file = await fetchFile(penpot, FILE_ID);
    const page = findPage(file);

    const createFrameOp: PrimitiveOp = {
        op: 'create_node',
        parentId: rootFrameId,
        type: 'frame',
        name: 'integration-test-layout-frame',
        x: 5000,
        y: 5200,
        width: 200,
        height: 100
    };
    const created = await executePlan(penpot, FILE_ID, page, [createFrameOp], 'create test frame');
    const frameId = created.affectedNodeIds[0]!;

    const layoutOp: PrimitiveOp = {
        op: 'set_auto_layout',
        nodeId: frameId,
        direction: 'column',
        gap: 12,
        padding: 8,
        justifyContent: 'center',
        alignItems: 'stretch'
    };
    const pageAfterCreate = findPage(await fetchFile(penpot, FILE_ID));
    await executePlan(penpot, FILE_ID, pageAfterCreate, [layoutOp], 'apply auto-layout');

    const pageAfterLayout = findPage(await fetchFile(penpot, FILE_ID));
    const frame = findShape(pageAfterLayout, frameId);
    assert.equal(frame.layout, 'flex');
    assert.equal(frame.layoutFlexDir, 'column');
    assert.deepEqual(frame.layoutGap, { rowGap: 12, columnGap: 12 });
    assert.deepEqual(frame.layoutPadding, { p1: 8, p2: 8, p3: 8, p4: 8 });
    assert.equal(frame.layoutJustifyContent, 'center');
    assert.equal(frame.layoutAlignItems, 'stretch');

    await executePlan(penpot, FILE_ID, pageAfterLayout, [{ op: 'delete_node', nodeId: frameId }], 'clean up test frame');
});
