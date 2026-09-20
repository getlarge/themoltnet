/** Deterministic child process: exercise the production selection parser under isolated HOME. */
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';

import { resolveRunProjectSelection } from '@themoltnet/agent-daemon/testing';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
const configPath = option('config-file');
const stateDir = option('state-dir');
assert(configPath && isAbsolute(configPath));
assert(stateDir && isAbsolute(stateDir));
const selection = await resolveRunProjectSelection({
  agent: option('agent') ?? '',
  team: option('team'),
  cwd: process.cwd(),
  apiUrl: process.env.MOLTNET_API_URL,
  project: option('project'),
  binding: option('binding'),
  general: args.includes('--general'),
  source: option('source'),
  'config-file': configPath,
  'state-dir': stateDir,
  'workspace-strategy': option('workspace-strategy'),
});
assert.notEqual(process.env.HOME, selection.source);
assert.notEqual(selection.stateRootDir, selection.source);
process.stdout.write(
  `${JSON.stringify({ event: 'fixture-worker-ready', projectId: selection.projectId, source: selection.source, strategy: selection.strategy })}\n`,
);
const timer = setInterval(() => undefined, 1000);
process.once('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});
process.once('SIGINT', () => {
  clearInterval(timer);
  process.exit(0);
});
