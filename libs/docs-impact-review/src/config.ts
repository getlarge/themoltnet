/**
 * Environment access for this library (the only module allowed to read
 * `process.env`).
 */

/**
 * The environment for `git` child processes: inherited, but never prompting
 * for credentials, so a missing one fails instead of hanging the review.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0' };
}
