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
import {
  type DockerEngineControl,
  dockerEngineControl,
} from './docker-engine-control.js';
import {
  ADJACENT_FIXTURE_HOST,
  type ExactOriginProxy,
  PROTECTED_FIXTURE_HOST,
  startExactOriginProxy,
} from './exact-origin-proxy.js';
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
// Force controlled TEST-NET requests through Docker's credential proxy and
// then the adapter-owned exact-origin upstream proxy.
const CREDENTIAL_HOST = PROTECTED_FIXTURE_HOST;
const FORCE_PROXY = "--noproxy ''";

export interface DockerSandboxAdapterOptions {
  appName: string;
  engineControl?: DockerEngineControl;
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

interface SandboxStatus {
  name: string;
  status: string;
}

export class DockerContainmentRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerContainmentRecoveryError';
  }
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
  readonly #engineControl: DockerEngineControl;
  readonly #appName: string;
  readonly #cleanup = new CleanupManifest();
  #inventory: BackendInventory | null = null;
  #fixture: PolicyFixture | null = null;
  #originProxy: ExactOriginProxy | null = null;
  #originProxyConfigured = false;
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
  #daemonStopped = false;
  #poisoned = false;

  constructor(options: DockerSandboxAdapterOptions) {
    const execute = options.execute ?? executeCommand;
    this.#appName = options.appName;
    if (!/^[a-z0-9-]{1,20}$/.test(this.#appName)) {
      throw new Error(
        'Docker Sandbox app name must contain 1-20 lowercase letters, digits, or hyphens',
      );
    }
    this.#engineControl = options.engineControl ?? dockerEngineControl;
    this.#execute = (command, args, commandOptions = {}) =>
      execute(command, args, {
        ...commandOptions,
        env: {
          ...process.env,
          ...commandOptions.env,
          DOCKER_SANDBOXES_APP_NAME: this.#appName,
        },
      });
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
    await this.#ensureOriginProxy(fixture);
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

  async #sandboxStatus(name: string): Promise<{
    result: CommandResult;
    parsed: boolean;
    status: string | null;
  }> {
    const result = await this.#executeScenario(['ls', '--json']);
    if (result.exitCode !== 0) return { result, parsed: false, status: null };
    try {
      const parsed = JSON.parse(result.stdout) as {
        sandboxes?: SandboxStatus[];
      };
      if (!Array.isArray(parsed.sandboxes)) {
        return { result, parsed: false, status: null };
      }
      const sandbox = parsed.sandboxes?.find(
        (candidate) => candidate.name === name,
      );
      return { result, parsed: true, status: sandbox?.status ?? null };
    } catch {
      return { result, parsed: false, status: null };
    }
  }

  async #startDaemon(): Promise<CommandResult> {
    const result = await this.#execute('sbx', ['daemon', 'start', '--detach'], {
      timeoutMs: 30_000,
    });
    if (result.exitCode === 0) this.#daemonStopped = false;
    return result;
  }

  async #retireDedicatedDaemon(): Promise<{
    status: CommandResult;
    stop: CommandResult;
    stopped: boolean;
  }> {
    const stop = await this.#execute('sbx', ['daemon', 'stop'], {
      timeoutMs: 30_000,
    });
    if (stop.exitCode === 0) this.#daemonStopped = true;
    const status = await this.#execute('sbx', ['daemon', 'status'], {
      timeoutMs: 10_000,
    });
    const stopped =
      stop.exitCode === 0 &&
      status.exitCode === 0 &&
      /^Status:\s*stopped\s*$/m.test(status.stdout) &&
      /not connected/i.test(status.stdout);
    if (!stopped) this.#poisoned = true;
    return { stop, status, stopped };
  }

  async #engineSocketPath(): Promise<string | null> {
    const status = await this.#execute('sbx', ['daemon', 'status'], {
      timeoutMs: 10_000,
    });
    if (
      status.exitCode !== 0 ||
      !/^Status:\s*running\s*$/m.test(status.stdout)
    ) {
      return null;
    }
    const socketMatch = /^Socket:\s*(\S+)\s*$/m.exec(status.stdout);
    if (!socketMatch?.[1]) return null;
    const daemonSocket = path.resolve(socketMatch[1]);
    const namespaceDirectory = path.dirname(daemonSocket);
    if (
      path.basename(daemonSocket) !== 'sandboxd.sock' ||
      path.basename(namespaceDirectory) !== `d_${this.#appName}`
    ) {
      return null;
    }
    return path.join(namespaceDirectory, 'docker.sock');
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

  async #ensureOriginProxy(fixture: PolicyFixture): Promise<ExactOriginProxy> {
    if (!this.#originProxy) {
      this.#originProxy = await startExactOriginProxy(fixture);
      this.#cleanup.add(
        'origin-proxy',
        '<trusted-loopback-proxy>',
        async () => {
          await this.#originProxy?.close();
        },
      );
    }
    if (!this.#originProxyConfigured) {
      const current = await this.#execute('sbx', [
        'settings',
        'get',
        'proxy.sandbox',
      ]);
      const noProxy = await this.#execute('sbx', [
        'settings',
        'get',
        'no_proxy.sandbox',
      ]);
      if (
        current.exitCode !== 0 ||
        current.stdout.trim() !== '' ||
        noProxy.exitCode !== 0 ||
        noProxy.stdout.trim() !== ''
      ) {
        throw new Error(
          'dedicated Docker Sandbox daemon must start without proxy overrides',
        );
      }
      const configured = await this.#execute('sbx', [
        'settings',
        'set',
        'proxy.sandbox',
        this.#originProxy.url,
      ]);
      if (configured.exitCode !== 0) {
        throw new Error(`upstream proxy setup failed: ${configured.stderr}`);
      }
      this.#cleanup.add(
        'daemon-setting',
        '<scoped-upstream-proxy>',
        async () => {
          const unset = await this.#execute('sbx', [
            'settings',
            'unset',
            'proxy.sandbox',
          ]);
          if (unset.exitCode !== 0) throw new Error(unset.stderr);
        },
      );
      const retired = await this.#retireDedicatedDaemon();
      const restarted = retired.stopped
        ? await this.#startDaemon()
        : { exitCode: 1, stdout: '', stderr: 'daemon retirement failed' };
      const applied = await this.#execute('sbx', [
        'settings',
        'get',
        'proxy.sandbox',
      ]);
      if (
        !retired.stopped ||
        restarted.exitCode !== 0 ||
        applied.exitCode !== 0 ||
        applied.stdout.trim() !== this.#originProxy.url
      ) {
        this.#poisoned = true;
        throw new Error('upstream proxy activation could not be confirmed');
      }
      this.#originProxyConfigured = true;
    }
    return this.#originProxy;
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
    const resources = [
      `${ADJACENT_FIXTURE_HOST}:${fixture.adjacentPort}`,
      `${ADJACENT_FIXTURE_HOST}:${fixture.allowedPort}`,
      `${CREDENTIAL_HOST}:${fixture.adjacentPort}`,
    ];
    const results: CommandResult[] = [];
    for (const resource of resources) {
      results.push(
        await this.#allowNetworkResource(
          resource,
          '<negative-credential-origin>',
        ),
      );
    }
    const failed = results.find((result) => result.exitCode !== 0);
    const result = failed ?? {
      exitCode: 0,
      stdout: 'all negative origins allowed',
      stderr: '',
    };
    if (!failed) {
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
    if (this.#poisoned) {
      throw new DockerContainmentRecoveryError(
        'Docker Sandbox adapter is poisoned after unconfirmed containment',
      );
    }
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
        const proxy = await this.#ensureOriginProxy(fixture);
        fixture.redirectTo(ADJACENT_FIXTURE_HOST);
        const allowedPolicy = await this.#ensureCredentialNetworkAllow(fixture);
        const adjacentPolicy =
          await this.#ensureAdjacentCredentialNetworkAllow(fixture);
        const secret = await this.#ensureSecret();
        const beforeRequests = fixture.requests.length;
        const beforeDecisions = proxy.decisions.length;
        const wrongHost = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${ADJACENT_FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/wrong-host-credential')}'`,
        ]);
        const wrongPort = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${CREDENTIAL_HOST}:${fixture.adjacentPort}${fixture.path('/wrong-port-credential')}'`,
        ]);
        const wrongProtocol = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -kfsS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'https://${CREDENTIAL_HOST}:${fixture.allowedPort}${fixture.path('/wrong-protocol-credential')}'`,
        ]);
        const redirect = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS -L --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${CREDENTIAL_HOST}:${fixture.allowedPort}${fixture.path('/redirect')}'`,
        ]);
        const directLoopback = await this.#exec([
          'sh',
          '-lc',
          `curl -fsS --max-time 2 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://127.0.0.1:${fixture.allowedPort}${fixture.path('/direct-loopback')}'`,
        ]);
        const adjacent = await this.#exec([
          'sh',
          '-lc',
          `curl ${FORCE_PROXY} -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${ADJACENT_FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/adjacent-credential')}'`,
        ]);
        const requests = fixture.capture(beforeRequests);
        const decisions = proxy.decisions.slice(beforeDecisions);
        const negativeRequests = requests.filter(
          (request) => request.path !== '/redirect',
        );
        const protectedRedirect = requests.filter(
          (request) => request.path === '/redirect',
        );
        const routes = new Map(
          decisions.map((decision) => [decision.route, decision]),
        );
        const passed =
          allowedPolicy.exitCode === 0 &&
          adjacentPolicy.exitCode === 0 &&
          secret.result.exitCode === 0 &&
          wrongHost.exitCode === 0 &&
          wrongPort.exitCode === 0 &&
          wrongProtocol.exitCode !== 0 &&
          redirect.exitCode === 0 &&
          directLoopback.exitCode !== 0 &&
          adjacent.exitCode === 0 &&
          protectedRedirect.length === 1 &&
          protectedRedirect[0]?.credentialMatch === 'expected' &&
          negativeRequests.length === 4 &&
          negativeRequests.every(
            (request) => request.credentialMatch === 'absent',
          ) &&
          routes.get('wrong-host')?.credential === 'removed' &&
          routes.get('wrong-port')?.credential === 'removed' &&
          routes.get('wrong-protocol')?.action === 'deny' &&
          routes.get('adjacent')?.action === 'forward';
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'exact-origin-negative-controls',
            expected: {
              negativeCredentialMatches: 0,
              negativeFixtureRequests: 4,
              protectedRedirectMatches: 1,
              proxyDecisions: 6,
            },
            observed: {
              negativeCredentialMatches: negativeRequests.filter(
                (request) => request.credentialMatch === 'expected',
              ).length,
              negativeFixtureRequests: negativeRequests.length,
              protectedRedirectMatches: protectedRedirect.filter(
                (request) => request.credentialMatch === 'expected',
              ).length,
              proxyDecisions: decisions.length,
            },
            passed,
          },
          {
            credentialBinding: `http://${CREDENTIAL_HOST}:<allowed-port>`,
            networkAllowed: `http://${ADJACENT_FIXTURE_HOST}:<adjacent-port>`,
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
          childName,
          'sh',
          '-lc',
          `setsid sh -c "printf started > '${started}'; sleep ${delayedMarkerMs / 1_000}; printf escaped > '${marker}'" >/dev/null 2>&1 </dev/null &`,
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
        const engineSocketPath = await this.#engineSocketPath();
        const retirement = engineSocketPath
          ? await this.#engineControl
              .retireSandbox({
                sandboxName: childName,
                socketPath: engineSocketPath,
                workspacePath: this.#guestRoot,
              })
              .catch(() => ({
                confirmed: false,
                exitCode: null,
                identityConfirmed: false,
                killStatus: null,
              }))
          : {
              confirmed: false,
              exitCode: null,
              identityConfirmed: false,
              killStatus: null,
            };
        if (!retirement.confirmed) {
          this.#poisoned = true;
          await this.#retireDedicatedDaemon();
        }
        await sleep(observationWindowMs);
        const observed = await readFile(marker, 'utf8').catch(() => '');
        const restarted = this.#daemonStopped
          ? await this.#startDaemon()
          : { exitCode: 0, stdout: '', stderr: '' };
        const childStatus =
          restarted.exitCode === 0
            ? await this.#sandboxStatus(childName)
            : { result: restarted, parsed: false, status: null };
        const removed =
          restarted.exitCode === 0
            ? await this.#execute('sbx', ['rm', '--force', childName])
            : restarted;
        const removedStatus =
          removed.exitCode === 0
            ? await this.#sandboxStatus(childName)
            : { result: removed, parsed: false, status: null };
        const passed =
          created.exitCode === 0 &&
          detached.exitCode === 0 &&
          acknowledged === 'started' &&
          retirement.confirmed &&
          retirement.identityConfirmed &&
          observed === '' &&
          restarted.exitCode === 0 &&
          childStatus.parsed &&
          childStatus.status === 'stopped' &&
          removed.exitCode === 0 &&
          removedStatus.parsed &&
          removedStatus.status === null;
        if (!passed) this.#poisoned = true;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'delayed-marker-absence',
            expected: 'absent',
            observed: observed === '' ? 'absent' : 'present',
            passed,
          },
          {
            termination: 'identity-verified-engine-kill',
            confirmedIdentity: retirement.identityConfirmed,
            confirmedEngineState: retirement.confirmed
              ? 'stopped'
              : 'unconfirmed',
            terminationExitCode: retirement.exitCode,
            terminationStatus: retirement.killStatus,
            confirmedStoppedState: childStatus.status,
            confirmedFinalState: removedStatus.status ?? 'absent',
            trigger:
              scenario.id === 'lifecycle.timeout'
                ? 'execution-deadline'
                : 'explicit-cancellation',
            detachedExitCode: detached.exitCode,
            delayedMarkerMs,
            observationWindowMs,
          },
          passed
            ? 'managed_engine_retirement_observed'
            : 'managed_engine_retirement_unconfirmed',
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
      case 'lifecycle.partial-launch': {
        const childName = `${this.#sandboxName}-partial-launch`;
        const created = await this.#executeScenario([
          'create',
          'shell',
          '--quiet',
          '--name',
          childName,
          this.#guestRoot,
        ]);
        if (created.exitCode !== 0) {
          throw new Error(
            `partial-launch sandbox create failed: ${created.stderr}`,
          );
        }
        this.#cleanup.add('sandbox', '<partial-launch-sandbox>', async () => {
          const cleanup = await this.#execute('sbx', [
            'rm',
            '--force',
            childName,
          ]);
          if (cleanup.exitCode !== 0 && !/not found/i.test(cleanup.stderr)) {
            throw new Error(cleanup.stderr);
          }
        });
        const failedLaunch = await this.#executeScenario([
          'exec',
          childName,
          '/moltnet-deliberately-missing-executable',
        ]);
        const stopped = await this.#executeScenario(['stop', childName]);
        const stoppedStatus = await this.#sandboxStatus(childName);
        const removed = await this.#executeScenario([
          'rm',
          '--force',
          childName,
        ]);
        const removedStatus = await this.#sandboxStatus(childName);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'partial-launch-backend-absence',
            expected: 'absent',
            observed:
              removedStatus.parsed && removedStatus.status === null
                ? 'absent'
                : 'present-or-unconfirmed',
            passed:
              failedLaunch.exitCode !== 0 &&
              stopped.exitCode === 0 &&
              stoppedStatus.parsed &&
              stoppedStatus.status === 'stopped' &&
              removed.exitCode === 0 &&
              removedStatus.parsed &&
              removedStatus.status === null,
          },
          {
            allocation: 'scoped-sandbox',
            launch: 'deliberately-rejected-before-handle',
            confirmedStoppedState: stoppedStatus.status,
            confirmedFinalState: removedStatus.status ?? 'absent',
          },
          'preflight_failure_left_no_backend_resource',
          HARNESS_PROVENANCE,
          ['research-harness', 'docker-sandbox-control-plane'],
        );
      }
      case 'lifecycle.repeated-close': {
        const childName = `${this.#sandboxName}-repeated-close`;
        const created = await this.#executeScenario([
          'create',
          'shell',
          '--quiet',
          '--name',
          childName,
          this.#guestRoot,
        ]);
        if (created.exitCode !== 0) {
          throw new Error(
            `repeated-close sandbox create failed: ${created.stderr}`,
          );
        }
        this.#cleanup.add('sandbox', '<repeated-close-sandbox>', async () => {
          const cleanup = await this.#execute('sbx', [
            'rm',
            '--force',
            childName,
          ]);
          if (cleanup.exitCode !== 0 && !/not found/i.test(cleanup.stderr)) {
            throw new Error(cleanup.stderr);
          }
        });
        const first = await this.#executeScenario(['rm', '--force', childName]);
        const afterFirst = await this.#sandboxStatus(childName);
        const second = await this.#executeScenario([
          'rm',
          '--force',
          childName,
        ]);
        const afterSecond = await this.#sandboxStatus(childName);
        const secondIdempotent =
          second.exitCode === 0 || /not found/i.test(second.stderr);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'repeated-close-backend-absence',
            expected: { first: 'absent', second: 'absent' },
            observed: {
              first:
                afterFirst.parsed && afterFirst.status === null
                  ? 'absent'
                  : 'present-or-unconfirmed',
              second:
                afterSecond.parsed && afterSecond.status === null
                  ? 'absent'
                  : 'present-or-unconfirmed',
            },
            passed:
              first.exitCode === 0 &&
              afterFirst.parsed &&
              afterFirst.status === null &&
              secondIdempotent &&
              afterSecond.parsed &&
              afterSecond.status === null,
          },
          {
            close: 'scoped-sandbox-remove',
            repeatedClose: secondIdempotent ? 'idempotent' : 'failed',
          },
          'repeated_adapter_close_observed',
          HARNESS_PROVENANCE,
          ['research-harness', 'docker-sandbox-control-plane'],
        );
      }
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
    if (this.#daemonStopped) await this.#startDaemon();
    return this.#cleanup.close();
  }
}
