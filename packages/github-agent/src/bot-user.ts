const GITHUB_API_BASE_URL = 'https://api.github.com';

/**
 * Look up the shadow bot user associated with a GitHub App.
 * Every GitHub App gets a bot user account (`<slug>[bot]`).
 * This endpoint is public — no authentication required.
 *
 * @returns The bot user ID and login
 */
export async function lookupBotUser(
  appSlug: string,
  apiBaseUrl = GITHUB_API_BASE_URL,
): Promise<{ id: number; login: string }> {
  const url = `${apiBaseUrl}/users/${encodeURIComponent(`${appSlug}[bot]`)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id: number; login: string };
  return { id: data.id, login: data.login };
}

/**
 * Build the GitHub noreply email for a bot user.
 * Format: `<bot-user-id>+<slug>[bot]@users.noreply.github.com`
 */
export function buildBotEmail(botUserId: number, appSlug: string): string {
  return `${botUserId}+${appSlug}[bot]@users.noreply.github.com`;
}
