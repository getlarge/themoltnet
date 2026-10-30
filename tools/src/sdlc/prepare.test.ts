import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { githubRequest, main } from './prepare.js';

const child = vi.hoisted(() => ({ execute: vi.fn(), end: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: child.execute }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  child.execute.mockReset();
  child.end.mockReset();
});
function respond() {
  child.execute.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      queueMicrotask(() => callback(null, '{"ok":true}'));
      return { stdin: { on: vi.fn(), end: child.end } };
    },
  );
}
const policyFile = fileURLToPath(
  new URL('../../../libs/sdlc/examples/pilot-policy.json', import.meta.url),
);
const requestFile = fileURLToPath(
  new URL(
    '../../../libs/sdlc/examples/preparation-request.json',
    import.meta.url,
  ),
);
describe('SDLC preparation operator', () => {
  it('uses the released agent wrapper and passes untrusted content through stdin', async () => {
    respond();
    const body = { body: '$(touch /tmp/not-executed); `ignored`' };
    expect(
      await githubRequest('example/repo')(
        '/repos/example/repo/issues/1/comments',
        'POST',
        body,
      ),
    ).toEqual({ ok: true });
    expect(child.execute.mock.calls[0].slice(0, 2)).toEqual([
      'moltnet',
      [
        'github',
        'exec',
        '--',
        'gh',
        'api',
        '--hostname',
        'github.com',
        '--method',
        'POST',
        '/repos/example/repo/issues/1/comments',
        '--input',
        '-',
      ],
    ]);
    expect(child.end).toHaveBeenCalledWith(JSON.stringify(body));
  });
  it('rejects requests outside the configured repository without starting a child', async () => {
    await expect(
      githubRequest('example/repo')('/repos/other/repo/issues/1', 'GET'),
    ).rejects.toThrow('escaped');
    expect(child.execute).not.toHaveBeenCalled();
  });
  it('plans offline with a complete durable policy snapshot', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await main(['plan', policyFile, requestFile]);
    expect(child.execute).not.toHaveBeenCalled();
    const plan = JSON.parse(String(stdout.mock.calls[0][0])) as {
      params: { policySnapshot: { limits: { maxActiveCases: number } } };
      taskName: string;
    };
    expect(plan.taskName).toBe('sdlc_prepare_v1');
    expect(plan.params.policySnapshot.limits.maxActiveCases).toBe(2);
  });
  it('refuses run before invoking GitHub when the explicit database is absent', async () => {
    vi.stubEnv('ABSURD_DATABASE_URL', '');
    await expect(main(['run', policyFile, requestFile])).rejects.toThrow(
      'Explicit database',
    );
    expect(child.execute).not.toHaveBeenCalled();
  });
});
