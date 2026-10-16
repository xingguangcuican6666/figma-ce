/**
 * Generic client for Penpot's RPC API (`/api/rpc/command/:name`).
 *
 * Verified empirically against a live Penpot 2.18 instance (see docs/penpot-rpc-notes.md):
 * every command — query or mutation — accepts POST with a JSON body, and responding with
 * `Accept: application/json` returns plain camelCase JSON (dates as ISO strings) instead of
 * Penpot's native Transit+JSON wire format. We rely on both of those behaviors so the rest of
 * the adapter never has to deal with Transit encoding or kebab-case keys — EXCEPT for
 * `update-file`, which needs real Transit+JSON for specific enum-valued fields (see
 * transitEncode.ts and submitChanges below); its response stays plain JSON regardless.
 */
import { randomUUID } from 'node:crypto';
import type { PenpotChange } from './changes.js';
import { encodeUpdateFileBody } from './transitEncode.js';

export class PenpotRpcError extends Error {
    constructor(
        public readonly command: string,
        public readonly status: number,
        public readonly body: unknown
    ) {
        super(`Penpot RPC '${command}' failed with HTTP ${status}: ${JSON.stringify(body)}`);
        this.name = 'PenpotRpcError';
    }

    get code(): string | undefined {
        return (this.body as { code?: string } | undefined)?.code;
    }
}

export class PenpotRpcClient {
    constructor(
        private readonly baseUrl: string,
        private readonly accessToken: string,
        private readonly timeoutMs = 15_000
    ) {}

    private async request<T>(command: string, contentType: string, body: string): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}/api/rpc/command/${command}`, {
                method: 'POST',
                headers: { Authorization: `Token ${this.accessToken}`, 'Content-Type': contentType, Accept: 'application/json' },
                body,
                signal: controller.signal
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => res.text().catch(() => undefined));
                throw new PenpotRpcError(command, res.status, errBody);
            }
            if (res.status === 204) return undefined as T;
            return (await res.json()) as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    async call<T = unknown>(command: string, params: Record<string, unknown> = {}): Promise<T> {
        return this.request<T>(command, 'application/json', JSON.stringify(params));
    }

    /**
     * Submits a batch of changes to a file as ONE `update-file` call, relying on Penpot's
     * own per-call transaction for atomicity (see the plan's `use_figma` design notes —
     * we never build our own rollback). Retries exactly once on a revn/vern conflict by
     * re-reading the file's current revision and resubmitting the SAME changes — correct
     * here because our primitives never read-then-write stale data into a change payload
     * (e.g. `mod-obj` operations carry the new value directly, not a diff against what we
     * last saw), so replaying them against a newer revision is safe.
     *
     * Uses Transit+JSON, not plain JSON, for this one command — see transitEncode.ts for why.
     */
    async submitChanges(fileId: string, changes: PenpotChange[]): Promise<{ revn: number }> {
        const sessionId = randomUUID();
        const attempt = async (): Promise<{ revn: number }> => {
            const file = await this.call<{ revn: number; vern: number }>('get-file', { id: fileId });
            const body = encodeUpdateFileBody({ id: fileId, sessionId, revn: file.revn, vern: file.vern, changes });
            // update-file's response `revn` is the file's PRE-update revision ("we need to
            // preserve the original revn for the response", per Penpot's own source comment)
            // — the server increments it internally when applying. Report the real new value.
            const result = await this.request<{ revn: number }>('update-file', 'application/transit+json', body);
            return { revn: result.revn + 1 };
        };

        try {
            return await attempt();
        } catch (err) {
            if (err instanceof PenpotRpcError && (err.code === 'revn-conflict' || err.code === 'vern-conflict')) {
                return attempt();
            }
            throw err;
        }
    }
}
