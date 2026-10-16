import type { PenpotRpcClient } from './rpcClient.js';

export interface PenpotFill {
    fillColor?: string;
    fillOpacity?: number;
}

export interface PenpotShape {
    id: string;
    name: string;
    type: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    hidden?: boolean;
    opacity?: number;
    blendMode?: string;
    parentId?: string;
    frameId?: string;
    shapes?: string[]; // child shape ids, present on frame/group/board types
    fills?: PenpotFill[];
    strokes?: unknown[];
    appliedTokens?: Record<string, string>;
    content?: unknown; // text node tree, present on type === 'text'
    componentId?: string;
    componentFile?: string;
    [key: string]: unknown;
}

export interface PenpotPage {
    id: string;
    name: string;
    objects: Record<string, PenpotShape>;
}

export interface PenpotToken {
    $value: unknown;
    $type: string;
    $description?: string;
}

export interface PenpotFileData {
    id: string;
    name: string;
    projectId: string;
    revn: number;
    vern: number;
    data: {
        pagesIndex: Record<string, PenpotPage>;
        components?: Record<string, PenpotShape>;
        tokensLib?: Record<string, Record<string, PenpotToken> | unknown>;
    };
}

const ROOT_SHAPE_ID = '00000000-0000-0000-0000-000000000000';

export async function fetchFile(penpot: PenpotRpcClient, fileId: string): Promise<PenpotFileData> {
    return penpot.call<PenpotFileData>('get-file', { id: fileId });
}

export function firstPage(file: PenpotFileData): PenpotPage {
    const page = Object.values(file.data.pagesIndex)[0];
    if (!page) throw new Error(`File ${file.id} has no pages`);
    return page;
}

export function findPage(file: PenpotFileData, pageId?: string): PenpotPage {
    if (!pageId) return firstPage(file);
    const page = file.data.pagesIndex[pageId];
    if (!page) throw new Error(`Page ${pageId} not found in file ${file.id}`);
    return page;
}

export function findShape(page: PenpotPage, shapeId: string): PenpotShape {
    const shape = page.objects[shapeId];
    if (!shape) throw new Error(`Shape ${shapeId} not found on page ${page.id}`);
    return shape;
}

export function rootShape(page: PenpotPage): PenpotShape {
    return findShape(page, ROOT_SHAPE_ID);
}

/** Depth-first walk of a shape's subtree (including itself), following `shapes` child-id lists. */
export function* walkSubtree(page: PenpotPage, shapeId: string): Generator<PenpotShape> {
    const shape = findShape(page, shapeId);
    yield shape;
    for (const childId of shape.shapes ?? []) {
        yield* walkSubtree(page, childId);
    }
}

export function extractTextContent(shape: PenpotShape): string | undefined {
    if (shape.type !== 'text' || !shape.content) return undefined;
    const parts: string[] = [];
    const visit = (node: unknown): void => {
        if (node && typeof node === 'object') {
            const n = node as { text?: string; children?: unknown[] };
            if (typeof n.text === 'string') parts.push(n.text);
            n.children?.forEach(visit);
        }
    };
    visit(shape.content);
    return parts.join('') || undefined;
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function round(n: number | undefined): number | undefined {
    return typeof n === 'number' ? Math.round(n * 100) / 100 : undefined;
}

/**
 * Figma's get_metadata returns "a sparse XML representation... containing just basic
 * properties such as the layer IDs, names, types, position and sizes." We mirror that
 * shape — used both by the get_metadata tool and to ground the use_figma interpreter.
 */
export function buildSparseOutline(page: PenpotPage, rootId: string): string {
    const lines: string[] = [];
    const depthOf = new Map<string, number>([[rootId, 0]]);
    for (const shape of walkSubtree(page, rootId)) {
        const depth = depthOf.get(shape.id) ?? 0;
        for (const childId of shape.shapes ?? []) depthOf.set(childId, depth + 1);
        const indent = '  '.repeat(depth);
        const attrs = [
            `id="${escapeXml(shape.id)}"`,
            `name="${escapeXml(shape.name)}"`,
            `type="${escapeXml(shape.type)}"`,
            shape.x !== undefined ? `x="${round(shape.x)}"` : undefined,
            shape.y !== undefined ? `y="${round(shape.y)}"` : undefined,
            shape.width !== undefined ? `width="${round(shape.width)}"` : undefined,
            shape.height !== undefined ? `height="${round(shape.height)}"` : undefined
        ].filter(Boolean);
        lines.push(`${indent}<node ${attrs.join(' ')} />`);
    }
    return lines.join('\n');
}
