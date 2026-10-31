import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(root, '..', '..');

const run = (script, args) =>
  spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
    encoding: 'utf8',
  });

const listFiles = async (directory) => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
};

// Builds into temporary directories so the test never touches dist/, which the
// Nx build target owns and may be rewriting concurrently.
const assemble = async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'legreffier-marketplace-'));
  t.after(() => rm(temporary, { force: true, recursive: true }));
  const dist = join(temporary, 'dist');
  const out = join(temporary, 'marketplace');
  const build = run('build.mjs', [dist]);
  assert.equal(build.status, 0, build.stderr);
  const marketplace = run('build-marketplace.mjs', ['--dist', dist, out]);
  assert.equal(marketplace.status, 0, marketplace.stderr);
  return { dist, out, temporary };
};

// The published layout is a contract with the hosts: Codex reads
// .agents/plugins/marketplace.json and Claude reads
// .claude-plugin/marketplace.json from the repository root that
// `plugin marketplace add getlarge/legreffier-plugin` clones.
test('assembles exactly the published marketplace layout', async (t) => {
  const { dist, out } = await assemble(t);
  const pluginFiles = (await listFiles(join(dist, 'plugins'))).map((file) =>
    join('plugins', file),
  );
  const expected = [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'LICENSE',
    'README.md',
    'scripts/smoke-install.mjs',
    ...pluginFiles,
  ].sort();
  assert.deepEqual(await listFiles(out), expected);
});

test('publishes the plugin bundle byte-for-byte from the build', async (t) => {
  const { dist, out } = await assemble(t);
  for (const file of await listFiles(join(dist, 'plugins'))) {
    assert.deepEqual(
      await readFile(join(out, 'plugins', file)),
      await readFile(join(dist, 'plugins', file)),
      `plugins/${file} differs from the build`,
    );
  }
  assert.deepEqual(
    await readFile(join(out, '.agents', 'plugins', 'marketplace.json')),
    await readFile(join(dist, 'marketplace.json')),
  );
  assert.deepEqual(
    await readFile(join(out, 'LICENSE')),
    await readFile(join(repositoryRoot, 'LICENSE')),
  );
});

test('marks the published repository as generated', async (t) => {
  const { out } = await assemble(t);
  const readme = await readFile(join(out, 'README.md'), 'utf8');
  assert.match(readme, /This repository is generated/);
  // The notice is a wrapped blockquote, so a line break carries a `> ` prefix.
  assert.match(readme, /overwritten by the next\s+(?:>\s*)?release/);
  assert.match(
    readme,
    /codex plugin marketplace add getlarge\/legreffier-plugin/,
  );
  assert.match(
    readme,
    /claude plugin marketplace add getlarge\/legreffier-plugin/,
  );
});

test('refuses to write into a non-empty directory', async (t) => {
  const { dist, temporary } = await assemble(t);
  const occupied = join(temporary, 'occupied');
  await writeFile(join(temporary, 'placeholder'), '');
  const first = run('build-marketplace.mjs', ['--dist', dist, occupied]);
  assert.equal(first.status, 0, first.stderr);
  const second = run('build-marketplace.mjs', ['--dist', dist, occupied]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /not empty/);
});
