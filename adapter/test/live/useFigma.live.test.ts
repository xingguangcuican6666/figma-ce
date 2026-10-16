import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Exercises `use_figma` through REAL Anthropic calls (via this machine's Claude Code relay
 * — see docs/penpot-rpc-notes.md for the quota-sharing tradeoff the user explicitly
 * accepted 2026-10-16). Deliberately NOT part of `pnpm test:integration` (a different
 * directory, excluded from that glob) so routine regression runs stay free/fast — run this
 * one deliberately with `pnpm test:live` when actually validating interpreter behavior.
 *
 * Mirrors the three example instructions from Figma's own use_figma docs, adapted to this
 * fixture file's actual content (it has no "nav" component, so the auto-layout example
 * targets a real existing auto-layout frame instead) — this is the plan's Phase 3
 * acceptance criterion.
 */

const BASE_URL = `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '8787'}/mcp`;
const TOKEN = process.env.ADAPTER_READWRITE_TOKEN;
if (!TOKEN) throw new Error('ADAPTER_READWRITE_TOKEN must be set (source .env before running)');

const BUTTON_SECONDARY_STANDALONE_ID = 'c365028c-7aa4-5a39-a608-595eb4506fa8';
const READOUT_ROW_ID = 'dfb81332-1020-5688-a280-ca198ac65f83';

let client: Client;

before(async () => {
    client = new Client({ name: 'live-test', version: '0.0.1' });
    const transport = new StreamableHTTPClientTransport(new URL(BASE_URL), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
    });
    await client.connect(transport);
});

after(async () => {
    await client.close();
});

test('use_figma asks for clarification on a genuinely ambiguous instruction instead of guessing', async () => {
    const result = await client.callTool({ name: 'use_figma', arguments: { instruction: 'add a new frame to my Figma file' } });
    assert.equal(result.isError, undefined);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    // Should read as a question, not a change-applied summary.
    assert.match(text, /\?/);
    assert.doesNotMatch(text, /Applied \d+ change/);
});

test('use_figma asks which instance when multiple nodes match, then applies correctly once disambiguated', async () => {
    const ambiguous = await client.callTool({
        name: 'use_figma',
        arguments: { instruction: 'update the Button / Secondary component to use a red fill color' }
    });
    const ambiguousText = (ambiguous.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    assert.match(ambiguousText, /\?/);

    const specific = await client.callTool({
        name: 'use_figma',
        arguments: {
            instruction: `update the standalone Button / Secondary frame (id ${BUTTON_SECONDARY_STANDALONE_ID}) to use a red #ff0000 fill`
        }
    });
    assert.equal(specific.isError, undefined);
    const body = specific.structuredContent as { changeCount: number; affectedNodeIds: string[] };
    assert.equal(body.changeCount, 1);
    assert.deepEqual(body.affectedNodeIds, [BUTTON_SECONDARY_STANDALONE_ID]);
});

test('use_figma fixes auto-layout spacing on a named frame (mirrors Figma\'s third documented example)', async () => {
    const result = await client.callTool({
        name: 'use_figma',
        arguments: {
            instruction: `the auto-layout spacing on the Readout / Row frame (id ${READOUT_ROW_ID}) is too tight — set a comfortable 8px gap`
        }
    });
    assert.equal(result.isError, undefined);
    const body = result.structuredContent as { changeCount: number; affectedNodeIds: string[] };
    assert.ok(body.changeCount >= 1);
    assert.ok(body.affectedNodeIds.includes(READOUT_ROW_ID));
});
