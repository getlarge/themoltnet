import { n as renderComment, o as requireFullOid, t as DOCS_IMPACT_COMMENT_MARKER } from "./assets/report-C7i4IlI6.js";
import { t as runMain } from "./assets/run-ClXssV5J.js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
//#region ../../libs/docs-impact-review/src/config.ts
/**
* Environment access for this app (the only module allowed to read
* `process.env`). Tokens come from the environment, never argv, so they stay
* out of shell history and process listings.
*/
function githubToken() {
	return (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim() || void 0;
}
//#endregion
//#region ../../libs/docs-impact-review/src/comment.ts
function runLine(revision, runUrl) {
	return `Head \`${revision}\` · [workflow run](${runUrl})`;
}
function renderProgress(revision, runUrl) {
	return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: reviewing** · ${runLine(revision, runUrl)}`,
		"",
		"Any result for an earlier head is stale until this review finishes."
	].join("\n");
}
function renderStale(reviewedRevision, currentRevision, runUrl) {
	return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: stale** · ${runLine(reviewedRevision, runUrl)}`,
		"",
		`The pull request now points at \`${currentRevision}\`. This result was not published as current guidance.`
	].join("\n");
}
function renderPublished(report, runUrl) {
	return `${renderComment(report)}\n\n[workflow run](${runUrl})`;
}
function renderMissingReport(revision, runUrl) {
	return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: not reviewed** · ${runLine(revision, runUrl)}`,
		"",
		"The review did not produce a report. No judgment was made."
	].join("\n");
}
/**
* Only a marker comment written by the posting identity is ours to update:
* a token cannot edit another account's comment, and a human quoting the
* marker must not be overwritten.
*/
function findDocsImpactComment(comments, author) {
	return comments.find((comment) => comment.user?.login === author && comment.body?.includes("<!-- moltnet:docs-impact-review -->"));
}
var GitHubApi = class {
	constructor(repo, token, author, fetchImpl = fetch) {
		this.repo = repo;
		this.token = token;
		this.author = author;
		this.fetchImpl = fetchImpl;
	}
	async request(path, init) {
		const response = await this.fetchImpl(`https://api.github.com${path}`, {
			...init,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${this.token}`,
				"content-type": "application/json",
				"x-github-api-version": "2022-11-28",
				...init?.headers
			}
		});
		if (!response.ok) {
			const detail = await response.json().then((body) => typeof body.message === "string" ? `: ${body.message}` : "").catch(() => "");
			throw new Error(`GitHub API ${init?.method ?? "GET"} ${path} failed with ${response.status}${detail}`);
		}
		return await response.json();
	}
	async headSha(prNumber) {
		return (await this.request(`/repos/${this.repo}/pulls/${prNumber}`)).head.sha;
	}
	async upsert(prNumber, body) {
		const comments = [];
		for (let page = 1;; page += 1) {
			const batch = await this.request(`/repos/${this.repo}/issues/${prNumber}/comments?per_page=100&page=${page}`);
			comments.push(...batch);
			if (batch.length < 100) break;
		}
		const existing = findDocsImpactComment(comments, this.author);
		if (existing) {
			await this.request(`/repos/${this.repo}/issues/comments/${existing.id}`, {
				method: "PATCH",
				body: JSON.stringify({ body })
			});
			return;
		}
		await this.request(`/repos/${this.repo}/issues/${prNumber}/comments`, {
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
	const github = new GitHubApi(args.repo, args.token, args.author, args.fetchImpl);
	const current = requireFullOid(await github.headSha(args.prNumber), "current revision");
	if (current !== args.reviewedRevision) {
		await github.upsert(args.prNumber, renderStale(args.reviewedRevision, current, args.runUrl));
		return "stale";
	}
	if (args.mode === "start") {
		await github.upsert(args.prNumber, renderProgress(args.reviewedRevision, args.runUrl));
		return "progress";
	}
	const report = readReport(args.reportPath);
	if (!report || report.headRevision !== args.reviewedRevision) {
		await github.upsert(args.prNumber, renderMissingReport(args.reviewedRevision, args.runUrl));
		return "missing";
	}
	await github.upsert(args.prNumber, renderPublished(report, args.runUrl));
	const after = await github.headSha(args.prNumber);
	if (after !== args.reviewedRevision) {
		await github.upsert(args.prNumber, renderStale(args.reviewedRevision, after, args.runUrl));
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
			author: { type: "string" }
		}
	});
	if (values.mode !== "start" && values.mode !== "publish" || !values.repo || !values.pr || !values.revision || !values["run-url"] || !values.author) throw new Error("Usage: comment --mode start|publish --repo owner/repo --pr N --revision SHA --run-url URL --author LOGIN [--report summary.json]");
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
		reportPath: values.report
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
