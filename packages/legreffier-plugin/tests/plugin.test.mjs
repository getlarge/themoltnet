import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(root, 'plugins', 'legreffier');

const read = (path) => readFile(join(pluginRoot, path), 'utf8');

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
  const commands = hooks.hooks.PreToolUse[0].hooks.map((hook) => hook.command);
  const secrets = commands.find((command) =>
    command.includes('moltnet secrets guard'),
  );
  assert.ok(secrets);
  assert.equal(secrets.includes('|| true'), false);
});
