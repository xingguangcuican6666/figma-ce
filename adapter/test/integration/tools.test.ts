import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * True integration tests: they exercise the real, already-running adapter (`pnpm dev`)
 * against the real self-hosted Penpot instance, through an actual MCP client — not mocks.
 * Run with `pnpm test:integration` (requires the adapter to be up and PENPOT_TARGET_FILE_ID
 * to point at a file matching the fixture ids below; see docs/penpot-rpc-notes.md for how
 * this project's own imported "ABK OOBE" file was seeded).
 */

const BASE_URL = `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '8787'}/mcp`;
const TOKEN = process.env.ADAPTER_READONLY_TOKEN;
if (!TOKEN) throw new Error('ADAPTER_READONLY_TOKEN must be set (source .env before running)');

// Fixture ids from the real imported file this project uses for development.
const BUTTON_PRIMARY_ID = '0137cef9-ff23-541f-8d90-ed4a1c9dc233';
const ACCENT_TOKEN_TEXT_ID = '4b613130-8e92-5480-abd3-75622ccc1492';

let client: Client;

before(async () => {
    client = new Client({ name: 'integration-test', version: '0.0.1' });
    const transport = new StreamableHTTPClientTransport(new URL(BASE_URL), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
    });
    await client.connect(transport);
});

after(async () => {
    await client.close();
});

test('tools/list exposes the Phase 1+2+3 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    assert.deepEqual(names, ['download_assets', 'get_design_context', 'get_metadata', 'get_screenshot', 'get_variable_defs', 'use_figma', 'whoami']);
});

test('whoami identifies as the self-hosted backend', async () => {
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.structuredContent ? JSON.stringify(result.structuredContent) : (result.content as any)[0].text));
    assert.equal(body.backend, 'self-hosted-penpot');
    assert.ok(body.email);
});

test('get_metadata with no nodeId lists pages', async () => {
    const result = await client.callTool({ name: 'get_metadata', arguments: {} });
    const body = result.structuredContent as { pages: Array<{ id: string; name: string }> };
    assert.ok(Array.isArray(body.pages) && body.pages.length >= 1);
});

test('get_metadata with a nodeId returns a sparse XML outline including that node', async () => {
    const result = await client.callTool({ name: 'get_metadata', arguments: { nodeId: BUTTON_PRIMARY_ID } });
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    assert.match(text, new RegExp(BUTTON_PRIMARY_ID));
    assert.match(text, /name="Button \/ Primary"/);
});

test('get_design_context returns geometry, fills, applied tokens, and recurses into children', async () => {
    const result = await client.callTool({ name: 'get_design_context', arguments: { nodeId: BUTTON_PRIMARY_ID, maxDepth: 3 } });
    const body = result.structuredContent as any;
    assert.equal(body.id, BUTTON_PRIMARY_ID);
    assert.ok(body.geometry?.width > 0);
    assert.ok(body.appliedTokens?.fill);
    assert.ok(Array.isArray(body.children) && body.children.length >= 1);
    assert.equal(body.children[0].text, 'Continue');
});

test('get_variable_defs with no nodeId returns the full token set', async () => {
    const result = await client.callTool({ name: 'get_variable_defs', arguments: {} });
    const body = result.structuredContent as Record<string, Record<string, unknown>>;
    const [firstSet] = Object.values(body);
    assert.ok(firstSet && Object.keys(firstSet).length > 1);
});

test('get_variable_defs scoped to a node only returns tokens that node actually uses', async () => {
    const result = await client.callTool({ name: 'get_variable_defs', arguments: { nodeId: ACCENT_TOKEN_TEXT_ID } });
    const body = result.structuredContent as Record<string, Record<string, unknown>>;
    const [firstSet] = Object.values(body);
    assert.deepEqual(Object.keys(firstSet ?? {}), ['accent']);
});

test('get_screenshot renders a real node and returns a non-trivial PNG', async () => {
    const result = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: BUTTON_PRIMARY_ID } });
    assert.equal(result.isError, undefined);
    const image = (result.content as Array<{ type: string; data?: string; mimeType?: string }>).find(c => c.type === 'image');
    assert.ok(image, 'expected an image content block');
    assert.equal(image!.mimeType, 'image/png');
    assert.ok(Buffer.from(image!.data!, 'base64').length > 500, 'rendered PNG should not be a near-empty/degenerate image');
});

test('get_screenshot rejects the implicit page root (it has no real geometry)', async () => {
    const result = await client.callTool({
        name: 'get_screenshot',
        arguments: { nodeId: '00000000-0000-0000-0000-000000000000' }
    });
    assert.equal(result.isError, true);
});

test('download_assets exports multiple nodes in one call', async () => {
    const result = await client.callTool({
        name: 'download_assets',
        arguments: { nodeIds: [BUTTON_PRIMARY_ID, ACCENT_TOKEN_TEXT_ID] }
    });
    const body = result.structuredContent as { assets: Array<{ nodeId: string; sizeBytes: number }> };
    assert.equal(body.assets.length, 2);
    assert.ok(body.assets.every(a => a.sizeBytes > 0));
});

test('use_figma rejects a read-only token before ever calling the LLM (least-privilege enforcement)', async () => {
    // This client is connected with ADAPTER_READONLY_TOKEN (see `before` above) — the whole
    // point of this test is that requireWriteScope() runs BEFORE any Anthropic call, so it
    // needs no ANTHROPIC_API_KEY to verify.
    const result = await client.callTool({ name: 'use_figma', arguments: { instruction: 'add a rectangle' } });
    assert.equal(result.isError, true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    assert.match(text, /read-write adapter token/);
});
