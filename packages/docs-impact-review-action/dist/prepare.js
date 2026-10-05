import { n as actionEnv, t as runMain } from "./assets/run-BAJLqHWw.js";
import { n as codeSpan } from "./assets/report-DJdZyA5m.js";
import { t as GitHubApi } from "./assets/github-api-Ch9U5VTr.js";
import { t as workflowCommandValue } from "./assets/workflow-command-UvtADBsB.js";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
//#region ../../libs/docs-impact-review/src/eligibility.ts
/**
* GitHub lists changed files relative to the repository root, so a prefix
* written as `./.github/` or `/.github/` means `.github/`.
*/
function normalizePrefix(prefix) {
	return prefix.trim().replace(/^(?:\.?\/)+/, "");
}
function checkEligibility(pr) {
	if (pr.headRepo !== pr.baseRepo) return {
		eligible: false,
		reason: "fork pull requests are not reviewed"
	};
	if (pr.author === "dependabot[bot]") return {
		eligible: false,
		reason: "Dependabot pull requests are not reviewed"
	};
	const protectedPaths = (pr.protectedPaths ?? []).map(normalizePrefix).filter((prefix) => prefix.length > 0);
	const runtimeChanges = /* @__PURE__ */ new Set();
	for (const file of pr.files) for (const path of [file.filename, file.previous_filename]) if (path && protectedPaths.some((prefix) => path.startsWith(prefix))) runtimeChanges.add(path);
	if (runtimeChanges.size > 0) return {
		eligible: false,
		reason: `the PR changes the trusted review runtime (${[...runtimeChanges].sort().join(", ")})`
	};
	return { eligible: true };
}
//#endregion
//#region ../../libs/docs-impact-review/src/prepare.ts
/**
* A UUID derived from `seed` (SHA-256, with the version and variant bits of a
* name-based UUID), so every job of one workflow run computes the same id
* without passing it around, and a re-run attempt gets a new one.
*/
function correlationIdFor(seed) {
	const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
	bytes[6] = bytes[6] & 15 | 80;
	bytes[8] = bytes[8] & 63 | 128;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Collects the pull request facts, pins revisions, and applies the gate. */
async function preparePullRequestReview(options) {
	const { api, repo, pullNumber } = options;
	const pr = await api.request(`/repos/${repo}/pulls/${pullNumber}`);
	const files = await api.paginate(`/repos/${repo}/pulls/${pullNumber}/files`);
	const facts = {
		headRepo: pr.head.repo?.full_name ?? null,
		baseRepo: repo,
		author: pr.user.login,
		files: files.map((file) => ({
			filename: file.filename,
			...file.previous_filename ? { previous_filename: file.previous_filename } : {}
		})),
		protectedPaths: options.protectedPaths
	};
	const eligibility = files.length < pr.changed_files ? {
		eligible: false,
		reason: `GitHub listed ${files.length} of ${pr.changed_files} changed files, so the protected paths cannot be checked`
	} : checkEligibility(facts);
	const coverage = options.coverageProfile || options.profile;
	const docsCheck = options.docsCheckProfile || options.profile;
	const runAttempt = Number(options.runAttempt);
	return {
		skip: !eligibility.eligible,
		reason: eligibility.eligible ? "" : eligibility.reason,
		prepared: {
			v: 1,
			eligible: eligibility.eligible,
			pr: pr.number,
			baseSha: pr.base.sha,
			headSha: pr.head.sha,
			correlationId: correlationIdFor([
				repo,
				pr.number,
				pr.head.sha,
				options.runId,
				runAttempt
			].join(":")),
			runAttempt,
			profiles: {
				default: options.profile,
				coverage,
				docsCheck
			},
			workerProfiles: [...new Set([
				options.profile,
				coverage,
				docsCheck
			])]
		}
	};
}
/** The pull request a `pull_request` or `issue_comment` event is about. */
function pullNumberFromEvent(eventName, event) {
	const payload = event;
	const number = eventName === "issue_comment" ? payload.issue?.pull_request ? payload.issue.number : void 0 : payload.pull_request?.number;
	if (!number) throw new Error(`run on pull_request or on a pull request's issue_comment (got ${eventName})`);
	return number;
}
function required(env, name) {
	const value = env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}
/** `prepare` step: writes the step outputs and explains a skip. */
async function runPrepareCli(env, fetchImpl) {
	const protectedPaths = (env.PROTECTED_PATHS ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
	if (protectedPaths.length === 0) process.stdout.write("::warning::no protected-paths: a pull request that changes the review workflow is reviewed by the workflow it changes\n");
	const eventName = required(env, "GITHUB_EVENT_NAME");
	const event = JSON.parse(readFileSync(required(env, "GITHUB_EVENT_PATH"), "utf8"));
	const result = await preparePullRequestReview({
		api: new GitHubApi({
			token: required(env, "GITHUB_TOKEN"),
			apiUrl: env.GITHUB_API_URL,
			fetchImpl
		}),
		repo: required(env, "GITHUB_REPOSITORY"),
		pullNumber: pullNumberFromEvent(eventName, event),
		runId: required(env, "GITHUB_RUN_ID"),
		runAttempt: required(env, "GITHUB_RUN_ATTEMPT"),
		profile: required(env, "PROFILE"),
		coverageProfile: env.COVERAGE_PROFILE,
		docsCheckProfile: env.DOCS_CHECK_PROFILE,
		protectedPaths
	});
	appendFileSync(required(env, "GITHUB_OUTPUT"), [
		`skip=${result.skip}`,
		`reason=${result.reason.replace(/[\r\n]+/g, " ")}`,
		`correlation-id=${result.prepared.correlationId}`,
		`prepared=${JSON.stringify(result.prepared)}`
	].map((line) => `${line}\n`).join(""));
	if (result.skip) {
		process.stdout.write(`::notice::Docs impact review skipped: ${workflowCommandValue(result.reason)}\n`);
		if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Docs impact review skipped\n\n${codeSpan(result.reason)}\n`);
	}
}
//#endregion
//#region src/prepare.ts
runMain(async () => {
	await runPrepareCli(actionEnv());
	return 0;
});
//#endregion
export {};
