import { publishAdaptiveReportFromEnv } from '@moltnet/adaptive-review/publish';

publishAdaptiveReportFromEnv().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
