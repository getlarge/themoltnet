import { appendFileSync } from 'node:fs';

import { required } from './config.js';
import { hostTimeoutSeconds } from './host-settings.js';
import { actionReviewCorrelation } from './identity.js';
import { hasIncompleteCoverage } from './report.js';
import { cleanupReviewExecutions, reviewRetentionPolicy } from './retention.js';
import { runStandaloneFromHost } from './standalone-host.js';

export const REVIEW_HELP = `Run the complete durable adaptive review with review-scoped workers.
Usage: node run.js --repo owner/repository --pr NUMBER --execution-id UUID [options]
  --cleanup                 Preview expired executions; ADAPTIVE_CLEANUP_APPLY=true applies
  --workers local|external   Manage local workers (default) or use existing workers
  --publish                  Reconcile findings on GitHub
  --report PATH              Export JSON report
  --timeout-sec SECONDS      Host lifetime, up to 86400 (default 7200)
Requires initialized ADAPTIVE_DATABASE_URL, MoltNet credentials/team/diary,
ADAPTIVE_RUNTIME_SHA, ADAPTIVE_APP_LOGIN, runtime profiles and GitHub access.
Local workers require moltnet-agent, MOLTNET_AGENT_NAME and configured providers.
Reuse the execution ID, database, runtime and original options to resume.
After exhausted workflow attempts, retry explicitly with ADAPTIVE_RETRY_FAILED=true.
This preserves checkpoints; it does not replace terminally failed child tasks.
`;

export function formatReviewError(
  error: unknown,
  source: NodeJS.ProcessEnv,
): string {
  const seen = new Set<unknown>();
  const describe = (value: unknown, depth: number): string => {
    if (depth > 4 || seen.has(value)) return '';
    seen.add(value);
    if (value instanceof Error)
      return [value.message, describe(value.cause, depth + 1)]
        .filter(Boolean)
        .join(': ');
    if (value === undefined) return '';
    try {
      return typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      return 'Unserializable failure';
    }
  };
  let message = describe(error, 0) || 'Adaptive review failed';
  for (const [key, value] of Object.entries(source))
    if (
      value &&
      value.length >= 6 &&
      /TOKEN|KEY|SECRET|PASSWORD|DATABASE_URL/.test(key)
    )
      message = message.replaceAll(value, '[redacted]');
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[redacted database URL]')
    .slice(0, 2500);
}

/** CLI behavior without import-time execution, for direct failure/output tests. */
export async function runReviewCommand(args: {
  argv: string[];
  source: NodeJS.ProcessEnv;
  cwd: string;
  signal?: AbortSignal;
  run?: typeof runStandaloneFromHost;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}): Promise<number> {
  const { argv, source } = args;
  const out =
    args.stdout ??
    ((text: string) => {
      process.stdout.write(text);
    });
  const err =
    args.stderr ??
    ((text: string) => {
      process.stderr.write(text);
    });
  const output = (skip: boolean) => {
    if (source.GITHUB_OUTPUT)
      appendFileSync(
        source.GITHUB_OUTPUT,
        `skip=${skip}\nresult=${JSON.stringify({ skip })}\n`,
      );
  };
  if (argv.includes('--help') || argv.includes('-h')) {
    out(REVIEW_HELP);
    return 0;
  }
  try {
    if (argv.includes('--cleanup')) {
      if (
        source.ADAPTIVE_CLEANUP_APPLY !== undefined &&
        !['true', 'false'].includes(source.ADAPTIVE_CLEANUP_APPLY)
      )
        throw new Error('ADAPTIVE_CLEANUP_APPLY must be true or false');
      const result = await cleanupReviewExecutions({
        databaseUrl: required('ADAPTIVE_DATABASE_URL', source),
        policy: reviewRetentionPolicy(source),
        apply: source.ADAPTIVE_CLEANUP_APPLY === 'true',
      });
      out(`${JSON.stringify(result)}\n`);
      return 0;
    }
    output(true);
    if (argv.includes('--resolve-intent')) {
      const correlation = actionReviewCorrelation(source);
      const remaining = hostTimeoutSeconds(source);
      if (!source.GITHUB_ENV) throw new Error('GITHUB_ENV required');
      appendFileSync(
        source.GITHUB_ENV,
        `ADAPTIVE_EXECUTION_ID=${correlation}\nADAPTIVE_TIMEOUT_SEC=${remaining}\n`,
      );
      if (source.GITHUB_OUTPUT)
        appendFileSync(source.GITHUB_OUTPUT, `correlation=${correlation}\n`);
      return 0;
    }
    const result = await (args.run ?? runStandaloneFromHost)(
      argv,
      source,
      args.cwd,
      args.signal,
    );
    output(result.status === 'skipped');
    if (result.status === 'skipped') {
      out(`Adaptive review skipped: ${result.reason}\n`);
      return 0;
    }
    out(
      `Adaptive review ${result.report.correlationId}: ${result.report.results.map((lane) => `${lane.lane}=${lane.status}`).join(', ')}\n`,
    );
    if (hasIncompleteCoverage(result.report))
      err('Adaptive review has incomplete coverage; inspect the report.\n');
    return result.report.results.some((lane) => lane.status === 'failed')
      ? 1
      : 0;
  } catch (error) {
    err(formatReviewError(error, source) + '\n');
    return 1;
  }
}
