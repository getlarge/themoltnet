import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs, promisify } from 'node:util';

import { GitHubApi } from '@moltnet/docs-impact-review/github-api';

import { parseReviewTaskBudgets, required } from './config.js';
import { reviewGithubToken } from './github-auth.js';
import { githubChildEnvironment } from './github-environment.js';
import type { PinnedPullRequest } from './host-deps.js';
import { createReviewHostDeps } from './host-deps.js';
import { reuseHostPreparation } from './host-preparation.js';
import {
  DEFAULT_HOST_TIMEOUT_SEC,
  hostTimeoutSeconds,
} from './host-settings.js';
import { publishAdaptiveReport } from './publish.js';
import { reviewRetentionPolicy } from './retention.js';
import {
  runStandaloneReview,
  type StandaloneReviewInput,
  type StandaloneReviewResult,
} from './standalone.js';
import { withReviewWorkers } from './supervisor.js';
import { createGraphQL } from './threads.js';
import type { ReviewCapacity } from './workers.js';

/** The CLI and Actions translate intent once; neither sequences review stages. */
export function standaloneCommand(
  argv: string[],
  env: NodeJS.ProcessEnv,
): {
  input: StandaloneReviewInput;
  workers: 'local' | 'external';
  timeoutSec: number;
  reportPath?: string;
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      pr: { type: 'string' },
      'execution-id': { type: 'string' },
      workers: { type: 'string', default: 'local' },
      publish: { type: 'boolean', default: false },
      report: { type: 'string' },
      'timeout-sec': { type: 'string' },
    },
  });
  const repo = values.repo ?? required('ADAPTIVE_REPOSITORY', env);
  const pr = Number(values.pr ?? required('ADAPTIVE_PR', env));
  const correlationId = (
    values['execution-id'] ?? required('ADAPTIVE_EXECUTION_ID', env)
  ).toLowerCase();
  const mode = env.ADAPTIVE_MODE ?? 'active';
  const workers = values.workers;
  const timeoutSec = hostTimeoutSeconds(
    env,
    Number(
      values['timeout-sec'] ??
        env.ADAPTIVE_TIMEOUT_SEC ??
        DEFAULT_HOST_TIMEOUT_SEC,
    ),
  );
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error('repo must be owner/repository');
  if (!Number.isSafeInteger(pr) || pr < 1)
    throw new Error('pr must be a positive integer');
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      correlationId,
    )
  )
    throw new Error('execution-id must be a UUID; reuse it on resume');
  if (mode !== 'active' && mode !== 'shadow')
    throw new Error('ADAPTIVE_MODE must be active or shadow');
  if (workers !== 'local' && workers !== 'external')
    throw new Error('workers must be local or external');

  const runtimeSha = required('ADAPTIVE_RUNTIME_SHA', env);
  if (!/^[a-f0-9]{40}$/.test(runtimeSha))
    throw new Error('ADAPTIVE_RUNTIME_SHA must be a full commit SHA');
  const profiles: StandaloneReviewInput['profiles'] = {
    classifier: required('ADAPTIVE_CLASSIFIER_PROFILE', env),
  };
  for (const pool of ['focused', 'docs', 'complexity', 'security'] as const) {
    const profile = env[`ADAPTIVE_${pool.toUpperCase()}_PROFILE`];
    if (profile) profiles[pool] = profile;
  }
  return {
    input: {
      repo,
      pr,
      correlationId,
      runtimeSha,
      mode,
      profiles,
      teamId: required('MOLTNET_TEAM_ID', env),
      diaryId: required('MOLTNET_DIARY_ID', env),
      ...(env.MOLTNET_PROJECT_ID ? { projectId: env.MOLTNET_PROJECT_ID } : {}),
      taskBudgets: parseReviewTaskBudgets(env.ADAPTIVE_TASK_BUDGETS),
      protectedPaths: (env.PROTECTED_PATHS ?? '').split('\n').filter(Boolean),
      appLogin: required('ADAPTIVE_APP_LOGIN', env),
      publication:
        values.publish || env.ADAPTIVE_PUBLICATION === 'github'
          ? 'github'
          : 'report-only',
      runUrl: env.ADAPTIVE_RUN_URL ?? `https://github.com/${repo}/pull/${pr}`,
      inlineFindings: env.ADAPTIVE_INLINE_FINDINGS !== 'false',
    },
    workers,
    timeoutSec,
    reportPath: values.report ?? env.ADAPTIVE_REPORT,
  };
}

