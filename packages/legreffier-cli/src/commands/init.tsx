import { defineCommand } from 'citty';
import { render } from 'ink';

import { InitApp } from '../InitApp.js';
import {
  collectAgents,
  commonArgs,
  requireAgentName,
  resolveApiUrl,
  resolveDir,
  withCleanErrors,
} from './shared.js';

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Create a new agent identity and wire it into this repository',
  },
  args: {
    name: { ...commonArgs.name, required: true },
    agent: commonArgs.agent,
    'api-url': commonArgs['api-url'],
    dir: commonArgs.dir,
    org: {
      type: 'string',
      description: 'GitHub organization to install the App on (optional)',
      alias: 'o',
      valueHint: 'github-org',
    },
  },
  run: withCleanErrors(({ args, rawArgs }) => {
    const name = requireAgentName(args.name);
    const agents = collectAgents(rawArgs);
    const apiUrl = resolveApiUrl(args['api-url']);
    const dir = resolveDir(args.dir);
    const org = typeof args.org === 'string' ? args.org : undefined;

    render(
      <InitApp
        name={name}
        agents={agents.length > 0 ? agents : undefined}
        apiUrl={apiUrl}
        dir={dir}
        org={org}
      />,
    );
  }),
});
