import { z } from 'zod/v4';

const envSchema = z.object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(8787),

    PENPOT_BASE_URL: z.string().url(),
    PENPOT_ACCESS_TOKEN: z.string().min(1),
    // Session-based login, needed only for the /api/export rendering endpoint
    // (it does not accept the bearer access token — see docs/penpot-rpc-notes.md).
    PENPOT_BOT_EMAIL: z.string().email(),
    PENPOT_BOT_PASSWORD: z.string().min(1),
    PENPOT_BOT_PROFILE_ID: z.string().uuid(),
    PENPOT_DEFAULT_PROJECT_ID: z.string().uuid().optional(),
    // The single Penpot file this adapter instance operates on (v1 scope: one file, see plan).
    PENPOT_TARGET_FILE_ID: z.string().uuid().optional(),

    // Bearer tokens accepted from MCP clients talking to *this* adapter.
    // Least-privilege: a read-only token can only call read tools; the read-write
    // token unlocks use_figma / create_new_file / upload_assets as well.
    ADAPTER_READONLY_TOKEN: z.string().min(16),
    ADAPTER_READWRITE_TOKEN: z.string().min(16),

    // Used by the use_figma interpreter (Phase 3). Reuses this machine's existing Claude
    // Code relay credentials (explicit user sign-off, 2026-10-16) rather than a dedicated
    // Anthropic API key — see docs/penpot-rpc-notes.md for the tradeoff (shared quota/
    // billing with the user's interactive sessions; availability depends on that local
    // relay process staying up). Anthropic's SDK reads these exact env var names itself
    // (`authToken` sends `Authorization: Bearer`, distinct from `apiKey`'s `x-api-key`),
    // so these names are not our own invention.
    ANTHROPIC_AUTH_TOKEN: z.string().optional(),
    ANTHROPIC_BASE_URL: z.string().url().optional()
});

export type Config = {
    host: string;
    port: number;
    penpot: {
        baseUrl: string;
        accessToken: string;
        botEmail: string;
        botPassword: string;
        botProfileId: string;
        defaultProjectId?: string;
        targetFileId?: string;
    };
    adapterTokens: {
        readonly: string;
        readwrite: string;
    };
    anthropic?: {
        authToken: string;
        baseUrl: string;
    };
};

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    if (cached) return cached;

    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid adapter configuration:\n${issues}`);
    }
    const e = parsed.data;

    cached = {
        host: e.HOST,
        port: e.PORT,
        penpot: {
            baseUrl: e.PENPOT_BASE_URL.replace(/\/+$/, ''),
            accessToken: e.PENPOT_ACCESS_TOKEN,
            botEmail: e.PENPOT_BOT_EMAIL,
            botPassword: e.PENPOT_BOT_PASSWORD,
            botProfileId: e.PENPOT_BOT_PROFILE_ID,
            defaultProjectId: e.PENPOT_DEFAULT_PROJECT_ID,
            targetFileId: e.PENPOT_TARGET_FILE_ID
        },
        adapterTokens: {
            readonly: e.ADAPTER_READONLY_TOKEN,
            readwrite: e.ADAPTER_READWRITE_TOKEN
        },
        anthropic:
            e.ANTHROPIC_AUTH_TOKEN && e.ANTHROPIC_BASE_URL
                ? { authToken: e.ANTHROPIC_AUTH_TOKEN, baseUrl: e.ANTHROPIC_BASE_URL }
                : undefined
    };
    return cached;
}

/** Test-only: clear the cached config so a test can reload with different env vars. */
export function _resetConfigCacheForTests(): void {
    cached = undefined;
}
