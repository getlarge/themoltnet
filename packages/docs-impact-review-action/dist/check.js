import { n as actionEnv, t as runMain } from "./assets/run-BAJLqHWw.js";
import { n as PreparedReviewError, r as runCheckPreparedCli, t as workflowCommandValue } from "./assets/workflow-command-DAfRW_6B.js";
//#region src/check.ts
runMain(() => {
	try {
		runCheckPreparedCli(actionEnv());
	} catch (error) {
		if (!(error instanceof PreparedReviewError)) throw error;
		process.stderr.write(`::error::${workflowCommandValue(error.message)}\n`);
		return Promise.resolve(1);
	}
	return Promise.resolve(0);
});
//#endregion
export {};
