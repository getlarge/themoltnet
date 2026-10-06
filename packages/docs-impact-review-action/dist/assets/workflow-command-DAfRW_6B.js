import { _ as _Object_, b as _Array_, d as Integer, f as Boolean$1, n as Errors, r as Check, s as String$1, u as Literal } from "./value-CDS208oC.js";
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
/** One line with something on it: values end up in `name=value` outputs. */
var NonEmpty = String$1({ pattern: "^[^\\r\\n]*\\S[^\\r\\n]*$" });
/**
* Everything `review` and the workers need from `prepare`, passed between
* jobs as one JSON output so callers forward a single value. The one schema
* both writes and checks it.
*/
var PreparedReviewSchema = _Object_({
	v: Literal(1),
	/** `review` refuses a pull request the gate turned away. */
	eligible: Boolean$1(),
	pr: Integer({ minimum: 1 }),
	baseSha: String$1({ pattern: "^[0-9a-f]{40}$" }),
	headSha: String$1({ pattern: "^[0-9a-f]{40}$" }),
	correlationId: String$1({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
	/** `GITHUB_RUN_ATTEMPT` of `prepare`; a later attempt must re-run it. */
	runAttempt: Integer({ minimum: 1 }),
	profiles: _Object_({
		default: NonEmpty,
		coverage: NonEmpty,
		docsCheck: NonEmpty
	}, { additionalProperties: false }),
	/** Distinct profiles: one drain worker each. */
	workerProfiles: _Array_(NonEmpty, {
		minItems: 1,
		uniqueItems: true
	})
}, { additionalProperties: false });
/** A `prepared` value `review` cannot use; the message says what to fix. */
var PreparedReviewError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PreparedReviewError";
	}
};
/**
* Parses and checks the `prepared` output: the version, the schema, and that
* every stage profile has a worker.
*/
function parsePreparedReview(raw) {
	if (!raw.trim()) throw new PreparedReviewError("step: review needs the prepare payload: set prepared to the prepare step's prepared output");
	let value;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new PreparedReviewError("prepared is not JSON");
	}
	const version = value?.v;
	if (version !== 1) throw new PreparedReviewError(`prepared payload version '${String(version)}' is not supported (expected 1): run prepare and review with the same action version`);
	if (!Check(PreparedReviewSchema, value)) {
		const problems = [...Errors(PreparedReviewSchema, value)].slice(0, 5).map((error) => error.instancePath || "(root)");
		throw new PreparedReviewError(`prepared review has missing or invalid: ${[...new Set(problems)].join(" ")}`);
	}
	const unserved = Object.values(value.profiles).filter((profile) => !value.workerProfiles.includes(profile));
	if (unserved.length > 0) throw new PreparedReviewError(`prepared review has no worker for profiles: ${unserved.join(", ")}`);
	return value;
}
function isGitWorkTree() {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
/**
* `step: review`, first command: checks `prepared` and the inputs, then
* writes the step outputs the later steps use.
*/
function runCheckPreparedCli(env, isWorkTree = isGitWorkTree) {
	const prepared = parsePreparedReview(env.PREPARED ?? "");
	if (!prepared.eligible) throw new PreparedReviewError("the prepared review is not eligible; gate the review job on the prepare skip output being 'false'");
	const attempt = env.GITHUB_RUN_ATTEMPT;
	if (attempt && String(prepared.runAttempt) !== attempt) throw new PreparedReviewError(`this is run attempt ${attempt}, but prepare ran in attempt ${prepared.runAttempt}, so no workers run for this review: re-run all jobs, not only failed ones`);
	const missing = ["TEAM_ID", "DIARY_ID"].filter((name) => !env[name]?.trim());
	if (missing.length > 0) throw new PreparedReviewError(`step: review is missing inputs: ${missing.join(" ")}`);
	if (Boolean(env.APP_ID?.trim()) !== Boolean(env.APP_KEY?.trim())) throw new PreparedReviewError("set app-id and app-private-key together");
	if (!isWorkTree()) throw new PreparedReviewError("check out the repository at the base revision before step: review");
	const output = env.GITHUB_OUTPUT;
	if (!output) throw new PreparedReviewError("GITHUB_OUTPUT is required");
	appendFileSync(output, [
		`pr-number=${prepared.pr}`,
		`base-sha=${prepared.baseSha}`,
		`head-sha=${prepared.headSha}`,
		`correlation-id=${prepared.correlationId}`,
		`profile=${prepared.profiles.default}`,
		`coverage-profile=${prepared.profiles.coverage}`,
		`docs-check-profile=${prepared.profiles.docsCheck}`
	].map((line) => `${line}\n`).join(""));
}
//#endregion
//#region ../../libs/docs-impact-review/src/workflow-command.ts
/**
* A value safe inside a GitHub Actions workflow command (`::error::…`): the
* runner decodes `%25`, `%0D` and `%0A`, so a newline in untrusted text
* cannot end the command and start another.
*/
function workflowCommandValue(text) {
	return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
//#endregion
export { PreparedReviewError as n, runCheckPreparedCli as r, workflowCommandValue as t };
