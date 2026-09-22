/** Deterministic child process: exercise the production selection parser under isolated HOME. */
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';

import {
  projectRunOptionDefs,
  resolveRunProjectSelection,
} from '@themoltnet/agent-daemon/testing';

// Parse with the daemon's own flag definitions, so a renamed flag fails here.
// Non-project worker flags (poll settings) are tolerated, not interpreted.
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    ...projectRunOptionDefs(),
    agent: { type: 'string' },
    team: { type: 'string' },
  },
  strict: false,
  allowPositionals: true,
});
const text = (name: string) => {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
};
const configPath = text('config-file');
const stateDir = text('state-dir');
assert(configPath && isAbsolute(configPath));
assert(stateDir && isAbsolute(stateDir));
const selection = await resolveRunProjectSelection({
  agent: text('agent') ?? '',
  team: text('team'),
  cwd: process.cwd(),
  apiUrl: process.env.MOLTNET_API_URL,
  project: text('project'),
  binding: text('binding'),
  general: values.general === true,
  source: text('source'),
  'config-file': configPath,
  'state-dir': stateDir,
  'workspace-strategy': text('workspace-strategy'),
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
