import { runCommentCli } from '@moltnet/docs-impact-review/comment';
import { runMain } from '@moltnet/docs-impact-review/run';

runMain(async () => {
  await runCommentCli(process.argv.slice(2));
  return 0;
});
