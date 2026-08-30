import { describe, expect, it } from 'vitest';

import { parseCredentialRequirements } from '../src/credential-requirements.js';

describe('parseCredentialRequirements', () => {
  it('parses a minimal brokered-http bearer requirement with an exact destination', () => {
    // Arrange
    const input = [
      {
        name: 'github-app',
        kind: 'http-bearer',
        projection: 'brokered-http',
        guestEnv: 'GH_TOKEN',
        destinations: [
          { protocol: 'https', host: 'api.github.com', port: 443 },
        ],
      },
    ];

    // Act
    const requirements = parseCredentialRequirements(input);

    // Assert
    expect(requirements).toEqual([
      {
        name: 'github-app',
        kind: 'http-bearer',
        projection: 'brokered-http',
        guestEnv: 'GH_TOKEN',
        destinations: [
          { protocol: 'https', host: 'api.github.com', port: 443 },
        ],
        required: true,
      },
    ]);
  });
});

describe('parseCredentialRequirements — portability boundary', () => {
  it('rejects a requirement carrying a secret-like field', () => {
    // Arrange
    const input = [
      {
        name: 'npm-publish',
        kind: 'http-bearer',
        projection: 'brokered-http',
        destinations: [
          { protocol: 'https', host: 'registry.npmjs.org', port: 443 },
        ],
        value: 'npm_s3cr3t',
      },
    ];

    // Act + Assert
    expect(() => parseCredentialRequirements(input)).toThrow();
  });
});

describe('parseCredentialRequirements — exact destinations', () => {
  const base = {
    name: 'github-app',
    kind: 'http-bearer',
    projection: 'brokered-http',
  };

  it('rejects a wildcard destination host', () => {
    const input = [
      {
        ...base,
        destinations: [{ protocol: 'https', host: '*.github.com', port: 443 }],
      },
    ];

    expect(() => parseCredentialRequirements(input)).toThrow();
  });

  it('rejects a non-canonical (uppercase) destination host', () => {
    const input = [
      {
        ...base,
        destinations: [
          { protocol: 'https', host: 'API.GitHub.com', port: 443 },
        ],
      },
    ];

    expect(() => parseCredentialRequirements(input)).toThrow();
  });
});

describe('parseCredentialRequirements — guest projection rules', () => {
  const dest = [{ protocol: 'https', host: 'api.github.com', port: 443 }];

  it('rejects a brokered-http requirement without a guestEnv placeholder', () => {
    const input = [
      {
        name: 'github-app',
        kind: 'http-bearer',
        projection: 'brokered-http',
        destinations: dest,
      },
    ];

    expect(() => parseCredentialRequirements(input)).toThrow();
  });

  it('rejects a reserved MOLTNET_* guestEnv name', () => {
    const input = [
      {
        name: 'github-app',
        kind: 'http-bearer',
        projection: 'brokered-http',
        guestEnv: 'MOLTNET_CLIENT_SECRET',
        destinations: dest,
      },
    ];

    expect(() => parseCredentialRequirements(input)).toThrow();
  });

  it('rejects a host-tool requirement that names a guestEnv', () => {
    const input = [
      {
        name: 'github-app',
        kind: 'http-bearer',
        projection: 'host-tool',
        guestEnv: 'GH_TOKEN',
        destinations: dest,
      },
    ];

    expect(() => parseCredentialRequirements(input)).toThrow();
  });

  it('accepts a brokered-http requirement with a guestEnv placeholder', () => {
    const input = [
      {
        name: 'github-app',
        kind: 'http-bearer',
        projection: 'brokered-http',
        guestEnv: 'GH_TOKEN',
        destinations: dest,
      },
    ];

    const [requirement] = parseCredentialRequirements(input);

    expect(requirement.guestEnv).toBe('GH_TOKEN');
  });
});

describe('parseCredentialRequirements — lifecycle intent', () => {
  const base = {
    name: 'github-app',
    kind: 'http-bearer',
    projection: 'brokered-http',
    guestEnv: 'GH_TOKEN',
    destinations: [{ protocol: 'https', host: 'api.github.com', port: 443 }],
  };

  it('accepts bounded lifecycle intent', () => {
    const input = [
      { ...base, lifecycle: { maxTtlSec: 3600, refreshBeforeSec: 300 } },
    ];

    const [requirement] = parseCredentialRequirements(input);

    expect(requirement.lifecycle).toEqual({
      maxTtlSec: 3600,
      refreshBeforeSec: 300,
    });
  });

  it('rejects a refresh window that is not shorter than the ttl', () => {
    const input = [
      { ...base, lifecycle: { maxTtlSec: 300, refreshBeforeSec: 300 } },
    ];

    expect(() => parseCredentialRequirements(input)).toThrow();
  });
});

describe('parseCredentialRequirements — uniqueness', () => {
  const dest = [{ protocol: 'https', host: 'api.github.com', port: 443 }];

  it('rejects duplicate requirement names', () => {
    expect(() =>
      parseCredentialRequirements([
        {
          name: 'github-app',
          kind: 'http-bearer',
          projection: 'host-tool',
          destinations: dest,
        },
        {
          name: 'github-app',
          kind: 'http-basic',
          projection: 'host-tool',
          destinations: dest,
        },
      ]),
    ).toThrow(/duplicate/i);
  });

  it('rejects duplicate brokered guestEnv names', () => {
    expect(() =>
      parseCredentialRequirements([
        {
          name: 'a',
          kind: 'http-bearer',
          projection: 'brokered-http',
          guestEnv: 'TOKEN',
          destinations: dest,
        },
        {
          name: 'b',
          kind: 'http-basic',
          projection: 'brokered-http',
          guestEnv: 'TOKEN',
          destinations: dest,
        },
      ]),
    ).toThrow(/duplicate/i);
  });
});
