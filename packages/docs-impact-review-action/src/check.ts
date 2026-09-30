import { actionEnv } from '@moltnet/docs-impact-review/config';
import {
  PreparedReviewError,
  runCheckPreparedCli,
} from '@moltnet/docs-impact-review/prepared';
import { runMain } from '@moltnet/docs-impact-review/run';
import { workflowCommandValue } from '@moltnet/docs-impact-review/workflow-command';

// A problem with the caller's wiring is an annotation, not a crash.
runMain(() => {
  try {
    runCheckPreparedCli(actionEnv());
  } catch (error) {
    if (!(error instanceof PreparedReviewError)) throw error;
    process.stderr.write(`::error::${workflowCommandValue(error.message)}\n`);
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
});
