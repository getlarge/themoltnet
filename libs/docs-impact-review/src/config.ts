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

/** `GITHUB_API_URL`, set on GitHub Enterprise Server; empty means github.com. */
export function githubApiUrl(): string | undefined {
  return process.env.GITHUB_API_URL?.trim() || undefined;
}

/** The GitHub Actions environment the action's command lines read. */
export interface ActionEnv {
  [name: string]: string | undefined;
}

export function actionEnv(): ActionEnv {
  return process.env;
}
