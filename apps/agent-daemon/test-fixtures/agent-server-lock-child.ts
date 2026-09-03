import { mkdirSync } from 'node:fs';

import { acquireAgentServerLock } from '../src/lib/agent-server/lock.js';

const root = process.argv[2];
if (!root) throw new Error('agent server lock fixture requires a root');
mkdirSync(root, { recursive: true });

const held = await acquireAgentServerLock(root);
process.stdout.write('locked\n');

const shutdown = (): void => {
  void held.release().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
setInterval(() => undefined, 1_000);