/** Fetch blobs/ancestry only. Reviewed head code is never executed or checked out. */
export async function ensureReviewGit(
  prepared: PinnedPullRequest,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (
    ![prepared.base, prepared.head].every((oid) => /^[a-f0-9]{40}$/.test(oid))
  )
    throw new Error('Review revisions must be full commit SHAs');
  const git = async (...args: string[]) =>
    (
      await promisify(execFile)('git', args, {
        cwd,
        env: githubChildEnvironment(env, env.GH_TOKEN ?? ''),
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
      })
    ).stdout.trim();
  try {
    await git('cat-file', '-e', `${prepared.base}^{tree}`);
    await git('cat-file', '-e', `${prepared.head}^{tree}`);
    await git('merge-base', prepared.base, prepared.head);
    return;
  } catch {
    /* A replacement host may not have the original objects. */
  }
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const fetchEnv = {
    ...githubChildEnvironment(env, required('GH_TOKEN', env)),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${server}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${required('GH_TOKEN', env)}`).toString('base64')}`,
  };
  const fetch = (...args: string[]) =>
    promisify(execFile)(
      'git',
      [
        'fetch',
        '--no-tags',
        ...args,
        `${server}/${prepared.repo}.git`,
        prepared.base,
        prepared.head,
      ],
      { cwd, env: fetchEnv, maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
    );
  const shallow =
    (await git('rev-parse', '--is-shallow-repository')) === 'true';
  await fetch(...(shallow ? ['--depth=1'] : []));
  for (let deepen = 32; ; deepen *= 2) {
    try {
      await git('merge-base', prepared.base, prepared.head);
      return;
    } catch {
      if (
        deepen > 65536 ||
        (await git('rev-parse', '--is-shallow-repository')) !== 'true'
      )
        throw new Error(
          'Unable to obtain a common ancestor for pinned review revisions',
        );
      await fetch(`--deepen=${deepen}`);
    }
  }
}

export async function runStandaloneFromHost(
  argv: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  signal?: AbortSignal,
): Promise<StandaloneReviewResult> {
  const command = standaloneCommand(argv, env);
  const token = reviewGithubToken(
    command.input.repo,
    env,
    command.input.publication,
  );
  const deps = createReviewHostDeps(env, cwd, token);
  const services = reuseHostPreparation({
    cwd,
    github: deps.github,
    connect: deps.connect,
    ensureGit: async (prepared: PinnedPullRequest) =>
      ensureReviewGit(prepared, cwd, { ...env, GH_TOKEN: await token() }),
    async publish(
      report: Parameters<typeof publishAdaptiveReport>[0],
      input: StandaloneReviewInput,
    ) {
      if (command.reportPath)
        writeFileSync(
          command.reportPath,
          JSON.stringify(report, null, 2) + '\n',
          { mode: 0o600 },
        );
      const accessToken = await token();
      const api = new GitHubApi({
        token: accessToken,
        apiUrl: env.GITHUB_API_URL,
      });
      await publishAdaptiveReport(report, {
        request: (url, method = 'GET', body) =>
          api.request(url, {
            method,
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
        graphql: createGraphQL(accessToken, env.GITHUB_GRAPHQL_URL),
        runUrl: input.runUrl,
        appLogin: input.appLogin,
        expected: report,
        inlineFindings: input.inlineFindings,
        recoverStale: true,
      });
    },
  });
  const run = (
    hostSignal?: AbortSignal,
    ensureCapacity?: (capacity?: readonly ReviewCapacity[]) => Promise<void>,
  ) =>
    runStandaloneReview({
      databaseUrl: required('ADAPTIVE_DATABASE_URL', env),
      input: command.input,
      services: { ...services, ensureCapacity },
      retryFailed: env.ADAPTIVE_RETRY_FAILED === 'true',
      retention: reviewRetentionPolicy(env),
      signal: hostSignal,
    });
  const hostSignal = AbortSignal.any([
    AbortSignal.timeout(command.timeoutSec * 1000),
    ...(signal ? [signal] : []),
  ]);
  process.stderr.write(
    `Adaptive review execution ${command.input.correlationId} (${command.workers} workers)\n`,
  );
  const result =
    command.workers === 'local'
      ? await withReviewWorkers({
          input: command.input,
          cwd,
          env,
          binary: env.MOLTNET_DAEMON_BIN ?? 'moltnet-agent',
          agent: required('MOLTNET_AGENT_NAME', env),
          focusedRuntime: env.ADAPTIVE_FOCUSED_RUNTIME,
          signal: hostSignal,
          run,
        })
      : await run(hostSignal);
  if (command.reportPath && result.status === 'completed')
    writeFileSync(
      command.reportPath,
      JSON.stringify(result.report, null, 2) + '\n',
      { mode: 0o600 },
    );
  return result;
}
