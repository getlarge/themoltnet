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
export { gitEnv as a, actionEnv as i, createRateLimitFetch as n, githubApiUrl as o, createRetryFetch as r, githubToken as s, runMain as t };
