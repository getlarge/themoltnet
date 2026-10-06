import { o as createRetryFetch } from "./report-DJdZyA5m.js";
//#region ../../libs/docs-impact-review/src/github-api.ts
/** A GitHub API response that failed; `status` is the HTTP status. */
var GitHubApiError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "GitHubApiError";
	}
};
var DEFAULT_ATTEMPT_TIMEOUT_MS = 3e4;
var DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 6e4;
/** Marks a rate limit too long to wait for, set by `rateLimits`. */
var LONG_WAIT_HEADER = "x-moltnet-rate-limit-wait-ms";
/** The edit is idempotent; creating a comment (POST) is not. */
var RETRY_METHODS = [
	"GET",
	"HEAD",
	"OPTIONS",
	"PUT",
	"PATCH"
];
/** How long GitHub asks us to wait, from `retry-after` or the reset time. */
function rateLimitWaitMs(response, now) {
	const retryAfter = response.headers.get("retry-after");
	if (retryAfter !== null && Number.isFinite(Number(retryAfter))) return Number(retryAfter) * 1e3;
	if (response.headers.get("x-ratelimit-remaining") === "0") {
		const reset = Number(response.headers.get("x-ratelimit-reset"));
		return Number.isFinite(reset) ? Math.max(0, reset * 1e3 - now) : 0;
	}
}
/**
* GitHub reports secondary rate limits as 403 with `retry-after`, and an
* exhausted primary limit as 403 with `x-ratelimit-remaining: 0`. Either way
* the request was not executed, so a wait within `maxWaitMs` is retried like
* a 429, whatever the method, and honoured in full; a longer one is returned
* as a final 403 so the caller fails with a rate-limit error at once. Each
* attempt also gets its own timeout.
*/
function rateLimits(baseFetch, options) {
	return async (input, init) => {
		const timeout = AbortSignal.timeout(options.attemptTimeoutMs);
		const response = await baseFetch(input, {
			...init,
			signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
		});
		if (response.status !== 403 && response.status !== 429) return response;
		const waitMs = rateLimitWaitMs(response, options.now());
		if (waitMs === void 0) return response;
		const headers = new Headers(response.headers);
		if (waitMs > options.maxWaitMs) {
			headers.set(LONG_WAIT_HEADER, String(waitMs));
			return new Response(response.body, {
				status: 403,
				headers
			});
		}
		headers.set("retry-after", String(Math.ceil(waitMs / 1e3)));
		return new Response(response.body, {
			status: 429,
			statusText: "rate limited",
			headers
		});
	};
}
/**
* Minimal GitHub REST client for the review's own calls: headers,
* pagination, and errors that carry GitHub's message. Retries come from
* `createRetryFetch`: rate limits for every method (the request was never
* executed), server errors, timeouts and network failures only for
* idempotent methods (PATCH included, POST not), so a comment is never
* posted twice.
*/
var GitHubApi = class {
	options;
	apiUrl;
	baseFetch;
	log;
	constructor(options) {
		this.options = options;
		let apiUrl = options.apiUrl || "https://api.github.com";
		while (apiUrl.endsWith("/")) apiUrl = apiUrl.slice(0, -1);
		this.apiUrl = apiUrl;
		this.baseFetch = rateLimits(options.fetchImpl ?? fetch, {
			maxWaitMs: options.maxRateLimitWaitMs ?? DEFAULT_MAX_RATE_LIMIT_WAIT_MS,
			attemptTimeoutMs: options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
			now: options.now ?? Date.now
		});
		this.log = options.log ?? ((message) => process.stderr.write(`${message}\n`));
	}
	async request(path, init) {
		const method = (init?.method ?? "GET").toUpperCase();
		const response = await createRetryFetch({
			baseDelay: 1e3,
			...this.options.retry,
			maxDelay: this.options.maxRateLimitWaitMs ?? DEFAULT_MAX_RATE_LIMIT_WAIT_MS,
			retryMethods: RETRY_METHODS,
			baseFetch: this.baseFetch,
			onRetry: (attempt, delay, reason) => this.log(`GitHub API ${method} ${path}: ${reason}, retry ${attempt + 1} in ${Math.round(delay)} ms`)
		})(`${this.apiUrl}${path}`, {
			...init,
			method,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${this.options.token}`,
				"content-type": "application/json",
				"x-github-api-version": "2022-11-28",
				...init?.headers
			}
		});
		if (response.ok) return await response.json();
		const longWait = response.headers.get(LONG_WAIT_HEADER);
		if (longWait) throw new GitHubApiError(`GitHub API ${method} ${path} is rate limited for ${Math.ceil(Number(longWait) / 1e3)} s, longer than this run waits`, 429);
		const detail = await response.json().then((body) => typeof body.message === "string" ? `: ${body.message}` : "").catch(() => "");
		throw new GitHubApiError(`GitHub API ${method} ${path} failed with ${response.status}${detail}`, response.status);
	}
	/** Follows `per_page=100` pages until a short page. */
	async paginate(path) {
		const separator = path.includes("?") ? "&" : "?";
		const items = [];
		for (let page = 1;; page += 1) {
			const batch = await this.request(`${path}${separator}per_page=100&page=${page}`);
			items.push(...batch);
			if (batch.length < 100) return items;
		}
	}
};
//#endregion
export { GitHubApi as t };
