/**
 * E2E: Crypto Tools — signing workflows
 *
 * Tests crypto_prepare_signature, crypto_submit_signature,
 * crypto_signing_status, and crypto_verify tools via the MCP protocol.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { computeContentCid, cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Crypto Tools E2E', () => {
  let harness: McpTestHarness;
  let client: Client;
  let setupError: Error | undefined;

  beforeAll(async () => {
    harness = await createMcpTestHarness();

    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${harness.mcpBaseUrl}/mcp`),
        {
          requestInit: {
            headers: {
              'X-Client-Id': harness.agent.clientId,
              'X-Client-Secret': harness.agent.clientSecret,
            },
          },
        },
      );
      client = new Client({ name: 'e2e-crypto-client', version: '1.0.0' });
      await client.connect(transport);
    } catch (err) {
      setupError = err instanceof Error ? err : new Error(String(err));
    }
  });

  afterAll(async () => {
    await client?.close();
    await harness?.teardown();
  });

  function requireSetup(): void {
    if (setupError) {
      throw new Error(
        `MCP client setup failed — skipping is not allowed: ${setupError.message}`,
      );
    }
  }

  it('prepares a signature envelope', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'crypto_prepare_signature',
      arguments: { message: 'hello moltnet' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `crypto_prepare_signature error: ${content[0].text}`,
    ).toBeUndefined();
    const parsed = JSON.parse(content[0].text);
    expect(parsed.message).toBe('hello moltnet');
    expect(parsed.id).toBeDefined();
    expect(parsed.nonce).toBeDefined();
    expect(parsed.signingInput).toBeDefined();
  });

  it('full signing workflow: prepare → sign → submit → verify', async () => {
    requireSetup();

    // 1. Prepare signing request
    const prepareResult = await client.callTool({
      name: 'crypto_prepare_signature',
      arguments: { message: 'MCP e2e signing test' },
    });
    const prepareContent = prepareResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      prepareResult.isError,
      `prepare error: ${prepareContent[0].text}`,
    ).toBeUndefined();
    const envelope = JSON.parse(prepareContent[0].text);
    const { id: request_id, message, nonce } = envelope;
    expect(request_id).toBeDefined();

    // 2. Sign locally using the deterministic pre-hash protocol
    const signature = await cryptoService.signWithNonce(
      message,
      nonce,
      harness.agent.keyPair.privateKey,
    );

    // 3. Submit signature
    const submitResult = await client.callTool({
      name: 'crypto_submit_signature',
      arguments: { request_id, signature },
    });
    const submitContent = submitResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      submitResult.isError,
      `submit error: ${submitContent[0].text}`,
    ).toBeUndefined();
    const submitParsed = JSON.parse(submitContent[0].text);
    expect(submitParsed.status).toBe('completed');
    expect(submitParsed.valid).toBe(true);

    // 4. Verify by signature
    const verifyResult = await client.callTool({
      name: 'crypto_verify',
      arguments: { signature },
    });
    const verifyContent = verifyResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      verifyResult.isError,
      `verify error: ${verifyContent[0].text}`,
    ).toBeUndefined();
    const verifyParsed = JSON.parse(verifyContent[0].text);
    expect(verifyParsed.valid).toBe(true);
  });

  it('full signing workflow with multiline message', async () => {
    requireSetup();
    const message = 'line1\nline2\nline3';

    // 1. Prepare
    const prepareResult = await client.callTool({
      name: 'crypto_prepare_signature',
      arguments: { message },
    });
    const prepareContent = prepareResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      prepareResult.isError,
      `prepare error: ${prepareContent[0].text}`,
    ).toBeUndefined();
    const envelope = JSON.parse(prepareContent[0].text);
    expect(envelope.message).toBe(message);

    // 2. Sign with deterministic pre-hash
    const signature = await cryptoService.signWithNonce(
      envelope.message,
      envelope.nonce,
      harness.agent.keyPair.privateKey,
    );

    // 3. Submit
    const submitResult = await client.callTool({
      name: 'crypto_submit_signature',
      arguments: { request_id: envelope.id, signature },
    });
    const submitContent = submitResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      submitResult.isError,
      `submit error: ${submitContent[0].text}`,
    ).toBeUndefined();
    const submitParsed = JSON.parse(submitContent[0].text);
    expect(submitParsed.status).toBe('completed');
    expect(submitParsed.valid).toBe(true);
  });

  it('returns false for signature not yet submitted', async () => {
    requireSetup();

    const prepareResult = await client.callTool({
      name: 'crypto_prepare_signature',
      arguments: { message: 'MCP unsigned signature' },
    });
    const prepareContent = prepareResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      prepareResult.isError,
      `prepare error: ${prepareContent[0].text}`,
    ).toBeUndefined();
    const envelope = JSON.parse(prepareContent[0].text);

    const signature = await cryptoService.signWithNonce(
      envelope.message,
      envelope.nonce,
      harness.agent.keyPair.privateKey,
    );

    const verifyResult = await client.callTool({
      name: 'crypto_verify',
      arguments: { signature },
    });
    const verifyContent = verifyResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      verifyResult.isError,
      `verify error: ${verifyContent[0].text}`,
    ).toBeUndefined();
    const verifyParsed = JSON.parse(verifyContent[0].text);
    expect(verifyParsed.valid).toBe(false);
  });

  it('creates a signed entry and verifies it via MCP tools', async () => {
    requireSetup();

    const content = 'MCP signed entry e2e test';
    const title = 'MCP Signed';
    const entryType = 'semantic';
    const tags = ['mcp-e2e', 'signing'];

    // 1. Compute CID locally
    const contentCid = computeContentCid(entryType, title, content, tags);
    expect(contentCid).toMatch(/^b/);

    // 2. Prepare signing request
    const prepareResult = await client.callTool({
      name: 'crypto_prepare_signature',
      arguments: { message: contentCid },
    });
    const prepareContent = prepareResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      prepareResult.isError,
      `prepare error: ${prepareContent[0].text}`,
    ).toBeUndefined();
    const envelope = JSON.parse(prepareContent[0].text);

    // 3. Sign locally
    const signature = await cryptoService.signWithNonce(
      contentCid,
      envelope.nonce,
      harness.agent.keyPair.privateKey,
    );

    // 4. Submit signature
    const submitResult = await client.callTool({
      name: 'crypto_submit_signature',
      arguments: { request_id: envelope.id, signature },
    });
    const submitContent = submitResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      submitResult.isError,
      `submit error: ${submitContent[0].text}`,
    ).toBeUndefined();
    const submitParsed = JSON.parse(submitContent[0].text);
    expect(submitParsed.status).toBe('completed');
    expect(submitParsed.valid).toBe(true);

    // 5. Create signed entry via MCP
    const createResult = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content,
        title,
        entry_type: entryType,
        tags,
        signing_request_id: envelope.id,
      },
    });
    const createContent = createResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      createResult.isError,
      `entries_create error: ${createContent[0].text}`,
    ).toBeUndefined();
    const entry = JSON.parse(createContent[0].text);
    expect(entry.contentHash).toBe(contentCid);
    expect(entry.contentSignature).toBe(signature);

    // 6. Verify via entries_verify tool
    const verifyResult = await client.callTool({
      name: 'entries_verify',
      arguments: {
        diary_id: harness.privateDiaryId,
        entry_id: entry.id,
      },
    });
    const verifyContent = verifyResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      verifyResult.isError,
      `entries_verify error: ${verifyContent[0].text}`,
    ).toBeUndefined();
    const verification = JSON.parse(verifyContent[0].text);
    expect(verification.signed).toBe(true);
    expect(verification.hashMatches).toBe(true);
    expect(verification.signatureValid).toBe(true);
    expect(verification.valid).toBe(true);
  });
});
