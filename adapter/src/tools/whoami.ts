import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PenpotRpcClient } from '../penpot/rpcClient.js';

interface PenpotProfile {
    email: string;
    fullname: string;
    id: string;
    defaultTeamId: string;
}

interface PenpotTeam {
    id: string;
    name: string;
    isDefault: boolean;
    permissions: { isOwner: boolean; isAdmin: boolean; canEdit: boolean };
}

/**
 * Figma's `whoami` returns the authenticated user's email plus the plans/seat types they
 * belong to. We mirror that shape but are explicit that this is the self-hosted backend —
 * never fabricate a real Figma plan tier, since a calling agent might otherwise assume
 * Enterprise-only features (e.g. variables) are available here when they aren't relevant
 * to this backend at all.
 */
export function registerWhoamiTool(server: McpServer, deps: { penpot: PenpotRpcClient }): void {
    server.registerTool(
        'whoami',
        {
            title: 'Who am I',
            description:
                "Returns the identity of the authenticated user and the backend they're connected to. " +
                'This adapter runs against a self-hosted Penpot instance, not Figma — plan/seat concepts ' +
                "below are Penpot's, not Figma's."
        },
        async () => {
            const profile = await deps.penpot.call<PenpotProfile>('get-profile');
            const teams = await deps.penpot.call<PenpotTeam[]>('get-teams');

            const result = {
                backend: 'self-hosted-penpot' as const,
                email: profile.email,
                fullname: profile.fullname,
                plans: teams.map(t => ({
                    id: t.id,
                    name: t.name,
                    isDefault: t.isDefault,
                    seatType: t.permissions.isOwner ? 'owner' : t.permissions.isAdmin ? 'admin' : t.permissions.canEdit ? 'editor' : 'viewer'
                }))
            };

            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                structuredContent: result
            };
        }
    );
}
