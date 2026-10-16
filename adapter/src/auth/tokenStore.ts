export type AdapterScope = 'read' | 'write';

export interface AdapterTokenInfo {
    clientId: string;
    scopes: AdapterScope[];
}

/**
 * Static bearer-token -> scope lookup for clients connecting to *this* adapter.
 * Deliberately simple (no OAuth server, no JWT) — this is an internal tool gated
 * by two long random tokens, not a multi-tenant auth system.
 */
export class TokenStore {
    private readonly tokens: Map<string, AdapterTokenInfo>;

    constructor(opts: { readonlyToken: string; readwriteToken: string }) {
        this.tokens = new Map([
            [opts.readonlyToken, { clientId: 'readonly-client', scopes: ['read'] }],
            [opts.readwriteToken, { clientId: 'readwrite-client', scopes: ['read', 'write'] }]
        ]);
    }

    lookup(token: string): AdapterTokenInfo | undefined {
        return this.tokens.get(token);
    }
}
