import { randomUUID } from 'node:crypto';

/**
 * Typed builders for Penpot's `:changes` vocabulary (the `update-file` RPC's payload —
 * see docs/penpot-rpc-notes.md for how this was reverse-engineered from
 * common/src/app/common/files/changes.cljc and common/src/app/common/types/shape.cljc,
 * since none of it is published). This is the ONLY module that knows that raw shape;
 * everything above it (primitives/executor) works through these builders instead.
 *
 * Field names below are camelCase because Penpot's RPC content-negotiation converts
 * camelCase JSON <-> kebab-case Clojure keywords automatically (verified empirically —
 * see docs/penpot-rpc-notes.md) for `/api/rpc/command/*`, which `update-file` is.
 */

export interface Point {
    x: number;
    y: number;
}

export interface Fill {
    fillColor?: string;
    fillOpacity?: number;
}

export type ShapeType = 'frame' | 'group' | 'rect' | 'circle' | 'text' | 'path' | 'bool' | 'image' | 'svg-raw';

export interface MinimalShapeInput {
    type: ShapeType;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    parentId: string;
    frameId: string;
    fills?: Fill[];
    strokes?: unknown[];
    opacity?: number;
    rotation?: number; // kept at 0 in v1 — see note on computeGeometry below
    r1?: number;
    r2?: number;
    r3?: number;
    r4?: number;
    // frame/group require their own (initially empty) children list
    shapes?: string[];
    // text-only
    content?: unknown;
}

export interface PenpotShapeObject extends Record<string, unknown> {
    id: string;
    name: string;
    type: ShapeType;
    x: number;
    y: number;
    width: number;
    height: number;
    selrect: { x: number; y: number; width: number; height: number; x1: number; y1: number; x2: number; y2: number };
    points: [Point, Point, Point, Point];
    transform: { a: number; b: number; c: number; d: number; e: number; f: number };
    transformInverse: { a: number; b: number; c: number; d: number; e: number; f: number };
    parentId: string;
    frameId: string;
}

const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Computes the derived geometry fields (`selrect`/`points`/`transform*`) every shape
 * needs. v1 only ever emits an identity transform (rotation 0) — real rotation support
 * needs proper matrix math we haven't verified against a live instance yet (flagged in
 * the plan as a later-phase risk, not attempted here).
 */
function computeGeometry(x: number, y: number, width: number, height: number) {
    return {
        selrect: { x, y, width, height, x1: x, y1: y, x2: x + width, y2: y + height },
        points: [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height }
        ] as [Point, Point, Point, Point],
        transform: { ...IDENTITY_MATRIX },
        transformInverse: { ...IDENTITY_MATRIX }
    };
}

export function newShapeId(): string {
    return randomUUID();
}

export function makeShapeObject(id: string, input: MinimalShapeInput): PenpotShapeObject {
    const { selrect, points, transform, transformInverse } = computeGeometry(input.x, input.y, input.width, input.height);
    const obj: PenpotShapeObject = {
        id,
        name: input.name,
        type: input.type,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        selrect,
        points,
        transform,
        transformInverse,
        parentId: input.parentId,
        frameId: input.frameId,
        rotation: input.rotation ?? 0,
        opacity: input.opacity ?? 1,
        fills: input.fills ?? [],
        strokes: input.strokes ?? []
    };
    if (input.type === 'frame' || input.type === 'group') obj.shapes = input.shapes ?? [];
    if (input.type === 'rect' || input.type === 'frame') {
        if (input.r1 !== undefined) obj.r1 = input.r1;
        if (input.r2 !== undefined) obj.r2 = input.r2;
        if (input.r3 !== undefined) obj.r3 = input.r3;
        if (input.r4 !== undefined) obj.r4 = input.r4;
    }
    if (input.type === 'text' && input.content) obj.content = input.content;
    return obj;
}

// --- Change builders -------------------------------------------------------

export type PenpotChange = Record<string, unknown>;

export function addObj(opts: {
    pageId: string;
    obj: PenpotShapeObject;
    frameId: string;
    parentId?: string;
    index?: number;
}): PenpotChange {
    return {
        type: 'add-obj',
        id: opts.obj.id,
        pageId: opts.pageId,
        frameId: opts.frameId,
        parentId: opts.parentId,
        index: opts.index,
        obj: opts.obj
    };
}

export interface SetOperation {
    type: 'set';
    attr: string;
    val: unknown;
}

export function modObj(opts: { id: string; pageId: string; operations: SetOperation[] }): PenpotChange {
    return { type: 'mod-obj', id: opts.id, pageId: opts.pageId, operations: opts.operations };
}

export function setOp(attr: string, val: unknown): SetOperation {
    return { type: 'set', attr, val };
}

export function delObj(opts: { id: string; pageId: string }): PenpotChange {
    return { type: 'del-obj', id: opts.id, pageId: opts.pageId };
}

export function movObjects(opts: { pageId: string; parentId: string; shapes: string[]; index?: number }): PenpotChange {
    return { type: 'mov-objects', pageId: opts.pageId, parentId: opts.parentId, shapes: opts.shapes, index: opts.index };
}

/** Re-registers derived indices after structural changes. Penpot's own frontend always
 *  follows an add-obj/mov-objects batch with one of these for the affected parent set. */
export function regObjects(opts: { pageId: string; shapes: string[] }): PenpotChange {
    return { type: 'reg-objects', pageId: opts.pageId, shapes: opts.shapes };
}

export function addPage(opts: { name: string; id?: string }): PenpotChange {
    return { type: 'add-page', id: opts.id ?? newShapeId(), name: opts.name };
}
