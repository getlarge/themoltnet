import { runCommentCli } from '@moltnet/docs-impact-review/comment';

import { runMain } from './run.js';

runMain(async () => {
  await runCommentCli(process.argv.slice(2));
  return 0;
});
