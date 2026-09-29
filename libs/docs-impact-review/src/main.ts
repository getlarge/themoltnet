import { runReviewCli } from './review-cli.js';

runReviewCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `[fatal] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
