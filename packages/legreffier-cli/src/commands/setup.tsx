import { defineCommand } from 'citty';
import { render } from 'ink';

import { SetupApp } from '../SetupApp.js';
import {
  collectAgents,
  commonArgs,
  requireAgentName,
  resolveApiUrl,
  resolveDir,
  withCleanErrors,
} from './shared.js';

export const setupCommand = defineCommand({
  meta: {
    name: 'setup',
    description:
      'Install LeGreffier skills and MCP config into an existing repo',
  },
  args: {
    name: { ...commonArgs.name, required: true },
    agent: commonArgs.agent,
    'api-url': commonArgs['api-url'],
    dir: commonArgs.dir,
  },
  run: withCleanErrors(({ args, rawArgs }) => {
    const name = requireAgentName(args.name);
    const agents = collectAgents(rawArgs);
    const apiUrl = resolveApiUrl(args['api-url']);
    const dir = resolveDir(args.dir);

    // `agents` can be empty here — unlike `port.tsx` (which falls back to
    // ['claude']), `SetupApp` handles the no-agents case itself by prompting
    // the user to pick one in the TUI, so we pass the array through as-is.
    render(<SetupApp name={name} agents={agents} apiUrl={apiUrl} dir={dir} />);
  }),
});
