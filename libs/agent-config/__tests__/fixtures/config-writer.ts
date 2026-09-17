import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  agentKeyKey,
  readConfig,
  updateTeamAgentKeyReference,
  withConfigLock,
  writeConfig,
} from '../../src/index.js';

const [operation, path, team] = process.argv.slice(2);
if (operation === 'update') {
  await updateTeamAgentKeyReference(
    'subject',
    team,
    { provider: 'file', key: agentKeyKey('subject', team) },
    dirname(path),
  );
} else if (operation === 'roundtrip') {
  const config = await readConfig(dirname(path));
  if (!config || config.subject_type !== 'agent')
    throw new Error('missing canonical config');
  await writeConfig(config, dirname(path));
} else if (operation === 'hold') {
  await withConfigLock(path, async () => {
    await writeFile(`${path}.ready`, 'ready');
    await new Promise<void>(() => {
      setInterval(() => undefined, 1000);
    });
  });
} else {
  // Read through the public reader and emit only the synthetic fixture document.
  await readConfig(dirname(path));
  process.stdout.write(await readFile(path, 'utf8'));
}
