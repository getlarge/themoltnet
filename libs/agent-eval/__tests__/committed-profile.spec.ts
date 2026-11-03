import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertRuntimePolicyBody,
  CommittedProfileError,
  loadCommittedRuntimeProfile,
  readCommittedRuntimeProfile,
  readRuntimePolicyBindings,
  RUNTIME_POLICIES_DIR,
  RUNTIME_PROFILES_DIR,
} from '../src/index.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

function definitionNames(dir: string): string[] {
  return readdirSync(join(repoRoot, dir))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
}

/** Policy → profiles, as documented in the runtime-policies README table. */
function readmeBindings(): Map<string, string[]> {
  const readme = readFileSync(
    join(repoRoot, RUNTIME_POLICIES_DIR, 'README.md'),
    'utf8',
  );
  const rows = new Map<string, string[]>();
  for (const line of readme.split('\n')) {
    const match = /^\| \[`([^`]+)\.json`\]\([^)]*\)\s*\|(.*)\|\s*$/.exec(line);
    if (!match) continue;
    const profiles = [...match[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    rows.set(match[1], profiles.sort());
  }
  return rows;
}

describe('committed runtime definitions', () => {
  const profiles = definitionNames(RUNTIME_PROFILES_DIR);
  const policies = definitionNames(RUNTIME_POLICIES_DIR);
  const bindings = readRuntimePolicyBindings(repoRoot);

  it.each(profiles)(
    '%s is a valid create body and its bound policies resolve',
    (name) => {
      // Act
      const definitions = readCommittedRuntimeProfile(repoRoot, name);

      // Assert
      expect(definitions.profile.name).toBe(name);
      expect(definitions.policies.map((policy) => policy.name)).toEqual(
        bindings[name] ?? [],
      );
    },
  );

  it.each(policies)('%s is a valid policy create body', (name) => {
    // Arrange
    const value: unknown = JSON.parse(
      readFileSync(
        join(repoRoot, RUNTIME_POLICIES_DIR, `${name}.json`),
        'utf8',
      ),
    );

    // Act + Assert
    expect(() => assertRuntimePolicyBody(value, name)).not.toThrow();
    expect((value as { name: string }).name).toBe(name);
  });

  it('binds only committed profiles and leaves no policy unbound', () => {
    // Arrange
    const bound = new Set(Object.values(bindings).flat());

    // Assert
    expect(Object.keys(bindings).filter((p) => !profiles.includes(p))).toEqual(
      [],
    );
    expect(policies.filter((p) => !bound.has(p))).toEqual([]);
  });

  it('matches the profile table in the runtime-policies README', () => {
    // Arrange
    const expected = new Map<string, string[]>();
    for (const [profile, names] of Object.entries(bindings)) {
      for (const policy of names) {
        expected.set(policy, [...(expected.get(policy) ?? []), profile]);
      }
    }
    for (const list of expected.values()) list.sort();

    // Assert
    expect(Object.fromEntries(readmeBindings())).toEqual(
      Object.fromEntries(expected),
    );
  });
});

describe('loadCommittedRuntimeProfile', () => {
  const name = 'legreffier-adaptive-focused-review-v1';

  it('overrides only the e2e fields and keeps the behaviour under test', () => {
    // Arrange
    const committed = readCommittedRuntimeProfile(repoRoot, name);

    // Act
    const loaded = loadCommittedRuntimeProfile(repoRoot, name, {
      nameSuffix: 'eval-1',
      generation: { provider: 'ollama', model: 'qwen3:8b' },
      requiredEnv: [],
      sandboxEnv: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
      sandboxResources: { cpus: 2, memory: '2G' },
    });

    // Assert
    expect(loaded.profile.name).toBe(`${name}-eval-1`);
    expect(loaded.policies.map((p) => p.name)).toEqual([
      'legreffier-adaptive-focused-readonly-v1-eval-1',
    ]);
    expect(loaded.policies[0].tools).toEqual(committed.policies[0].tools);
    expect(loaded.profile.models.generation).toEqual({
      ...committed.profile.models.generation,
      provider: 'ollama',
      model: 'qwen3:8b',
    });
    expect(loaded.profile.sandbox.env).toEqual({
      ...committed.profile.sandbox.env,
      NODE_OPTIONS: '--dns-result-order=ipv4first',
    });
    const {
      name: _n,
      models: _m,
      sandbox,
      requiredEnv: _r,
      ...rest
    } = loaded.profile;
    const {
      name: _cn,
      models: _cm,
      sandbox: committedSandbox,
      requiredEnv: _cr,
      ...committedRest
    } = committed.profile;
    expect(rest).toEqual(committedRest);
    expect(sandbox.vfs).toEqual(committedSandbox.vfs);
    expect(sandbox.network).toEqual(committedSandbox.network);
  });

  it('does not mutate the committed definition it read', () => {
    // Arrange
    const before = readCommittedRuntimeProfile(repoRoot, name);

    // Act
    loadCommittedRuntimeProfile(repoRoot, name, {
      nameSuffix: 'x',
      sandboxEnv: { A: 'b' },
    });

    // Assert
    expect(readCommittedRuntimeProfile(repoRoot, name)).toEqual(before);
  });

  it.each([
    [
      'host-only diary configuration in the guest env',
      { nameSuffix: 'x', sandboxEnv: { ADAPTIVE_REVIEW_DIARY_IDS: '["d"]' } },
      /host configuration/,
    ],
    ['a suffix outside the name pattern', { nameSuffix: 'a:b' }, /nameSuffix/],
    [
      'a suffix that makes the name too long',
      { nameSuffix: 'x'.repeat(80) },
      /not a valid runtime profile/,
    ],
  ])('rejects %s', (_label, overrides, message) => {
    // Act + Assert
    expect(() =>
      loadCommittedRuntimeProfile(repoRoot, name, overrides),
    ).toThrow(message);
  });

  it('rejects a generation override on a classification-only profile', () => {
    // Act + Assert
    expect(() =>
      loadCommittedRuntimeProfile(repoRoot, 'legreffier-issue-classifier-v2', {
        nameSuffix: 'x',
        generation: { provider: 'ollama', model: 'm' },
      }),
    ).toThrow(/no generation model/);
  });
});

describe('readCommittedRuntimeProfile on malformed definitions', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function fixture(
    profile: Record<string, unknown>,
    bindings: Record<string, string[]>,
  ): string {
    root = mkdtempSync(join(tmpdir(), 'committed-profile-'));
    mkdirSync(join(root, RUNTIME_PROFILES_DIR), { recursive: true });
    mkdirSync(join(root, RUNTIME_POLICIES_DIR), { recursive: true });
    writeFileSync(
      join(root, RUNTIME_PROFILES_DIR, 'p.json'),
      JSON.stringify(profile),
    );
    writeFileSync(
      join(root, '.github/runtime-policy-bindings.json'),
      JSON.stringify(bindings),
    );
    return root;
  }

  const valid = {
    name: 'p',
    models: { generation: { provider: 'ollama', model: 'm' } },
    sandbox: {},
  };

  it('rejects a file whose name differs from its declared name', () => {
    // Arrange
    const dir = fixture({ ...valid, name: 'other' }, {});

    // Act + Assert
    expect(() => readCommittedRuntimeProfile(dir, 'p')).toThrow(
      /file name and name must match/,
    );
  });

  it('rejects the legacy flat model shape', () => {
    // Arrange
    const { models: _models, ...flat } = valid;
    const dir = fixture({ ...flat, provider: 'ollama', model: 'm' }, {});

    // Act + Assert
    expect(() => readCommittedRuntimeProfile(dir, 'p')).toThrow(
      CommittedProfileError,
    );
  });

  it('rejects an enforcing profile with no bound policy', () => {
    // Arrange
    const dir = fixture({ ...valid, toolEnforcement: 'enforce' }, {});

    // Act + Assert
    expect(() => readCommittedRuntimeProfile(dir, 'p')).toThrow(
      /enforces tool policy but has no entry/,
    );
  });

  it('rejects a binding to a missing policy file', () => {
    // Arrange
    const dir = fixture(valid, { p: ['missing'] });

    // Act + Assert
    expect(() => readCommittedRuntimeProfile(dir, 'p')).toThrow(
      /Cannot read .*missing\.json/,
    );
  });
});
