import type { PenpotRpcClient } from '../../penpot/rpcClient.js';
import { addPage, type PenpotChange } from '../../penpot/changes.js';
import type { PenpotPage } from '../../penpot/fileData.js';
import { primitiveToChanges } from './primitives/toChanges.js';
import type { PrimitiveOp } from './primitives/types.js';

export interface ExecutionResult {
    summary: string;
    changeCount: number;
    newRevn: number;
    affectedNodeIds: string[];
}

function collectAffectedNodeIds(ops: PrimitiveOp[], changes: PenpotChange[]): string[] {
    const ids = new Set<string>();
    for (const change of changes) {
        const id = (change as { id?: string }).id;
        if (id) ids.add(id);
    }
    for (const op of ops) {
        if ('nodeId' in op) ids.add(op.nodeId);
    }
    return Array.from(ids);
}

/**
 * Turns a validated plan into Penpot changes and submits them as ONE `update-file` call.
 * Every operation is translated BEFORE anything is submitted (fail-closed: one bad
 * operation means nothing in the batch is sent — see the plan's failure-mode notes),
 * and the whole batch rides Penpot's own per-call transaction for atomicity.
 */
export async function executePlan(
    penpot: PenpotRpcClient,
    fileId: string,
    page: PenpotPage,
    operations: PrimitiveOp[],
    summary: string
): Promise<ExecutionResult> {
    const changes: PenpotChange[] = [];
    for (const op of operations) {
        if (op.op === 'add_page') {
            changes.push(addPage({ name: op.name }));
        } else {
            changes.push(...primitiveToChanges(op, page));
        }
    }
    if (!changes.length) {
        throw new Error('Plan produced no changes to submit (all operations were no-ops)');
    }

    const { revn } = await penpot.submitChanges(fileId, changes);

    return {
        summary,
        changeCount: changes.length,
        newRevn: revn,
        affectedNodeIds: collectAffectedNodeIds(operations, changes)
    };
}
