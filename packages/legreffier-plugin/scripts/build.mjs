import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// dist/ is owned by the Nx build target and replaced wholesale. An explicit
// output directory lets tests build without touching it; that one must be new
// or empty, because a caller-supplied path is never deleted.
const target = process.argv[2];
const dist = target ? resolve(target) : join(root, 'dist');
if (target) {
  if ((await readdir(dist).catch(() => [])).length > 0) {
    console.error(`${dist} is not empty; pass a new or empty directory`);
    process.exit(1);
  }
} else {
  await rm(dist, { force: true, recursive: true });
}
await mkdir(dist, { recursive: true });
await cp(join(root, 'plugins'), join(dist, 'plugins'), { recursive: true });
await cp(join(root, 'marketplace.json'), join(dist, 'marketplace.json'));
await cp(join(root, 'submission'), join(dist, 'submission'), {
  recursive: true,
});
await cp(join(root, '.claude-plugin'), join(dist, '.claude-plugin'), {
  recursive: true,
});
