import { runReviewCli } from '@moltnet/docs-impact-review/review-cli';
import { runMain } from '@moltnet/docs-impact-review/run';

runMain(() => runReviewCli(process.argv.slice(2)));
