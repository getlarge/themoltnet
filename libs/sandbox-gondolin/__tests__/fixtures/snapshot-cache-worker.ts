import { appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

import { ensureCachedSnapshot } from '../../src/snapshot-cache.js';

const [path, marker, pause] = process.argv.slice(2);
await ensureCachedSnapshot(path, async (pending) => {
  appendFileSync(marker, `${process.pid}\n`);
  writeFileSync(pending, 'partial');
  process.send?.('BUILDING');
  await setTimeout(Number(pause));
  writeFileSync(pending, 'complete');
});
process.disconnect?.();
