// Child process used by Go's writer-lock interoperability test. All paths are
// disposable test paths passed by the parent; no central identity store is read.
import { access, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

import { updateProjectConfig } from '../../src/project-bindings.js';

const [path, ready, release] = process.argv.slice(2);
await updateProjectConfig(path, async (config) => {
  await writeFile(ready, 'ready');
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await access(release);
      break;
    } catch {
      if (Date.now() >= deadline)
        throw new Error('interop test release timed out');
      await setTimeout(10);
    }
  }
  config.bindings.push({
    name: 'typescript',
    apiUrl: 'https://api.example',
    teamId: 'team',
    projectId: 'project',
    strategy: 'none',
  });
});
