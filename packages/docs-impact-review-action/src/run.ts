/** Runs a CLI entry point and maps its result or failure to the exit code. */
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
