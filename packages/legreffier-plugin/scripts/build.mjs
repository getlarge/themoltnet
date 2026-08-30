import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'plugins'), join(dist, 'plugins'), { recursive: true });
await cp(join(root, 'marketplace.json'), join(dist, 'marketplace.json'));
await cp(join(root, 'submission'), join(dist, 'submission'), {
  recursive: true,
});
await cp(join(root, '.claude-plugin'), join(dist, '.claude-plugin'), {
  recursive: true,
});
