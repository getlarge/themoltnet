const GITHUB_API_BASE_URL = 'https://api.github.com';

export interface LookupBotUserOptions {
  apiBaseUrl?: string;
  /** Retries with exponential backoff. GitHub's /users API may lag for
   * newly created apps. Default: 0 (no retry). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 2000. */
  baseDelayMs?: number;
}

/**
 * Look up the shadow bot user associated with a GitHub App.
 * Every GitHub App gets a bot user account (`<slug>[bot]`).
 * This endpoint is public — no authentication required.
 *
 * Tries `<appSlug>[bot]` first (exists post-installation), then falls
 * back to plain `<appSlug>` (exists right after app creation, pre-install).
 *
 * @returns The bot user ID and login
 */
export async function lookupBotUser(
  appSlug: string,
  opts: LookupBotUserOptions = {},
): Promise<{ id: number; login: string }> {
  const {
    apiBaseUrl = GITHUB_API_BASE_URL,
    maxRetries = 0,
    baseDelayMs = 2_000,
  } = opts;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (const username of [`${appSlug}[bot]`, appSlug]) {
      const url = `${apiBaseUrl}/users/${encodeURIComponent(username)}`;
      const response = await fetch(url, { headers });
      if (response.ok) {
        const data = (await response.json()) as { id: number; login: string };
        return { id: data.id, login: data.login };
      }
    }
    if (attempt < maxRetries) {
      const delayMs = baseDelayMs * 2 ** attempt;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }
  throw new Error(`GitHub user lookup failed for app "${appSlug}"`);
}

/**
 * Build the GitHub noreply email for a bot user.
 * Format: `<bot-user-id>+<slug>[bot]@users.noreply.github.com`
 */
export function buildBotEmail(botUserId: number, appSlug: string): string {
  return `${botUserId}+${appSlug}[bot]@users.noreply.github.com`;
}
