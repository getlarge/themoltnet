import { access, cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Assembles the tree published to github.com/getlarge/legreffier-plugin, the
// Git-installable marketplace that Codex and Claude Code install from.
//
// The plugin bundle and manifests are taken from dist/ — the same build that
// the release archive and its provenance attestation cover — so the
// marketplace never ships anything the release did not build. `submission/`
// is the ChatGPT app submission and is not part of the Git marketplace.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..', '..');

// `--dist <dir>` reads a build other than the package's dist/ (used by tests).
const args = process.argv.slice(2);
const distFlag = args.indexOf('--dist');
const distValue = distFlag === -1 ? undefined : args.splice(distFlag, 2)[1];
const dist = distValue ? resolve(distValue) : join(root, 'dist');
const output = args[0];
if (!output || (distFlag !== -1 && !distValue)) {
  console.error(
    'usage: node scripts/build-marketplace.mjs [--dist <dir>] <output-directory>',
  );
  process.exit(2);
}
const out = resolve(output);

// Refuse rather than delete: the output is replaced wholesale, and a mistyped
// path must never cost anything.
const existing = await readdir(out).catch(() => []);
if (existing.length > 0) {
  console.error(`${out} is not empty; pass a new or empty directory`);
  process.exit(1);
}

try {
  await access(join(dist, 'plugins'));
} catch {
  console.error(`${dist} has no plugin bundle; run the build first`);
  process.exit(1);
}

await mkdir(join(out, '.agents', 'plugins'), { recursive: true });
await mkdir(join(out, 'scripts'), { recursive: true });
await cp(join(dist, 'plugins'), join(out, 'plugins'), { recursive: true });
await cp(join(dist, '.claude-plugin'), join(out, '.claude-plugin'), {
  recursive: true,
});
await cp(
  join(dist, 'marketplace.json'),
  join(out, '.agents', 'plugins', 'marketplace.json'),
);
await cp(join(root, 'marketplace', 'README.md'), join(out, 'README.md'));
await cp(
  join(root, 'scripts', 'smoke-install.mjs'),
  join(out, 'scripts', 'smoke-install.mjs'),
);
await cp(join(repoRoot, 'LICENSE'), join(out, 'LICENSE'));
