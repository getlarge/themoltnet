import { describe, expect, it } from 'vitest';

import {
  BrokeredHttpSecretBoundaryError,
  prepareBrokeredHttpSecrets,
} from './vm-manager.js';

describe('brokered HTTP secret preflight', () => {
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
