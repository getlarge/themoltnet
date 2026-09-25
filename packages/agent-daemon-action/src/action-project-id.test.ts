/**
 * Executes the `create-task` and `run` shell blocks from action.yml against
 * fake `npx` / daemon binaries to pin the `project-id` contract:
 *
 * - With `project-id` set, a released CLI that lacks `task create
 *   --project-id` must fail the step before any task is created. Warning and
 *   creating General work instead would silently mis-scope the task.
 * - The daemon runs bound to the project through a generated bindings file,
 *   and an old daemon without `--binding` fails the step the same way.
 * - Without `project-id`, behaviour is unchanged (`--team`, no binding).
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = parse(
  readFileSync(resolve(packageRoot, 'action.yml'), 'utf8'),
) as {
  inputs: Record<string, { default?: string }>;
  runs: {
    steps: { id?: string; run?: string; env?: Record<string, string> }[];
  };
};

function stepById(id: string) {
  const step = action.runs.steps.find((candidate) => candidate.id === id);
  if (!step?.run) throw new Error(`Missing action step id: ${id}`);
  return step as { id: string; run: string; env?: Record<string, string> };
}

/** Expressions are resolved by the runner, not bash; inline the ones used. */
function renderRun(run: string): string {
  return run.replaceAll('${{ inputs.cancel-superseded }}', 'false');
}

const PROJECT = '55555555-5555-4555-8555-555555555555';
const TEAM = '11111111-1111-4111-8111-111111111111';

let root: string;
let binDir: string;
let callLog: string;

function writeExecutable(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
}

/** Fake `npx`: `task create --help` prints $FAKE_CREATE_HELP; a create logs argv. */
function installFakeNpx() {
  writeExecutable(
    resolve(binDir, 'npx'),
    [
      'for arg in "$@"; do',
      '  if [ "$arg" = "--help" ]; then printf "%s\\n" "$FAKE_CREATE_HELP"; exit 0; fi',
      'done',
      'printf "%s\\n" "$*" >> "$FAKE_CALL_LOG"',
      'echo created-task-id',
    ].join('\n'),
  );
}

/** Fake daemon: `<mode> --help` prints $FAKE_DAEMON_HELP; a run logs argv. */
function installFakeDaemon(): string {
  const bin = resolve(binDir, 'moltnet-agent');
  writeExecutable(
    bin,
    [
      'if [ "${2:-}" = "--help" ]; then printf "%s\\n" "$FAKE_DAEMON_HELP"; exit 0; fi',
      'printf "%s\\n" "$@" > "$FAKE_CALL_LOG"',
    ].join('\n'),
  );
  return bin;
}

function runStep(id: string, env: Record<string, string>) {
  return spawnSync('bash', ['-c', renderRun(stepById(id).run)], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      HOME: root,
      RUNNER_TEMP: root,
      GITHUB_WORKSPACE: root,
      GITHUB_OUTPUT: resolve(root, 'github-output'),
      FAKE_CALL_LOG: callLog,
      ...env,
    },
  });
}

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'agent-daemon-action-project-'));
  binDir = resolve(root, 'bin');
  mkdirSync(binDir);
  callLog = resolve(root, 'calls.log');
  writeFileSync(resolve(root, 'github-output'), '', 'utf8');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('project-id input', () => {
  it('is declared, optional, and empty (General) by default', () => {
    expect(action.inputs['project-id']).toMatchObject({ default: '' });
  });

  it('is wired to the create, dispatch and run steps under dedicated names', () => {
    expect(stepById('create-task').env?.PROJECT_ID).toBe(
      '${{ inputs.project-id }}',
    );
    expect(stepById('dispatch').env?.MOLTNET_ACTION_PROJECT_ID).toBe(
      '${{ inputs.project-id }}',
    );
    expect(stepById('run').env?.PROJECT_ID).toBe('${{ inputs.project-id }}');
  });
});

