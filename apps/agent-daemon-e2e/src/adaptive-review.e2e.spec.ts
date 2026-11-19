/** Real launcher + Absurd + API + daemon processes; scripted executor and GitHub boundary. */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  type AdaptiveReport,
  createAdaptiveStageApp,
  executionQueue,
} from '@moltnet/adaptive-review';
import { AGENT_CREDENTIAL_SCOPES } from '@moltnet/models';
import { type Agent, connect } from '@themoltnet/sdk';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHttpStub } from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const reviewEntry = resolve(
  workspaceRoot,
  'packages/adaptive-review-action/dist/run.js',
);
const workerEntry = resolve(
  import.meta.dirname,
  'fixtures/adaptive-review-worker.mts',
);
const absurdUrl =
  process.env.ORCHESTRATION_ABSURD_URL ??
  'postgresql://issue_lifecycle:issue_lifecycle_secret@localhost:55434/issue_lifecycle';
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function executable(path: string, source: string) {
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
}

async function launch(
  cwd: string,
  env: NodeJS.ProcessEnv,
  correlationId: string,
  report: string,
) {
  const child = spawn(
    process.execPath,
    [
      reviewEntry,
      '--repo',
      'fixture/repository',
      '--pr',
      '7',
      '--execution-id',
      correlationId,
      '--report',
      report,
      '--publish',
      '--timeout-sec',
      '120',
    ],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (chunk: Buffer) => {
    log += chunk.toString();
    appendFileSync(report + '.log', chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    log += chunk.toString();
    appendFileSync(report + '.log', chunk);
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), 130_000);
  try {
    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', resolveExit);
    });
    expect(code, log).toBe(0);
    return JSON.parse(readFileSync(report, 'utf8')) as AdaptiveReport;
  } finally {
    clearTimeout(timer);
  }
}

