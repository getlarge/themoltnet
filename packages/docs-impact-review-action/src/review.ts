import { runReviewCli } from '@moltnet/docs-impact-review/review-cli';

import { runMain } from './run.js';

runMain(() => runReviewCli(process.argv.slice(2)));
