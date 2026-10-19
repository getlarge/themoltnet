//#region ../../libs/docs-impact-review/src/config.ts
/**
* Environment access for this app (the only module allowed to read
* `process.env`). Tokens come from the environment, never argv, so they stay
* out of shell history and process listings.
*/
function githubToken() {
	return (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim() || void 0;
}
/**
* The environment for `git` child processes: inherited, but never prompting
* for credentials, so a missing one fails instead of hanging the review.
*/
function gitEnv() {
	return {
		...process.env,
		GIT_TERMINAL_PROMPT: "0"
	};
}
/** `GITHUB_API_URL`, set on GitHub Enterprise Server; empty means github.com. */
function githubApiUrl() {
	return process.env.GITHUB_API_URL?.trim() || void 0;
}
function actionEnv() {
	return process.env;
}
//#endregion
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
export { githubToken as a, githubApiUrl as i, actionEnv as n, gitEnv as r, runMain as t };
