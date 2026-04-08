#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { render } from 'ink';

import { printGitHubToken, resolveAgentName } from './github-token.js';
import { InitApp } from './InitApp.js';
import type { PortDiaryMode } from './phases/portDiary.js';
import { PortApp } from './PortApp.js';
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
    org: { type: 'string', short: 'o' },
    from: { type: 'string' },
    diary: { type: 'string' },
  },
});

const subcommand = positionals[0] ?? 'init';
const name = values['name'];
const agentFlags = values['agent'] ?? [];
const apiUrl =
  values['api-url'] ?? process.env.MOLTNET_API_URL ?? 'https://api.themolt.net';
const dir = values['dir'] ?? process.cwd();
const org = values['org'];
const fromDir = values['from'];
const diaryModeArg = values['diary'] ?? 'new';

if (subcommand === 'github' && positionals[1] === 'token') {
  try {
    const agentName = resolveAgentName(name, process.env.GIT_CONFIG_GLOBAL);
    printGitHubToken(agentName, dir);
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

if (!name) {
  const usage =
    subcommand === 'setup'
      ? 'Usage: legreffier setup --name <agent-name> [--agent claude] [--agent codex] [--dir <path>]'
      : subcommand === 'port'
        ? 'Usage: legreffier port --name <agent-name> --from <path/to/source/.moltnet/<agent>> [--agent claude] [--agent codex] [--dir <target-repo>] [--diary new|reuse|skip]'
        : 'Usage: legreffier [init] --name <agent-name> [--agent claude] [--agent codex] [--api-url <url>] [--dir <path>] [--org <github-org>]';
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
      org={org}
    />,
  );
} else if (subcommand === 'port') {
  if (!fromDir) {
    process.stderr.write(
      'Error: legreffier port requires --from <path/to/source/.moltnet/<agent>>\n',
    );
    process.exit(1);
  }
  if (!['new', 'reuse', 'skip'].includes(diaryModeArg)) {
    process.stderr.write(
      `Error: --diary must be one of: new, reuse, skip (got "${diaryModeArg}")\n`,
    );
    process.exit(1);
  }
  render(
    <PortApp
      name={name}
      agents={agents.length > 0 ? agents : ['claude']}
      sourceDir={fromDir}
      targetRepoDir={dir}
      diaryMode={diaryModeArg as PortDiaryMode}
      apiUrl={apiUrl}
    />,
  );
} else {
  process.stderr.write(
    `Unknown subcommand: ${subcommand}. Use "init", "setup", or "port".\n`,
  );
  process.exit(1);
}
