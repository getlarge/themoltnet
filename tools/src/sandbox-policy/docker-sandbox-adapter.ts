import {
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CleanupManifest } from './cleanup.js';
import {
  type CommandExecutor,
  type CommandResult,
  executeCommand,
} from './command.js';
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

const BACKEND_ID = 'docker-sandbox';
const PLACEHOLDER = 'moltnet-probe-placeholder';
const HOST_ALIAS = 'host.docker.internal';
// Force loopback requests through Docker's outbound proxy. Direct loopback is
// guest-local, while the proxy resolves this exact IP on the trusted host.
const CREDENTIAL_HOST = '127.0.0.1';
const FORCE_PROXY = "--noproxy ''";

interface DockerSandboxAdapterOptions {
  execute?: CommandExecutor;
}

interface SecretApplication {
  changed: boolean;
  result: CommandResult;
}

interface EvidenceProvenance {
  basis: Exclude<EvidenceBasis, 'declared'>;
  attestedBy: ControlOracle['attestedBy'];
}

const ADAPTER_PROVENANCE: EvidenceProvenance = {
  basis: 'applied',
  attestedBy: 'adapter',
};
const HARNESS_PROVENANCE: EvidenceProvenance = {
  basis: 'verified',
  attestedBy: 'harness',
};

function resultSummary(result: CommandResult): Record<string, unknown> {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.trim().slice(0, 200),
    stderr: result.stderr.trim().slice(0, 200),
  };
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class DockerSandboxAdapter implements ResearchSandboxAdapter {
  readonly #execute: CommandExecutor;
  readonly #cleanup = new CleanupManifest();
  #inventory: BackendInventory | null = null;
  #fixture: PolicyFixture | null = null;
  #sandboxName = '';
  #guestRoot = '';
  #readonlyRoot = '';
  #outsideRoot = '';
  #secretFile = '';
  #created = false;
  #networkAllowApplied = false;
  #credentialNetworkAllowApplied = false;
  #adjacentCredentialNetworkAllowApplied = false;
  #secretApplied = false;
  #secretCleanupRegistered = false;
  #scenarioSignal: AbortSignal | undefined;
  #credentialDeliveryVerified = false;
  #rotatedDeliveryVerified = false;

  constructor(options: DockerSandboxAdapterOptions = {}) {
    this.#execute = options.execute ?? executeCommand;
  }

  async inspect(): Promise<BackendInventory> {
    if (this.#inventory) return this.#inventory;
    const version = await this.#execute('sbx', ['version']);
    if (version.exitCode !== 0) {
      throw new Error(`Docker Sandbox unavailable: ${version.stderr}`);
    }
    const match = /v\d+\.\d+\.\d+/.exec(version.stdout);
    this.#inventory = {
      id: BACKEND_ID,
      version: match?.[0] ?? 'unknown',
      runtime: 'Docker Desktop Sandbox',
      os: os.platform(),
      architecture: os.arch(),
      topology: [
        'host research harness',
        'sbx control plane and credential proxy',
        'sandbox container guest',
      ],
    };
    return this.#inventory;
  }

  async #ensureCreated(context: ProbeContext): Promise<void> {
    if (this.#created) return;
    const fixture = await this.#ensureFixture();
    this.#sandboxName = `moltnet-1972-${context.runId}`
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '-')
      .slice(0, 48);
    this.#guestRoot = path.join(context.probeRoot, 'workspace');
    this.#readonlyRoot = path.join(context.probeRoot, 'readonly');
    this.#outsideRoot = path.join(context.probeRoot, 'outside');
    this.#secretFile = path.join(this.#outsideRoot, 'credential.txt');
    this.#cleanup.add('probe-directory', '<probe-root>', async () => {
      await rm(context.probeRoot, { recursive: true, force: true });
    });
    await Promise.all([
      mkdir(this.#guestRoot, { recursive: true }),
      mkdir(this.#readonlyRoot, { recursive: true }),
      mkdir(this.#outsideRoot, { recursive: true }),
    ]);
    await writeFile(
      path.join(this.#readonlyRoot, 'fixture.txt'),
      'immutable\n',
    );
    await writeFile(this.#secretFile, `${fixture.credential}\n`, {
      mode: 0o600,
    });
    await chmod(this.#secretFile, 0o600);
    const create = await this.#executeScenario([
      'create',
      'shell',
      '--quiet',
      '--name',
      this.#sandboxName,
      '--cpus',
      '1',
      '--memory',
      '1g',
      '--env',
      `MOLTNET_PROBE_TOKEN=${PLACEHOLDER}`,
      this.#guestRoot,
      `${this.#readonlyRoot}:ro`,
    ]);
    if (create.exitCode !== 0) {
      throw new Error(`sbx create failed: ${create.stderr}`);
    }
    this.#created = true;
    this.#cleanup.add('sandbox', '<scoped-sandbox>', async () => {
      const removed = await this.#execute('sbx', [
        'rm',
        '--force',
        this.#sandboxName,
      ]);
      if (removed.exitCode !== 0 && !/not found/i.test(removed.stderr)) {
        throw new Error(removed.stderr);
      }
    });
  }

  async #executeScenario(
    args: string[],
    timeoutMs = 30_000,
  ): Promise<CommandResult> {
    return this.#execute('sbx', args, {
      signal: this.#scenarioSignal,
      timeoutMs,
    });
  }

  async #exec(args: string[], timeoutMs = 30_000): Promise<CommandResult> {
    return this.#executeScenario(
      ['exec', this.#sandboxName, ...args],
      timeoutMs,
    );
  }

  #resolution(
    scenario: SandboxScenario,
    effective: Record<string, unknown>,
  ): AdapterResolution {
    return {
      backendId: BACKEND_ID,
      requested: requestedIntent(scenario),
      effective,
      fidelity: `docker-sandbox-${this.#inventory?.version ?? 'unknown'}`,
    };
  }

  async #evidence(
    scenario: SandboxScenario,
    context: ProbeContext,
    oracle: Omit<ControlOracle, 'attestedBy'>,
    effective: Record<string, unknown>,
    reasonCode: ReasonCode,
    provenance: EvidenceProvenance,
    locus: EnforcementLocus[] = [
      'docker-sandbox-guest',
      'docker-sandbox-control-plane',
    ],
  ): Promise<ControlEvidence> {
    const inventory = await this.inspect();
    return {
      scenarioId: scenario.id,
      requestedIntent: requestedIntent(scenario),
      resolvedAdapterConfig: this.#resolution(scenario, effective),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: locus,
      state: oracle?.passed ? 'enforced' : 'failed-open',
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
      basis?: EvidenceBasis;
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
        options.effective ?? { support: 'unsupported-by-safe-probe' },
      ),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: options.locus ?? ['docker-sandbox-adapter'],
      state: 'unsupported',
      unsupportedKind,
      basis: options.basis ?? 'applied',
      oracle: null,
      reasonCode,
      recordedAt: context.recordedAt(),
      persistentMutations: this.#cleanup.snapshot(),
    };
  }

  async #ensureFixture(): Promise<PolicyFixture> {
    if (!this.#fixture) {
      this.#fixture = await startPolicyFixture('127.0.0.1', HOST_ALIAS);
      this.#cleanup.add('fixture-server', '<loopback-fixture>', async () => {
        await this.#fixture?.close();
      });
    }
    return this.#fixture;
  }

  async #ensureNetworkAllow(fixture: PolicyFixture): Promise<CommandResult> {
    if (this.#networkAllowApplied) {
      return { exitCode: 0, stdout: 'already applied', stderr: '' };
    }
    const result = await this.#executeScenario([
      'policy',
      'allow',
      'network',
      '--sandbox',
      this.#sandboxName,
      `localhost:${fixture.allowedPort}`,
    ]);
    if (result.exitCode === 0) {
      this.#networkAllowApplied = true;
      this.#cleanup.add('network-policy', '<scoped-network-rule>', async () => {
        const removed = await this.#execute('sbx', [
          'policy',
          'rm',
          'network',
          '--sandbox',
          this.#sandboxName,
          '--resource',
          `localhost:${fixture.allowedPort}`,
        ]);
        if (removed.exitCode !== 0 && !/not found/i.test(removed.stderr)) {
          throw new Error(removed.stderr);
        }
      });
    }
    return result;
  }

  async #ensureCredentialNetworkAllow(
    fixture: PolicyFixture,
  ): Promise<CommandResult> {
    if (this.#credentialNetworkAllowApplied) {
      return { exitCode: 0, stdout: 'already applied', stderr: '' };
    }
    const resource = `${CREDENTIAL_HOST}:${fixture.allowedPort}`;
    const result = await this.#allowNetworkResource(
      resource,
      '<credential-origin>',
    );
    if (result.exitCode === 0) this.#credentialNetworkAllowApplied = true;
    return result;
  }

  async #ensureAdjacentCredentialNetworkAllow(
    fixture: PolicyFixture,
  ): Promise<CommandResult> {
    if (this.#adjacentCredentialNetworkAllowApplied) {
      return { exitCode: 0, stdout: 'already applied', stderr: '' };
    }
    const resource = `${CREDENTIAL_HOST}:${fixture.adjacentPort}`;
    const result = await this.#allowNetworkResource(
      resource,
      '<adjacent-credential-origin>',
    );
    if (result.exitCode === 0) {
      this.#adjacentCredentialNetworkAllowApplied = true;
    }
    return result;
  }

  async #allowNetworkResource(
    resource: string,
    cleanupResource: string,
  ): Promise<CommandResult> {
    const result = await this.#executeScenario([
      'policy',
      'allow',
      'network',
      '--sandbox',
      this.#sandboxName,
      resource,
    ]);
    if (result.exitCode === 0) {
      this.#cleanup.add('network-policy', cleanupResource, async () => {
        const removed = await this.#execute('sbx', [
          'policy',
          'rm',
          'network',
          '--sandbox',
          this.#sandboxName,
          '--resource',
          resource,
        ]);
        if (removed.exitCode !== 0 && !/not found/i.test(removed.stderr)) {
          throw new Error(removed.stderr);
        }
      });
    }
    return result;
  }

  async #ensureSecret(): Promise<SecretApplication> {
    if (this.#secretApplied) {
      return {
        changed: false,
        result: { exitCode: 0, stdout: 'already applied', stderr: '' },
      };
    }
    const fixture = await this.#ensureFixture();
    return this.#applySecret(fixture.credential);
  }

  async #applySecret(value: string): Promise<SecretApplication> {
    await writeFile(this.#secretFile, `${value}\n`, { mode: 0o600 });
    const result = await this.#executeScenario([
      'secret',
      'set-custom',
      '--sandbox',
      this.#sandboxName,
      '--host',
      CREDENTIAL_HOST,
      '--env',
      'MOLTNET_PROBE_TOKEN',
      '--placeholder',
      PLACEHOLDER,
      '--command',
      `cat '${this.#secretFile}'`,
    ]);
    if (result.exitCode === 0) {
      this.#secretApplied = true;
      if (!this.#secretCleanupRegistered) {
        this.#secretCleanupRegistered = true;
        this.#cleanup.add(
          'credential-binding',
          '<scoped-placeholder>',
          async () => {
            const removed = await this.#execute('sbx', [
              'secret',
              'rm',
              '--sandbox',
              this.#sandboxName,
              '--placeholder',
              PLACEHOLDER,
              '--force',
            ]);
            if (removed.exitCode !== 0 && !/not found/i.test(removed.stderr)) {
              throw new Error(removed.stderr);
            }
          },
        );
      }
    }
    return { changed: result.exitCode === 0, result };
  }

  async runScenario(
    scenario: SandboxScenario,
    context: ProbeContext,
  ): Promise<ControlEvidence> {
    this.#scenarioSignal = context.signal;
    await this.#ensureCreated(context);
    switch (scenario.id) {
      case 'filesystem.workspace-rw': {
        const marker = path.join(this.#guestRoot, 'guest-write.txt');
        const result = await this.#exec([
          'sh',
          '-lc',
          `printf ok > '${marker}'`,
        ]);
        const observed = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'host-visible-write',
            expected: 'ok',
            observed: result.exitCode === 0 ? observed : resultSummary(result),
            passed: result.exitCode === 0 && observed === 'ok',
          },
          { mounts: [{ mode: 'rw', path: '<workspace>' }] },
          'workspace_write_observed',
          HARNESS_PROVENANCE,
        );
      }
      case 'filesystem.read-only': {
        const fixture = path.join(this.#readonlyRoot, 'fixture.txt');
        const result = await this.#exec([
          'sh',
          '-lc',
          `printf changed > '${fixture}'`,
        ]);
        const observed = await readFile(fixture, 'utf8');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'read-only-mutation',
            expected: 'immutable\n',
            observed: {
              guestExitCode: result.exitCode,
              hostContents: observed,
            },
            passed: result.exitCode !== 0 && observed === 'immutable\n',
          },
          { mounts: [{ mode: 'ro', path: '<readonly-fixture>' }] },
          'readonly_mount_observed',
          HARNESS_PROVENANCE,
        );
      }
      case 'filesystem.outside-write':
      case 'filesystem.symlink-traversal': {
        const outsideMarker = path.join(
          this.#outsideRoot,
          `${scenario.id}.txt`,
        );
        const link = path.join(this.#guestRoot, 'outside-link');
        await rm(link, { force: true });
        await symlink(this.#outsideRoot, link);
        try {
          const result = await this.#exec([
            'sh',
            '-lc',
            `printf escaped > '${path.join(link, path.basename(outsideMarker))}'`,
          ]);
          const escaped = await readFile(outsideMarker, 'utf8').catch(() => '');
          return this.#evidence(
            scenario,
            context,
            {
              kind: 'outside-marker-absence',
              expected: 'absent',
              observed: escaped === '' ? 'absent' : 'present',
              passed: escaped === '',
            },
            {
              mounts: ['<workspace>', '<readonly-fixture>'],
              guestExitCode: result.exitCode,
            },
            'outside_mount_boundary_observed',
            HARNESS_PROVENANCE,
          );
        } finally {
          await rm(link, { force: true });
        }
      }
      case 'filesystem.credential-path': {
        const link = path.join(this.#guestRoot, 'outside-link');
        await rm(link, { force: true });
        await symlink(this.#outsideRoot, link);
        try {
          const result = await this.#exec([
            'sh',
            '-lc',
            `test -r '${this.#secretFile}' || test -r '${path.join(link, 'credential.txt')}'`,
          ]);
          return this.#evidence(
            scenario,
            context,
            {
              kind: 'credential-file-visibility',
              expected: 'unreadable',
              observed: result.exitCode === 0 ? 'readable' : 'unreadable',
              passed: result.exitCode !== 0,
            },
            { secretPathMounted: false, symlinkPathTested: true },
            'host_credential_path_absent',
            ADAPTER_PROVENANCE,
          );
        } finally {
          await rm(link, { force: true });
        }
      }
      case 'filesystem.cleanup': {
        const cleanupRoot = path.join(this.#guestRoot, 'cleanup-probe');
        await mkdir(cleanupRoot, { recursive: true });
        await writeFile(path.join(cleanupRoot, 'marker'), 'temporary');
        await rm(cleanupRoot, { recursive: true, force: true });
        await rm(cleanupRoot, { recursive: true, force: true });
        const residue = await readFile(
          path.join(cleanupRoot, 'marker'),
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
          { scope: '<probe-workspace>', attempts: 2 },
          'scoped_cleanup_idempotence_observed',
          HARNESS_PROVENANCE,
          ['research-harness'],
        );
      }
      case 'network.deny-all': {
        const fixture = await this.#ensureFixture();
        const before = fixture.requests.length;
        const result = await this.#exec(
          [
            'sh',
            '-lc',
            `curl -fsS --max-time 2 'http://${HOST_ALIAS}:${fixture.adjacentPort}${fixture.path('/deny')}'`,
          ],
          5_000,
        );
        const delivered = fixture
          .capture(before)
          .filter((request) => request.destination === 'adjacent').length;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'unlisted-request-count',
            expected: 0,
            observed: delivered,
            passed: result.exitCode !== 0 && delivered === 0,
          },
          { defaultNetwork: 'deny', guestExitCode: result.exitCode },
          'unlisted_destination_blocked',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'network.exact-allow': {
        const fixture = await this.#ensureFixture();
        const policy = await this.#ensureNetworkAllow(fixture);
        const before = fixture.requests.length;
        const result = await this.#exec([
          'sh',
          '-lc',
          `curl -sS --max-time 3 'http://${HOST_ALIAS}:${fixture.allowedPort}${fixture.path('/allowed')}'`,
        ]);
        const delivered = fixture.requests.length - before;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'allowed-request-count',
            expected: 1,
            observed: delivered,
            passed:
              policy.exitCode === 0 && result.exitCode === 0 && delivered === 1,
          },
          {
            requested: ['localhost:<allowed-port>'],
            effective: [`${HOST_ALIAS}:<allowed-port>`],
            policy: {
              resource: 'localhost:<allowed-port>',
              exitCode: policy.exitCode,
            },
          },
          'exact_destination_allow_observed',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'network.wrong-host': {
        const fixture = await this.#ensureFixture();
        const policy = await this.#ensureNetworkAllow(fixture);
        const before = fixture.requests.length;
        const result = await this.#exec(
          [
            'sh',
            '-lc',
            `curl ${FORCE_PROXY} -fsS --max-time 2 'http://${CREDENTIAL_HOST}:${fixture.allowedPort}${fixture.path('/wrong-host')}'`,
          ],
          5_000,
        );
        const delivered = fixture.capture(before).length;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'wrong-host-request-count',
            expected: 0,
            observed: delivered,
            passed:
              policy.exitCode === 0 && result.exitCode !== 0 && delivered === 0,
          },
          {
            allowed: `${HOST_ALIAS}:<allowed-port>`,
            attempted: `${CREDENTIAL_HOST}:<allowed-port>`,
          },
          'unlisted_hostname_blocked',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'network.wrong-port': {
        const fixture = await this.#ensureFixture();
        const policy = await this.#ensureNetworkAllow(fixture);
        const before = fixture.requests.length;
        const result = await this.#exec(
          [
            'sh',
            '-lc',
            `curl -fsS --max-time 2 'http://${HOST_ALIAS}:${fixture.adjacentPort}${fixture.path('/wrong-port')}'`,
          ],
          5_000,
        );
        const delivered = fixture.capture(before).length;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'wrong-port-request-count',
            expected: 0,
            observed: delivered,
            passed:
              policy.exitCode === 0 && result.exitCode !== 0 && delivered === 0,
          },
          {
            allowed: `${HOST_ALIAS}:<allowed-port>`,
            attempted: `${HOST_ALIAS}:<adjacent-port>`,
          },
          'exact_port_probe_observed',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'network.redirect': {
        const fixture = await this.#ensureFixture();
        const policy = await this.#ensureNetworkAllow(fixture);
        const before = fixture.requests.length;
        const result = await this.#exec([
          'sh',
          '-lc',
          `curl -fsS -L --max-time 3 -H 'Authorization: Bearer ${PLACEHOLDER}' 'http://${HOST_ALIAS}:${fixture.allowedPort}${fixture.path('/redirect')}'`,
        ]);
        const requests = fixture.capture(before);
        const allowed = requests.filter(
          (request) => request.destination === 'allowed',
        );
        const adjacent = requests.filter(
          (request) => request.destination === 'adjacent',
        );
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'redirect-adjacent-delivery',
            expected: {
              allowedRequests: 1,
              adjacentRequests: 0,
              guestExitCode: 'non-zero',
            },
            observed: {
              allowedRequests: allowed.length,
              adjacentRequests: adjacent.length,
              guestExitCode: result.exitCode,
            },
            passed:
              policy.exitCode === 0 &&
              allowed.length === 1 &&
              adjacent.length === 0 &&
              result.exitCode !== 0,
          },
          { followRedirects: true, guestExitCode: result.exitCode },
          'redirect_revalidation_probe_observed',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'network.internal':
      case 'network.requested-effective': {
        await this.#ensureFixture();
        return this.#unsupported(
          scenario,
          context,
          'host_gateway_binding_recorded',
          'not-measured',
          {
            basis: 'declared',
            effective: {
              requested: [`127.0.0.1:<allowed-port>`],
              effective: [`${HOST_ALIAS}:<allowed-port>`],
              binding: 'host-gateway-mediated',
            },
            locus: ['docker-sandbox-adapter'],
          },
        );
      }
      case 'network.protocol':
      case 'network.dns-rebinding':
        return this.#unsupported(
          scenario,
          context,
          'fixture_does_not_claim_protocol_or_dns_control',
          'fixture-limitation',
        );
      case 'credential.missing-binding':
        return this.#unsupported(
          scenario,
          context,
          'required_binding_preflight_unverified',
          'not-measured',
          {
            basis: 'declared',
            effective: {
              binding: 'required',
              probe: 'no independent launch-attempt oracle',
            },
            locus: ['research-harness'],
          },
        );
      case 'credential.allowed-origin': {
        const fixture = await this.#ensureFixture();
        const policy = await this.#ensureCredentialNetworkAllow(fixture);
        const secret = await this.#ensureSecret();
        const before = fixture.requests.length;
        const result = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${CREDENTIAL_HOST}:${fixture.allowedPort}${fixture.path('/credential')}'`,
        ]);
        const requests = fixture.capture(before);
        const matched = requests.some(
          (request) => request.credentialMatch === 'expected',
        );
        this.#credentialDeliveryVerified =
          policy.exitCode === 0 &&
          secret.result.exitCode === 0 &&
          result.exitCode === 0 &&
          matched;
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
            binding: `${CREDENTIAL_HOST}:<allowed-port>`,
            secretCommandExitCode: secret.result.exitCode,
            secretSource: 'host-command',
          },
          'allowed_origin_secret_substitution_observed',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'credential.adjacent-origin': {
        const fixture = await this.#ensureFixture();
        const allowedPolicy = await this.#ensureCredentialNetworkAllow(fixture);
        const adjacentPolicy =
          await this.#ensureAdjacentCredentialNetworkAllow(fixture);
        const secret = await this.#ensureSecret();
        const before = fixture.requests.length;
        const result = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${CREDENTIAL_HOST}:${fixture.adjacentPort}${fixture.path('/adjacent-credential')}'`,
        ]);
        const requests = fixture.capture(before);
        const adjacentRequests = requests.filter(
          (request) => request.destination === 'adjacent',
        );
        const matched = adjacentRequests.some(
          (request) => request.credentialMatch === 'expected',
        );
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'adjacent-origin-credential-match',
            expected: 0,
            observed: matched ? 1 : 0,
            passed:
              allowedPolicy.exitCode === 0 &&
              adjacentPolicy.exitCode === 0 &&
              secret.result.exitCode === 0 &&
              result.exitCode === 0 &&
              adjacentRequests.length === 1 &&
              !matched,
          },
          {
            credentialBinding: `${CREDENTIAL_HOST}:<any-port>`,
            networkAllowed: `${CREDENTIAL_HOST}:<adjacent-port>`,
          },
          'adjacent_origin_secret_not_substituted',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'credential.rotation': {
        const fixture = await this.#ensureFixture();
        const rotatedCredential = fixture.rotate();
        const update = await this.#applySecret(rotatedCredential);
        const before = fixture.requests.length;
        const request = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${CREDENTIAL_HOST}:${fixture.allowedPort}${fixture.path('/rotated')}'`,
        ]);
        const matched = fixture
          .capture(before)
          .some((item) => item.credentialMatch === 'expected');
        this.#rotatedDeliveryVerified =
          update.changed &&
          update.result.exitCode === 0 &&
          request.exitCode === 0 &&
          matched;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'rotated-credential-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed: this.#rotatedDeliveryVerified,
          },
          { transition: 'replace-scoped-binding', guestValue: '<stand-in>' },
          'rotated_binding_observed',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'credential.revocation': {
        const fixture = await this.#ensureFixture();
        const removed = await this.#executeScenario([
          'secret',
          'rm',
          '--sandbox',
          this.#sandboxName,
          '--placeholder',
          PLACEHOLDER,
          '--force',
        ]);
        if (removed.exitCode === 0) this.#secretApplied = false;
        const before = fixture.requests.length;
        await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H 'Authorization: Bearer ${PLACEHOLDER}' 'http://${CREDENTIAL_HOST}:${fixture.allowedPort}${fixture.path('/revoked')}'`,
        ]);
        const requests = fixture.capture(before);
        const matched = requests.some(
          (item) => item.credentialMatch === 'expected',
        );
        const passed =
          this.#credentialDeliveryVerified &&
          this.#rotatedDeliveryVerified &&
          removed.exitCode === 0 &&
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
          { transition: 'remove-scoped-binding' },
          passed
            ? 'revoked_binding_not_delivered'
            : 'revocation_unverified_without_prior_delivery',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'credential.resume': {
        const fixture = await this.#ensureFixture();
        const rebound = await this.#ensureSecret();
        const stopped = await this.#executeScenario([
          'stop',
          this.#sandboxName,
        ]);
        const before = fixture.requests.length;
        const request = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${CREDENTIAL_HOST}:${fixture.allowedPort}${fixture.path('/resumed')}'`,
        ]);
        const matched = fixture
          .capture(before)
          .some((item) => item.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'resumed-credential-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed:
              rebound.changed &&
              rebound.result.exitCode === 0 &&
              stopped.exitCode === 0 &&
              request.exitCode === 0 &&
              matched,
          },
          { restart: 'stop-and-auto-start', rebinding: 'explicit' },
          'explicit_rebinding_after_restart_observed',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'credential.evidence-leak':
        return this.#unsupported(
          scenario,
          context,
          'evidence_persistence_validation_deferred',
          'not-measured',
          {
            basis: 'declared',
            effective: {
              persistenceValidation: 'performed after adapter completion',
            },
            locus: ['research-harness'],
          },
        );
      case 'lifecycle.timeout':
      case 'lifecycle.cancel': {
        const delayedMarkerMs = scenario.parameters?.delayedMarkerMs ?? 5_000;
        const observationWindowMs =
          scenario.parameters?.observationWindowMs ?? 6_000;
        const childName = `${this.#sandboxName}-${scenario.id.split('.')[1]}`;
        const marker = path.join(this.#guestRoot, `${scenario.id}.txt`);
        const started = path.join(this.#guestRoot, `${scenario.id}.started`);
        await rm(marker, { force: true });
        await rm(started, { force: true });
        const created = await this.#executeScenario([
          'create',
          'shell',
          '--quiet',
          '--name',
          childName,
          this.#guestRoot,
        ]);
        if (created.exitCode !== 0) {
          throw new Error(`child sandbox create failed: ${created.stderr}`);
        }
        this.#cleanup.add('sandbox', '<scoped-lifecycle-sandbox>', async () => {
          const cleanup = await this.#execute('sbx', [
            'rm',
            '--force',
            childName,
          ]);
          if (cleanup.exitCode !== 0 && !/not found/i.test(cleanup.stderr)) {
            throw new Error(cleanup.stderr);
          }
        });
        const detached = await this.#executeScenario([
          'exec',
          '--detach',
          childName,
          'sh',
          '-lc',
          `printf started > '${started}'; sleep ${delayedMarkerMs / 1_000}; printf escaped > '${marker}'`,
        ]);
        if (detached.exitCode !== 0) {
          throw new Error(`detached child launch failed: ${detached.stderr}`);
        }
        let acknowledged = '';
        for (let attempt = 0; attempt < 20; attempt += 1) {
          acknowledged = await readFile(started, 'utf8').catch(() => '');
          if (acknowledged === 'started') break;
          await sleep(100, this.#scenarioSignal);
        }
        if (acknowledged !== 'started') {
          throw new Error('detached child did not acknowledge startup');
        }
        const removed = await this.#executeScenario([
          'rm',
          '--force',
          childName,
        ]);
        await sleep(observationWindowMs, this.#scenarioSignal);
        const observed = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'delayed-marker-absence',
            expected: 'absent',
            observed: observed === '' ? 'absent' : 'present',
            passed:
              created.exitCode === 0 &&
              detached.exitCode === 0 &&
              acknowledged === 'started' &&
              removed.exitCode === 0 &&
              observed === '',
          },
          {
            termination: 'scoped-sandbox-remove',
            trigger:
              scenario.id === 'lifecycle.timeout'
                ? 'execution-deadline'
                : 'explicit-cancellation',
            detachedExitCode: detached.exitCode,
            delayedMarkerMs,
            observationWindowMs,
          },
          'sandbox_removal_detached_child_observed',
          HARNESS_PROVENANCE,
          ['research-harness', 'docker-sandbox-control-plane'],
        );
      }
      case 'lifecycle.broker-unavailable':
        return this.#unsupported(
          scenario,
          context,
          'broker_preflight_unverified',
          'not-measured',
          {
            basis: 'declared',
            effective: {
              broker: 'required',
              probe: 'no independent launch-attempt oracle',
            },
            locus: ['research-harness'],
          },
        );
      case 'lifecycle.partial-launch':
        return this.#unsupported(
          scenario,
          context,
          'partial_launch_cleanup_unverified',
          'not-measured',
          {
            basis: 'declared',
            effective: {
              probe: 'no deliberately interrupted create operation',
            },
            locus: ['research-harness'],
          },
        );
      case 'lifecycle.repeated-close':
        return this.#unsupported(
          scenario,
          context,
          'repeated_adapter_close_unverified',
          'not-measured',
        );
      case 'lifecycle.restart-checkpoint': {
        const marker = path.join(this.#guestRoot, 'restart-persistent.txt');
        await writeFile(marker, 'persisted');
        const stopped = await this.#executeScenario([
          'stop',
          this.#sandboxName,
        ]);
        const resumed = await this.#exec(['sh', '-lc', `test -f '${marker}'`]);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'restart-storage-observation',
            expected: { workspace: 'persists', process: 'terminates' },
            observed: {
              workspace: resumed.exitCode === 0 ? 'persists' : 'missing',
              process: 'terminated-by-stop',
            },
            passed: stopped.exitCode === 0 && resumed.exitCode === 0,
          },
          {
            workspace: 'bind-mount',
            process: 'container-lifecycle',
            bindings: 'control-plane',
          },
          'restart_surfaces_observed',
          HARNESS_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'resource.cpu': {
        const expectedCpuCount = scenario.parameters?.cpuCount ?? 1;
        const result = await this.#exec(['getconf', '_NPROCESSORS_ONLN']);
        const cpuCount = Number.parseInt(result.stdout.trim(), 10);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'online-cpu-count',
            expected: expectedCpuCount,
            observed: Number.isNaN(cpuCount) ? resultSummary(result) : cpuCount,
            passed: result.exitCode === 0 && cpuCount === expectedCpuCount,
          },
          { requestedCpuCount: expectedCpuCount },
          'guest_cpu_limit_observed',
          ADAPTER_PROVENANCE,
          ['docker-sandbox-control-plane'],
        );
      }
      case 'resource.memory': {
        const targetKiB = scenario.parameters?.memoryKiB ?? 1_048_576;
        const tolerancePercent = scenario.parameters?.tolerancePercent ?? 15;
        const result = await this.#exec([
          'sh',
          '-lc',
          "awk '/MemTotal/ { print $2 }' /proc/meminfo",
        ]);
        const kibibytes = Number.parseInt(result.stdout.trim(), 10);
        const toleranceKiB = targetKiB * (tolerancePercent / 100);
        const withinTolerance =
          kibibytes >= targetKiB - toleranceKiB &&
          kibibytes <= targetKiB + toleranceKiB;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'guest-memory-kibibytes',
            expected: { target: targetKiB, tolerancePercent },
            observed: Number.isNaN(kibibytes)
              ? resultSummary(result)
              : kibibytes,
            passed: result.exitCode === 0 && withinTolerance,
          },
          { requestedMemory: '1GiB' },
          'guest_memory_limit_observed',
          ADAPTER_PROVENANCE,
          ['docker-sandbox-control-plane'],
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
              guest: ['shell', 'workspace'],
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

  async hostCapabilities(): Promise<HostCapabilityEvidence[]> {
    return [
      {
        id: 'mcp-and-host-exec',
        locus: 'host',
        relationship: 'outside-containment',
        basis: 'declared',
        description:
          'MCP calls and host commands are orchestrator capabilities, not guest capabilities.',
      },
      {
        id: 'credential-proxy',
        locus: 'control-plane',
        relationship: 'mediates-containment',
        basis: this.#credentialDeliveryVerified ? 'verified' : 'declared',
        description:
          'Docker Sandbox replaces a guest stand-in at a bound outbound origin.',
      },
    ];
  }

  sensitiveValues(): string[] {
    return this.#fixture?.sensitiveValues() ?? [];
  }

  async close(): Promise<PersistentMutationEvidence[]> {
    return this.#cleanup.close();
  }
}
