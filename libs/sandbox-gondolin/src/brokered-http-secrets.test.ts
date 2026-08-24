import { describe, expect, it } from 'vitest';

import {
  BrokeredHttpSecretBoundaryError,
  canonicalizeBrokeredHttpSecretDescriptor,
  createBrokeredHttpNetworkOriginPolicy,
  prepareBrokeredHttpSecrets,
} from './vm-manager.js';

describe('brokered HTTP secret preflight', () => {
  it('defaults the attested origin to HTTPS on port 443', () => {
    expect(
      canonicalizeBrokeredHttpSecretDescriptor({
        id: 'example-api',
        guestEnv: 'EXAMPLE_API_TOKEN',
        hosts: ['api.example.com'],
      }),
    ).toEqual({
      id: 'example-api',
      guestEnv: 'EXAMPLE_API_TOKEN',
      hosts: ['api.example.com'],
      protocol: 'https',
      ports: [443],
      required: true,
    });
  });

  it('accepts an explicit narrow HTTP fixture origin', () => {
    expect(
      canonicalizeBrokeredHttpSecretDescriptor({
        id: 'fixture-api',
        guestEnv: 'FIXTURE_API_TOKEN',
        hosts: ['fixture.internal'],
        protocol: 'http',
        ports: [18_080],
      }),
    ).toEqual(expect.objectContaining({ protocol: 'http', ports: [18_080] }));
  });

  it.each([
    { protocol: 'ftp', ports: [443], expected: /invalid protocol/ },
    { protocol: 'https', ports: [], expected: /no destination ports/ },
    { protocol: 'https', ports: [0], expected: /invalid port/ },
    { protocol: 'https', ports: [65_536], expected: /invalid port/ },
    { protocol: 'https', ports: [443.5], expected: /invalid port/ },
  ])(
    'rejects an invalid attested origin %#',
    ({ protocol, ports, expected }) => {
      expect(() =>
        canonicalizeBrokeredHttpSecretDescriptor({
          id: 'example-api',
          guestEnv: 'EXAMPLE_API_TOKEN',
          hosts: ['api.example.com'],
          protocol: protocol as 'https',
          ports,
        }),
      ).toThrow(expected);
    },
  );

  it('materializes an exact destination below a broader network wildcard', () => {
    const secrets = prepareBrokeredHttpSecrets({
      allowedHosts: ['*.example.com'],
      bindings: [
        {
          id: 'example-api',
          guestEnv: 'EXAMPLE_API_TOKEN',
          hosts: ['api.example.com'],
          value: 'host-only-value',
        },
      ],
    });

    expect(secrets).toEqual({
      EXAMPLE_API_TOKEN: {
        hosts: ['api.example.com'],
        value: 'host-only-value',
      },
    });
    expect(Object.getPrototypeOf(secrets)).toBeNull();
  });

  it('canonicalizes the attested and enforced destination set', () => {
    const secrets = prepareBrokeredHttpSecrets({
      allowedHosts: ['*.example.com'],
      bindings: [
        {
          id: 'example-api',
          guestEnv: 'EXAMPLE_API_TOKEN',
          hosts: [' API.EXAMPLE.COM ', 'api.example.com'],
          value: 'host-only-value',
        },
      ],
    });

    expect(secrets.EXAMPLE_API_TOKEN?.hosts).toEqual(['api.example.com']);
  });

  it.each([
    {
      label: 'an exact destination',
      allowedHosts: ['api.example.com'],
      secretHost: 'api.example.com',
    },
    {
      label: 'an exact wildcard grant',
      allowedHosts: ['*.example.com'],
      secretHost: '*.example.com',
    },
    {
      label: 'an exact destination below a broader wildcard',
      allowedHosts: ['*.example.com'],
      secretHost: 'api.example.com',
    },
    {
      label: 'an explicit global grant',
      allowedHosts: ['*'],
      secretHost: '*',
    },
  ])('accepts $label', ({ allowedHosts, secretHost }) => {
    expect(() =>
      prepareBrokeredHttpSecrets({
        allowedHosts,
        bindings: [
          {
            id: 'example-api',
            guestEnv: 'EXAMPLE_API_TOKEN',
            hosts: [secretHost],
            value: 'host-only-value',
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each<[string, string[], string]>([
    ['a broader credential wildcard', ['api.example.com'], '*.example.com'],
    ['an ambiguous wildcard', ['api.*'], '*.example.com'],
    ['an implicit global credential grant', ['*.example.com'], '*'],
    ['a URL', ['api.example.com'], 'https://api.example.com'],
    ['a port', ['api.example.com'], 'api.example.com:443'],
    ['a path', ['api.example.com'], 'api.example.com/path'],
    ['internal whitespace', ['api.example.com'], 'api .example.com'],
  ])('rejects %s', (_label, allowedHosts, secretHost) => {
    expect(() =>
      prepareBrokeredHttpSecrets({
        allowedHosts,
        bindings: [
          {
            id: 'example-api',
            guestEnv: 'EXAMPLE_API_TOKEN',
            hosts: [secretHost],
            value: 'host-only-value',
          },
        ],
      }),
    ).toThrow();
  });

  it('fails closed when a credential destination exceeds network policy', () => {
    const sentinel = 'must-never-appear-in-errors';

    expect(() =>
      prepareBrokeredHttpSecrets({
        allowedHosts: ['api.example.com'],
        bindings: [
          {
            id: 'other-api',
            guestEnv: 'OTHER_API_TOKEN',
            hosts: ['other.example.com'],
            value: sentinel,
          },
        ],
      }),
    ).toThrow(/outside the effective network policy/);

    try {
      prepareBrokeredHttpSecrets({
        allowedHosts: ['api.example.com'],
        bindings: [
          {
            id: 'other-api',
            guestEnv: 'OTHER_API_TOKEN',
            hosts: ['other.example.com'],
            value: sentinel,
          },
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(BrokeredHttpSecretBoundaryError);
      expect(String(error)).not.toContain(sentinel);
    }
  });

  it('rejects missing required values and omits missing optional bindings', () => {
    expect(() =>
      prepareBrokeredHttpSecrets({
        allowedHosts: ['api.example.com'],
        bindings: [
          {
            id: 'required-api',
            guestEnv: 'REQUIRED_API_TOKEN',
            hosts: ['api.example.com'],
          },
        ],
      }),
    ).toThrow(/required binding "required-api" has no resolved value/);

    expect(
      prepareBrokeredHttpSecrets({
        allowedHosts: ['api.example.com'],
        bindings: [
          {
            id: 'optional-api',
            guestEnv: 'OPTIONAL_API_TOKEN',
            hosts: ['api.example.com'],
            required: false,
          },
        ],
      }),
    ).toEqual({});
  });

  it.each([
    {
      label: 'duplicate requirement ids',
      bindings: [
        {
          id: 'same-api',
          guestEnv: 'FIRST_TOKEN',
          hosts: ['api.example.com'],
          value: 'one',
        },
        {
          id: 'same-api',
          guestEnv: 'SECOND_TOKEN',
          hosts: ['api.example.com'],
          value: 'two',
        },
      ],
      expected: /duplicate requirement id/,
    },
    {
      label: 'duplicate guest environment names',
      bindings: [
        {
          id: 'first-api',
          guestEnv: 'SHARED_TOKEN',
          hosts: ['api.example.com'],
          value: 'one',
        },
        {
          id: 'second-api',
          guestEnv: 'SHARED_TOKEN',
          hosts: ['api.example.com'],
          value: 'two',
        },
      ],
      expected: /duplicate guest env/,
    },
    {
      label: 'reserved environment names',
      bindings: [
        {
          id: 'moltnet-api',
          guestEnv: 'MOLTNET_PRIVATE_KEY',
          hosts: ['api.example.com'],
          value: 'one',
        },
      ],
      expected: /reserved guest env/,
    },
    {
      label: 'object meta-property environment names',
      bindings: [
        {
          id: 'prototype-api',
          guestEnv: '__proto__',
          hosts: ['api.example.com'],
          value: 'one',
        },
      ],
      expected: /reserved guest env/,
    },
  ])('rejects $label', ({ bindings, expected }) => {
    expect(() =>
      prepareBrokeredHttpSecrets({
        allowedHosts: ['api.example.com'],
        bindings,
      }),
    ).toThrow(expected);
  });

  it('rejects collisions with every other guest environment source', () => {
    expect(() =>
      prepareBrokeredHttpSecrets({
        allowedHosts: ['api.example.com'],
        occupiedGuestEnvNames: ['API_TOKEN'],
        bindings: [
          {
            id: 'example-api',
            guestEnv: 'API_TOKEN',
            hosts: ['api.example.com'],
            value: 'host-only-value',
          },
        ],
      }),
    ).toThrow(/already supplied by another source/);
  });
});

describe('brokered HTTP network origin policy', () => {
  const policy = createBrokeredHttpNetworkOriginPolicy([
    {
      id: 'fixture-api',
      guestEnv: 'FIXTURE_API_TOKEN',
      hosts: ['fixture.internal'],
      protocol: 'http',
      ports: [18_080],
    },
    {
      id: 'loopback-api',
      guestEnv: 'LOOPBACK_API_TOKEN',
      hosts: ['127.0.0.1'],
      protocol: 'https',
    },
  ]);

  it('allows the attested protocol, hostname, and port', () => {
    expect(
      policy.isRequestAllowed(
        new Request('http://fixture.internal:18080/resource'),
      ),
    ).toBe(true);
    expect(
      policy.isIpAllowed({
        hostname: 'fixture.internal',
        ip: '127.0.0.1',
        family: 4,
        protocol: 'http',
        port: 18_080,
      }),
    ).toBe(true);
  });

  it('denies adjacent ports and protocol changes for a protected host', () => {
    expect(
      policy.isRequestAllowed(
        new Request('http://fixture.internal:18081/resource'),
      ),
    ).toBe(false);
    expect(
      policy.isRequestAllowed(
        new Request('https://fixture.internal:18080/resource'),
      ),
    ).toBe(false);
  });

  it('normalizes default ports and enforces direct IP literals', () => {
    expect(
      policy.isRequestAllowed(new Request('https://127.0.0.1/resource')),
    ).toBe(true);
    expect(
      policy.isRequestAllowed(new Request('http://127.0.0.1/resource')),
    ).toBe(false);
    expect(
      policy.isIpAllowed({
        hostname: '127.0.0.1',
        ip: '127.0.0.1',
        family: 4,
        protocol: 'https',
        port: 443,
      }),
    ).toBe(true);
  });

  it('leaves unrelated hosts to the outer Gondolin hostname policy', () => {
    expect(
      policy.isRequestAllowed(new Request('https://api.example.com/resource')),
    ).toBe(true);
  });
});
