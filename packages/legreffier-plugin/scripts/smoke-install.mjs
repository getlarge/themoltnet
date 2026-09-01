import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
  process.stdout.write(`Checking ${command} ${args.join(' ')}...\n`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...quietEnv, ...env },
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
};

const assertIncludes = (output, expected, label) => {
  if (!output.includes(expected)) {
    throw new Error(`${label} did not include ${JSON.stringify(expected)}`);
  }
};

try {
  run('codex', ['plugin', 'marketplace', 'add', root, '--json'], {
    CODEX_HOME: codexHome,
  });
  run('codex', ['plugin', 'add', 'legreffier@moltnet', '--json'], {
    CODEX_HOME: codexHome,
  });
  run('claude', ['plugin', 'marketplace', 'add', root, '--scope', 'user'], {
    CLAUDE_CONFIG_DIR: claudeHome,
  });
  run(
    'claude',
    ['plugin', 'install', 'legreffier@moltnet', '--scope', 'user'],
    {
      CLAUDE_CONFIG_DIR: claudeHome,
    },
  );

  const codexPlugins = run('codex', ['plugin', 'list', '--json'], {
    CODEX_HOME: codexHome,
  });
  assertIncludes(codexPlugins, 'legreffier@moltnet', 'Codex plugin discovery');
  assertIncludes(codexPlugins, '"enabled": true', 'Codex plugin enablement');
  const codexMcp = run('codex', ['mcp', 'list', '--json'], {
    CODEX_HOME: codexHome,
  });
  assertIncludes(codexMcp, 'moltnet', 'Codex MCP discovery');
  const codexPrompt = run(
    'codex',
    ['debug', 'prompt-input', 'Use LeGreffier'],
    {
      CODEX_HOME: codexHome,
    },
  );
  assertIncludes(codexPrompt, 'legreffier:legreffier', 'Codex skill discovery');

  const claudePlugins = run('claude', ['plugin', 'list', '--json'], {
    CLAUDE_CONFIG_DIR: claudeHome,
  });
  assertIncludes(
    claudePlugins,
    'legreffier@moltnet',
    'Claude plugin discovery',
  );
  const claudeDetails = run(
    'claude',
    ['plugin', 'details', 'legreffier@moltnet'],
    { CLAUDE_CONFIG_DIR: claudeHome },
  );
  for (const component of ['Skills (3)', 'Hooks (1)', 'MCP servers (1)']) {
    assertIncludes(claudeDetails, component, 'Claude component discovery');
  }

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
  const manifest = JSON.parse(
    await readFile(join(plugin, '.codex-plugin', 'plugin.json'), 'utf8'),
  );
  const installed = [
    join(
      codexHome,
      'plugins',
      'cache',
      'moltnet',
      'legreffier',
      manifest.version,
    ),
    join(
      claudeHome,
      'plugins',
      'cache',
      'moltnet',
      'legreffier',
      manifest.version,
    ),
  ];

  for (const installation of installed) {
    const actual = await digestTree(installation);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Installed plugin tree differs at ${installation}`);
    }
  }

  process.stdout.write('Codex and Claude installed identical plugin trees.\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
