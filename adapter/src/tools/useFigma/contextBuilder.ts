import type { PenpotFileData, PenpotPage } from '../../penpot/fileData.js';
import { buildSparseOutline } from '../../penpot/fileData.js';

/** Grounds the interpreter in current document state before it plans anything — reuses
 *  get_metadata's sparse-outline format since it's already a compact, LLM-friendly view. */
export function buildContext(file: PenpotFileData, page: PenpotPage): string {
    const outline = buildSparseOutline(page, '00000000-0000-0000-0000-000000000000');
    const tokenSetNames = Object.keys(file.data.tokensLib ?? {}).filter(k => !k.startsWith('$'));
    const tokenNames = tokenSetNames.flatMap(setName => Object.keys((file.data.tokensLib as Record<string, object>)[setName] ?? {}));

    return [
        `File: "${file.name}" (id ${file.id})`,
        `Page: "${page.name}" (id ${page.id})`,
        '',
        'Current page outline (id, name, type, position, size):',
        outline,
        '',
        tokenNames.length ? `Design tokens available: ${Array.from(new Set(tokenNames)).join(', ')}` : 'No design tokens defined.'
    ].join('\n');
}
