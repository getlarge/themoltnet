//#region src/run.ts
/** Runs a CLI entry point and maps its result or failure to the exit code. */
function runMain(cli) {
	cli().then((code) => {
		process.exitCode = code;
	}).catch((error) => {
		process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
//#endregion
export { runMain as t };
