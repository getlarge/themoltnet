/**
 * Runs a command-line entry point: its result becomes the exit code, and an
 * error is printed as `[fatal] <message>` with exit code 1.
 */
export function runMain(cli: () => Promise<number>): void {
  cli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `[fatal] ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
