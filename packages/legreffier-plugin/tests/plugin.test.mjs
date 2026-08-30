import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(root, 'plugins', 'legreffier');

const read = (path) => readFile(join(pluginRoot, path), 'utf8');

const runHook = (command, gitConfigGlobal) =>
  spawnSync('/bin/sh', ['-c', command], {
    encoding: 'utf8',
    env: {
      GIT_CONFIG_GLOBAL: gitConfigGlobal,
      PATH: '/usr/bin:/bin',
    },
  });

test('bundles all LeGreffier skills and companion references', async () => {
  const skillNames = await readdir(join(pluginRoot, 'skills'));
  assert.deepEqual(skillNames.sort(), [
    'legreffier',
    'legreffier-explore',
    'legreffier-onboarding',
  ]);

  assert.equal(
    (
      await readdir(
        join(pluginRoot, 'skills', 'legreffier-explore', 'references'),
      )
    ).length,
    2,
  );
  assert.equal(
    (
      await readdir(
        join(pluginRoot, 'skills', 'legreffier-onboarding', 'references'),
      )
    ).length,
    4,
  );
});

test('selects transport from the principal and forbids fallback', async () => {
  for (const skill of [
    'skills/legreffier/SKILL.md',
    'skills/legreffier-explore/SKILL.md',
    'skills/legreffier-onboarding/SKILL.md',
  ]) {
    const content = await read(skill);
    assert.match(content, /agent mode/i);
    assert.match(content, /human mode/i);
    assert.match(content, /Never\s+fall back/i);
  }

  const main = await read('skills/legreffier/SKILL.md');
  assert.match(main, /Select \*\*agent mode\*\*[\s\S]*`valid: true`/i);
  assert.match(main, /agent mode is CLI-only and human\s+mode is MCP-only/i);
});

test('keeps human MCP authentication free of agent credentials', async () => {
  const mcp = JSON.parse(await read('.mcp.json'));
  assert.deepEqual(mcp, {
    moltnet: {
      type: 'http',
      url: 'https://mcp.themolt.net/mcp',
    },
  });
  assert.equal(JSON.stringify(mcp).includes('X-Client-Secret'), false);
});

test('keeps the secrets hook fail-closed for activated agents', async () => {
  const hooks = JSON.parse(await read('hooks/hooks.json'));
  const groups = hooks.hooks.PreToolUse;
  const secretGroup = groups.find((group) =>
    group.hooks.some((hook) => hook.command.includes('moltnet secrets guard')),
  );
  assert.ok(secretGroup);
  assert.equal(
    secretGroup.matcher,
    'Bash|Read|Write|Edit|Grep|Glob|apply_patch',
  );

  const secrets = secretGroup.hooks[0].command;
  assert.equal(secrets.includes('|| true'), false);

  const human = runHook(secrets, '');
  assert.equal(human.status, 0);
  assert.equal(human.stdout, '');

  const agent = runHook(secrets, '.moltnet/legreffier/gitconfig');
  assert.equal(agent.status, 0);
  assert.match(agent.stdout, /permissionDecision\"?:\"deny/);
  assert.match(agent.stdout, /secret guard is unavailable/i);
});

test('blocks the human OAuth MCP for activated agents', async () => {
  const hooks = JSON.parse(await read('hooks/hooks.json'));
  const principalGroup = hooks.hooks.PreToolUse.find((group) =>
    group.matcher.includes('mcp__plugin_legreffier_moltnet__'),
  );
  assert.ok(principalGroup);
  assert.match(principalGroup.matcher, /mcp__moltnet__/);

  const principal = principalGroup.hooks[0].command;
  const human = runHook(principal, '');
  assert.equal(human.status, 0);
  assert.equal(human.stdout, '');

  const agent = runHook(principal, '/repo/.moltnet/legreffier/gitconfig');
  assert.equal(agent.status, 0);
  assert.match(agent.stdout, /permissionDecision\"?:\"deny/);
  assert.match(agent.stdout, /must use the released moltnet CLI/i);
});
