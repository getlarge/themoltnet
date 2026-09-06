import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = join(root, '..', '..');
const hook = join(repositoryRoot, '.claude', 'hooks', 'session-start.sh');

/**
 * Runs the hook in an isolated HOME with the identity document already present,
 * so `npx` is never reached and the test exercises only the export logic.
 */
function runHook({ identity = 'legreffier', withGitconfig, withDocument = true, env = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'moltnet-hook-'));
  const project = mkdtempSync(join(tmpdir(), 'moltnet-project-'));
  // Present so the hook skips `pnpm install`.
  mkdirSync(join(project, 'node_modules'), { recursive: true });

  if (withDocument) {
    const dir = join(home, '.config', 'moltnet', 'identities', identity);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'moltnet.json'), JSON.stringify({ identity_id: 'x' }));
    if (withGitconfig) writeFileSync(join(dir, 'gitconfig'), '[user]\n');
  }

  const envFile = join(home, 'claude-env');
  writeFileSync(envFile, '');
  const result = spawnSync('/bin/sh', [hook], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CODE_REMOTE: 'true',
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_ENV_FILE: envFile,
      MOLTNET_ACTIVE_IDENTITY: identity,
      MOLTNET_IDENTITY_ID: 'identity-uuid',
      ...env,
    },
  });
  return { ...result, exported: readFileSync(envFile, 'utf8') };
}

// The active identity IS the session activation signal — the secrets guard and
// the GitHub authorship guard both key on it. An identity created by
// `moltnet register` has no gitconfig, so gating the export on Git artifacts
// left that session looking like an ordinary human shell with every agent
// protection silently disabled.
test('exports the active identity even without a gitconfig', () => {
  const { status, exported } = runHook({ withGitconfig: false });
  assert.equal(status, 0);
  assert.match(exported, /export MOLTNET_ACTIVE_IDENTITY='legreffier'/);
  assert.doesNotMatch(exported, /GIT_CONFIG_GLOBAL/);
});

test('exports the gitconfig too when the agent has one', () => {
  const { status, exported } = runHook({ withGitconfig: true });
  assert.equal(status, 0);
  assert.match(exported, /export MOLTNET_ACTIVE_IDENTITY='legreffier'/);
  assert.match(exported, /export GIT_CONFIG_GLOBAL='.*\/identities\/legreffier\/gitconfig'/);
});

// The alias becomes a path segment and is written into a file that is later
// sourced by the shell.
test('refuses hostile aliases and writes nothing', () => {
  for (const identity of ['../escape', '.hidden', '-leading', 'has space', 'a'.repeat(64)]) {
    const { status, exported } = runHook({ identity, withDocument: false });
    assert.equal(status, 1, `alias ${identity} must be refused`);
    assert.equal(exported, '', `alias ${identity} must not export anything`);
  }
});

test('does nothing outside a remote session', () => {
  const { status, exported } = runHook({
    withGitconfig: true,
    env: { CLAUDE_CODE_REMOTE: '' },
  });
  assert.equal(status, 0);
  assert.equal(exported, '');
});

// The hook runs with OAuth, signing-key and optional GitHub App secrets in its
// environment, so it must not resolve a mutable npm tag by default.
test('pins the CLI it installs rather than tracking latest', () => {
  const script = readFileSync(hook, 'utf8');
  assert.doesNotMatch(script, /@themoltnet\/cli@\$\{MOLTNET_CLI_VERSION:-latest\}/);
  assert.match(script, /@themoltnet\/cli@\$\{MOLTNET_CLI_VERSION:-\d+\.\d+\.\d+\}/);
});
