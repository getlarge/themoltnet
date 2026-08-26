import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import {
  BrokeredHttpSecretBoundaryError,
  ensureSnapshot,
  execManagedCommand,
  type ManagedExecTermination,
  type ManagedVm,
  resumeVm,
} from '@themoltnet/sandbox-gondolin';

import { CleanupManifest } from './cleanup.js';
import { type PolicyFixture, startPolicyFixture } from './fixture-server.js';
import { requestedIntent } from './runner.js';
import type {
  AdapterResolution,
  BackendInventory,
  ControlEvidence,
  ControlOracle,
  EnforcementLocus,
  EvidenceBasis,
  HostCapabilityEvidence,
  PersistentMutationEvidence,
  ProbeContext,
  ReasonCode,
  ResearchSandboxAdapter,
  SandboxScenario,
  UnsupportedKind,
} from './types.js';

const BACKEND_ID = 'gondolin';
const FIXTURE_HOST = '127.0.0.1';
const FIXTURE_BIND_ADDRESS = FIXTURE_HOST;
const EFFECTIVE_FIXTURE_HOSTS = [FIXTURE_HOST];
const SECRET_ENV = 'FIXTURE_API_TOKEN';
const gondolinPackage = createRequire(import.meta.url)(
  '@earendil-works/gondolin/package.json',
) as { version?: unknown };
const GONDOLIN_VERSION =
  typeof gondolinPackage.version === 'string'
    ? gondolinPackage.version
    : 'unknown';

interface GuestResult {
  exitCode: number;
  output: string;
  termination: ManagedExecTermination;
}

interface EvidenceProvenance {
  basis: Exclude<EvidenceBasis, 'declared'>;
  attestedBy: ControlOracle['attestedBy'];
}

interface GondolinAdapterOptions {
  ensureSnapshot?: typeof ensureSnapshot;
  execManagedCommand?: typeof execManagedCommand;
  resumeVm?: typeof resumeVm;
  startPolicyFixture?: typeof startPolicyFixture;
}

