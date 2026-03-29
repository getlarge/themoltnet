import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pollStatus,
  pollUntil,
  startOnboarding,
  toErrorMessage,
} from './api.js';

const BASE_URL = 'http://localhost:8000';

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startOnboarding', () => {
  it('returns workflowId and manifestFormUrl on success', async () => {
    vi.stubGlobal('fetch', async () =>
      makeResponse({
        workflowId: 'wf-123',
        manifestFormUrl: 'https://github.com/apps/my-app/installations/new',
      }),
    );

    const result = await startOnboarding(BASE_URL, {
      publicKey: 'ed25519:abc',
      fingerprint: 'A1B2-C3D4-E5F6-G7H8',
      agentName: 'my-agent',
    });

    expect(result.workflowId).toBe('wf-123');
    expect(result.manifestFormUrl).toContain('github.com');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', async () =>
      makeResponse({ detail: 'Service unavailable' }, 503),
    );

    await expect(
      startOnboarding(BASE_URL, {
        publicKey: 'ed25519:abc',
        fingerprint: 'A1B2-C3D4-E5F6-G7H8',
        agentName: 'my-agent',
      }),
    ).rejects.toThrow();
  });
});

describe('pollStatus', () => {
  it('returns status and githubCode', async () => {
    vi.stubGlobal('fetch', async () =>
      makeResponse({ status: 'github_code_ready', githubCode: 'gh-code-abc' }),
    );

    const result = await pollStatus(BASE_URL, 'wf-123');
    expect(result.status).toBe('github_code_ready');
    expect(result.githubCode).toBe('gh-code-abc');
  });
});

describe('pollUntil', () => {
  it('resolves when target status is reached', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      call++;
      const status = call === 1 ? 'awaiting_github' : 'github_code_ready';
      const githubCode = call === 2 ? 'gh-code-abc' : undefined;
      return makeResponse({ status, githubCode });
    });

    const ticks: string[] = [];
    const result = await pollUntil(
      BASE_URL,
      'wf-123',
      ['github_code_ready'],
      (s) => ticks.push(s),
    );

    expect(result.status).toBe('github_code_ready');
    expect(result.githubCode).toBe('gh-code-abc');
    expect(ticks).toEqual(['awaiting_github', 'github_code_ready']);
  }, 10_000);

  it('throws immediately when status is failed', async () => {
    vi.stubGlobal('fetch', async () => makeResponse({ status: 'failed' }));

    await expect(pollUntil(BASE_URL, 'wf-123', ['completed'])).rejects.toThrow(
      'Onboarding workflow failed',
    );
  });

  it('throws on timeout', async () => {
    vi.stubGlobal('fetch', async () =>
      makeResponse({ status: 'awaiting_github' }),
    );

    let calls = 0;
    const origDateNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++;
      return calls === 1 ? origDateNow() : origDateNow() + 10 * 60 * 1000;
    });

    await expect(pollUntil(BASE_URL, 'wf-123', ['completed'])).rejects.toThrow(
      'Timed out waiting for status',
    );
  });
});

describe('toErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(toErrorMessage(new Error('something broke'))).toBe(
      'something broke',
    );
  });

  it('extracts title from ProblemDetails', () => {
    const pd = {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
    };
    expect(toErrorMessage(pd)).toBe('Unauthorized');
  });

  it('includes detail in ProblemDetails message', () => {
    const pd = {
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'entry does not exist',
    };
    expect(toErrorMessage(pd)).toBe('Not found: entry does not exist');
  });

  it('formats ValidationProblemDetails with field errors', () => {
    const vpd = {
      type: 'about:blank',
      title: 'Validation failed',
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [
        { field: 'content', message: 'must not be empty' },
        { field: 'diaryId', message: 'invalid UUID' },
      ],
    };
    const msg = toErrorMessage(vpd);
    expect(msg).toContain('Validation failed');
    expect(msg).toContain('content: must not be empty');
    expect(msg).toContain('diaryId: invalid UUID');
  });

  it('falls back to JSON.stringify for unknown objects', () => {
    const obj = { foo: 'bar' };
    expect(toErrorMessage(obj)).toBe('{"foo":"bar"}');
  });
});
