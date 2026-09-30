//#region ../../libs/api-client/src/retry-fetch.ts
var DEFAULT_RETRY_STATUSES = [
	408,
	429,
	500,
	502,
	503,
	504
];
var DEFAULT_RETRY_METHODS = [
	"GET",
	"HEAD",
	"OPTIONS",
	"PUT"
];
function createRetryFetch(options) {
	const { maxRetries = 3, baseDelay = 500, maxDelay = 1e4, retryStatuses = DEFAULT_RETRY_STATUSES, retryMethods = DEFAULT_RETRY_METHODS, retryOnNetworkError = true, baseFetch = globalThis.fetch, jitter = true, onRetry } = options ?? {};
	const retryMethodSet = new Set(retryMethods.map((m) => m.toUpperCase()));
	return async function retryFetch(input, init) {
		const method = (input instanceof Request ? input.method : init?.method ?? "GET").toUpperCase();
		const signal = init?.signal ?? (input instanceof Request ? input.signal : void 0);
		let lastError;
		let lastResponse;
		for (let attempt = 0; attempt <= maxRetries; attempt++) try {
			const response = await baseFetch(input instanceof Request ? input.clone() : input, init);
			const isRateLimited = response.status === 429;
			if (!(retryStatuses.includes(response.status) && (isRateLimited || retryMethodSet.has(method))) || attempt === maxRetries) return response;
			lastResponse = response;
			await response.body?.cancel().catch(() => {});
			const delay = computeDelay(attempt, baseDelay, maxDelay, jitter, response);
			onRetry?.(attempt, delay, `status ${response.status}`);
			await sleep(delay, signal);
		} catch (err) {
			lastError = err;
			if (signal?.aborted || !retryOnNetworkError || !retryMethodSet.has(method) || attempt === maxRetries) throw err;
			const delay = computeDelay(attempt, baseDelay, maxDelay, jitter);
			onRetry?.(attempt, delay, "network error");
			await sleep(delay, signal);
		}
		if (lastResponse) return lastResponse;
		throw lastError;
	};
}
function computeDelay(attempt, baseDelay, maxDelay, jitter, response) {
	const retryAfter = response?.headers.get("Retry-After");
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (!Number.isNaN(seconds)) return Math.min(seconds * 1e3, maxDelay);
		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), maxDelay);
	}
	const exponential = baseDelay * 2 ** attempt;
	const jitterMs = jitter ? Math.random() * baseDelay : 0;
	return Math.min(exponential + jitterMs, maxDelay);
}
function abortReason(signal) {
	const reason = signal?.reason;
	return reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError");
}
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortReason(signal));
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortReason(signal));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
function createRateLimitFetch(options) {
	return createRetryFetch({
		maxRetries: options?.maxRetries ?? 3,
		baseDelay: options?.baseDelayMs ?? 1e3,
		maxDelay: options?.maxDelayMs ?? 3e4,
		retryStatuses: [429],
		retryMethods: [
			"GET",
			"HEAD",
			"OPTIONS",
			"PUT",
			"POST",
			"PATCH",
			"DELETE"
		],
		retryOnNetworkError: false
	});
}
//#endregion
//#region ../../libs/docs-impact-review/src/report.ts
var DOCS_IMPACT_COMMENT_MARKER = "<!-- moltnet:docs-impact-review -->";
/**
* An error in the comment stays readable and far below GitHub's 65,536
* character limit; the full text is in the run's report and log.
*/
var ERROR_TEXT_MAX = 1e3;
/**
* Model-written text is published as the posting identity, so it must stay
* one line of plain text:
*
* - whitespace collapses to single spaces, so no heading, list or reference
*   definition can start;
* - `[`, `]` and `!` before `[` are escaped, so no link or image forms, at
*   any nesting;
* - `@` mentions and `#123` or `owner/repo#123` references are broken with a
*   zero-width space, so nobody is notified and nothing is backlinked;
* - `<` and `>` are escaped, so no HTML or autolink.
*
* Each rule is one pass over the text with no backtracking.
*/
function neutralize(text) {
	return text.replace(/\s+/g, " ").trim().replace(/[[\]]/g, (bracket) => `\\${bracket}`).replace(/@(?=[A-Za-z0-9_-])/g, "@​").replace(/#(?=\d)/g, "#​").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function shorten(text, max = 280) {
	const flat = neutralize(text);
	return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
/** A Markdown heading as plain text: `## Flags` → `Flags`. */
function headingText(section) {
	return neutralize(section.replace(/^#{1,6}\s+/, "").trim());
}
/** `48s`, `2m 48s`; sub-second durations round up to `1s`. */
function formatDuration(ms) {
	const seconds = Math.max(1, Math.round(ms / 1e3));
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
/** A repository path shown as code and linked at head; both escaped. */
function fileLink(report, path) {
	const target = path.split("/").map((segment) => encodeURIComponent(segment).replace(/[()]/g, (char) => char === "(" ? "%28" : "%29")).join("/");
	return `[${codeSpan(path)}](https://github.com/${report.repo}/blob/${report.headRevision}/${target})`;
}
/**
* Inline code that `text` cannot break out of: the fence is longer than any
* backtick run inside, and newlines are flattened.
*/
function codeSpan(text, max = Number.POSITIVE_INFINITY) {
	const collapsed = text.replace(/\s+/g, " ").trim();
	const flat = collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
	const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(longest + 1);
	const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
	return `${fence}${pad}${flat}${pad}${fence}`;
}
/**
* One concise PR comment body. Clean results stay on one line; a failed run
* says so explicitly instead of looking like an empty clean result.
*/
function renderComment(report) {
	const head = report.headRevision ? `head [\`${report.headRevision.slice(0, 7)}\`](https://github.com/${report.repo}/commit/${report.headRevision})` : "head unknown";
	if (report.status === "failed" || !report.outcome) return [
		DOCS_IMPACT_COMMENT_MARKER,
		`**Docs impact: not reviewed** · ${head}`,
		"",
		`The review did not complete: ${codeSpan(report.error || "unknown error", ERROR_TEXT_MAX)}. No judgment was made.`
	].join("\n");
	const count = report.findings.length;
	const lines = [DOCS_IMPACT_COMMENT_MARKER, [
		`**Docs impact: ${report.outcome}**`,
		head,
		...count > 0 ? [`${count} finding${count === 1 ? "" : "s"}`] : [],
		`reviewed in ${formatDuration(report.timings.totalMs)}`
	].join(" · ")];
	if (report.config?.kind === "default") lines.push("", "_No `.github/docs-impact-review.json` at the base revision: reviewed with the default configuration, without routing rules._");
	else if (report.config?.kind === "file") lines.push("", `_Reviewed with the configuration in ${codeSpan(report.config.location)}, not the base revision's._`);
	else if (report.config?.kind === "base") lines.push("", `_Configuration: ${codeSpan(report.config.location)}._`);
	const missing = new Set(report.selectedDocs.filter((doc) => doc.missing).map((doc) => doc.path));
	if (count > 0) {
		lines.push("");
		for (const finding of report.findings.slice(0, 3)) {
			const doc = missing.has(finding.docsPath) ? codeSpan(finding.docsPath) : fileLink(report, finding.docsPath);
			const section = finding.section ? ` › ${headingText(finding.section)}` : "";
			const label = finding.issue ? `**${finding.issue}** ` : "";
			lines.push(`- ${label}${doc}${section} — ${shorten(finding.update)}`, `  - Evidence: ${fileLink(report, finding.evidence.path)} — ${shorten(finding.evidence.detail)}`);
		}
	}
	const hidden = count - 3;
	if (hidden > 0) lines.push(`- …and ${hidden} more finding${hidden === 1 ? "" : "s"} in the workflow run report.`);
	if (report.gaps.length > 0) {
		lines.push("", "Not covered by this review:");
		for (const gap of report.gaps) lines.push(`- ${codeSpan(gap.scope)}: ${neutralize(gap.reason)}`);
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
export { createRateLimitFetch as a, summarizeCorpus as i, codeSpan as n, createRetryFetch as o, renderComment as r, DOCS_IMPACT_COMMENT_MARKER as t };
