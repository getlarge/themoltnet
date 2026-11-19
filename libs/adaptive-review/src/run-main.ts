import { appendFileSync } from 'node:fs';

import { env } from './config.js';
import { hasIncompleteCoverage } from './report.js';
import { runStandaloneFromHost } from './standalone-host.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout
      .write(`Run the complete durable adaptive review with review-scoped workers.

Usage: node run.js --repo owner/repository --pr NUMBER --execution-id UUID [options]

  --workers local|external   Start scoped workers locally (default) or use existing workers
  --publish                  Reconcile the report and inline findings on GitHub
  --report PATH              Export the report as JSON
  --timeout-sec SECONDS      Host lifetime, up to 86400 (default 7200)

Run from a checkout of the reviewed repository using a trusted runtime bundle.
Requires initialized ADAPTIVE_DATABASE_URL, MoltNet credentials/team/diary,
ADAPTIVE_RUNTIME_SHA, ADAPTIVE_APP_LOGIN, runtime profiles and GitHub App access.
Local workers require moltnet-agent, MOLTNET_AGENT_NAME and configured providers.
Reuse the execution ID, database and original options to resume after interruption.
`);
    return;
  }
  const source = env();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const result = await runStandaloneFromHost(
      argv,
      source,
      process.cwd(),
      controller.signal,
    );
    if (source.GITHUB_OUTPUT)
      appendFileSync(
        source.GITHUB_OUTPUT,
        `skip=${result.status === 'skipped'}\n`,
      );
    if (result.status === 'skipped')
      process.stdout.write(`Adaptive review skipped: ${result.reason}\n`);
    else {
      process.stdout.write(
        `Adaptive review ${result.report.correlationId}: ${result.report.results.map((lane) => `${lane.lane}=${lane.status}`).join(', ')}\n`,
      );
      if (hasIncompleteCoverage(result.report))
        process.stderr.write(
          'Adaptive review has incomplete coverage; inspect the report.\n',
        );
      process.exitCode = result.report.results.some(
        (lane) => lane.status === 'failed',
      )
        ? 1
        : 0;
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Adaptive review failed'}\n`,
  );
  process.exitCode = 1;
});
