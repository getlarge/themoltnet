import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadAction,
  renderRun,
  stepById,
  writeExecutable,
} from './test-support.js';

const action = loadAction();
const TEAM = '11111111-1111-4111-8111-111111111111';
const PROFILE = '44444444-4444-4444-8444-444444444444';
let root: string;
let calls: string;

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'action-profile-'));
  calls = resolve(root, 'calls.json');
  const identity = resolve(root, '.config/moltnet/identities/test');
  mkdirSync(identity, { recursive: true });
  writeFileSync(resolve(identity, 'moltnet.json'), '{}');
  mkdirSync(resolve(root, 'bin'));
  writeExecutable(
    resolve(root, 'bin/npx'),
    `
if [ "$3 $4" = "profile get" ]; then
  printf '%s\\n' "$FAKE_PROFILE_JSON"
  exit "\${FAKE_PROFILE_STATUS:-0}"
fi
if [ "\${5:-}" = "--help" ]; then
  printf '%s\\n' "$FAKE_CREATE_HELP"
  exit 0
fi
printf '%s\\n' "$@" | jq -Rsc 'split("\\n")[:-1]' > "$CALLS"
echo created-task-id
`,
  );
  writeFileSync(
    resolve(root, 'spec.json'),
    JSON.stringify({
      taskType: 'freeform',
      correlationId: '33333333-3333-4333-8333-333333333333',
      input: { brief: 'Review an issue' },
    }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(id: string, overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    'bash',
    [
      '-c',
      renderRun(stepById(action, id).run, {
        'inputs.cancel-superseded': 'false',
      }),
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: `${resolve(root, 'bin')}:${process.env.PATH ?? ''}`,
        HOME: root,
        ACTION_TEMP: root,
        GITHUB_OUTPUT: resolve(root, 'output'),
        CALLS: calls,
        MOLTNET_CLI_PACKAGE: '@themoltnet/cli@3.15.0',
        MOLTNET_TEAM_ID: TEAM,
        MOLTNET_DIARY_ID: TEAM,
        MOLTNET_AGENT_NAME: 'test',
        MOLTNET_AGENT_KEY: '',
        PROFILE_OVERRIDE: 'triage',
        PROFILE_ID: PROFILE,
        FAKE_PROFILE_JSON: JSON.stringify({ id: PROFILE, teamId: TEAM }),
        FAKE_CREATE_HELP: '--allowed-profile',
        TASK_SPEC_PATH: resolve(root, 'spec.json'),
        TASK_TAGS: '',
        SKIP_VALIDATION: 'false',
        ...overrides,
      },
    },
  );
}

describe('runtime profile pinning', () => {
  it('resolves a team-scoped name once and shares the UUID with create, dispatch, and execution', () => {
    const result = run('profile');
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(resolve(root, 'output'), 'utf8')).toBe(
      `id=${PROFILE}\n`,
    );
    expect(stepById(action, 'create-task').env?.PROFILE_ID).toBe(
      '${{ steps.profile.outputs.id }}',
    );
    expect(stepById(action, 'dispatch').env?.MOLTNET_ACTION_PROFILE_ID).toBe(
      '${{ steps.profile.outputs.id }}',
    );
    expect(stepById(action, 'run').env?.PROFILE_OVERRIDE).toBe(
      '${{ steps.profile.outputs.id }}',
    );
    const ids = action.runs.steps.map((step) => step.id);
    expect(ids.indexOf('profile')).toBeLessThan(ids.indexOf('create-task'));
  });

  it('uses the environment profile when the input is empty', () => {
    const result = run('profile', {
      PROFILE_OVERRIDE: '',
      MOLTNET_AGENT_PROFILE: 'triage',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    { FAKE_PROFILE_STATUS: '1' },
    { FAKE_PROFILE_JSON: '{}' },
    { FAKE_PROFILE_JSON: JSON.stringify({ id: 'invalid', teamId: TEAM }) },
    { FAKE_PROFILE_JSON: JSON.stringify({ id: PROFILE, teamId: PROFILE }) },
    { PROFILE_OVERRIDE: '', MOLTNET_AGENT_PROFILE: '' },
  ])(
    'fails before enqueueing when profile resolution fails: %j',
    (overrides) => {
      const result = run('profile', overrides);
      expect(result.status).not.toBe(0);
      expect(existsSync(calls)).toBe(false);
      expect(existsSync(resolve(root, 'output'))).toBe(false);
    },
  );

  it('enqueues work restricted to the resolved profile and preserves the correlation ID', () => {
    const result = run('create-task');
    expect(result.status, result.stderr).toBe(0);
    const args = JSON.parse(readFileSync(calls, 'utf8')) as string[];
    expect(JSON.parse(args[args.indexOf('--allowed-profile') + 1])).toEqual({
      profileId: PROFILE,
    });
    expect(args[args.indexOf('--correlation-id') + 1]).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('refuses to enqueue unrestricted work with an older CLI', () => {
    const result = run('create-task', { FAKE_CREATE_HELP: '--task-type' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to create unpinned work');
    expect(existsSync(calls)).toBe(false);
  });
});
