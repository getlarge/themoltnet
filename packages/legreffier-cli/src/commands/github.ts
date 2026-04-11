import { defineCommand } from 'citty';

import { printGitHubToken, resolveAgentName } from '../github-token.js';
import {
  CliValidationError,
  commonArgs,
  resolveDir,
  withCleanErrors,
} from './shared.js';

const tokenSubcommand = defineCommand({
  meta: {
    name: 'token',
    description:
      'Print a short-lived installation token for the agent GitHub App (reads .moltnet/<agent>/moltnet.json).',
  },
  args: {
    // `--name` here is optional: if unset, we derive the agent from
    // $GIT_CONFIG_GLOBAL so `gh`-wrapper scripts don't need to duplicate it.
    name: commonArgs.name,
    dir: commonArgs.dir,
  },
  run: withCleanErrors(({ args }) => {
    let agentName: string;
    try {
      agentName = resolveAgentName(
        typeof args.name === 'string' ? args.name : undefined,
        process.env['GIT_CONFIG_GLOBAL'],
      );
    } catch (err) {
      throw new CliValidationError(
        err instanceof Error ? err.message : String(err),
      );
    }
    printGitHubToken(agentName, resolveDir(args.dir));
  }),
});

export const githubCommand = defineCommand({
  meta: {
    name: 'github',
    description: 'GitHub-related helpers (token minting)',
  },
  subCommands: {
    token: tokenSubcommand,
  },
});
