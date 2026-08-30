import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'plugins', 'legreffier');
const temporary = await mkdtemp(join(tmpdir(), 'legreffier-plugin-'));
const codexHome = join(temporary, 'codex');
const claudeHome = join(temporary, 'claude');
await mkdir(codexHome, { recursive: true });
await mkdir(claudeHome, { recursive: true });
const quietEnv = {
  ...process.env,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CODEX_DISABLE_TELEMETRY: '1',
  DISABLE_TELEMETRY: '1',
};

const run = (command, args, env) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...quietEnv, ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
};

run('codex', ['plugin', 'marketplace', 'add', root, '--json'], {
  CODEX_HOME: codexHome,
});
run('codex', ['plugin', 'add', 'legreffier@moltnet', '--json'], {
  CODEX_HOME: codexHome,
});
run('claude', ['plugin', 'marketplace', 'add', root, '--scope', 'user'], {
  CLAUDE_CONFIG_DIR: claudeHome,
});
run('claude', ['plugin', 'install', 'legreffier@moltnet', '--scope', 'user'], {
  CLAUDE_CONFIG_DIR: claudeHome,
});

const digestTree = async (treeRoot) => {
  const result = new Map();
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        const hash = createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
        result.set(relative(treeRoot, path), hash);
      }
    }
  };
  await visit(treeRoot);
  return [...result].sort(([left], [right]) => left.localeCompare(right));
};

const expected = await digestTree(plugin);
const installed = [
  join(codexHome, 'plugins', 'cache', 'moltnet', 'legreffier', '0.1.0'),
  join(claudeHome, 'plugins', 'cache', 'moltnet', 'legreffier', '0.1.0'),
];

for (const installation of installed) {
  const actual = await digestTree(installation);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Installed plugin tree differs at ${installation}`);
  }
}

process.stdout.write('Codex and Claude installed identical plugin trees.\n');
