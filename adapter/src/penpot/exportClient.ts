/**
 * Client for Penpot's shape-rendering endpoint, which is a DIFFERENT subsystem from the
 * rest of the RPC API (see docs/penpot-rpc-notes.md):
 *   - lives at `POST /api/export` (proxied to the separate `penpot-exporter` service),
 *     not `/api/rpc/command/...`
 *   - only understands `Content-Type: application/transit+json` — plain JSON bodies are
 *     silently misparsed, so requests are hand-encoded Transit here rather than JSON
 *   - authenticates via the session cookie (`auth-token`, from `login-with-password`),
 *     not the `Authorization: Token` bearer header used everywhere else in this adapter
 *
 * Verified empirically against a live Penpot 2.18 instance.
 */

export type PenpotExportFormat = 'png' | 'svg' | 'pdf' | 'jpeg' | 'webp';

export interface ShapeExportRequest {
    pageId: string;
    fileId: string;
    objectId: string;
    type: PenpotExportFormat;
    scale?: number;
    name?: string;
    suffix?: string;
}

export interface ShapeExportResult {
    mtype: string;
    name: string;
    filename: string;
    id: string;
    uri: string;
}

function kw(s: string): string {
    return `~:${s}`;
}
function uuidTag(s: string): string {
    return `~u${s}`;
}

function buildExportShapesBody(profileId: string, exports: ShapeExportRequest[]): string {
    const payload: Record<string, unknown> = {
        [kw('cmd')]: kw('export-shapes'),
        [kw('wait')]: true,
        [kw('profile-id')]: uuidTag(profileId),
        [kw('exports')]: exports.map(e => ({
            [kw('page-id')]: uuidTag(e.pageId),
            [kw('file-id')]: uuidTag(e.fileId),
            [kw('object-id')]: uuidTag(e.objectId),
            [kw('type')]: kw(e.type),
            [kw('suffix')]: e.suffix ?? '',
            [kw('scale')]: e.scale ?? 1,
            [kw('name')]: e.name ?? e.objectId
        }))
    };
    return JSON.stringify(payload);
}

/** Parses the (still-Transit) `{mtype,name,filename,id,uri}` response of a single-shape export. */
function parseExportShapesResponse(text: string): ShapeExportResult {
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
        throw new Error(`Penpot export-shapes returned non-JSON response: ${text.slice(0, 500)}`);
    }
    const get = (key: string): unknown => raw[kw(key)];
    const idRaw = get('id');
    const uriRaw = get('uri') as { ['~#uri']?: string } | string | undefined;
    const uri = typeof uriRaw === 'string' ? uriRaw : uriRaw?.['~#uri'];
    if (!uri) {
        throw new Error(`Unexpected Penpot export-shapes response shape: ${text.slice(0, 500)}`);
    }
    return {
        mtype: String(get('mtype')),
        name: String(get('name')),
        filename: String(get('filename')),
        id: typeof idRaw === 'string' ? idRaw.replace(/^~u/, '') : String(idRaw),
        uri
    };
}

export class PenpotExportClient {
    private sessionCookie?: string;
    private cookieObtainedAt = 0;
    private readonly cookieLifetimeMs = 6 * 24 * 60 * 60 * 1000; // real cookie lasts 7 days; refresh a day early

    constructor(
        private readonly baseUrl: string,
        private readonly email: string,
        private readonly password: string,
        private readonly profileId: string
    ) {}

    private async ensureSession(): Promise<string> {
        if (this.sessionCookie && Date.now() - this.cookieObtainedAt < this.cookieLifetimeMs) {
            return this.sessionCookie;
        }
        const res = await fetch(`${this.baseUrl}/api/rpc/command/login-with-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: this.email, password: this.password })
        });
        if (!res.ok) {
            throw new Error(`Penpot session login failed: HTTP ${res.status}`);
        }
        const setCookie = res.headers.get('set-cookie');
        const match = setCookie?.match(/auth-token=([^;]+)/);
        if (!match) {
            throw new Error('Penpot login-with-password did not return an auth-token cookie');
        }
        this.sessionCookie = `auth-token=${match[1]}`;
        this.cookieObtainedAt = Date.now();
        return this.sessionCookie;
    }

    /** Renders a single shape/frame to an image. For multiple nodes, call this once per node
     *  (simpler and more faithful to Figma's per-node URL shape than unzipping Penpot's
     *  batch/zip response — see docs/penpot-rpc-notes.md). */
    async exportShape(req: ShapeExportRequest): Promise<ShapeExportResult> {
        const cookie = await this.ensureSession();
        const res = await fetch(`${this.baseUrl}/api/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/transit+json', Cookie: cookie },
            body: buildExportShapesBody(this.profileId, [req])
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`Penpot export-shapes failed: HTTP ${res.status}: ${text.slice(0, 500)}`);
        }
        return parseExportShapesResponse(text);
    }

    /** Downloads the bytes for a `ShapeExportResult.uri` (or any other `/assets/by-id/...` URI). */
    async downloadAsset(uri: string, bearerToken: string): Promise<{ bytes: Uint8Array; mtype: string }> {
        const res = await fetch(uri, { headers: { Authorization: `Token ${bearerToken}` } });
        if (!res.ok) {
            throw new Error(`Penpot asset download failed: HTTP ${res.status} for ${uri}`);
        }
        const mtype = res.headers.get('content-type') ?? 'application/octet-stream';
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { bytes, mtype };
    }
}
