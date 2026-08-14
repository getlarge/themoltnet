import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { materializePiTools, type PiToolContext } from '@themoltnet/pi-runtime';
import { Value } from 'typebox/value';
import { describe, expect, it, vi } from 'vitest';

import {
  createExaContentsTool,
  createExaSearchTool,
  EXA_CONTENT_LIMIT_BYTES,
  EXA_SNIPPET_LIMIT_BYTES,
  exaContents,
  exaContentsParameters,
  exaSearch,
  exaSearchParameters,
} from './exa-tools.js';
import { runtime } from './runtime.js';

function makeContext() {
  const record = vi.fn().mockResolvedValue(undefined);
  const context = {
    claimedTask: {
      task: { id: '11111111-1111-4111-8111-111111111111' },
      attemptN: 1,
    },
    reporter: { record },
  } as unknown as Pick<PiToolContext, 'claimedTask' | 'reporter'>;
  return { context, record };
}

async function execute(tool: ToolDefinition, parameters: unknown) {
  return tool.execute(
    'call-1',
    parameters as never,
    new AbortController().signal,
    () => {},
    {} as never,
  );
}

function textOf(result: Awaited<ReturnType<ToolDefinition['execute']>>) {
  const content = result.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('expected text tool output');
  }
  return content.text;
}

/** `AgentToolResult` does not surface `isError` in its public type. */
function isError(
  result: Awaited<ReturnType<ToolDefinition['execute']>>,
): boolean {
  return (result as { isError?: boolean }).isError === true;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

describe('exa tool schemas', () => {
  it.each([
    [{ query: 'headless agent orchestration' }, true],
    [{ query: 'ab' }, false],
    [{ query: 'valid query', numResults: 11 }, false],
    [{ query: 'valid query', numResults: 3 }, true],
    [{ query: 'valid query', startPublishedDate: '2026-07' }, false],
    [{ query: 'valid query', startPublishedDate: '2026-07-01' }, true],
    [{ query: 'valid query', endpoint: '/admin' }, false],
  ])('validates search params %j as %s', (input, valid) => {
    expect(Value.Check(exaSearchParameters, input)).toBe(valid);
  });

  it('accepts only a url for contents', () => {
    expect(
      Value.Check(exaContentsParameters, { url: 'https://a.example' }),
    ).toBe(true);
    expect(
      Value.Check(exaContentsParameters, {
        url: 'https://a.example',
        selector: 'body',
      }),
    ).toBe(false);
  });
});

describe('exa_search', () => {
  it('posts to the fixed search endpoint and bounds the projection', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: 'Remote agent sessions',
            url: 'https://example.com/post',
            publishedDate: '2026-08-01',
            text: 'x'.repeat(EXA_SNIPPET_LIMIT_BYTES * 2),
          },
        ],
      }),
    );
    const { context, record } = makeContext();

    // Act
    const result = await execute(
      createExaSearchTool(context, { fetchImpl, apiKey: 'secret-key' }),
      { query: 'remote agent sessions' },
    );

    // Assert
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    const projected = JSON.parse(textOf(result));
    expect(projected.results[0].url).toBe('https://example.com/post');
    expect(projected.results[0].publishedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(
      new TextEncoder().encode(projected.results[0].snippet).byteLength,
    ).toBeLessThanOrEqual(EXA_SNIPPET_LIMIT_BYTES);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'info',
        payload: expect.objectContaining({
          phase: 'start',
          operation: 'exa.search',
        }),
      }),
    );
  });

  it('clamps numResults even when schema validation is bypassed', async () => {
    // Arrange — the schema already caps this at 10, so the clamp inside the
    // tool is defence in depth. Calling execute directly is how we reach it.
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ results: [] }));
    const { context } = makeContext();

    // Act
    await execute(createExaSearchTool(context, { fetchImpl, apiKey: 'k' }), {
      query: 'anything at all',
      numResults: 500,
    });

    // Assert
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.numResults).toBe(10);
  });

  it('fails closed when no API key is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { context } = makeContext();
    const result = await execute(createExaSearchTool(context, { fetchImpl }), {
      query: 'remote agent sessions',
    });
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain('authentication');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentication'],
    [429, 'rate_limited'],
    [500, 'upstream_failure'],
    [302, 'invalid_response'],
  ])('maps status %i to %s', async (status, category) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status }));
    const { context } = makeContext();
    const result = await execute(
      createExaSearchTool(context, { fetchImpl, apiKey: 'k' }),
      { query: 'remote agent sessions' },
    );
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain(category);
  });

  it('redacts the API key if it ever appears in upstream text', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: 'leak secret-key',
            url: 'https://e.example',
            text: 'secret-key',
          },
        ],
      }),
    );
    const { context } = makeContext();
    const result = await execute(
      createExaSearchTool(context, { fetchImpl, apiKey: 'secret-key' }),
      { query: 'remote agent sessions' },
    );
    expect(textOf(result)).not.toContain('secret-key');
    expect(textOf(result)).toContain('[redacted]');
  });
});

