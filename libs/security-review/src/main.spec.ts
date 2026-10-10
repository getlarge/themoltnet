import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// main.ts dispatches at import time. Resetting modules lets each test exercise
// one CLI command with its own accepted-output and GitHub responses.
const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  exec: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    const value = mocks.files.get(path);
    if (value === undefined) throw new Error(`missing fixture ${path}`);
    return value;
  },
  writeFileSync: (path: string, value: string) => {
    mocks.files.set(path, value);
  },
}));
vi.mock('node:child_process', () => ({ execFileSync: mocks.exec }));

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const PATCH = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -1 +1 @@',
  '-deny();',
  '+allow();',
].join('\n');
const CANDIDATES = {
  summary: 'Check authorization.',
  findings: [
    {
      id: 'guard',
      path: 'src/auth.ts',
      side: 'new',
      line: 1,
      title: 'Authorization guard',
      hypothesis: 'A caller may bypass the guard.',
    },
  ],
};
const RESULT = {
  summary: 'The caller still checks authorization.',
  findings: [
    {
      id: 'guard',
      status: 'refuted',
      severity: 'info',
      path: 'src/auth.ts',
      side: 'new',
      line: 1,
      title: 'Authorization guard',
      evidence: 'The changed line allows the checked caller.',
      reachability: 'The caller checks authorization first.',
      remediation: 'No change needed.',
    },
  ],
};
const originalCommand = process.argv[2];
const originalExitCode = process.exitCode;

async function run(command: string) {
  process.argv[2] = command;
  vi.resetModules();
  await import('./main.js');
}

describe('security review command orchestration', () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.exec.mockReset();
    vi.stubEnv('GITHUB_REPOSITORY', 'getlarge/themoltnet');
    vi.stubEnv('PR_NUMBER', '42');
    vi.stubEnv('GITHUB_RUN_ID', '100');
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '1');
    vi.stubEnv('REVIEW_META', '/tmp/review-meta.json');
    vi.stubEnv('TASK_SPEC', '/tmp/task.json');
    vi.stubEnv('CANDIDATE_OUTPUT', '/tmp/candidates.json');
    vi.stubEnv('REVIEW_OUTPUT', '/tmp/result.json');
    vi.stubEnv('REVIEW_TASK_ID', TASK_ID);
    vi.stubEnv('APP_LOGIN', 'moltnet[bot]');
    mocks.files.set(
      '/tmp/review-meta.json',
      JSON.stringify({
        repo: 'getlarge/themoltnet',
        pr: 42,
        title: 'Change auth',
        body: 'Review me',
        headRefOid: HEAD,
        baseRefOid: BASE,
        correlation: TASK_ID,
      }),
    );
    mocks.files.set('.agents/skills/security-review/SKILL.md', '# Procedure');
    mocks.files.set(
      '/tmp/candidates.json',
      JSON.stringify({ result: CANDIDATES }),
    );
    mocks.files.set('/tmp/result.json', JSON.stringify({ result: RESULT }));
    mocks.exec.mockImplementation((binary: string, args: string[]) => {
      if (binary === 'git') return PATCH;
      if (binary === 'gh' && args[1] === 'repos/getlarge/themoltnet/pulls/42')
        return JSON.stringify({ head: { sha: HEAD } });
      if (
        binary === 'gh' &&
        args[1] === 'repos/getlarge/themoltnet/issues/42/comments' &&
        args.includes('--paginate')
      )
        return '';
      return '';
    });
  });

  afterEach(() => {
    process.argv[2] = originalCommand;
    process.exitCode = originalExitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('pins PR metadata and skips a catalogue-only Renovate update', async () => {
    mocks.exec.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === 'pr')
        return JSON.stringify({
          title: 'Update catalog',
          body: null,
          headRefOid: HEAD,
          baseRefOid: BASE,
          author: { login: 'themoltnet-renovate[bot]' },
        });
      return 'pnpm-workspace.yaml\npnpm-lock.yaml\n';
    });
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await run('prepare');

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('skip=true'));
    expect(JSON.parse(mocks.files.get('/tmp/review-meta.json')!)).toMatchObject(
      {
        headRefOid: HEAD,
        baseRefOid: BASE,
        pr: 42,
      },
    );
  });

  it('composes a pinned hunt task with the embedded skill and diff', async () => {
    await run('compose-hunt');

    const task = JSON.parse(mocks.files.get('/tmp/task.json')!) as {
      input: {
        brief: string;
        context: { binding: string; content: string }[];
        execution: { revision: string };
      };
    };
    expect(task.input.execution.revision).toBe(HEAD);
    expect(task.input.context).toContainEqual(
      expect.objectContaining({ binding: 'skill', content: '# Procedure' }),
    );
    expect(task.input.brief).toContain('+allow();');
  });

  it('composes verification from accepted, diff-anchored candidates', async () => {
    await run('compose-verify');

    const task = JSON.parse(mocks.files.get('/tmp/task.json')!) as {
      input: { brief: string };
    };
    expect(task.input.brief).toContain('"id":"guard"');
    expect(task.input.brief).toContain('Try to disprove each hypothesis');
  });

  it('publishes only after checking the head and accepted evidence', async () => {
    await run('publish');

    const calls = mocks.exec.mock.calls as [string, string[]][];
    const publish = calls.find(
      ([binary, args]) =>
        binary === 'gh' &&
        args[1] === 'repos/getlarge/themoltnet/issues/42/comments' &&
        args.includes('POST'),
    );
    expect(publish).toBeDefined();
    expect(publish![1].join(' ')).toContain(TASK_ID);
    expect(publish![1].join(' ')).toContain(HEAD);
    expect(calls.some(([binary]) => binary === 'git')).toBe(true);
  });

  it('rejects accepted output that omits a candidate before posting', async () => {
    mocks.files.set(
      '/tmp/result.json',
      JSON.stringify({ result: { summary: 'Incomplete', findings: [] } }),
    );
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await run('publish');

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('every candidate'),
    );
    expect(
      (mocks.exec.mock.calls as [string, string[]][]).some(
        ([binary, args]) => binary === 'gh' && args.includes('POST'),
      ),
    ).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('refuses publication when the PR head moved', async () => {
    mocks.exec.mockImplementation((binary: string) => {
      if (binary === 'gh')
        return JSON.stringify({ head: { sha: 'c'.repeat(40) } });
      throw new Error('unexpected command');
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await run('publish');

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('PR head moved'),
    );
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
