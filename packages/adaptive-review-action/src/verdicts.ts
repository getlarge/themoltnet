import { recordReviewCommandFromEnv } from '@moltnet/adaptive-review/verdicts';

recordReviewCommandFromEnv().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
