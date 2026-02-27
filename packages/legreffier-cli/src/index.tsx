#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { render } from 'ink';

import { InitApp } from './InitApp.js';
import { SetupApp } from './SetupApp.js';
import { type AgentType, SUPPORTED_AGENTS } from './ui/types.js';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    name: { type: 'string', short: 'n' },
    agent: { type: 'string', short: 'a', multiple: true },
    'api-url': { type: 'string' },
    dir: { type: 'string' },
  },
});

const subcommand = positionals[0] ?? 'init';
const name = values['name'];
const agentFlags = values['agent'] ?? [];
const apiUrl =
  values['api-url'] ?? process.env.MOLTNET_API_URL ?? 'https://api.themolt.net';
const dir = values['dir'] ?? process.cwd();

if (!name) {
  const usage =
    subcommand === 'setup'
      ? 'Usage: legreffier setup --name <agent-name> [--agent claude] [--agent codex] [--dir <path>]'
      : 'Usage: legreffier [init] --name <agent-name> [--agent claude] [--agent codex] [--api-url <url>] [--dir <path>]';
  process.stderr.write(usage + '\n');
  process.exit(1);
}

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$/;
if (!AGENT_NAME_RE.test(name)) {
  process.stderr.write(
    `Invalid agent name: "${name}". Must be 2-39 lowercase alphanumeric characters or hyphens, starting and ending with a letter or digit.\n`,
  );
  process.exit(1);
}

for (const a of agentFlags) {
  if (!SUPPORTED_AGENTS.includes(a as AgentType)) {
    process.stderr.write(
      `Unsupported agent: ${a}. Supported: ${SUPPORTED_AGENTS.join(', ')}\n`,
    );
    process.exit(1);
  }
}

const agents = agentFlags as AgentType[];

if (subcommand === 'setup') {
  render(<SetupApp name={name} agents={agents} apiUrl={apiUrl} dir={dir} />);
} else if (subcommand === 'init') {
  render(
    <InitApp
      name={name}
      agents={agents.length > 0 ? agents : undefined}
      apiUrl={apiUrl}
      dir={dir}
    />,
  );
} else {
  process.stderr.write(
    `Unknown subcommand: ${subcommand}. Use "init" or "setup".\n`,
  );
  process.exit(1);
}
