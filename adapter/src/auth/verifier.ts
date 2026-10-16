import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { TokenStore } from './tokenStore.js';

// requireBearerAuth refuses any AuthInfo with no expiresAt ("Token has no expiration time").
// These are static, long-lived tokens (not minted per-session), so we hand out a long but
// bounded lifetime computed from process start, rather than a real per-token expiry. Restarting
// the adapter effectively renews it — fine for an internal tool; rotate the underlying token
// values in .env if a real revocation is ever needed.
const STATIC_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
const processStartExpiresAt = Math.floor(Date.now() / 1000) + STATIC_TOKEN_LIFETIME_SECONDS;

/**
 * Minimal OAuthTokenVerifier backed by our static TokenStore. There is no real
 * OAuth authorization server here — this adapter is a single-deployment internal
 * tool gated by long random bearer tokens, not a multi-tenant service.
 */
export function createVerifier(tokenStore: TokenStore): OAuthTokenVerifier {
    return {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
            const info = tokenStore.lookup(token);
            if (!info) {
                throw new InvalidTokenError('Unknown or revoked adapter token');
            }
            return {
                token,
                clientId: info.clientId,
                scopes: info.scopes,
                expiresAt: processStartExpiresAt
            };
        }
    };
}

/** Throws if the authenticated caller lacks the 'write' scope. Call at the top of every write-tool handler. */
export function requireWriteScope(authInfo: AuthInfo | undefined): void {
    if (!authInfo?.scopes.includes('write')) {
        throw new Error('This tool requires a read-write adapter token; the connected client is read-only.');
    }
}
