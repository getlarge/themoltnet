import { execFileSync } from "node:child_process";
//#region ../../libs/docs-impact-review/src/git.ts
var FULL_OID = /^[0-9a-f]{40}$/;
function requireFullOid(value, label) {
	if (!FULL_OID.test(value)) throw new Error(`${label} must be a full 40-character lowercase git OID`);
	return value;
}
function createGit(cwd) {
	return (args, input) => execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		input,
		maxBuffer: 64 * 1024 * 1024,
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		]
	});
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
		} catch {
			return true;
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
//#region ../../libs/docs-impact-review/src/report.ts
var DOCS_IMPACT_COMMENT_MARKER = "<!-- moltnet:docs-impact-review -->";
function shorten(text, max = 280) {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
/** A Markdown heading as plain text: `## Flags` → `Flags`. */
function headingText(section) {
	return section.replace(/^#{1,6}\s+/, "").trim();
}
/** `48s`, `2m 48s`; sub-second durations round up to `1s`. */
function formatDuration(ms) {
	const seconds = Math.max(1, Math.round(ms / 1e3));
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
function fileLink(report, path) {
	return `[\`${path}\`](https://github.com/${report.repo}/blob/${report.headRevision}/${path})`;
}
/**
* One concise PR comment body. Clean results stay on one line; a failed run
* says so explicitly instead of looking like an empty clean result.
*/
function renderComment(report) {
	const head = `head [\`${report.headRevision.slice(0, 7)}\`](https://github.com/${report.repo}/commit/${report.headRevision})`;
	if (report.status === "failed" || !report.outcome) return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: not reviewed** · ${head}`,
		"",
		`The review did not complete: ${report.error ?? "unknown error"}. No judgment was made.`
	].join("\n");
	const count = report.findings.length;
	const lines = [DOCS_IMPACT_COMMENT_MARKER, [
		`**Docs impact: ${report.outcome}**`,
		head,
		...count > 0 ? [`${count} finding${count === 1 ? "" : "s"}`] : [],
		`reviewed in ${formatDuration(report.timings.totalMs)}`
	].join(" · ")];
	const missing = new Set(report.selectedDocs.filter((doc) => doc.missing).map((doc) => doc.path));
	if (count > 0) {
		lines.push("");
		for (const finding of report.findings.slice(0, 3)) {
			const doc = missing.has(finding.docsPath) ? `\`${finding.docsPath}\`` : fileLink(report, finding.docsPath);
			const section = finding.section ? ` › ${headingText(finding.section)}` : "";
			const label = finding.issue ? `**${finding.issue}** ` : "";
			lines.push(`- ${label}${doc}${section} — ${shorten(finding.update)}`, `  - Evidence: ${fileLink(report, finding.evidence.path)} — ${shorten(finding.evidence.detail)}`);
		}
	}
	const hidden = count - 3;
	if (hidden > 0) lines.push(`- …and ${hidden} more finding${hidden === 1 ? "" : "s"} in the workflow run report.`);
	if (report.gaps.length > 0) {
		lines.push("", "Not covered by this review:");
		for (const gap of report.gaps) lines.push(`- \`${gap.scope}\`: ${gap.reason}`);
	}
	return lines.join("\n");
}
/** Nearest-rank percentile; `null` for an empty sample. */
function percentile(values, p) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil(p / 100 * sorted.length);
	return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
var STAGE_PHASES = [
	"queue",
	"open",
	"setup",
	"firstModelEvent",
	"model",
	"execution",
	"observed"
];
function summarizeCorpus(reports) {
	const outcomes = {};
	const samples = {
		total: [],
		ingest: [],
		retrieval: []
	};
	const inputTokens = [];
	const outputTokens = [];
	for (const report of reports) {
		const key = report.status === "failed" ? "failed" : String(report.outcome);
		outcomes[key] = (outcomes[key] ?? 0) + 1;
		samples.total.push(report.timings.totalMs);
		samples.ingest.push(report.timings.ingestMs);
		samples.retrieval.push(report.timings.retrievalMs);
		for (const [stage, timing] of Object.entries(report.timings.stages)) {
			for (const phase of STAGE_PHASES) {
				const value = timing[`${phase}Ms`];
				if (value === null || value === void 0) continue;
				(samples[`${stage}.${phase}`] ??= []).push(value);
			}
			if (timing.inputTokens !== null) inputTokens.push(timing.inputTokens);
			if (timing.outputTokens !== null) outputTokens.push(timing.outputTokens);
		}
	}
	return {
		runs: reports.length,
		outcomes,
		latencyMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, {
			p50: percentile(values, 50),
			p95: percentile(values, 95)
		}])),
		tokens: {
			maxInput: inputTokens.length ? Math.max(...inputTokens) : null,
			maxOutput: outputTokens.length ? Math.max(...outputTokens) : null
		}
	};
}
//#endregion
export { ensureRevisions as a, createGit as i, renderComment as n, requireFullOid as o, summarizeCorpus as r, DOCS_IMPACT_COMMENT_MARKER as t };