describe('create-task step with project-id', () => {
  const specEnv = () => {
    const spec = resolve(root, 'spec.json');
    writeFileSync(
      spec,
      JSON.stringify({
        taskType: 'fulfill_brief',
        correlationId: '33333333-3333-4333-8333-333333333333',
        input: { brief: 'b' },
      }),
      'utf8',
    );
    // A credentials file keeps every array non-empty: macOS bash 3.2 treats
    // an empty "${arr[@]}" as unbound under `set -u` (runners use bash 5).
    const creds = resolve(root, '.config/moltnet/identities/agent-a');
    mkdirSync(creds, { recursive: true });
    writeFileSync(resolve(creds, 'moltnet.json'), '{}', 'utf8');
    return {
      MOLTNET_CLI_PACKAGE: '@themoltnet/cli@9.9.9',
      TASK_SPEC_PATH: spec,
      TASK_TAGS: '',
      SKIP_VALIDATION: 'false',
      MOLTNET_RUNNING_TIMEOUT_SEC: '',
      MOLTNET_MAX_ATTEMPTS: '2',
      MOLTNET_AGENT_NAME: 'agent-a',
      MOLTNET_AGENT_KEY: '',
      MOLTNET_AGENT_KEY_REF: '',
      MOLTNET_TEAM_ID: TEAM,
      MOLTNET_DIARY_ID: '22222222-2222-4222-8222-222222222222',
    };
  };

  it('fails before creating anything when the released CLI lacks --project-id', () => {
    installFakeNpx();

    const result = runStep('create-task', {
      ...specEnv(),
      PROJECT_ID: PROJECT,
      FAKE_CREATE_HELP: '--task-type\n--team-id\n--tags',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'does not support task create --project-id',
    );
    expect(existsSync(callLog)).toBe(false);
  });

  it('forwards --project-id when the released CLI supports it', () => {
    installFakeNpx();

    const result = runStep('create-task', {
      ...specEnv(),
      PROJECT_ID: PROJECT,
      FAKE_CREATE_HELP: '--task-type\n--project-id string',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(callLog, 'utf8')).toContain(`--project-id ${PROJECT}`);
  });

  it('trims surrounding whitespace (incl. newlines) before forwarding --project-id', () => {
    installFakeNpx();

    const result = runStep('create-task', {
      ...specEnv(),
      PROJECT_ID: `  ${PROJECT}\n`,
      FAKE_CREATE_HELP: '--task-type\n--project-id string',
    });

    expect(result.status).toBe(0);
    // The fake npx logs "$*": an untrimmed value would leave extra spaces
    // between the flag and the UUID, and a trailing newline after it.
    expect(readFileSync(callLog, 'utf8')).toMatch(
      new RegExp(`--project-id ${PROJECT}(?: |\n)`),
    );
    expect(readFileSync(callLog, 'utf8')).not.toContain(`${PROJECT}\n\n`);
  });

  it('rejects a whitespace-only project-id before creating anything (matches dispatch)', () => {
    installFakeNpx();

    const result = runStep('create-task', {
      ...specEnv(),
      PROJECT_ID: ' \n ',
      FAKE_CREATE_HELP: '--task-type\n--project-id string',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('project-id is blank');
    expect(existsSync(callLog)).toBe(false);
  });

  it('creates General work without probing the CLI when project-id is empty', () => {
    installFakeNpx();

    const result = runStep('create-task', {
      ...specEnv(),
      PROJECT_ID: '',
      FAKE_CREATE_HELP: '',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(callLog, 'utf8')).not.toContain('--project-id');
  });
});

describe('run step with project-id', () => {
  const runEnv = (bin: string) => ({
    TASK_ID: 'task-1',
    PROFILE_OVERRIDE: 'profile-a',
    TASK_TYPES: '',
    CORRELATION_ID: '',
    WAIT_FOR_FIRST_TASK_SEC: '0',
    WAIT_AFTER_TASK_SEC: '0',
    DAEMON_VERSION: 'latest',
    DAEMON_MODE: 'once',
    MOLTNET_AGENT_BIN: bin,
    MOLTNET_AGENT_NAME: 'agent-a',
    MOLTNET_AGENT_PROFILE: '',
    MOLTNET_TEAM_ID: TEAM,
    MOLTNET_API_URL: 'https://api.example.test',
    FAKE_DAEMON_HELP: '--binding <name>\n--config-file <path>',
  });

  const daemonArgs = () => readFileSync(callLog, 'utf8').trim().split('\n');

  it.each(['once', 'drain'])(
    'binds the %s daemon to the project through a generated bindings file',
    (mode) => {
      const bin = installFakeDaemon();

      const result = runStep('run', {
        ...runEnv(bin),
        DAEMON_MODE: mode,
        PROJECT_ID: PROJECT,
      });

      expect(result.status).toBe(0);
      const args = daemonArgs();
      expect(args[0]).toBe(mode);
      expect(args).not.toContain('--team');
      const bindingsPath = args[args.indexOf('--config-file') + 1];
      expect(args[args.indexOf('--binding') + 1]).toBe('moltnet-action');
      expect(JSON.parse(readFileSync(bindingsPath, 'utf8'))).toEqual({
        version: 1,
        bindings: [
          {
            name: 'moltnet-action',
            apiUrl: 'https://api.example.test',
            teamId: TEAM,
            projectId: PROJECT,
            source: root,
            strategy: 'existing',
          },
        ],
      });
      // The daemon refuses group/world-writable project configs.
      expect(statSync(bindingsPath).mode & 0o077).toBe(0);
    },
  );

  it('trims surrounding whitespace (incl. newlines) before validating and binding', () => {
    const bin = installFakeDaemon();

    const result = runStep('run', {
      ...runEnv(bin),
      PROJECT_ID: `  ${PROJECT}\n`,
    });

    expect(result.status).toBe(0);
    const args = daemonArgs();
    const bindingsPath = args[args.indexOf('--config-file') + 1];
    const bindings = JSON.parse(readFileSync(bindingsPath, 'utf8')) as {
      bindings: { projectId: string }[];
    };
    expect(bindings.bindings[0].projectId).toBe(PROJECT);
  });

  it('rejects a whitespace-only project-id (matches dispatch)', () => {
    const bin = installFakeDaemon();

    const result = runStep('run', { ...runEnv(bin), PROJECT_ID: ' \n ' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('project-id is blank');
    expect(existsSync(callLog)).toBe(false);
  });

  it('keeps the team-only General invocation when project-id is empty', () => {
    const bin = installFakeDaemon();

    const result = runStep('run', { ...runEnv(bin), PROJECT_ID: '' });

    expect(result.status).toBe(0);
    const args = daemonArgs();
    expect(args[args.indexOf('--team') + 1]).toBe(TEAM);
    expect(args).not.toContain('--binding');
    expect(args).not.toContain('--config-file');
  });

  it('fails when the installed daemon predates --binding', () => {
    const bin = installFakeDaemon();

    const result = runStep('run', {
      ...runEnv(bin),
      PROJECT_ID: PROJECT,
      FAKE_DAEMON_HELP: '--team <uuid>',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not support --binding');
    expect(existsSync(callLog)).toBe(false);
  });

  it.each([
    ['a non-UUID project', { PROJECT_ID: 'none' }, 'project-id must be'],
    [
      'a project without a team',
      { PROJECT_ID: PROJECT, MOLTNET_TEAM_ID: '' },
      'project-id requires MOLTNET_TEAM_ID',
    ],
  ])('rejects %s', (_label, overrides, expected) => {
    const bin = installFakeDaemon();

    const result = runStep('run', { ...runEnv(bin), ...overrides });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
    expect(existsSync(callLog)).toBe(false);
  });
});
