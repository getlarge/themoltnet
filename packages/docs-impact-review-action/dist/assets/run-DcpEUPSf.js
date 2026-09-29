//#region ../../libs/docs-impact-review/src/run.ts
/**
* Runs a command-line entry point: its result becomes the exit code, and an
* error is printed as `[fatal] <message>` with exit code 1.
*/
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
