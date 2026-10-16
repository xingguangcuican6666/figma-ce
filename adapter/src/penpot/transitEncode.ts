/**
 * A minimal, SCOPED Transit-JSON encoder for `update-file` request bodies — not a
 * general Transit implementation. Empirically derived (see docs/penpot-rpc-notes.md):
 * `update-file` (like every `/api/rpc/command/*`) accepts plain `application/json` and
 * auto-converts camelCase keys and UUID-typed STRING fields correctly — but any field
 * whose schema is a Penpot `one-of` enum (e.g. a frame's `layout`/`layoutFlexDir`) is
 * NOT coerced from a plain JSON string into the Clojure keyword it needs; the write is
 * silently accepted at the parsing stage and only rejected later, by file-schema
 * validation, once applied. The fix: send `Content-Type: application/transit+json`
 * (the response stays plain `application/json` regardless — verified), with every key
 * kebab-cased and `~:`-prefixed, UUID-named fields `~u`-prefixed, and — the key
 * discovery — enum values explicitly wrapped in `Keyword` at the call site (see
 * src/tools/useFigma/primitives/toChanges.ts's set_auto_layout case) rather than
 * guessed from field names, since the same generic `val`/`value` field sometimes holds
 * a plain string (e.g. a shape's `name`) and sometimes needs a keyword (e.g. `layout`).
 */

export class Keyword {
    constructor(public readonly name: string) {}
}

export function kw(name: string): Keyword {
    return new Keyword(name);
}

const UUID_FIELD_NAMES = new Set([
    'id',
    'session-id',
    'page-id',
    'frame-id',
    'parent-id',
    'object-id',
    'component-id',
    'comment-thread-id'
]);

function camelToKebab(key: string): string {
    return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function encodeValue(value: unknown, kebabKey?: string): unknown {
    if (value instanceof Keyword) return `~:${value.name}`;
    if (Array.isArray(value)) return value.map(v => encodeValue(v));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value)) {
            const kebab = camelToKebab(key);
            out[`~:${kebab}`] = kebab && UUID_FIELD_NAMES.has(kebab) && typeof v === 'string' ? `~u${v}` : encodeValue(v, kebab);
        }
        return out;
    }
    return value;
}

/** Encodes a plain JS request body (camelCase keys, `Keyword`-wrapped enum values) into
 *  the Transit-JSON string `update-file` expects as its request body. */
export function encodeUpdateFileBody(body: Record<string, unknown>): string {
    return JSON.stringify(encodeValue(body));
}
