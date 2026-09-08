import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const actionPath = resolve(packageRoot, 'action.yml');
const multiLensWorkflowPath = resolve(
  workspaceRoot,
  '.github/workflows/multi-lens-review.yml',
);
const daemonSourcePath = resolve(
  workspaceRoot,
  'apps/agent-daemon/src/main.ts',
);

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
}

interface CompositeAction {
  runs: { steps: WorkflowStep[] };
}

interface WorkflowFile {
  jobs: Record<string, { env?: Record<string, string> }>;
}

const action = parse(readFileSync(actionPath, 'utf8')) as CompositeAction;
const workflow = parse(
  readFileSync(multiLensWorkflowPath, 'utf8'),
) as WorkflowFile;

function actionStep(name: string): WorkflowStep {
  const step = action.runs.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing action step: ${name}`);
  return step;
}

/** Some steps carry an `id` instead of a `name` (e.g. `create-task`). */
function actionStepById(id: string): WorkflowStep {
  const step = action.runs.steps.find(
    (candidate) => (candidate as { id?: string }).id === id,
  );
  if (!step) throw new Error(`Missing action step id: ${id}`);
  return step;
}

describe('workspace daemon action contract', () => {
  it('uses a TypeScript-aware source entrypoint in workspace mode', () => {
    const run = action.runs.steps.map((step) => step.run ?? '').join('\n');

    expect(run).toContain('node --import tsx');
    expect(run).toContain('"$GITHUB_WORKSPACE/apps/agent-daemon/src/main.ts"');
    expect(run).not.toContain(
      'node "$GITHUB_WORKSPACE/apps/agent-daemon/dist/main.js"',
    );
  });

  it('executes the configless agent-key branch without materializing credentials', () => {
    const run = actionStep('Materialize MoltNet agent dir from env').run!;
    const root = mkdtempSync(resolve(tmpdir(), 'agent-daemon-action-'));
    const githubEnv = resolve(root, 'github-env');
    writeFileSync(githubEnv, '', 'utf8');

    try {
      const result = spawnSync('bash', ['-c', run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_WORKSPACE: root,
          GITHUB_ENV: githubEnv,
          AGENT_NAME_OVERRIDE: '',
          MOLTNET_AGENT_NAME: 'configless',
          MOLTNET_AGENT_KEY: 'agent-key-secret',
          MOLTNET_PRIVATE_KEY: 'signing-seed',
          // Configless is an assertion about absence, so clear these
          // explicitly rather than inheriting a developer's shell. The _REF
          // forms matter too: the step now rejects a value and a reference
          // together, so an inherited one would fail the run.
          MOLTNET_CLIENT_ID: '',
          MOLTNET_CLIENT_SECRET: '',
          MOLTNET_AGENT_KEY_REF: '',
          MOLTNET_PRIVATE_KEY_REF: '',
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'Using configless MoltNet agent-key authentication',
      );
      expect(
        existsSync(resolve(root, '.moltnet/configless/moltnet.json')),
      ).toBe(false);
      expect(existsSync(resolve(root, '.moltnet/configless/env'))).toBe(false);
      expect(readFileSync(githubEnv, 'utf8')).toContain(
        'MOLTNET_API_URL=https://api.themolt.net',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves an explicit API URL in configless agent-key mode', () => {
    const run = actionStep('Materialize MoltNet agent dir from env').run!;
    const root = mkdtempSync(resolve(tmpdir(), 'agent-daemon-action-url-'));
    const githubEnv = resolve(root, 'github-env');
    writeFileSync(githubEnv, '', 'utf8');

    try {
      const result = spawnSync('bash', ['-c', run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_WORKSPACE: root,
          GITHUB_ENV: githubEnv,
          AGENT_NAME_OVERRIDE: '',
          MOLTNET_AGENT_NAME: 'configless',
          MOLTNET_AGENT_KEY: 'agent-key-secret',
          MOLTNET_PRIVATE_KEY: 'signing-seed',
          // Configless is an assertion about absence, so clear these
          // explicitly rather than inheriting a developer's shell. The _REF
          // forms matter too: the step now rejects a value and a reference
          // together, so an inherited one would fail the run.
          MOLTNET_CLIENT_ID: '',
          MOLTNET_CLIENT_SECRET: '',
          MOLTNET_AGENT_KEY_REF: '',
          MOLTNET_PRIVATE_KEY_REF: '',
          MOLTNET_API_URL: 'https://staging.example.test',
        },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(githubEnv, 'utf8')).toContain(
        'MOLTNET_API_URL=https://staging.example.test',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails the parsed agent-key branch clearly when signing material is absent', () => {
    const run = actionStep('Materialize MoltNet agent dir from env').run!;
    const result = spawnSync('bash', ['-c', run], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_WORKSPACE: tmpdir(),
        AGENT_NAME_OVERRIDE: '',
        MOLTNET_AGENT_NAME: 'configless',
        MOLTNET_AGENT_KEY: 'agent-key-secret',
        MOLTNET_PRIVATE_KEY: '',
        // "Absent" must mean absent: inheriting a reference from the
        // developer's shell would satisfy the check and hide the failure.
        MOLTNET_PRIVATE_KEY_REF: '',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'MOLTNET_PRIVATE_KEY (or MOLTNET_PRIVATE_KEY_REF) is required',
    );
  });

  // The guards below run before the task is created, so a shape the daemon
  // would reject must fail here rather than queue work nothing claims.
  const materializeStep = () =>
    actionStep('Materialize MoltNet agent dir from env').run!;

  const baseEnv = {
    AGENT_NAME_OVERRIDE: '',
    MOLTNET_AGENT_NAME: 'guarded',
    MOLTNET_AGENT_KEY: '',
    MOLTNET_AGENT_KEY_REF: '',
    MOLTNET_PRIVATE_KEY: '',
    MOLTNET_PRIVATE_KEY_REF: '',
    MOLTNET_CLIENT_ID: '',
    MOLTNET_CLIENT_SECRET: '',
  };

  const runMaterialize = (overrides: Record<string, string>) =>
    spawnSync('bash', ['-c', materializeStep()], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...baseEnv,
        ...overrides,
        GITHUB_WORKSPACE: tmpdir(),
      },
    });

  it.each([
    [
      'an agent key value and reference together',
      {
        MOLTNET_AGENT_KEY: 'k',
        MOLTNET_AGENT_KEY_REF: 'os-keyring:agent-key/id-1',
        MOLTNET_PRIVATE_KEY: 'seed',
      },
      'Set only one of MOLTNET_AGENT_KEY',
    ],
    [
      'a seed value and reference together',
      {
        MOLTNET_AGENT_KEY: 'k',
        MOLTNET_PRIVATE_KEY: 'seed',
        MOLTNET_PRIVATE_KEY_REF: 'file:identity/FP/seed',
      },
      'Set only one of MOLTNET_PRIVATE_KEY',
    ],
    [
      'a client id without its secret',
      {
        MOLTNET_AGENT_KEY: 'k',
        MOLTNET_PRIVATE_KEY: 'seed',
        MOLTNET_CLIENT_ID: 'c1',
      },
      'MOLTNET_CLIENT_SECRET is required',
    ],
    [
      'a client secret without its id',
      {
        MOLTNET_AGENT_KEY: 'k',
        MOLTNET_PRIVATE_KEY: 'seed',
        MOLTNET_CLIENT_SECRET: 's1',
      },
      'MOLTNET_CLIENT_ID is required',
    ],
  ])('rejects %s', (_label, overrides, expected) => {
    const result = runMaterialize(overrides);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
  });

  it('selects configless credentials for a key reference', () => {
    // Scoped to the credential branch, which is all this can honestly cover:
    // driving real task creation would need the CLI and a live API. Before the
    // fix this branch tested only MOLTNET_AGENT_KEY, so a reference-only run —
    // which materializes no moltnet.json to point at — fell through to
    // "credentials not found".
    const run = actionStepById('create-task').run!;

    // The branch must accept either form.
    expect(run).toContain(
      'if [ -n "${MOLTNET_AGENT_KEY:-}" ] || [ -n "${MOLTNET_AGENT_KEY_REF:-}" ]; then',
    );
    // And the failure it used to hit must still exist for the case it is for:
    // no key of either form and no credentials file.
    expect(run).toContain('moltnet credentials not found');
  });

  it('accepts a seed reference in place of the literal seed', () => {
    // The daemon resolves either form, so a reference-only deployment must not
    // be rejected by the wrapper and pushed into exposing the seed value.
    const run = actionStep('Materialize MoltNet agent dir from env').run!;
    const root = mkdtempSync(resolve(tmpdir(), 'agent-daemon-action-seedref-'));
    const githubEnv = resolve(root, 'github-env');
    writeFileSync(githubEnv, '', 'utf8');

    try {
      const result = spawnSync('bash', ['-c', run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_WORKSPACE: root,
          GITHUB_ENV: githubEnv,
          AGENT_NAME_OVERRIDE: '',
          MOLTNET_AGENT_NAME: 'configless',
          MOLTNET_AGENT_KEY_REF: 'os-keyring:agent-key/identity-1',
          MOLTNET_AGENT_KEY: '',
          MOLTNET_PRIVATE_KEY: '',
          MOLTNET_PRIVATE_KEY_REF: 'os-keyring:identity/FP/seed',
          MOLTNET_CLIENT_ID: '',
          MOLTNET_CLIENT_SECRET: '',
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('configless MoltNet agent-key');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('retains agent-tree materialization when OAuth vars are supplied', () => {
    const run = actionStep('Materialize MoltNet agent dir from env').run!;

    // OAuth vars still rebuild git, SSH and GitHub App assets — they just no
    // longer authenticate the daemon, which needs the agent key below.
    expect(run).toContain('config init-from-env');
    expect(run).toContain('MOLTNET_SUBJECT_ID');
    expect(run).toContain('MOLTNET_SUBJECT_TYPE');
    expect(run).toContain('MOLTNET_IDENTITY_ID is no longer supported');
  });

  it('refuses to run without an agent key, naming the fix', () => {
    // Arrange: the pre-#2160 shape — OAuth client credentials and no key.
    // `config init-from-env` writes no agent_key_ref, so the daemon would
    // refuse the config it produces; fail here instead, with the remedy.
    const run = actionStep('Materialize MoltNet agent dir from env').run!;

    // Act
    const result = spawnSync('bash', ['-c', run], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_WORKSPACE: tmpdir(),
        AGENT_NAME_OVERRIDE: '',
        MOLTNET_AGENT_NAME: 'oauth-only',
        MOLTNET_AGENT_KEY: '',
        MOLTNET_AGENT_KEY_REF: '',
        MOLTNET_CLIENT_ID: 'client-1',
        MOLTNET_CLIENT_SECRET: 'secret-1',
        MOLTNET_PRIVATE_KEY: 'signing-seed',
      },
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MOLTNET_AGENT_KEY');
    expect(result.stderr).toContain(
      'no longer accepts OAuth2 client credentials',
    );
  });

  it('materializes the agent tree when a key and OAuth vars are both present', () => {
    // Arrange: the two paths used to be mutually exclusive — the key branch
    // exited before materialization, so a committing agent could not have
    // both. Assert they now compose.
    const run = actionStep('Materialize MoltNet agent dir from env').run!;

    expect(run).toContain(
      'Agent-key authentication with a materialized agent tree',
    );
  });

  it('keeps multi-lens workers on the minimal configless secret set', () => {
    const environments = [
      workflow.jobs['runtime-preflight']?.env,
      workflow.jobs['review-workers']?.env,
    ];

    for (const env of environments) {
      expect(env).toMatchObject({
        MOLTNET_AGENT_KEY: '${{ secrets.MOLTNET_AGENT_KEY }}',
        MOLTNET_PRIVATE_KEY: '${{ secrets.MOLTNET_PRIVATE_KEY }}',
      });
      expect(env).not.toHaveProperty('MOLTNET_IDENTITY_ID');
      expect(env).not.toHaveProperty('MOLTNET_CLIENT_ID');
      expect(env).not.toHaveProperty('MOLTNET_CLIENT_SECRET');
      expect(env).not.toHaveProperty('MOLTNET_PUBLIC_KEY');
      expect(env).not.toHaveProperty('MOLTNET_FINGERPRINT');
    }
  });

  it('boots the workspace daemon entrypoint with plain Node and tsx', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', daemonSourcePath, 'drain', '--help'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'agent-daemon drain — poll until the queue is empty, then exit.',
    );
  }, 30_000);
});
