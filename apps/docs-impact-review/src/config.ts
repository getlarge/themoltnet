/**
 * Environment access for this app (the only module allowed to read
 * `process.env`). Tokens come from the environment, never argv, so they stay
 * out of shell history and process listings.
 */
export function githubToken(): string | undefined {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return token?.trim() || undefined;
}
