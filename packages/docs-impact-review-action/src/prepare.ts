import { actionEnv } from '@moltnet/docs-impact-review/config';
import { runPrepareCli } from '@moltnet/docs-impact-review/prepare';
import { runMain } from '@moltnet/docs-impact-review/run';

runMain(async () => {
  await runPrepareCli(actionEnv());
  return 0;
});
