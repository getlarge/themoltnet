/**
 * Logger setup + teardown for the agent-daemon CLI commands.
 *
 * Why this helper exists: pino with `pino-pretty` transport spawns a
 * Node Worker thread for human-readable output. The Worker holds the
 * parent's TTYWrap handles ref'd; without an explicit `.end()` the
 * daemon never exits after the task completes — symptom: `once`
 * prints `[done] TaskOutput: …` then hangs until Ctrl-C
 * (see issue #1107). This module owns both creation and shutdown
 * so every CLI command gets the same cleanup contract without
 * duplicating the dance.
 *
 * Non-TTY mode (CI, file redirect) skips the transport entirely:
 * pino writes raw NDJSON directly to stderr, no worker thread,
 * nothing extra to clean up.
 */
import { once } from 'node:events';

import { type Logger, type LoggerOptions, pino, transport } from 'pino';

export interface RootLoggerHandle {
  /** Root pino logger. Always `.child()` on this in caller. */
  logger: Logger;
  /**
   * Call in the CLI command's `finally` block AFTER all other
   * cleanup (otel shutdown, reporter drain). Flushes any
   * pino-buffered logs into the transport (TTY mode only) and ends
   * the worker thread so the daemon process can exit.
   *
   * Safe to call when no transport was created (non-TTY mode): the
   * function is then a no-op. Failures from `transport.end()` are
   * logged to stderr and swallowed — we never want logger cleanup
   * to mask the CLI's real exit code.
   */
  shutdown: () => Promise<void>;
}

export function createRootLogger(options: LoggerOptions): RootLoggerHandle {
  const prettyTransport = process.stderr.isTTY
    ? transport({
        target: 'pino-pretty',
        options: { colorize: true },
      })
    : null;
  let transportClosed = prettyTransport === null;
  let shutdownStarted = false;

  prettyTransport?.on('close', () => {
    transportClosed = true;
  });
  prettyTransport?.on('error', (err: unknown) => {
    transportClosed = true;
    process.stderr.write(
      `[pino] transport error: ` +
        (err instanceof Error ? err.message : String(err)) +
        '\n',
    );
  });

  const logger = pino(options, prettyTransport ?? undefined);

  const shutdown = async (): Promise<void> => {
    if (!prettyTransport || shutdownStarted || transportClosed) return;
    shutdownStarted = true;
    try {
      logger.flush();
    } catch (err) {
      process.stderr.write(
        `[pino] logger flush failed: ` +
          (err instanceof Error ? err.message : String(err)) +
          '\n',
      );
    }
    // ThreadStream.end() is sync but the worker thread continues to
    // drain in the background; the actual termination is signaled via
    // the 'close' event. Awaiting that lets the Worker (and the
    // TTYWraps it inherits from our process) release before main()
    // returns, so the daemon actually exits instead of hanging.
    try {
      prettyTransport.end();
      if (!transportClosed) {
        await once(prettyTransport, 'close');
      }
    } catch (err) {
      process.stderr.write(
        `[pino] transport teardown failed: ` +
          (err instanceof Error ? err.message : String(err)) +
          '\n',
      );
    }
  };

  return { logger, shutdown };
}
