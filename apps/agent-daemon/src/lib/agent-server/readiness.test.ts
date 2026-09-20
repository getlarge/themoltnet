import { describe, expect, it } from 'vitest';

import { deriveProfileReadiness } from './readiness.js';

/** A profile shaped like the catalogue entry the desktop renders. */
const profile = {
  name: 'opus-review',
  runtimeKind: 'gondolin_pi',
  requiredEnv: ['ANTHROPIC_API_KEY'],
  requiredTools: [] as string[],
  requiredExecutables: [] as string[],
};

const machine = {
  /** envName -> whether an API key is configured for it on this machine. */
  providerEnv: new Map([['ANTHROPIC_API_KEY', true]]),
  runtimeKinds: new Set(['gondolin_pi']),
};

describe('deriveProfileReadiness', () => {
  it('reports ready when the machine satisfies every requirement', () => {
    // Act
    const result = deriveProfileReadiness(profile, machine);

    // Assert
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('blocks on an env var no configured provider supplies', () => {
    // Arrange
    const withoutKey = {
      ...machine,
      providerEnv: new Map<string, boolean>(),
    };

    // Act
    const result = deriveProfileReadiness(profile, withoutKey);

    // Assert
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]?.code).toBe('env_missing');
    expect(result.blockers[0]?.message).toContain('ANTHROPIC_API_KEY');
  });

  it('blocks when the provider exists but holds no API key', () => {
    // A configured provider with no key is the common half-done case, and it
    // must not read as ready.
    const keyless = {
      ...machine,
      providerEnv: new Map([['ANTHROPIC_API_KEY', false]]),
    };

    const result = deriveProfileReadiness(profile, keyless);

    expect(result.ready).toBe(false);
    expect(result.blockers[0]?.code).toBe('env_missing');
  });

  it('blocks when the runtime kind is not registered on this machine', () => {
    // Arrange
    const custom = { ...profile, runtimeKind: 'acme_runtime' };

    // Act
    const result = deriveProfileReadiness(custom, machine);

    // Assert
    expect(result.ready).toBe(false);
    expect(result.blockers[0]?.code).toBe('runtime_unregistered');
    expect(result.blockers[0]?.message).toContain('acme_runtime');
  });

  it('reports every blocker rather than stopping at the first', () => {
    // The desktop shows the whole list, so a profile missing two things
    // should not send the user round the loop twice.
    const custom = {
      ...profile,
      runtimeKind: 'acme_runtime',
      requiredEnv: ['ANTHROPIC_API_KEY', 'ACME_TOKEN'],
    };
    const bare = {
      providerEnv: new Map<string, boolean>(),
      runtimeKinds: new Set<string>(),
    };

    const result = deriveProfileReadiness(custom, bare);

    expect(result.blockers.map((blocker) => blocker.code).sort()).toEqual([
      'env_missing',
      'env_missing',
      'runtime_unregistered',
    ]);
  });

  it('carries a remedy the desktop can act on', () => {
    // Arrange
    const bare = {
      ...machine,
      providerEnv: new Map<string, boolean>(),
    };

    // Act
    const result = deriveProfileReadiness(profile, bare);

    // Assert
    expect(result.blockers[0]?.remedy).toBeTruthy();
    // Names the surface that fixes it, not the product hosting it: Providers
    // moves from Console to Desktop (#2273 step 3) and this text should survive.
    expect(result.blockers[0]?.remedy).toMatch(/Providers/u);
  });

  it('treats a profile with no requirements as ready', () => {
    // Arrange
    const trivial = {
      name: 'nightly-digest',
      runtimeKind: 'gondolin_pi',
      requiredEnv: [],
      requiredTools: [],
      requiredExecutables: [],
    };

    // Act / Assert
    expect(deriveProfileReadiness(trivial, machine).ready).toBe(true);
  });
});

describe('prerequisites beyond provider keys', () => {
  it('blocks on a required executable the runtime does not provide', () => {
    // Arrange: the reviewer's point — fixtures with empty requirements could
    // never catch this, so the requirement is non-empty here.
    const needsGit = { ...profile, requiredExecutables: ['git'] };

    // Act
    const result = deriveProfileReadiness(needsGit, {
      ...machine,
      inventory: { tools: [], executables: [] },
    });

    // Assert
    expect(result.ready).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      'executable_missing',
    );
    expect(result.blockers.some((b) => b.message.includes('git'))).toBe(true);
  });

  it('blocks on a required tool the runtime does not provide', () => {
    // Arrange
    const needsTool = {
      ...profile,
      requiredTools: ['moltnet.entries.create'],
    };

    // Act
    const result = deriveProfileReadiness(needsTool, {
      ...machine,
      inventory: { tools: [], executables: [] },
    });

    // Assert
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      'tool_missing',
    );
  });

  it('reports several missing prerequisites of different kinds at once', () => {
    // Arrange
    const demanding = {
      ...profile,
      requiredEnv: ['ANTHROPIC_API_KEY', 'ACME_TOKEN'],
      requiredTools: ['some.tool'],
      requiredExecutables: ['git', 'jq'],
    };

    // Act
    const result = deriveProfileReadiness(demanding, {
      providerEnv: new Map(),
      runtimeKinds: new Set(['gondolin_pi']),
      inventory: { tools: [], executables: [] },
    });

    // Assert: one trip, not five.
    const codes = result.blockers.map((blocker) => blocker.code).sort();
    expect(codes).toEqual([
      'env_missing',
      'env_missing',
      'executable_missing',
      'executable_missing',
      'tool_missing',
    ]);
  });

  it('is satisfied when the runtime provides what the profile requires', () => {
    // Arrange
    const needsGit = { ...profile, requiredExecutables: ['git'] };

    // Act
    const result = deriveProfileReadiness(needsGit, {
      ...machine,
      inventory: { tools: [], executables: ['git'] },
    });

    // Assert
    expect(result.ready).toBe(true);
  });

  it('does not claim tools are missing when the inventory is unknown', () => {
    // Without a prepared runtime the server cannot know what the adapter
    // provides. Reporting "missing" would be a guess, and a guess that blocks
    // a runnable profile is worse than saying nothing.
    const needsGit = { ...profile, requiredExecutables: ['git'] };

    const result = deriveProfileReadiness(needsGit, machine);

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});
