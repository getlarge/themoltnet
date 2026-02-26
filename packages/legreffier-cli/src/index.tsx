#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { render } from 'ink';

import { InitApp } from './InitApp.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    name: { type: 'string', short: 'n' },
    'api-url': { type: 'string' },
    dir: { type: 'string' },
  },
});

const name = values['name'];
const apiUrl =
  values['api-url'] ?? process.env.MOLTNET_API_URL ?? 'https://api.themolt.net';
const dir = values['dir'] ?? process.cwd();

if (!name) {
  process.stderr.write(
    'Usage: legreffier --name <agent-name> [--api-url <url>] [--dir <path>]\n',
  );
  process.exit(1);
}

render(<InitApp name={name} apiUrl={apiUrl} dir={dir} />);
