import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(root, 'plugins', 'legreffier');
const repositoryRoot = join(root, '..', '..');

const read = (path) => readFile(join(pluginRoot, path), 'utf8');

const runHook = (command, gitConfigGlobal) =>
  spawnSync('/bin/sh', ['-c', command], {
    encoding: 'utf8',
    env: {
      GIT_CONFIG_GLOBAL: gitConfigGlobal,
      PATH: '/usr/bin:/bin',
    },
  });

test('uses one version for every host manifest', async () => {
  const packageManifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  const codex = JSON.parse(await read('.codex-plugin/plugin.json'));
  const claude = JSON.parse(await read('.claude-plugin/plugin.json'));
  const claudeMarketplace = JSON.parse(
    await readFile(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'),
  );

  assert.equal(codex.version, packageManifest.version);
  assert.equal(claude.version, packageManifest.version);
  assert.equal(
    claudeMarketplace.plugins.find((plugin) => plugin.name === 'legreffier')
      ?.version,
    packageManifest.version,
  );
});

test('releases one attested artifact with atomically bumped manifests', async () => {
  const releaseConfig = JSON.parse(
    await readFile(join(repositoryRoot, 'release-please-config.json'), 'utf8'),
  );
  const releaseManifest = JSON.parse(
    await readFile(
      join(repositoryRoot, '.release-please-manifest.json'),
      'utf8',
    ),
  );
  const packageManifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  const workflow = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  const pluginRelease = releaseConfig.packages['packages/legreffier-plugin'];

  assert.equal(pluginRelease.component, 'legreffier-plugin');
  assert.equal(pluginRelease['release-type'], 'node');
  assert.deepEqual(
    pluginRelease['extra-files'].map((file) => file.path),
    [
      'plugins/legreffier/.codex-plugin/plugin.json',
      'plugins/legreffier/.claude-plugin/plugin.json',
      '.claude-plugin/marketplace.json',
    ],
  );
  assert.equal(
    releaseManifest['packages/legreffier-plugin'],
    packageManifest.version,
  );
  assert.match(workflow, /release-legreffier-plugin:/);
  assert.match(workflow, /resolve "legreffier-plugin"/);
  assert.doesNotMatch(workflow, /resolve "plugin"/);
  assert.match(workflow, /actions\/attest@v4/);
  assert.match(workflow, /sha256sum "\$ARCHIVE"/);
  assert.match(workflow, /--sort=name/);
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

  const central = runHook(
    secrets,
    '/Users/test/.config/moltnet/identities/legreffier/gitconfig',
  );
  assert.equal(central.status, 0);
  assert.match(central.stdout, /permissionDecision\"?:\"deny/);
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

  const central = runHook(
    principal,
    '/Users/test/.config/moltnet/identities/legreffier/gitconfig',
  );
  assert.equal(central.status, 0);
  assert.match(central.stdout, /permissionDecision\"?:\"deny/);
});

test('ships a complete OpenAI public-review fixture', async () => {
  const submission = JSON.parse(
    await readFile(
      join(root, 'submission', 'openai-public-plugin.json'),
      'utf8',
    ),
  );
  assert.equal(submission.authentication.type, 'oauth2');
  assert.equal(
    submission.authentication.agentCredentialsAcceptedByPublicPlugin,
    false,
  );
  assert.equal(submission.demoRecordingUrl, 'https://youtu.be/xKgHelMRDZs');
  assert.ok(submission.testCases.positive.length >= 5);
  assert.ok(submission.testCases.negative.length >= 3);
  assert.match(submission.reviewerAccess.credentialDelivery, /portal/i);
  for (const testCase of submission.testCases.positive) {
    assert.ok(testCase.expectedBehavior);
    assert.ok(testCase.expectedResultShape);
    assert.ok(testCase.expectedTools.length > 0);
    assert.ok(testCase.fixtureData.length > 0);
  }
  for (const testCase of submission.testCases.negative) {
    assert.ok(testCase.expectedBehavior);
    assert.ok(testCase.whyNotComplete);
  }
  assert.doesNotMatch(submission.listing.longDescription, /signed decisions/i);
  assert.doesNotMatch(submission.releaseNotes, /signed diary workflows/i);

  const chatgptSubmission = JSON.parse(
    execFileSync(
      process.execPath,
      [join(root, 'scripts', 'generate-openai-submission.mjs'), '--stdout'],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(
    chatgptSubmission.$schema,
    'https://developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json',
  );
  assert.equal(chatgptSubmission.schema_version, 1);
  assert.equal(chatgptSubmission.test_cases.length, 5);
  assert.equal(chatgptSubmission.negative_test_cases.length, 3);
  assert.ok(Object.keys(chatgptSubmission.tools).length > 0);
});