describe('exa_contents', () => {
  it('reads one page and reports truncation honestly', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        results: [
          {
            url: 'https://example.com/post',
            title: 'A post',
            text: 'y'.repeat(EXA_CONTENT_LIMIT_BYTES * 2),
          },
        ],
      }),
    );
    const { context } = makeContext();
    const result = await execute(
      createExaContentsTool(context, { fetchImpl, apiKey: 'k' }),
      { url: 'https://example.com/post' },
    );
    const page = JSON.parse(textOf(result));
    expect(page.truncated).toBe(true);
    expect(new TextEncoder().encode(page.text).byteLength).toBeLessThanOrEqual(
      EXA_CONTENT_LIMIT_BYTES,
    );
  });

  it.each([
    'http://localhost:8080/admin',
    'https://10.0.0.5/metadata',
    'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.1/',
    'https://console.internal/',
    'file:///etc/passwd',
  ])('refuses to fetch %s', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { context } = makeContext();
    const result = await execute(
      createExaContentsTool(context, { fetchImpl, apiKey: 'k' }),
      { url },
    );
    expect(isError(result)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the sanitized url to the fixed contents endpoint', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ results: [{ url: 'https://e.example/a', text: 'ok' }] }),
      );
    const { context } = makeContext();
    await execute(createExaContentsTool(context, { fetchImpl, apiKey: 'k' }), {
      url: 'https://e.example/a',
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.exa.ai/contents');
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.urls).toEqual(['https://e.example/a']);
  });
});

describe('runtime declaration and tool policy', () => {
  const policyContext = {
    ...makeContext().context,
    runtime,
  } as unknown as PiToolContext;

  it('exposes exactly the two Exa tools to the model', async () => {
    // Act
    const tools = await materializePiTools({
      runtime,
      context: policyContext,
      target: 'parent',
      policy: {
        enforcement: 'off',
        allowedTools: new Set<string>(),
        allowedShellCommands: [],
      } as never,
    });

    // Assert
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'exa_contents',
      'exa_search',
    ]);
  });

  it('hides both tools when an enforcing policy does not allow them', async () => {
    // Arrange / Act — this is the sweep profile's blast radius in one assertion:
    // a profile in `enforce` mode that never allow-lists the Exa tools cannot
    // reach the network at all, however the brief is written.
    const hidden = await materializePiTools({
      runtime,
      context: policyContext,
      target: 'parent',
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set<string>(),
        allowedShellCommands: [],
      } as never,
    });
    const visible = await materializePiTools({
      runtime,
      context: policyContext,
      target: 'parent',
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(['exa_search']),
        allowedShellCommands: [],
      } as never,
    });

    // Assert
    expect(hidden.map((tool) => tool.name)).not.toContain('exa_search');
    expect(visible.map((tool) => tool.name)).toContain('exa_search');
    expect(visible.map((tool) => tool.name)).not.toContain('exa_contents');
  });

  it('keeps both tools parent-only so subagents cannot reach the network', () => {
    expect(exaSearch.scope).toBe('parent');
    expect(exaContents.scope).toBe('parent');
  });
});
