import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '../repo.js';
import {
  classifyCredentialPreflight,
  type CodexGondolinEvidence,
  compatibilityProbePassed,
  type CredentialPreflightState,
  serializeCompatibilityEvidence,
} from './contracts.js';

const ready: CredentialPreflightState = {
  binding: 'present',
  requirementMatches: true,
  resolutionBoundary: 'trusted-host',
  destinationAllowed: true,
  providerAvailable: true,
  providerRead: 'succeeded',
  valueFound: true,
  delivery: 'succeeded',
};

const evidence: CodexGondolinEvidence = {
  schemaVersion: 2,
  probe: 'codex-gondolin-compatibility',
  sourceRevision: '0123456789012345678901234567890123456789',
  host: { os: 'darwin', architecture: 'arm64', codexVersion: '0.149.0' },
  guest: { os: 'linux', architecture: 'arm64', codexVersion: '0.149.0' },
  gondolinVersion: '0.12.0',
  codexPackage: {
    specifier: '@openai/codex@0.149.0-linux-arm64',
    integrity: 'sha512-fixture',
  },
  model: 'gpt-5.6-luna',
  transport: {
    environmentStatusBeforeConnect: 'pending',
    environmentStatusAfterConnect: 'ready',
    relayConnectionCount: 1,
  },
  execution: {
    commandStarted: true,
    commandCompleted: true,
    commandExitCode: 0,
    turnCompleted: true,
    guestOsMarker: 'Linux',
    guestExecutorMarker: 'guest-exec-server',
  },
  hostCredentialCapability: {
    credentialPreflight: 'ready',
    authenticatedHostCall: true,
    authenticatedAgentSubject: true,
    authenticatedIdentityMatched: true,
    gitCommitSignatureVerified: true,
    allowedOperations: [
      'agent-signing/sign-git-commit',
      'host-auth-check/whoami',
    ],
    deniedOperations: ['agent-signing/sign-diary-entry'],
  },
  isolation: {
    hostOnlySentinelProjected: false,
    credentialShapedEnvironmentNames: [],
    hostSigningKeyProjected: false,
    guestPrivateKeyFiles: 0,
    guestCredentialFiles: 0,
    delayedMarkerAfterVmClose: false,
  },
  cleanupComplete: true,
  limitations: ['No credential-delivery claim.'],
};

describe('classifyCredentialPreflight', () => {
  it.each([
    [{ binding: 'missing' }, 'required_binding_missing'],
    [{ ...ready, requirementMatches: false }, 'binding_requirement_mismatch'],
    [
      { ...ready, resolutionBoundary: 'sandbox-guest' },
      'resolution_boundary_denied',
    ],
    [{ ...ready, destinationAllowed: false }, 'destination_denied'],
    [{ ...ready, providerAvailable: false }, 'provider_unavailable'],
    [{ ...ready, providerRead: 'failed' }, 'host_store_inaccessible'],
    [{ ...ready, valueFound: false }, 'binding_absent'],
    [{ ...ready, delivery: 'failed' }, 'delivery_failed'],
    [ready, 'ready'],
  ] as const)('classifies %j as %s', (state, expected) => {
    expect(classifyCredentialPreflight(state)).toBe(expected);
  });

  it('does not invent an outcome when a required observation is absent', () => {
    expect(() => classifyCredentialPreflight({ binding: 'present' })).toThrow(
      'requirementMatches',
    );
  });
});

describe('compatibility evidence', () => {
  it('accepts the complete boundary proof', () => {
    expect(compatibilityProbePassed(evidence)).toBe(true);
    expect(JSON.parse(serializeCompatibilityEvidence(evidence, []))).toEqual(
      evidence,
    );
  });

  it('rejects forbidden identifiers and secret values', () => {
    expect(() =>
      serializeCompatibilityEvidence(
        { ...evidence, threadId: 'opaque' } as CodexGondolinEvidence,
        [],
      ),
    ).toThrow('forbidden evidence field threadId');
    expect(() =>
      serializeCompatibilityEvidence(
        {
          ...evidence,
          limitations: ['synthetic-secret-value'],
        },
        ['synthetic-secret-value'],
      ),
    ).toThrow('synthetic credential sentinel');
  });

  it('fails when a host-only value or detached process crosses the boundary', () => {
    expect(
      compatibilityProbePassed({
        ...evidence,
        isolation: {
          ...evidence.isolation,
          hostOnlySentinelProjected: true,
          hostSigningKeyProjected: true,
          delayedMarkerAfterVmClose: true,
        },
      }),
    ).toBe(false);
  });

  it('fails when the host capability is unavailable or over-granted', () => {
    expect(
      compatibilityProbePassed({
        ...evidence,
        hostCredentialCapability: {
          ...evidence.hostCredentialCapability,
          credentialPreflight: 'host_store_inaccessible',
          deniedOperations: [],
        },
      }),
    ).toBe(false);
  });

  it('keeps the retained live evidence passing and canonical', async () => {
    const evidencePath = path.join(
      await resolveRepoRoot(),
      'tools/test-fixtures/codex-environment/observed/codex-0.149.0-gondolin-0.12.0-darwin-arm64.json',
    );
    const persisted = await readFile(evidencePath, 'utf8');
    const observed = JSON.parse(persisted) as CodexGondolinEvidence;

    expect(compatibilityProbePassed(observed)).toBe(true);
    expect(serializeCompatibilityEvidence(observed, [])).toBe(persisted);
  });
});
