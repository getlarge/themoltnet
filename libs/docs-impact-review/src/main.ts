import { runReviewCli } from './review-cli.js';
import { runMain } from './run.js';

runMain(() => runReviewCli(process.argv.slice(2)));
