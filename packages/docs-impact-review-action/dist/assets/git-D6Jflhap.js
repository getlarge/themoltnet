import { r as gitEnv } from "./run-BAJLqHWw.js";
import { execFileSync } from "node:child_process";
//#region ../../libs/docs-impact-review/src/git.ts
var FULL_OID = /^[0-9a-f]{40}$/;
function requireFullOid(value, label) {
	if (!FULL_OID.test(value)) throw new Error(`${label} must be a full 40-character lowercase git OID`);
	return value;
}
/** Long enough for a cold fetch of a large pull request. */
var GIT_TIMEOUT_MS = 3e5;
var MAX_OUTPUT_BYTES = 67108864;
/**
* A `git` command that exited with a status. Timeouts, signals and output
* limits are thrown as plain errors instead, so callers can tell "git said
* no" from "git never answered".
*/
var GitCommandError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "GitCommandError";
	}
};
/** Names the command, and the limit when git was stopped rather than failed. */
function describeGitFailure(args, error, timeoutMs) {
	const command = `git ${args[0] ?? ""}`.trim();
	const failure = error;
	if (failure.code === "ETIMEDOUT") return /* @__PURE__ */ new Error(`${command} timed out after ${timeoutMs} ms`);
	if (failure.code === "ENOBUFS") return /* @__PURE__ */ new Error(`${command} wrote more than ${MAX_OUTPUT_BYTES} bytes of output`);
	if (typeof failure.status === "number" && !failure.signal) {
		const stderr = String(failure.stderr ?? "").trim();
		return new GitCommandError(`${command} exited with ${failure.status}${stderr ? `: ${stderr}` : ""}`, failure.status);
	}
	return /* @__PURE__ */ new Error(`${command} failed${failure.signal ? ` (${failure.signal})` : ""}: ${failure.message}`);
}
/**
* Git never prompts (a missing credential fails instead of hanging), and a
* command that stalls is killed after `timeoutMs`.
*/
function createGit(cwd, timeoutMs = GIT_TIMEOUT_MS) {
	return (args, input) => {
		try {
			return execFileSync("git", args, {
				cwd,
				encoding: "utf8",
				input,
				maxBuffer: MAX_OUTPUT_BYTES,
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				],
				timeout: timeoutMs,
				env: gitEnv()
			});
		} catch (error) {
			throw describeGitFailure(args, error, timeoutMs);
		}
	};
}
/**
* Whether `path` exists at `revision`. Only git's own "no such object"
* answer means absent: a timeout or a killed process is rethrown, so it
* fails the review instead of reporting a page as missing.
*/
function existsAt(git, revision, path) {
	try {
		git([
			"cat-file",
			"-e",
			`${revision}:${path}`
		]);
		return true;
	} catch (error) {
		if (error instanceof GitCommandError) return false;
		throw error;
	}
}
/**
* Fetches only the revisions missing locally. A caller that already fetched
* them (with credentials it did not persist, as a private repository needs)
* must not have the reviewer contact the remote again.
*/
function ensureRevisions(git, revisions) {
	const missing = revisions.filter((revision) => {
		try {
			git([
				"cat-file",
				"-e",
				`${revision}^{commit}`
			]);
			return false;
		} catch (error) {
			if (error instanceof GitCommandError) return true;
			throw error;
		}
	});
	if (missing.length > 0) git([
		"fetch",
		"--no-tags",
		"--quiet",
		"origin",
		...missing
	]);
}
//#endregion
export { requireFullOid as i, ensureRevisions as n, existsAt as r, createGit as t };
