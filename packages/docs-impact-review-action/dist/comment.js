import { a as githubToken, i as githubApiUrl, t as runMain } from "./assets/run-BAJLqHWw.js";
import { r as renderComment, t as DOCS_IMPACT_COMMENT_MARKER } from "./assets/report-DJdZyA5m.js";
import { t as GitHubApi } from "./assets/github-api-Ch9U5VTr.js";
import { i as requireFullOid } from "./assets/git-D6Jflhap.js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
//#region ../../libs/docs-impact-review/src/comment.ts
/** The correlation id ties a comment to its MoltNet tasks and worker logs. */
function correlationSuffix(correlationId) {
	return correlationId ? ` · correlation \`${correlationId}\`` : "";
}
function runLine(revision, runUrl, correlationId) {
	return `Head \`${revision}\` · [workflow run](${runUrl})${correlationSuffix(correlationId)}`;
}
var PROGRESS_HEADLINE = "**Docs impact: reviewing**";
function renderProgress(revision, runUrl, correlationId) {
	return [
		DOCS_IMPACT_COMMENT_MARKER,
		`${PROGRESS_HEADLINE} · ${runLine(revision, runUrl, correlationId)}`,
		"",
		"Any result for an earlier head is stale until this review finishes."
	].join("\n");
}
function renderStale(reviewedRevision, currentRevision, runUrl, correlationId) {
	return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: stale** · ${runLine(reviewedRevision, runUrl, correlationId)}`,
		"",
		`The pull request now points at \`${currentRevision}\`. This result was not published as current guidance.`
	].join("\n");
}
function renderPublished(report, runUrl, correlationId) {
	return `${renderComment(report)}\n\n[workflow run](${runUrl})${correlationSuffix(correlationId)}`;
}
function renderMissingReport(revision, runUrl, correlationId) {
	return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: not reviewed** · ${runLine(revision, runUrl, correlationId)}`,
		"",
		"The review did not produce a report. No judgment was made."
	].join("\n");
}
function renderCancelled(revision, runUrl, correlationId) {
	return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: not completed** · ${runLine(revision, runUrl, correlationId)}`,
		"",
		"The run stopped before its result was published: it was cancelled, or the result could not be posted. No judgment was made."
	].join("\n");
}
/** Whether `body` is the in-progress placeholder of the run at `runUrl`. */
function isProgressOf(body, runUrl) {
	return !!body?.includes(PROGRESS_HEADLINE) && body.includes(`[workflow run](${runUrl})`);
}
/**
* Only a marker comment written by the posting identity is ours to update:
* a token cannot edit another account's comment, and a human quoting the
* marker must not be overwritten.
*/
function findDocsImpactComment(comments, author) {
	return comments.find((comment) => comment.user?.login === author && comment.body?.includes("<!-- moltnet:docs-impact-review -->"));
}
/** The comment's GitHub calls, retried on rate limits and 5xx errors. */
var CommentApi = class {
	repo;
	author;
	api;
	constructor(repo, token, author, options) {
		this.repo = repo;
		this.author = author;
		this.api = new GitHubApi({
			token,
			...options
		});
	}
	async headSha(prNumber) {
		return (await this.api.request(`/repos/${this.repo}/pulls/${prNumber}`)).head.sha;
	}
	async find(prNumber) {
		return findDocsImpactComment(await this.api.paginate(`/repos/${this.repo}/issues/${prNumber}/comments`), this.author);
	}
	async edit(id, body) {
		await this.api.request(`/repos/${this.repo}/issues/comments/${id}`, {
			method: "PATCH",
			body: JSON.stringify({ body })
		});
	}
	async upsert(prNumber, body) {
		const existing = await this.find(prNumber);
		if (existing) {
			await this.edit(existing.id, body);
			return;
		}
		await this.api.request(`/repos/${this.repo}/issues/${prNumber}/comments`, {
			method: "POST",
			body: JSON.stringify({ body })
		});
	}
};
function readReport(path) {
	if (!path) return void 0;
	try {
		return JSON.parse(readFileSync(path, "utf8")).reports?.[0];
	} catch {
		return;
	}
}
/**
* Upserts the single docs-impact comment. The PR head is checked first on
* every write, so a run for an older head can never overwrite feedback for
* a newer one.
*/
async function updateDocsImpactComment(args) {
	requireFullOid(args.reviewedRevision, "reviewed revision");
	const github = new CommentApi(args.repo, args.token, args.author, {
		apiUrl: args.apiUrl,
		fetchImpl: args.fetchImpl,
		retry: args.retry
	});
	if (args.mode === "cancelled") {
		const existing = await github.find(args.prNumber);
		if (!existing || !isProgressOf(existing.body, args.runUrl)) return "unchanged";
		await github.edit(existing.id, renderCancelled(args.reviewedRevision, args.runUrl, args.correlationId));
		return "cancelled";
	}
	const current = requireFullOid(await github.headSha(args.prNumber), "current revision");
	if (current !== args.reviewedRevision) {
		await github.upsert(args.prNumber, renderStale(args.reviewedRevision, current, args.runUrl, args.correlationId));
		return "stale";
	}
	if (args.mode === "start") {
		await github.upsert(args.prNumber, renderProgress(args.reviewedRevision, args.runUrl, args.correlationId));
		return "progress";
	}
	const report = readReport(args.reportPath);
	if (!report || report.headRevision !== args.reviewedRevision) {
		await github.upsert(args.prNumber, renderMissingReport(args.reviewedRevision, args.runUrl, args.correlationId));
		return "missing";
	}
	await github.upsert(args.prNumber, renderPublished(report, args.runUrl, args.correlationId));
	const after = await github.headSha(args.prNumber);
	if (after !== args.reviewedRevision) {
		await github.upsert(args.prNumber, renderStale(args.reviewedRevision, after, args.runUrl, args.correlationId));
		return "stale";
	}
	return "published";
}
/** The comment CLI used by CI to post and update the review comment. */
async function runCommentCli(args) {
	const { values } = parseArgs({
		args,
		options: {
			mode: { type: "string" },
			repo: { type: "string" },
			pr: { type: "string" },
			revision: { type: "string" },
			"run-url": { type: "string" },
			report: { type: "string" },
			author: { type: "string" },
			"correlation-id": { type: "string" }
		}
	});
	if (values.mode !== "start" && values.mode !== "publish" && values.mode !== "cancelled" || !values.repo || !values.pr || !values.revision || !values["run-url"] || !values.author) throw new Error("Usage: comment --mode start|publish|cancelled --repo owner/repo --pr N --revision SHA --run-url URL --author LOGIN [--report summary.json] [--correlation-id UUID]");
	const prNumber = Number(values.pr);
	if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("--pr must be a positive integer");
	const token = githubToken();
	if (!token) throw new Error("GITHUB_TOKEN is required");
	const status = await updateDocsImpactComment({
		mode: values.mode,
		repo: values.repo,
		prNumber,
		reviewedRevision: values.revision,
		runUrl: values["run-url"],
		token,
		author: values.author,
		reportPath: values.report,
		correlationId: values["correlation-id"],
		apiUrl: githubApiUrl()
	});
	process.stdout.write(`${JSON.stringify({ status })}\n`);
}
//#endregion
//#region src/comment.ts
runMain(async () => {
	await runCommentCli(process.argv.slice(2));
	return 0;
});
//#endregion
export {};
