import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { planGithubPreparation, type PreparationRequest } from '@moltnet/sdlc';
import type { GithubRequest } from '@moltnet/sdlc/github';
import { createGithubPreparationApp } from '@moltnet/sdlc/github-moltnet';

/** Keep the released CLI's command-scoped App identity; never use a human token fallback. */
export function githubRequest(repository: string): GithubRequest {
  return async (path, method, body) => {
    if (!path.startsWith(`/repos/${repository}/`))
      throw new Error('GitHub request escaped configured repository');
    const args = [
      'github',
      'exec',
      '--',
      'gh',
      'api',
      '--hostname',
      'github.com',
      '--method',
      method,
      path,
    ];
    if (body !== undefined) args.push('--input', '-');
    const stdout = await command(
      'moltnet',
      args,
      body === undefined ? undefined : JSON.stringify(body),
    );
    return stdout.trim() ? (JSON.parse(stdout) as unknown) : null;
  };
}
function command(
  file: string,
  args: string[],
  stdin?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(
            error instanceof Error ? error : new Error('GitHub command failed'),
          );
        else resolve(stdout);
      },
    );
    child.stdin?.on('error', () => {
      /* Exit callback reports failed commands. */
    });
    child.stdin?.end(stdin);
  });
}

export async function main(args: string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Usage: sdlc:prepare <plan|run> <policy.json> <request.json>\nRun requires ABSURD_DATABASE_URL and SDLC_PREPARATION_QUEUE; execute from the configured repository checkout.\n',
    );
    return;
  }
  const [mode, policyFile, requestFile] = args;
  if (args.length !== 3 || (mode !== 'plan' && mode !== 'run'))
    throw new Error(
      'Expected plan|run, policy file, and preparation request file',
    );
  const policy: unknown = JSON.parse(await readFile(policyFile, 'utf8'));
  const request = JSON.parse(
    await readFile(requestFile, 'utf8'),
  ) as PreparationRequest;
  const plan = planGithubPreparation(policy, request);
  if (mode === 'plan') {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const databaseUrl = process.env.ABSURD_DATABASE_URL;
  const queueName = process.env.SDLC_PREPARATION_QUEUE;
  if (!databaseUrl || !queueName || !/^[a-z][a-z0-9_]{0,62}$/.test(queueName))
    throw new Error('Explicit database and valid preparation queue required');
  // The released wrapper derives installation scope from this checkout.
  const remote = (await command('git', ['remote', 'get-url', 'origin'])).trim();
  const repository =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
      remote,
    )?.[1];
  if (repository?.toLowerCase() !== plan.policy.repository)
    throw new Error('Checkout origin differs from policy repository');
  const app = createGithubPreparationApp({
    databaseUrl,
    queueName,
    request: githubRequest(plan.policy.repository),
  });
  let worker: Awaited<ReturnType<typeof app.startWorker>> | undefined;
  try {
    await app.createQueue(queueName);
    const receipt = await app.spawn(plan.taskName, plan.params, {
      queue: queueName,
      idempotencyKey: plan.idempotencyKey,
    });
    process.stdout.write(
      `${JSON.stringify({ event: 'dispatched', ...receipt })}\n`,
    );
    worker = await app.startWorker({ concurrency: 1 });
    const result = await app.awaitTaskResult(receipt.taskID, {
      timeout: plan.policy.limits.stageTimeoutSec,
    });
    process.stdout.write(`${JSON.stringify({ event: 'result', ...result })}\n`);
    if (result.state !== 'completed')
      throw new Error('Preparation did not complete');
  } finally {
    await worker?.close();
    await app.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'SDLC preparation failed'}\n`,
    );
    process.exitCode = 1;
  });
}
