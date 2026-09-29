//#region ../../libs/docs-impact-review/src/config.ts
/**
* Environment access for this app (the only module allowed to read
* `process.env`). Tokens come from the environment, never argv, so they stay
* out of shell history and process listings.
*/
function githubToken() {
	return (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim() || void 0;
}
/** `GITHUB_API_URL`, set on GitHub Enterprise Server; empty means github.com. */
function githubApiUrl() {
	return process.env.GITHUB_API_URL?.trim() || void 0;
}
function actionEnv() {
	return process.env;
}
//#endregion
//#region ../../libs/docs-impact-review/src/github-api.ts
/** A GitHub API response that failed; `status` is the HTTP status. */
var GitHubApiError = class extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "GitHubApiError";
	}
};
/** Responses worth retrying: rate limits and transient server errors. */
var RETRYABLE = new Set([
	429,
	500,
	502,
	503,
	504
]);
var MAX_WAIT_MS = 3e4;
function waitFor(response, attempt) {
	const retryAfter = Number(response.headers.get("retry-after"));
	if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1e3, MAX_WAIT_MS);
	return Math.min(1e3 * 2 ** attempt, MAX_WAIT_MS);
}
/**
* Minimal GitHub REST client for the review's own calls. A transient failure
* at publish time would otherwise throw away minutes of review work, so
* rate limits and 5xx responses are retried with bounded backoff that honors
* `retry-after`.
*/
var GitHubApi = class {
	apiUrl;
	fetchImpl;
	attempts;
	sleep;
	constructor(options) {
		this.options = options;
		this.apiUrl = (options.apiUrl || "https://api.github.com").replace(/\/+$/, "");
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.attempts = options.attempts ?? 3;
		this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
			setTimeout(resolve, ms);
		}));
	}
	async request(path, init) {
		const method = init?.method ?? "GET";
		for (let attempt = 0;; attempt += 1) {
			const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
				...init,
				headers: {
					accept: "application/vnd.github+json",
					authorization: `Bearer ${this.options.token}`,
					"content-type": "application/json",
					"x-github-api-version": "2022-11-28",
					...init?.headers
				}
			});
			if (response.ok) return await response.json();
			if (RETRYABLE.has(response.status) && attempt + 1 < this.attempts) {
				await this.sleep(waitFor(response, attempt));
				continue;
			}
			const detail = await response.json().then((body) => typeof body.message === "string" ? `: ${body.message}` : "").catch(() => "");
			throw new GitHubApiError(`GitHub API ${method} ${path} failed with ${response.status}${detail}`, response.status);
		}
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
export { githubToken as i, actionEnv as n, githubApiUrl as r, GitHubApi as t };
