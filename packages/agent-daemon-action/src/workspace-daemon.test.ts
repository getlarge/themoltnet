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
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'MOLTNET_PRIVATE_KEY is required with MOLTNET_AGENT_KEY',
    );
  });

  it('retains config materialization for OAuth execution', () => {
    const run = actionStep('Materialize MoltNet agent dir from env').run!;

    expect(run).toContain('OAuth mode reconstructs the agent');
    expect(run).toContain('npx -y @themoltnet/cli config init-from-env');
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
