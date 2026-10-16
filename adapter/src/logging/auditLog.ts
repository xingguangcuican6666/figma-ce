import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Append-only audit trail for every `use_figma` call — per the plan's Phase 4
 * requirement, so a human can review what an AI agent actually did to this file.
 * Deliberately simple (JSON Lines, local file) rather than a database: this is a
 * single-instance internal tool, not a multi-tenant service.
 */

const LOG_PATH = fileURLToPath(new URL('../../logs/use-figma-audit.jsonl', import.meta.url));

export interface AuditEntry {
    timestamp: string;
    clientId: string;
    instruction: string;
    outcome: 'plan_applied' | 'clarification_requested' | 'error';
    summary?: string;
    operations?: unknown[];
    changeCount?: number;
    beforeRevn?: number;
    afterRevn?: number;
    affectedNodeIds?: string[];
    errorMessage?: string;
}

let dirEnsured = false;

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
    if (!dirEnsured) {
        await mkdir(dirname(LOG_PATH), { recursive: true });
        dirEnsured = true;
    }
    await appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function getAuditLogPath(): string {
    return LOG_PATH;
}
