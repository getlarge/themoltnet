import { t as runMain } from "./assets/run-ClXssV5J.js";
import { readFileSync } from "node:fs";
//#region ../../libs/docs-impact-review/src/eligibility.ts
/**
* Trust gate for the docs-impact CI workflow: decides whether a pull request
* may run the credentialed review jobs. Kept dependency-free and limited to
* erasable TypeScript so the `prepare` job can run it with plain `node`
* (native type stripping) before any install.
*/
function checkEligibility(pr) {
	if (pr.headRepo !== pr.baseRepo) return {
		eligible: false,
		reason: "fork pull requests are not reviewed"
	};
	if (pr.author === "dependabot[bot]") return {
		eligible: false,
		reason: "Dependabot pull requests are not reviewed"
	};
	const protectedPaths = (pr.protectedPaths ?? []).filter((prefix) => prefix.length > 0);
	const runtimeChanges = /* @__PURE__ */ new Set();
	for (const file of pr.files) for (const path of [file.filename, file.previous_filename]) if (path && protectedPaths.some((prefix) => path.startsWith(prefix))) runtimeChanges.add(path);
	if (runtimeChanges.size > 0) return {
		eligible: false,
		reason: `the PR changes the trusted review runtime (${[...runtimeChanges].sort().join(", ")})`
	};
	return { eligible: true };
}
/** `eligibility <facts.json>` prints `skip=` and `reason=` lines. */
function runEligibilityCli(args) {
	const path = args[0];
	if (!path) throw new Error("usage: eligibility.ts <facts.json>");
	const result = checkEligibility(JSON.parse(readFileSync(path, "utf8")));
	const reason = result.eligible ? "" : result.reason;
	process.stdout.write(`skip=${String(!result.eligible)}\nreason=${reason.replace(/\n/g, " ")}\n`);
}
//#endregion
//#region src/eligibility.ts
runMain(() => {
	runEligibilityCli(process.argv.slice(2));
	return Promise.resolve(0);
});
//#endregion
export {};
