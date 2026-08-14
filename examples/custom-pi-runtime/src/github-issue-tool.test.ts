import {
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  buildPiExecutorManifest,
  createToolPolicyExtension,
  definePiRuntime,
  definePiTool,
  materializePiTools,
  type PiToolContext,
  type ResolvedGondolinTemplate,
} from '@themoltnet/pi-runtime';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it, vi } from 'vitest';

import {
  createGitHubIssueReadTool,
  GITHUB_ISSUE_BODY_LIMIT_BYTES,
  GITHUB_REPOSITORY,
  GITHUB_RESPONSE_LIMIT_BYTES,
  githubIssueRead,
  githubIssueReadParameters,
} from './github-issue-tool.js';
import { runtime } from './runtime.js';

function makeContext() {
  const record = vi.fn().mockResolvedValue(undefined);
  const context = {
    claimedTask: {
      task: { id: '11111111-1111-4111-8111-111111111111' },
      attemptN: 3,
    },
    reporter: { record },
  } as unknown as Pick<PiToolContext, 'claimedTask' | 'reporter'>;
  return { context, record };
}

async function execute(
  tool: ToolDefinition,
  number: number,
  signal: AbortSignal = new AbortController().signal,
) {
  return tool.execute(
    'call-1',
    { number } as never,
    signal,
    () => {},
    {} as never,
  );
}

function issueResponse(
  overrides: Record<string, unknown> = {},
  init: ResponseInit = {},
) {
  return new Response(
    JSON.stringify({
      number: 1886,
      title: 'Host-owned access proof',
      state: 'open',
      body: 'Public issue body',
      ...overrides,
    }),
    { status: 200, ...init },
  );
}

describe('github_issue_read schema', () => {
  it.each([
    [{ number: 1 }, true],
    [{ number: 0 }, false],
    [{ number: -1 }, false],
    [{ number: 1.5 }, false],
    [{ number: '1' }, false],
    [{ number: 1, repository: 'other/repo' }, false],
  ])('validates %j as %s', (input, valid) => {
    expect(Value.Check(githubIssueReadParameters, input)).toBe(valid);
  });
});

describe('github_issue_read execution', () => {
  it('uses one fixed route and returns a bounded projection', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        issueResponse({ body: '🧪'.repeat(GITHUB_ISSUE_BODY_LIMIT_BYTES) }),
      );
    const { context, record } = makeContext();
    const result = await execute(
      createGitHubIssueReadTool(context, { fetchImpl }),
      1886,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/getlarge/themoltnet/issues/1886',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    const content = result.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('expected text tool output');
    }
    const projection = JSON.parse(content.text);
    expect(projection).toMatchObject({
      number: 1886,
      title: 'Host-owned access proof',
      state: 'open',
      url: 'https://github.com/getlarge/themoltnet/issues/1886',
    });
    expect(
      new TextEncoder().encode(projection.body).byteLength,
    ).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_LIMIT_BYTES);
    expect(record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'info',
        payload: expect.objectContaining({
          phase: 'start',
          taskId: '11111111-1111-4111-8111-111111111111',
          attemptN: 3,
          toolCallId: 'call-1',
          operation: 'issue.read',
          repository: GITHUB_REPOSITORY,
          issueNumber: 1886,
          resultCategory: 'started',
          durationMs: 0,
        }),
      }),
    );
    expect(record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({
          phase: 'outcome',
          resultCategory: 'success',
          durationMs: expect.any(Number),
        }),
      }),
    );
  });

  it.each([
    [401, {}, 'authentication'],
    [403, {}, 'authentication'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'],
    [404, {}, 'not_found'],
    [429, {}, 'rate_limited'],
    [500, {}, 'upstream_failure'],
  ])('maps status %i to %s', async (status, headers, category) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('untrusted upstream body', { status, headers }),
      );
    const { context, record } = makeContext();
    const result = await execute(
      createGitHubIssueReadTool(context, { fetchImpl }),
      1886,
    );

    expect(result).toMatchObject({
      isError: true,
      details: { resultCategory: category },
    });
    expect(JSON.stringify(result)).not.toContain('untrusted upstream body');
    expect(record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ resultCategory: category }),
      }),
    );
  });

  it('rejects redirects and invalid provider payloads', async () => {
    const { context } = makeContext();
    const redirect = await execute(
      createGitHubIssueReadTool(context, {
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 302 })),
      }),
      1886,
    );
    const invalid = await execute(
      createGitHubIssueReadTool(context, {
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(issueResponse({ number: 9999 })),
      }),
      1886,
    );

    expect(redirect).toMatchObject({
      isError: true,
      details: { resultCategory: 'invalid_response' },
    });
    expect(invalid).toMatchObject({
      isError: true,
      details: { resultCategory: 'invalid_response' },
    });
  });

  it('rejects a response beyond 256 KiB before parsing it', async () => {
    const { context } = makeContext();
    const result = await execute(
      createGitHubIssueReadTool(context, {
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response('x'.repeat(GITHUB_RESPONSE_LIMIT_BYTES + 1)),
          ),
      }),
      1886,
    );

    expect(result).toMatchObject({
      isError: true,
      details: { resultCategory: 'oversized_response' },
    });
  });

  it('honors cancellation', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const { context } = makeContext();
    const pending = execute(
      createGitHubIssueReadTool(context, { fetchImpl }),
      1886,
      controller.signal,
    );
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      isError: true,
      details: { resultCategory: 'cancelled' },
    });
  });

  it('enforces the five-second production deadline with a stable timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const { context } = makeContext();
    const pending = execute(
      createGitHubIssueReadTool(context, { fetchImpl }),
      1886,
    );
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toMatchObject({
      isError: true,
      details: { resultCategory: 'timeout' },
    });
    vi.useRealTimers();
  });

  it('sends a host token only to the fixed request and redacts reflections', async () => {
    const sentinel = 'sentinel-runtime-github-token';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(issueResponse({ title: sentinel, body: sentinel }));
    const { context, record } = makeContext();
    const result = await execute(
      createGitHubIssueReadTool(context, { fetchImpl, token: sentinel }),
      1886,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/getlarge/themoltnet/issues/1886',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${sentinel}`,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(JSON.stringify(record.mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(runtime)).not.toContain(sentinel);
  });
});