describe('standalone adaptive review (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let creds: Awaited<ReturnType<DaemonTestHarness['createAgent']>>;
  let key: string;
  let profileId: string;
  let projectId: string;

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    creds = await harness.createAgent('e2e-adaptive-review');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    const issued = await agent.agentKeys.create(
      {
        agentId: creds.agentId,
        name: 'review-host-e2e',
        scopes: [
          ...new Set([...AGENT_CREDENTIAL_SCOPES, 'task:write' as const]),
        ],
        ttlDays: 1,
      },
      { teamId: creds.personalTeamId, idempotencyKey: randomUUID() },
    );
    key = issued.secret;
    const profile = await agent.runtimeProfiles.create(
      {
        name: `adaptive-review-e2e-${randomUUID()}`,
        runtimeKind: 'adaptive_review_e2e',
        models: {
          classification: { provider: 'fixture', model: 'classifier' },
          generation: { provider: 'fixture', model: 'reviewer' },
        },
        maxTurns: 2,
        defaultWorkspaceMode: 'shared_mount',
        allowedWorkspaceModes: ['none', 'shared_mount', 'dedicated_worktree'],
        requiredEnv: [],
        requiredTools: [],
        sandbox: {},
      },
      { teamId: creds.personalTeamId },
    );
    profileId = profile.id;
    const project = await agent.projects.create(
      {
        name: `review-e2e-${randomUUID()}`,
        defaultDiaryId: creds.privateDiaryId,
      },
      { teamId: creds.personalTeamId },
    );
    projectId = project.id;
  });

  afterAll(async () => {
    if (profileId) await agent.runtimeProfiles.delete(profileId);
    await harness?.teardown();
  });

  it.each([
    { runLane: true, project: false },
    { runLane: false, project: false },
    { runLane: true, project: true },
    { runLane: false, project: true },
  ])(
    'runs classifier-selected branches (run lane=$runLane, project=$project), publishes once, and ignores another correlation',
    async ({ runLane, project }) => {
      const root = mkdtempSync(join(tmpdir(), 'adaptive-review-e2e-'));
      const source = join(root, 'repo');
      const bin = join(root, 'bin');
      mkdirSync(source);
      mkdirSync(bin);
      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
      git('init', '-q');
      git('config', 'user.name', 'Test');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'commit.gpgsign', 'false');
      mkdirSync(join(source, '.github'));
      writeFileSync(
        join(source, '.github/adaptive-review.json'),
        JSON.stringify({ version: 1, lanes: ['tests'], checks: [], rules: [] }),
      );
      writeFileSync(join(source, 'sample.ts'), 'export const value = 1;\n');
      git('add', '.');
      git('commit', '-qm', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(source, 'sample.ts'), 'export const value = 2;\n');
      git('commit', '-qam', 'head');
      const head = git('rev-parse', 'HEAD');
      const pullRequest = {
        number: 7,
        title: 'Change value',
        body: '',
        changed_files: 1,
        user: { login: 'contributor' },
        head: { sha: head, repo: { full_name: 'fixture/repository' } },
        base: { sha: base },
      };
      const githubState = join(root, 'github.json');
      writeFileSync(githubState, JSON.stringify(pullRequest));
      executable(
        join(bin, 'gh'),
        `#!${process.execPath}\nconst fs = require('node:fs');\nconst pr = JSON.parse(fs.readFileSync(process.env.ADAPTIVE_E2E_GITHUB_STATE, 'utf8'));\nconst args = process.argv.slice(2);\nif (args[0] === 'pr') console.log(JSON.stringify({headRefOid:pr.head.sha,baseRefOid:pr.base.sha}));\nelse if (args.includes('--paginate')) console.log(JSON.stringify([[{filename:'sample.ts'}]]));\nelse if (args[0] === 'api') console.log(JSON.stringify(pr));\nelse process.exit(2);\n`,
      );
      const daemon = join(bin, 'review-daemon');
      executable(
        daemon,
        `#!/bin/sh\nexec ${quote(process.execPath)} --import ${quote(createRequire(import.meta.url).resolve('tsx'))} ${quote(workerEntry)} "$@"\n`,
      );
      const comments: Array<{
        id: number;
        body: string;
        user: { login: string };
      }> = [];
      let published = 0;
      const github = await startHttpStub((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://fixture').pathname;
        response.setHeader('content-type', 'application/json');
        if (pathname === '/graphql') {
          response.end(
            JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              },
            }),
          );
        } else if (pathname.endsWith('/pulls/7'))
          response.end(JSON.stringify(pullRequest));
        else if (
          pathname.endsWith('/issues/7/comments') &&
          request.method === 'GET'
        )
          response.end(JSON.stringify(comments));
        else if (
          pathname.endsWith('/issues/7/comments') &&
          request.method === 'POST'
        ) {
          let body = '';
          request.setEncoding('utf8');
          request.on('data', (chunk: string) => {
            body += chunk;
          });
          request.on('end', () => {
            published += 1;
            const comment = {
              id: 9,
              body: (JSON.parse(body) as { body: string }).body,
              user: { login: 'reviewer[bot]' },
            };
            comments.push(comment);
            response.end(JSON.stringify(comment));
          });
        } else
          response
            .writeHead(404)
            .end(JSON.stringify({ message: 'Unknown GitHub fixture route' }));
      });
      const correlationId = randomUUID();
      const unrelated = await agent.tasks.create(
        {
          taskType: 'classify',
          ...(project ? { projectId } : {}),
          diaryId: creds.privateDiaryId,
          correlationId: randomUUID(),
          allowedProfiles: [{ profileId }],
          input: {
            version: 1,
            state: {},
            questions: {
              test: {
                type: 'bool',
                instructions: 'Unrelated work',
                criteria: { true: 'yes', false: 'no' },
              },
            },
          },
        },
        { teamId: creds.personalTeamId },
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        LOG_LEVEL: 'debug',
        MOLTNET_ACTIVE_IDENTITY: '',
        MOLTNET_CREDENTIALS_PATH: '',
        MOLTNET_AGENT_DIR: '',
        MOLTNET_AGENT_KEY_REF: '',
        MOLTNET_PRIVATE_KEY_REF: '',
        MOLTNET_SIGNER_URL: '',
        MOLTNET_CLIENT_ID: '',
        MOLTNET_CLIENT_SECRET: '',
        MOLTNET_GITHUB_APP_PRIVATE_KEY: '',
        MOLTNET_AGENT_KEY: key,
        MOLTNET_PRIVATE_KEY: creds.keyPair.privateKey,
        MOLTNET_AGENT_NAME: creds.name,
        MOLTNET_API_URL: harness.restApiUrl,
        MOLTNET_TEAM_ID: creds.personalTeamId,
        MOLTNET_DIARY_ID: creds.privateDiaryId,
        MOLTNET_PROJECT_ID: project ? projectId : '',
        ADAPTIVE_DATABASE_URL: absurdUrl,
        ADAPTIVE_RUNTIME_SHA: base,
        ADAPTIVE_MODE: 'active',
        ADAPTIVE_CLASSIFIER_PROFILE: profileId,
        ADAPTIVE_FOCUSED_PROFILE: profileId,
        ADAPTIVE_DOCS_PROFILE: '',
        ADAPTIVE_COMPLEXITY_PROFILE: '',
        ADAPTIVE_SECURITY_PROFILE: '',
        ADAPTIVE_DAEMON_BIN: daemon,
        ADAPTIVE_APP_LOGIN: 'reviewer[bot]',
        ADAPTIVE_E2E_GITHUB_STATE: githubState,
        ADAPTIVE_E2E_RUN_LANE: String(runLane),
        // This token reaches only the loopback GitHub fixture, never GitHub.
        GH_TOKEN: 'fixture-github-token',
        GITHUB_API_URL: github.url,
        GITHUB_GRAPHQL_URL: `${github.url}/graphql`,
      };
      delete env.GITHUB_OUTPUT;
      delete env.GITHUB_STEP_SUMMARY;
      try {
        const reportPath = join(root, 'report.json');
        const report = await launch(source, env, correlationId, reportPath);
        expect(report.results).toMatchObject([
          { lane: 'tests', status: runLane ? 'clear' : 'screened' },
        ]);
        expect(report.taskIds).toHaveLength(runLane ? 2 : 1);
        const tasks = await agent.tasks.list(
          { correlationId, limit: 50 },
          { teamId: creds.personalTeamId },
        );
        expect(new Set(tasks.items.map((task) => task.id))).toEqual(
          new Set(report.taskIds),
        );
        for (const task of tasks.items) {
          expect(task.status).toBe('completed');
          expect(task.correlationId).toBe(correlationId);
          expect(task.projectId ?? null).toBe(project ? projectId : null);
          expect(await agent.tasks.listAttempts(task.id)).toHaveLength(1);
        }
        expect((await agent.tasks.get(unrelated.id)).status).toBe('queued');
        expect(published).toBe(1);
        // A fresh launcher process reuses the completed workflow, not another task set.
        const replay = await launch(source, env, correlationId, reportPath);
        expect(replay.taskIds).toEqual(report.taskIds);
        expect(published).toBe(1);
        expect(
          (
            await agent.tasks.list(
              { correlationId, limit: 50 },
              { teamId: creds.personalTeamId },
            )
          ).items,
        ).toHaveLength(report.taskIds.length);
      } finally {
        await agent.tasks.cancel(unrelated.id, { reason: 'E2E cleanup' });
        const queue = executionQueue(`workflow-v1:${correlationId}`);
        for (const suffix of ['', '-input']) {
          const app = createAdaptiveStageApp({
            databaseUrl: absurdUrl,
            queueName: queue + suffix,
            run: () => Promise.resolve(null),
          });
          await app.dropQueue();
          await app.close();
        }
        const db = new Client({ connectionString: absurdUrl });
        await db.connect();
        await db.query(
          'DELETE FROM public.adaptive_review_retention WHERE queue_name = $1',
          [queue],
        );
        await db.end();
        await new Promise<void>((resolveClose, reject) => {
          github.server.close((error) =>
            error ? reject(error) : resolveClose(),
          );
        });
        rmSync(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
