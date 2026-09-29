/**
 * Environment access for this app (the only module allowed to read
 * `process.env`). Tokens come from the environment, never argv, so they stay
 * out of shell history and process listings.
 */
export function githubToken(): string | undefined {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return token?.trim() || undefined;
}

/**
 * The environment for `git` child processes: inherited, but never prompting
 * for credentials, so a missing one fails instead of hanging the review.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0' };
}
