import type { PenpotPage } from '../../../penpot/fileData.js';
import { findShape } from '../../../penpot/fileData.js';
import {
    addObj,
    delObj,
    makeShapeObject,
    modObj,
    movObjects,
    newShapeId,
    setOp,
    type PenpotChange
} from '../../../penpot/changes.js';
import { kw } from '../../../penpot/transitEncode.js';
import type { PrimitiveOp } from './types.js';

const ROOT_SHAPE_ID = '00000000-0000-0000-0000-000000000000';

/** Walks up `parentId` links to find the nearest frame — a new shape's `frameId` must
 *  name an actual frame, not an arbitrary group ancestor. */
function nearestFrameId(page: PenpotPage, fromId: string): string {
    let current = fromId;
    for (let i = 0; i < 64; i++) {
        if (current === ROOT_SHAPE_ID) return ROOT_SHAPE_ID;
        const shape = findShape(page, current);
        if (shape.type === 'frame') return current;
        if (!shape.parentId) return ROOT_SHAPE_ID;
        current = shape.parentId;
    }
    throw new Error(`Could not resolve a frame ancestor for ${fromId} (parent chain too deep or cyclic)`);
}

function hexToFill(hex: string): { fillColor: string; fillOpacity: number } {
    return { fillColor: hex, fillOpacity: 1 };
}

/** Translates one validated primitive into the Penpot change(s) that implement it.
 *  Each op maps to exactly one or two `PenpotChange` entries — see individual cases. */
export function primitiveToChanges(op: PrimitiveOp, page: PenpotPage): PenpotChange[] {
    switch (op.op) {
        case 'create_node': {
            const id = newShapeId();
            const frameId = nearestFrameId(page, op.parentId);
            const obj = makeShapeObject(id, {
                type: op.type,
                name: op.name,
                x: op.x,
                y: op.y,
                width: op.width,
                height: op.height,
                parentId: op.parentId,
                frameId,
                fills: op.fillColor ? [hexToFill(op.fillColor)] : undefined,
                r1: op.cornerRadius,
                r2: op.cornerRadius,
                r3: op.cornerRadius,
                r4: op.cornerRadius,
                content: op.text ? textContent(op.text) : undefined
            });
            return [addObj({ pageId: page.id, obj, frameId, parentId: op.parentId })];
        }

        case 'update_node_properties': {
            findShape(page, op.nodeId); // throws clearly if missing
            const operations = [];
            if (op.name !== undefined) operations.push(setOp('name', op.name));
            if (op.x !== undefined) operations.push(setOp('x', op.x));
            if (op.y !== undefined) operations.push(setOp('y', op.y));
            if (op.width !== undefined) operations.push(setOp('width', op.width));
            if (op.height !== undefined) operations.push(setOp('height', op.height));
            if (op.opacity !== undefined) operations.push(setOp('opacity', op.opacity));
            if (op.fillColor !== undefined) operations.push(setOp('fills', [hexToFill(op.fillColor)]));
            if (op.text !== undefined) operations.push(setOp('content', textContent(op.text)));
            if (!operations.length) return [];
            return [modObj({ id: op.nodeId, pageId: page.id, operations })];
        }

        case 'delete_node': {
            findShape(page, op.nodeId);
            return [delObj({ id: op.nodeId, pageId: page.id })];
        }

        case 'move_node': {
            findShape(page, op.nodeId);
            findShape(page, op.newParentId);
            return [movObjects({ pageId: page.id, parentId: op.newParentId, shapes: [op.nodeId], index: op.index })];
        }

        case 'set_auto_layout': {
            const shape = findShape(page, op.nodeId);
            if (shape.type !== 'frame') {
                throw new Error(`set_auto_layout targets "${shape.name}" (${shape.type}) — auto-layout can only be set on a frame`);
            }
            const operations = [
                setOp('layout', kw('flex')),
                setOp('layoutFlexDir', kw(op.direction)),
                ...(op.gap !== undefined ? [setOp('layoutGap', { rowGap: op.gap, columnGap: op.gap })] : []),
                ...(op.padding !== undefined
                    ? [setOp('layoutPadding', { p1: op.padding, p2: op.padding, p3: op.padding, p4: op.padding })]
                    : []),
                ...(op.justifyContent !== undefined ? [setOp('layoutJustifyContent', kw(op.justifyContent))] : []),
                ...(op.alignItems !== undefined ? [setOp('layoutAlignItems', kw(op.alignItems))] : [])
            ];
            return [modObj({ id: op.nodeId, pageId: page.id, operations })];
        }

        case 'add_page': {
            // add-page is file-scoped, not page-scoped — handled directly in the executor
            // since it doesn't need the current `page` context this function takes.
            throw new Error('add_page must be handled by the executor directly, not primitiveToChanges');
        }
    }
}

function textContent(text: string): unknown {
    // Minimal valid Penpot text-content tree (root -> paragraph-set -> paragraph -> run).
    return {
        type: 'root',
        children: [
            {
                type: 'paragraph-set',
                children: [
                    {
                        type: 'paragraph',
                        children: [{ text }]
                    }
                ]
            }
        ]
    };
}