describe('runtime policy and manifest evidence', () => {
  const context = {
    claimedTask: {
      task: { id: '11111111-1111-4111-8111-111111111111' },
      attemptN: 1,
    },
    reporter: { record: vi.fn() },
  } as unknown as PiToolContext;

  it('keeps the tool parent-only and filters it with enforcing policy', async () => {
    expect(githubIssueRead.scope).toBe('parent');
    const hidden = await materializePiTools({
      runtime,
      context,
      target: 'parent',
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [],
      } as never,
    });
    const visible = await materializePiTools({
      runtime,
      context,
      target: 'parent',
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(['github_issue_read']),
        allowedShellCommands: [],
      } as never,
    });

    expect(hidden.map((tool) => tool.name)).not.toContain('github_issue_read');
    expect(visible.map((tool) => tool.name)).toContain('github_issue_read');
  });

  it('blocks a forged call when policy removes the tool', () => {
    const on = vi.fn();
    createToolPolicyExtension({
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(),
        allowedShellCommands: [],
        degraded: false,
      } as never,
      analyzer: { analyze: vi.fn() } as never,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    })({ on } as never);
    const handler = on.mock.calls[0]![1] as (event: unknown) => unknown;

    expect(
      handler({
        type: 'tool_call',
        toolCallId: 'forged-1',
        toolName: 'github_issue_read',
        input: { number: 1886 },
      }),
    ).toMatchObject({ block: true });
  });

  it('changes executor-manifest evidence when the schema changes', async () => {
    const changedTool = definePiTool(
      defineTool({
        name: 'github_issue_read',
        label: 'Read MoltNet GitHub issue',
        description:
          'Read one public issue from the fixed getlarge/themoltnet repository.',
        parameters: Type.Object(
          { number: Type.Integer({ minimum: 2 }) },
          { additionalProperties: false },
        ),
        async execute() {
          return { content: [], details: {} };
        },
      }),
    );
    const changedRuntime = definePiRuntime({
      id: runtime.id,
      version: runtime.version,
      runtimeKind: runtime.runtimeKind,
      vm: runtime.vm,
      tools: [changedTool],
    });
    const template: ResolvedGondolinTemplate = {
      id: 'example-node-git',
      version: '1',
      checkpointPath: '/not-used',
      fingerprint: 'bafkreitemplate',
      guestAssetBuildId: 'guest-build-1',
      executables: ['git', 'node', 'npm'],
      resumeCommands: [],
    };
    const manifest = await buildPiExecutorManifest({
      runtime,
      profile: { id: 'profile-1', definitionCid: 'bafkreiprofile' },
      template,
    });
    const changedManifest = await buildPiExecutorManifest({
      runtime: changedRuntime,
      profile: { id: 'profile-1', definitionCid: 'bafkreiprofile' },
      template,
    });

    expect(runtime.runtimeKind).toBe('example_pi');
    expect(
      manifest.tools.find((tool) => tool.name === 'github_issue_read')
        ?.descriptorCid,
    ).not.toBe(
      changedManifest.tools.find((tool) => tool.name === 'github_issue_read')
        ?.descriptorCid,
    );
  });
});
