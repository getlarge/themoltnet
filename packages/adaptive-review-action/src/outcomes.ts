import { recordReviewOutcomesFromEnv } from '@moltnet/adaptive-review/outcomes';

recordReviewOutcomesFromEnv().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
