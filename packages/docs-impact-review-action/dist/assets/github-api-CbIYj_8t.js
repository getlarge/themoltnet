import { r as createRetryFetch } from "./run-BzFLlp08.js";
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
var DEFAULT_TIMEOUT_MS = 6e4;
/**
* GitHub reports secondary rate limits as 403 with `retry-after`, and an
* exhausted primary limit as 403 with `x-ratelimit-remaining: 0`. Either way
* the request was not executed, so it is retried like a 429, whatever the
* method.
*/
function rateLimitsAs429(baseFetch) {
	return async (input, init) => {
		const response = await baseFetch(input, init);
		if (response.status === 403 && (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0")) return new Response(response.body, {
			status: 429,
			statusText: "rate limited (403)",
			headers: response.headers
		});
		return response;
	};
}
/**
* Minimal GitHub REST client for the review's own calls: headers,
* pagination, and errors that carry GitHub's message. Retries come from
* `createRetryFetch`: rate limits for every method (the request was never
* executed), server errors and network failures only for idempotent methods,
* so a comment is never posted twice.
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
		this.baseFetch = rateLimitsAs429(options.fetchImpl ?? fetch);
		this.log = options.log ?? ((message) => process.stderr.write(`${message}\n`));
	}
	async request(path, init) {
		const method = (init?.method ?? "GET").toUpperCase();
		const response = await createRetryFetch({
			baseDelay: 1e3,
			maxDelay: 3e4,
			...this.options.retry,
			baseFetch: this.baseFetch,
			onRetry: (attempt, delay, reason) => this.log(`GitHub API ${method} ${path}: ${reason}, retry ${attempt + 1} in ${Math.round(delay)} ms`)
		})(`${this.apiUrl}${path}`, {
			...init,
			method,
			signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${this.options.token}`,
				"content-type": "application/json",
				"x-github-api-version": "2022-11-28",
				...init?.headers
			}
		});
		if (response.ok) return await response.json();
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