const ADAPTER_PROVENANCE: EvidenceProvenance = {
  basis: 'applied',
  attestedBy: 'adapter',
};
const HARNESS_PROVENANCE: EvidenceProvenance = {
  basis: 'verified',
  attestedBy: 'harness',
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function execGondolinGuest(
  managed: ManagedVm,
  command: string,
  signal?: AbortSignal,
  execute: typeof execManagedCommand = execManagedCommand,
): Promise<GuestResult> {
  let output = '';
  const result = await execute(managed.vm, command, {
    signal,
    onData(data) {
      output += data.toString('utf8');
    },
  });
  return {
    exitCode: result.exitCode,
    output,
    termination: result.termination,
  };
}

export class GondolinAdapter implements ResearchSandboxAdapter {
  readonly #ensureSnapshot: typeof ensureSnapshot;
  readonly #execManagedCommand: typeof execManagedCommand;
  readonly #resumeVm: typeof resumeVm;
  readonly #startPolicyFixture: typeof startPolicyFixture;
  readonly #cleanup = new CleanupManifest();
  #inventory: BackendInventory | null = null;
  #checkpointPath = '';
  #managed: ManagedVm | null = null;
  #fixture: PolicyFixture | null = null;
  #initialCredential = '';
  #probeRoot = '';
  #workspace = '';
  #outside = '';
  #missingBindingVerified: boolean | null = null;
  #scenarioSignal: AbortSignal | undefined;
  #credentialDeliveryVerified = false;
  #networkDeliveryVerified = false;
  #rotatedDeliveryVerified = false;

  constructor(options: GondolinAdapterOptions = {}) {
    this.#ensureSnapshot = options.ensureSnapshot ?? ensureSnapshot;
    this.#execManagedCommand = options.execManagedCommand ?? execManagedCommand;
    this.#resumeVm = options.resumeVm ?? resumeVm;
    this.#startPolicyFixture = options.startPolicyFixture ?? startPolicyFixture;
  }

  async inspect(): Promise<BackendInventory> {
    if (!this.#inventory) {
      this.#checkpointPath = await this.#ensureSnapshot();
      this.#inventory = {
        id: BACKEND_ID,
        version: GONDOLIN_VERSION,
        runtime: 'Gondolin microVM',
        os: os.platform(),
        architecture: os.arch(),
        topology: [
          'host research harness and HTTP hooks',
          'Gondolin microVM guest',
          'host-mounted VFS workspace',
        ],
      };
    }
    return this.#inventory;
  }

  async #ensureFixture(): Promise<PolicyFixture> {
    if (!this.#fixture) {
      const fixture = await this.#startPolicyFixture(
        FIXTURE_BIND_ADDRESS,
        FIXTURE_HOST,
      );
      this.#fixture = fixture;
      this.#initialCredential = fixture.credential;
      this.#cleanup.add('fixture-server', '<loopback-fixture>', async () => {
        await this.#fixture?.close();
      });
    }
    return this.#fixture;
  }

  async #resume(): Promise<ManagedVm> {
    const fixture = await this.#ensureFixture();
    const managed = await this.#resumeVm({
      checkpointPath: this.#checkpointPath,
      agentName: 'sandbox-policy-probe',
      agentRootDir: this.#probeRoot,
      guestCredentialMode: 'host-authenticated',
      mountPath: this.#workspace,
      workspaceMode: 'scratch_mount',
      sandboxConfig: {
        network: {
          allowedInternalHosts: EFFECTIVE_FIXTURE_HOSTS,
        },
        resources: { cpus: 1, memory: '1G' },
      },
      brokeredSecrets: [
        {
          id: 'sandbox-policy-fixture',
          guestEnv: SECRET_ENV,
          hosts: [FIXTURE_HOST],
          protocol: 'http',
          ports: [fixture.allowedPort],
          value: fixture.credential,
        },
      ],
    });
    this.#managed = managed;
    return managed;
  }

  async #ensureManaged(context: ProbeContext): Promise<ManagedVm> {
    if (this.#managed) return this.#managed;
    this.#probeRoot = context.probeRoot;
    this.#workspace = path.join(context.probeRoot, 'workspace');
    this.#outside = path.join(context.probeRoot, 'outside');
    await Promise.all([
      mkdir(this.#workspace, { recursive: true }),
      mkdir(this.#outside, { recursive: true }),
    ]);
    const fixture = await this.#ensureFixture();
    await writeFile(
      path.join(this.#outside, 'credential.txt'),
      fixture.credential,
      {
        mode: 0o600,
      },
    );
    this.#cleanup.add('probe-directory', '<probe-root>', async () => {
      await rm(context.probeRoot, { recursive: true, force: true });
    });
    await this.inspect();
    const managed = await this.#resume();
    this.#cleanup.add('microvm', '<gondolin-vm>', async () => {
      await this.#managed?.vm.close();
      this.#managed = null;
    });
    return managed;
  }

  async #execGuest(managed: ManagedVm, command: string): Promise<GuestResult> {
    const result = await execGondolinGuest(
      managed,
      command,
      this.#scenarioSignal,
      this.#execManagedCommand,
    );
    if (result.termination.status === 'backend-retired') {
      if (this.#managed === managed) this.#managed = null;
    }
    if (result.termination.status === 'recovery-required') {
      try {
        await managed.vm.close();
      } finally {
        if (this.#managed === managed) this.#managed = null;
      }
      throw new Error(
        `Gondolin guest termination requires VM recovery: ${result.termination.reason}`,
      );
    }
    return result;
  }

  #resolution(
    scenario: SandboxScenario,
    effective: Record<string, unknown>,
  ): AdapterResolution {
    return {
      backendId: BACKEND_ID,
      requested: requestedIntent(scenario),
      effective,
      fidelity: 'production-resumeVm-path',
    };
  }

  async #evidence(
    scenario: SandboxScenario,
    context: ProbeContext,
    oracle: Omit<ControlOracle, 'attestedBy'>,
    effective: Record<string, unknown>,
    reasonCode: ReasonCode,
    provenance: EvidenceProvenance,
    locus: EnforcementLocus[] = ['gondolin-microvm', 'gondolin-host-hooks'],
  ): Promise<ControlEvidence> {
    const inventory = await this.inspect();
    return {
      scenarioId: scenario.id,
      requestedIntent: requestedIntent(scenario),
      resolvedAdapterConfig: this.#resolution(scenario, effective),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: locus,
      state: oracle.passed ? 'enforced' : 'failed-open',
      basis: provenance.basis,
      oracle: { ...oracle, attestedBy: provenance.attestedBy },
      reasonCode,
      recordedAt: context.recordedAt(),
      persistentMutations: this.#cleanup.snapshot(),
    };
  }

  async #unsupported(
    scenario: SandboxScenario,
    context: ProbeContext,
    reasonCode: ReasonCode,
    unsupportedKind: UnsupportedKind,
    options: {
      basis?: 'declared' | 'applied';
      effective?: Record<string, unknown>;
      locus?: EnforcementLocus[];
    } = {},
  ): Promise<ControlEvidence> {
    const inventory = await this.inspect();
    return {
      scenarioId: scenario.id,
      requestedIntent: requestedIntent(scenario),
      resolvedAdapterConfig: this.#resolution(
        scenario,
        options.effective ?? {
          support: 'unsupported-by-production-path',
        },
      ),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: options.locus ?? ['gondolin-adapter'],
      state: 'unsupported',
      unsupportedKind,
      basis: options.basis ?? 'applied',
      oracle: null,
      reasonCode,
      recordedAt: context.recordedAt(),
      persistentMutations: this.#cleanup.snapshot(),
    };
  }

  async #verifyMissingBinding(): Promise<boolean> {
    if (this.#missingBindingVerified !== null) {
      return this.#missingBindingVerified;
    }
    const fixture = await this.#ensureFixture();
    let unexpected: ManagedVm | undefined;
    try {
      unexpected = await this.#resumeVm({
        checkpointPath: this.#checkpointPath,
        agentName: 'sandbox-policy-missing-binding',
        agentRootDir: this.#probeRoot,
        guestCredentialMode: 'host-authenticated',
        mountPath: this.#workspace,
        workspaceMode: 'scratch_mount',
        sandboxConfig: {
          network: { allowedInternalHosts: [FIXTURE_HOST] },
          resources: { cpus: 1, memory: '1G' },
        },
        brokeredSecrets: [
          {
            id: 'missing-fixture',
            guestEnv: 'MISSING_FIXTURE_TOKEN',
            hosts: [FIXTURE_HOST],
            protocol: 'http',
            ports: [fixture.allowedPort],
            required: true,
          },
        ],
      });
      this.#missingBindingVerified = false;
    } catch (error) {
      this.#missingBindingVerified =
        error instanceof BrokeredHttpSecretBoundaryError &&
        error.issues.some((issue) =>
          issue.includes(
            'required binding "missing-fixture" has no resolved value',
          ),
        );
      if (!this.#missingBindingVerified) throw error;
    } finally {
      await unexpected?.vm.close();
    }
    return this.#missingBindingVerified;
  }

  async runScenario(
    scenario: SandboxScenario,
    context: ProbeContext,
  ): Promise<ControlEvidence> {
    this.#scenarioSignal = context.signal;
    const managed = await this.#ensureManaged(context);
    const fixture = await this.#ensureFixture();
    switch (scenario.id) {
      case 'filesystem.workspace-rw': {
        const marker = path.join(this.#workspace, 'guest-write.txt');
        const result = await this.#execGuest(
          managed,
          'printf ok > "$MOLTNET_GUEST_WORKSPACE/guest-write.txt"',
        );
        const observed = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'host-visible-write',
            expected: 'ok',
            observed,
            passed: result.exitCode === 0 && observed === 'ok',
          },
          { workspace: 'host VFS mount', mode: 'rw' },
          'workspace_write_observed',
          HARNESS_PROVENANCE,
        );
      }
      case 'filesystem.outside-write': {
        const marker = path.join(this.#outside, 'outside-write.txt');
        const result = await this.#execGuest(
          managed,
          `printf escaped > '${marker}'`,
        );
        const escaped = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'outside-marker-absence',
            expected: 'absent',
            observed: escaped === '' ? 'absent' : 'present',
            passed: result.exitCode !== 0 && escaped === '',
          },
          { mount: '<workspace-only>', guestExitCode: result.exitCode },
          'outside_mount_boundary_observed',
          HARNESS_PROVENANCE,
        );
      }
      case 'filesystem.read-only':
        return this.#unsupported(
          scenario,
          context,
          'readonly_secondary_mount_unsupported',
          'backend-capability',
        );
      case 'filesystem.credential-path': {
        const credentialPath = path.join(this.#outside, 'credential.txt');
        const result = await this.#execGuest(
          managed,
          `test -r '${credentialPath}'`,
        );
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'credential-file-visibility',
            expected: 'unreadable',
            observed: result.exitCode === 0 ? 'readable' : 'unreadable',
            passed: result.exitCode !== 0,
          },
          { guestCredentialMode: 'host-authenticated', hostPathMounted: false },
          'host_credential_path_absent',
          ADAPTER_PROVENANCE,
        );
      }
      case 'filesystem.symlink-traversal': {
        const link = path.join(this.#workspace, 'outside-link');
        const marker = path.join(this.#outside, 'symlink-write.txt');
        await rm(link, { force: true });
        await symlink(this.#outside, link);
        try {
          const result = await this.#execGuest(
            managed,
            'printf escaped > "$MOLTNET_GUEST_WORKSPACE/outside-link/symlink-write.txt"',
          );
          const escaped = await readFile(marker, 'utf8').catch(() => '');
          return this.#evidence(
            scenario,
            context,
            {
              kind: 'outside-marker-absence',
              expected: 'absent',
              observed: escaped === '' ? 'absent' : 'present',
              passed: result.exitCode !== 0 && escaped === '',
            },
            {
              hostSymlinkTarget: '<outside-mount>',
              guestExitCode: result.exitCode,
            },
            'vfs_symlink_boundary_observed',
            HARNESS_PROVENANCE,
            ['gondolin-host-hooks'],
          );
        } finally {
          await rm(link, { force: true });
        }
      }
      case 'filesystem.cleanup': {
        const directory = path.join(this.#workspace, 'cleanup-probe');
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'marker'), 'temporary');
        await rm(directory, { recursive: true, force: true });
        await rm(directory, { recursive: true, force: true });
        const residue = await readFile(
          path.join(directory, 'marker'),
          'utf8',
        ).catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'idempotent-scoped-cleanup',
            expected: 'absent',
            observed: residue === '' ? 'absent' : 'present',
            passed: residue === '',
          },
          { attempts: 2, scope: '<workspace>' },
          'scoped_cleanup_idempotence_observed',
          HARNESS_PROVENANCE,
          ['research-harness'],
        );
      }
      case 'network.deny-all':
        return this.#unsupported(
          scenario,
          context,
          'fixture_does_not_claim_protocol_or_dns_control',
          'fixture-limitation',
          {
            effective: {
              allowedInternalHosts: EFFECTIVE_FIXTURE_HOSTS,
              probe: 'active VM is not configured with an empty allowlist',
            },
          },
        );
      case 'network.wrong-host':
        return this.#unsupported(
          scenario,
          context,
          'fixture_does_not_claim_protocol_or_dns_control',
          'fixture-limitation',
          {
            effective: {
              allowedInternalHosts: EFFECTIVE_FIXTURE_HOSTS,
              probe: 'no second controlled local hostname',
            },
          },
        );
      case 'network.exact-allow': {
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          managed,
          `curl -sS --max-time 10 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/allowed')}'`,
        );
        const delivered = fixture.requests.length - before;
        this.#networkDeliveryVerified =
          result.exitCode === 0 && delivered === 1;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'allowed-request-count',
            expected: 1,
            observed: delivered,
            passed: this.#networkDeliveryVerified,
          },
          {
            requested: [`${FIXTURE_HOST}:<allowed-port>`],
            effectiveNetwork: EFFECTIVE_FIXTURE_HOSTS,
          },
          'exact_destination_allow_observed',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'network.wrong-port': {
        if (!this.#networkDeliveryVerified) {
          return this.#unsupported(
            scenario,
            context,
            'positive_fixture_transport_unavailable',
            'fixture-limitation',
            {
              effective: {
                fixtureHost: FIXTURE_HOST,
                probe:
                  'literal loopback remains guest-local instead of traversing host HTTP hooks',
              },
              locus: ['research-harness'],
            },
          );
        }
        const requestStart = fixture.requests.length;
        const connectionStart = fixture.connectionCount('adjacent');
        const result = await this.#execGuest(
          managed,
          `curl -fsS --max-time 3 'http://${FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/wrong-port')}'`,
        );
        const delivered = fixture.capture(requestStart).length;
        const connections =
          fixture.connectionCount('adjacent') - connectionStart;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'adjacent-port-request-count',
            expected: 0,
            observed: { requests: delivered, connections },
            passed:
              result.exitCode !== 0 && delivered === 0 && connections === 0,
          },
          {
            requested: '<exact-host-port>',
            effectiveNetwork: '<protocol-host-port>',
            guestExitCode: result.exitCode,
          },
          'exact_port_probe_observed',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'network.protocol': {
        if (!this.#networkDeliveryVerified) {
          return this.#unsupported(
            scenario,
            context,
            'positive_fixture_transport_unavailable',
            'fixture-limitation',
            {
              effective: {
                fixtureHost: FIXTURE_HOST,
                probe:
                  'literal loopback remains guest-local instead of traversing host HTTP hooks',
              },
              locus: ['research-harness'],
            },
          );
        }
        const requestStart = fixture.requests.length;
        const connectionStart = fixture.connectionCount('allowed');
        const result = await this.#execGuest(
          managed,
          `curl -kfsS --max-time 3 'https://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/wrong-protocol')}'`,
        );
        const delivered = fixture.capture(requestStart).length;
        const connections =
          fixture.connectionCount('allowed') - connectionStart;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'wrong-protocol-delivery',
            expected: { requests: 0, connections: 0 },
            observed: { requests: delivered, connections },
            passed:
              result.exitCode !== 0 && delivered === 0 && connections === 0,
          },
          {
            network: 'protocol-host-port',
            credentialProtocol: 'http',
            credentialPorts: ['<allowed-port>'],
            attemptedProtocol: 'https',
            guestExitCode: result.exitCode,
          },
          'protocol_origin_probe_observed',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'network.redirect': {
        if (!this.#networkDeliveryVerified) {
          return this.#unsupported(
            scenario,
            context,
            'positive_fixture_transport_unavailable',
            'fixture-limitation',
            {
              effective: {
                fixtureHost: FIXTURE_HOST,
                probe: 'redirect baseline did not reach the host fixture',
              },
              locus: ['research-harness'],
            },
          );
        }
        const requestStart = fixture.requests.length;
        const adjacentConnectionStart = fixture.connectionCount('adjacent');
        const result = await this.#execGuest(
          managed,
          `curl -fsS -L --max-time 3 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/redirect')}'`,
        );
        const requests = fixture.capture(requestStart);
        const allowed = requests.filter(
          (request) => request.destination === 'allowed',
        );
        const adjacent = requests.filter(
          (request) => request.destination === 'adjacent',
        );
        const adjacentConnections =
          fixture.connectionCount('adjacent') - adjacentConnectionStart;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'redirect-revalidation',
            expected: {
              allowedRequests: 1,
              adjacentRequests: 0,
              adjacentConnections: 0,
              guestExitCode: 'non-zero',
            },
            observed: {
              allowedRequests: allowed.length,
              adjacentRequests: adjacent.length,
              adjacentConnections,
              guestExitCode: result.exitCode,
            },
            passed:
              allowed.length === 1 &&
              adjacent.length === 0 &&
              adjacentConnections === 0 &&
              result.exitCode !== 0,
          },
          { redirectTarget: `${FIXTURE_HOST}:<adjacent-port>` },
          'redirect_revalidation_probe_observed',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'network.internal':
      case 'network.requested-effective':
        return this.#unsupported(
          scenario,
          context,
          'internal_hostname_binding_recorded',
          'not-measured',
          {
            basis: 'applied',
            effective: {
              requested: ['127.0.0.1:<allowed-port>'],
              effectiveNetwork: EFFECTIVE_FIXTURE_HOSTS,
              credentialPorts: ['<allowed-port>'],
              probe: 'configuration-recorded-without-independent-oracle',
            },
            locus: ['gondolin-adapter', 'gondolin-host-hooks'],
          },
        );
      case 'network.dns-rebinding':
        return this.#unsupported(
          scenario,
          context,
          'no_controlled_dns_rebinding_fixture',
          'fixture-limitation',
        );
      case 'credential.missing-binding': {
        const rejected = await this.#verifyMissingBinding();
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'required-binding-preflight',
            expected: 'rejected',
            observed: rejected ? 'rejected' : 'launched',
            passed: rejected,
          },
          { required: true, boundValue: false },
          'required_binding_preflight_observed',
          HARNESS_PROVENANCE,
          ['gondolin-adapter', 'gondolin-host-hooks'],
        );
      }
      case 'credential.allowed-origin': {
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          managed,
          `case "$${SECRET_ENV}" in GONDOLIN_SECRET_*) ;; *) exit 9;; esac; curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/credential')}'`,
        );
        const requests = fixture.capture(before);
        const matched = requests.some(
          (request) => request.credentialMatch === 'expected',
        );
        this.#credentialDeliveryVerified =
          result.exitCode === 0 && requests.length === 1 && matched;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'credential-proxy-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed: this.#credentialDeliveryVerified,
          },
          {
            guestValue: '<stand-in>',
            origin: `${FIXTURE_HOST}:<allowed-port>`,
          },
          'allowed_origin_secret_substitution_observed',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.adjacent-origin': {
        if (!this.#networkDeliveryVerified) {
          return this.#unsupported(
            scenario,
            context,
            'positive_fixture_transport_unavailable',
            'fixture-limitation',
            {
              effective: {
                fixtureHost: FIXTURE_HOST,
                probe:
                  'adjacent-origin baseline did not reach the host fixture',
              },
              locus: ['research-harness'],
            },
          );
        }
        const baselineStart = fixture.requests.length;
        const baseline = await this.#execGuest(
          managed,
          `curl -sS --max-time 10 'http://${FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/adjacent-network')}'`,
        );
        const baselineRequests = fixture
          .capture(baselineStart)
          .filter((request) => request.destination === 'adjacent');
        const credentialStart = fixture.requests.length;
        const credentialAttempt = await this.#execGuest(
          managed,
          `curl -fsS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/adjacent-credential')}'`,
        );
        const credentialRequests = fixture
          .capture(credentialStart)
          .filter((request) => request.destination === 'adjacent');
        const matched = credentialRequests.some(
          (request) => request.credentialMatch === 'expected',
        );
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'adjacent-origin-credential-match',
            expected: 0,
            observed: {
              networkBaselineRequests: baselineRequests.length,
              credentialAttemptRequests: credentialRequests.length,
              credentialMatches: matched ? 1 : 0,
            },
            passed:
              baseline.exitCode === 0 &&
              baselineRequests.length === 1 &&
              credentialAttempt.exitCode !== 0 &&
              credentialRequests.length === 0 &&
              !matched,
          },
          {
            networkAllowed: `${FIXTURE_HOST}:<adjacent-port>`,
            credentialFidelity: 'protocol-host-port',
          },
          'adjacent_origin_secret_not_substituted',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.rotation': {
        if (!this.#credentialDeliveryVerified) {
          return this.#unsupported(
            scenario,
            context,
            'positive_fixture_transport_unavailable',
            'fixture-limitation',
            {
              effective: {
                fixtureHost: FIXTURE_HOST,
                probe: 'initial credential delivery was not established',
              },
              locus: ['research-harness'],
            },
          );
        }
        const rotatedCredential = fixture.rotate();
        managed.secretManager.rotateSecret(SECRET_ENV, rotatedCredential);
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          managed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/rotated')}'`,
        );
        const requests = fixture.capture(before);
        const matched = requests.some(
          (request) => request.credentialMatch === 'expected',
        );
        this.#rotatedDeliveryVerified =
          result.exitCode === 0 && requests.length === 1 && matched;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'rotated-credential-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed: this.#rotatedDeliveryVerified,
          },
          {
            transition: 'host-manager-rotation',
            guestValue: '<same-stand-in>',
          },
          'rotated_binding_observed',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.revocation': {
        if (
          !this.#credentialDeliveryVerified ||
          !this.#rotatedDeliveryVerified
        ) {
          return this.#unsupported(
            scenario,
            context,
            'revocation_unverified_without_prior_delivery',
            'not-measured',
            {
              effective: {
                prerequisite:
                  'initial and rotated credential delivery must both pass',
              },
              locus: ['research-harness'],
            },
          );
        }
        managed.secretManager.revokeSecret(SECRET_ENV);
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          managed,
          `curl -fsS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/revoked')}'`,
        );
        const requests = fixture.capture(before);
        const matched = requests.some(
          (request) => request.credentialMatch === 'expected',
        );
        const passed =
          this.#credentialDeliveryVerified &&
          this.#rotatedDeliveryVerified &&
          result.exitCode !== 0 &&
          requests.length === 1 &&
          !matched;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'revoked-credential-match',
            expected: 0,
            observed: matched ? 1 : 0,
            passed,
          },
          { transition: 'host-manager-revocation' },
          passed
            ? 'revoked_binding_not_delivered'
            : 'revocation_unverified_without_prior_delivery',
          HARNESS_PROVENANCE,
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.resume': {
        if (!this.#credentialDeliveryVerified) {
          return this.#unsupported(
            scenario,
            context,
            'positive_fixture_transport_unavailable',
            'fixture-limitation',
            {
              effective: {
                fixtureHost: FIXTURE_HOST,
                probe: 'initial credential delivery was not established',
              },
              locus: ['research-harness'],
            },
          );
        }
        await managed.vm.close();
        this.#managed = null;
        fixture.restore(this.#initialCredential);
        const resumed = await this.#resume();
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          resumed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/resumed')}'`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'resumed-credential-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed: result.exitCode === 0 && matched,
          },
          { restart: 'checkpoint-resume', rebinding: 'required-and-explicit' },
          'explicit_rebinding_after_restart_observed',
          HARNESS_PROVENANCE,
          ['gondolin-adapter', 'gondolin-host-hooks'],
        );
      }
      case 'credential.evidence-leak':
        return this.#unsupported(
          scenario,
          context,
          'value_free_evidence_only',
          'not-measured',
          {
            basis: 'declared',
            effective: {
              persistenceValidation: 'performed-after-adapter-completion',
            },
            locus: ['research-harness'],
          },
        );
      case 'lifecycle.timeout':
      case 'lifecycle.cancel': {
        const delayedMarkerMs = scenario.parameters?.delayedMarkerMs ?? 5_000;
        const observationWindowMs =
          scenario.parameters?.observationWindowMs ?? 6_000;
        const current = this.#managed ?? managed;
        const markerName = `${scenario.id}.txt`;
        const startedName = `${scenario.id}.started`;
        const marker = path.join(this.#workspace, markerName);
        const started = path.join(this.#workspace, startedName);
        await Promise.all([
          rm(marker, { force: true }),
          rm(started, { force: true }),
        ]);
        const controller = new AbortController();
        const abortFromRunner = () => controller.abort(context.signal.reason);
        if (context.signal.aborted) abortFromRunner();
        else
          context.signal.addEventListener('abort', abortFromRunner, {
            once: true,
          });
        const process = this.#execManagedCommand(
          current.vm,
          `printf started > "$MOLTNET_GUEST_WORKSPACE/${startedName}"; setsid sh -c 'sleep ${delayedMarkerMs / 1_000}; printf escaped > "$MOLTNET_GUEST_WORKSPACE/${markerName}"' & wait`,
          scenario.id === 'lifecycle.timeout'
            ? { signal: controller.signal, timeoutMs: 1_000 }
            : { signal: controller.signal },
        );
        let acknowledged = '';
        for (let attempt = 0; attempt < 40; attempt += 1) {
          acknowledged = await readFile(started, 'utf8').catch(() => '');
          if (acknowledged === 'started') break;
          await sleep(100);
        }
        if (acknowledged !== 'started') {
          controller.abort(new Error('guest work did not acknowledge startup'));
          await process.catch(() => undefined);
          context.signal.removeEventListener('abort', abortFromRunner);
          throw new Error('guest work did not acknowledge startup');
        }
        if (scenario.id === 'lifecycle.cancel') controller.abort();
        let termination: Awaited<ReturnType<typeof execManagedCommand>>;
        try {
          termination = await process;
        } finally {
          context.signal.removeEventListener('abort', abortFromRunner);
        }
        if (termination.termination.status === 'backend-retired') {
          if (this.#managed === current) this.#managed = null;
        }
        if (termination.termination.status === 'recovery-required') {
          try {
            await current.vm.close();
          } finally {
            if (this.#managed === current) this.#managed = null;
          }
        }
        const retirementObserved =
          termination.termination.status === 'backend-retired';
        await sleep(observationWindowMs);
        const escaped = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'delayed-marker-absence',
            expected: 'absent',
            observed: escaped === '' ? 'absent' : 'present',
            passed:
              acknowledged === 'started' &&
              escaped === '' &&
              retirementObserved,
          },
          {
            termination: termination.termination,
            backendRetired: retirementObserved,
            startupAcknowledged: acknowledged === 'started',
            delayedMarkerMs,
            observationWindowMs,
          },
          'backend_retirement_observed',
          HARNESS_PROVENANCE,
          ['research-harness', 'gondolin-host-hooks', 'gondolin-microvm'],
        );
      }
      case 'lifecycle.broker-unavailable':
        return this.#unsupported(
          scenario,
          context,
          'broker_preflight_unverified',
          'not-measured',
          {
            effective: {
              missingProbe: 'controlled-broker-unavailability',
            },
          },
        );
      case 'lifecycle.partial-launch': {
        const rejected = await this.#verifyMissingBinding();
        return this.#unsupported(
          scenario,
          context,
          'partial_launch_cleanup_unverified',
          'not-measured',
          {
            basis: 'applied',
            effective: {
              preflightRejected: rejected,
              missingProbe: 'failure-after-resource-allocation',
            },
            locus: ['gondolin-adapter', 'research-harness'],
          },
        );
      }
      case 'lifecycle.repeated-close':
        return this.#unsupported(
          scenario,
          context,
          'repeated_adapter_close_unverified',
          'not-measured',
        );
      case 'lifecycle.restart-checkpoint': {
        const current = this.#managed ?? managed;
        await this.#execGuest(
          current,
          'printf disk > "$MOLTNET_GUEST_WORKSPACE/restart-disk"; printf volatile > /tmp/restart-volatile',
        );
        await current.vm.close();
        this.#managed = null;
        const resumed = await this.#resume();
        const result = await this.#execGuest(
          resumed,
          'test -f "$MOLTNET_GUEST_WORKSPACE/restart-disk" && test ! -f /tmp/restart-volatile',
        );
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'restart-storage-observation',
            expected: { workspace: 'persists', tmp: 'resets' },
            observed:
              result.exitCode === 0
                ? { workspace: 'persists', tmp: 'resets' }
                : { workspace: 'unknown', tmp: 'unknown' },
            passed: result.exitCode === 0,
          },
          {
            workspace: 'host VFS',
            tmp: 'microVM volatile',
            binding: 'explicitly rebound',
          },
          'restart_surfaces_observed',
          HARNESS_PROVENANCE,
        );
      }
      case 'resource.cpu': {
        const expectedCpuCount = scenario.parameters?.cpuCount ?? 1;
        const current = this.#managed ?? managed;
        const result = await this.#execGuest(
          current,
          'getconf _NPROCESSORS_ONLN',
        );
        const count = Number.parseInt(result.output.trim(), 10);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'online-cpu-count',
            expected: expectedCpuCount,
            observed: Number.isNaN(count) ? result.output.slice(0, 100) : count,
            passed: result.exitCode === 0 && count === expectedCpuCount,
          },
          { requestedCpus: expectedCpuCount },
          'guest_cpu_limit_observed',
          ADAPTER_PROVENANCE,
          ['gondolin-microvm'],
        );
      }
      case 'resource.memory': {
        const targetKiB = scenario.parameters?.memoryKiB ?? 1_048_576;
        const tolerancePercent = scenario.parameters?.tolerancePercent ?? 15;
        const toleranceKiB = targetKiB * (tolerancePercent / 100);
        const current = this.#managed ?? managed;
        const result = await this.#execGuest(
          current,
          "awk '/MemTotal/ { print $2 }' /proc/meminfo",
        );
        const kibibytes = Number.parseInt(result.output.trim(), 10);
        const passed =
          result.exitCode === 0 &&
          kibibytes >= targetKiB - toleranceKiB &&
          kibibytes <= targetKiB + toleranceKiB;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'guest-memory-kibibytes',
            expected: { target: targetKiB, tolerancePercent },
            observed: Number.isNaN(kibibytes)
              ? result.output.slice(0, 100)
              : kibibytes,
            passed,
          },
          { requestedMemoryKiB: targetKiB },
          'guest_memory_limit_observed',
          ADAPTER_PROVENANCE,
          ['gondolin-microvm'],
        );
      }
      case 'topology.host-capabilities':
        return this.#unsupported(
          scenario,
          context,
          'capability_boundary_recorded',
          'not-measured',
          {
            basis: 'declared',
            effective: {
              guest: ['shell', 'workspace VFS'],
              host: ['MCP', 'signing', 'credential broker', 'model traffic'],
            },
            locus: ['research-harness'],
          },
        );
      default:
        return this.#unsupported(
          scenario,
          context,
          'scenario_not_implemented_by_adapter',
          'backend-capability',
        );
    }
  }

  hostCapabilities(): Promise<HostCapabilityEvidence[]> {
    return Promise.resolve([
      {
        id: 'mcp-signing-model',
        locus: 'host',
        relationship: 'outside-containment',
        basis: 'declared',
        description:
          'MCP, signing, and model traffic remain orchestrator capabilities.',
      },
      {
        id: 'vfs-and-http-hooks',
        locus: 'control-plane',
        relationship: 'mediates-containment',
        basis: 'applied',
        description:
          'Host VFS and HTTP hooks mediate guest workspace and egress.',
      },
    ]);
  }

  sensitiveValues(): string[] {
    return this.#fixture?.sensitiveValues() ?? [];
  }

  close(): Promise<PersistentMutationEvidence[]> {
    return this.#cleanup.close();
  }
}
