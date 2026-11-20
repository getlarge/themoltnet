/** CLI entry point: importing this module intentionally runs the command. */
import { env } from './config.js';
import { runReviewCommand } from './run-cli.js';

const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  process.exitCode = await runReviewCommand({
    argv: process.argv.slice(2),
    source: env(),
    cwd: process.cwd(),
    signal: controller.signal,
  });
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
