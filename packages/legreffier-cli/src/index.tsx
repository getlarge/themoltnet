#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { render } from 'ink';

import { InitApp } from './InitApp.js';
import { type AgentType, SUPPORTED_AGENTS } from './ui/types.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    name: { type: 'string', short: 'n' },
    agent: { type: 'string', short: 'a' },
    'api-url': { type: 'string' },
    dir: { type: 'string' },
  },
});

const name = values['name'];
const agentFlag = values['agent'];
const apiUrl =
  values['api-url'] ?? process.env.MOLTNET_API_URL ?? 'https://api.themolt.net';
const dir = values['dir'] ?? process.cwd();

if (!name) {
  process.stderr.write(
    'Usage: legreffier --name <agent-name> [--agent claude] [--api-url <url>] [--dir <path>]\n',
  );
  process.exit(1);
}

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$/;
if (!AGENT_NAME_RE.test(name)) {
  process.stderr.write(
    `Invalid agent name: "${name}". Must be 2-39 lowercase alphanumeric characters or hyphens, starting and ending with a letter or digit.\n`,
  );
  process.exit(1);
}

if (agentFlag && !SUPPORTED_AGENTS.includes(agentFlag as AgentType)) {
  process.stderr.write(
    `Unsupported agent: ${agentFlag}. Supported: ${SUPPORTED_AGENTS.join(', ')}\n`,
  );
  process.exit(1);
}

const agent = agentFlag as AgentType | undefined;

render(<InitApp name={name} agent={agent} apiUrl={apiUrl} dir={dir} />);
