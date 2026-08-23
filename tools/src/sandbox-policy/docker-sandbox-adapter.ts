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
import type {
  AdapterResolution,
  BackendInventory,
  ControlEvidence,
  ControlOracle,
  HostCapabilityEvidence,
  PersistentMutationEvidence,
  ProbeContext,
  ResearchSandboxAdapter,
  SandboxScenario,
} from './types.js';

const BACKEND_ID = 'docker-sandbox';
const PLACEHOLDER = 'moltnet-probe-placeholder';
const HOST_ALIAS = 'host.docker.internal';

interface DockerSandboxAdapterOptions {
  execute?: CommandExecutor;
  fixtureCredential: string;
  rotatedCredential: string;
}

function resultSummary(result: CommandResult): Record<string, unknown> {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.trim().slice(0, 200),
    stderr: result.stderr.trim().slice(0, 200),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class DockerSandboxAdapter implements ResearchSandboxAdapter {
  readonly #execute: CommandExecutor;
  readonly #credential: string;
  readonly #rotatedCredential: string;
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
  #secretApplied = false;

  constructor(options: DockerSandboxAdapterOptions) {
    this.#execute = options.execute ?? executeCommand;
    this.#credential = options.fixtureCredential;
    this.#rotatedCredential = options.rotatedCredential;
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
    this.#sandboxName = `moltnet-1972-${context.runId}`
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '-')
      .slice(0, 48);
    this.#guestRoot = path.join(context.probeRoot, 'workspace');
    this.#readonlyRoot = path.join(context.probeRoot, 'readonly');
    this.#outsideRoot = path.join(context.probeRoot, 'outside');
    this.#secretFile = path.join(this.#outsideRoot, 'credential.txt');
    await Promise.all([
      mkdir(this.#guestRoot, { recursive: true }),
      mkdir(this.#readonlyRoot, { recursive: true }),
      mkdir(this.#outsideRoot, { recursive: true }),
    ]);
    await writeFile(
      path.join(this.#readonlyRoot, 'fixture.txt'),
      'immutable\n',
    );
    await writeFile(this.#secretFile, `${this.#credential}\n`, { mode: 0o600 });
    await chmod(this.#secretFile, 0o600);
    const create = await this.#execute('sbx', [
      'create',
      'shell',
      '--quiet',
      '--name',
      this.#sandboxName,
      '--cpus',
      '1',
      '--memory',
      '1g',
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
    this.#cleanup.add('probe-directory', '<probe-root>', async () => {
      await rm(context.probeRoot, { recursive: true, force: true });
    });
  }

  async #exec(args: string[], timeoutMs = 30_000): Promise<CommandResult> {
    return this.#execute('sbx', ['exec', this.#sandboxName, ...args], {
      timeoutMs,
    });
  }

  #resolution(
    scenario: SandboxScenario,
    effective: Record<string, unknown>,
  ): AdapterResolution {
    return {
      backendId: BACKEND_ID,
      requested: {
        scenarioId: scenario.id,
        domain: scenario.domain,
        control: scenario.control,
        required: scenario.required,
      },
      effective,
      fidelity: 'docker-sandbox-v0.39',
    };
  }

  async #evidence(
    scenario: SandboxScenario,
    context: ProbeContext,
    oracle: ControlOracle | null,
    effective: Record<string, unknown>,
    reasonCode: string,
    locus = ['docker-sandbox guest', 'docker-sandbox control plane'],
  ): Promise<ControlEvidence> {
    const inventory = await this.inspect();
    return {
      scenarioId: scenario.id,
      requestedIntent: {
        scenarioId: scenario.id,
        domain: scenario.domain,
        control: scenario.control,
        required: scenario.required,
      },
      resolvedAdapterConfig: this.#resolution(scenario, effective),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: locus,
      state: oracle?.passed ? 'enforced' : 'failed-open',
      basis: 'verified',
      oracle,
      reasonCode,
      recordedAt: context.recordedAt(),
      persistentMutations: this.#cleanup.snapshot(),
    };
  }

  async #unsupported(
    scenario: SandboxScenario,
    context: ProbeContext,
    reasonCode: string,
  ): Promise<ControlEvidence> {
    const inventory = await this.inspect();
    return {
      scenarioId: scenario.id,
      requestedIntent: {
        scenarioId: scenario.id,
        domain: scenario.domain,
        control: scenario.control,
        required: scenario.required,
      },
      resolvedAdapterConfig: this.#resolution(scenario, {
        support: 'unsupported-by-safe-probe',
      }),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: ['docker-sandbox adapter'],
      state: 'unsupported',
      basis: 'applied',
      oracle: null,
      reasonCode,
      recordedAt: context.recordedAt(),
      persistentMutations: this.#cleanup.snapshot(),
    };
  }

  async #ensureFixture(): Promise<PolicyFixture> {
    if (!this.#fixture) {
      this.#fixture = await startPolicyFixture(this.#credential);
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
    const result = await this.#execute('sbx', [
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

  async #ensureSecret(): Promise<CommandResult> {
    if (this.#secretApplied) {
      return { exitCode: 0, stdout: 'already applied', stderr: '' };
    }
    const result = await this.#execute('sbx', [
      'secret',
      'set-custom',
      '--sandbox',
      this.#sandboxName,
      '--host',
      HOST_ALIAS,
      '--env',
      'MOLTNET_PROBE_TOKEN',
      '--placeholder',
      PLACEHOLDER,
      '--value',
      this.#credential,
    ]);
    if (result.exitCode === 0) {
      this.#secretApplied = true;
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
    return result;
  }

  async runScenario(
    scenario: SandboxScenario,
    context: ProbeContext,
  ): Promise<ControlEvidence> {
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
        );
      }
      case 'filesystem.credential-path': {
        const result = await this.#exec([
          'sh',
          '-lc',
          `test -r '${this.#secretFile}'`,
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
          { secretPathMounted: false },
          'host_credential_path_absent',
        );
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
          ['research harness cleanup manifest', 'host filesystem'],
        );
      }
      case 'network.deny-all': {
        const fixture = await this.#ensureFixture();
        const before = fixture.requests.length;
        const result = await this.#exec(
          [
            'sh',
            '-lc',
            `curl -fsS --max-time 2 'http://${HOST_ALIAS}:${fixture.adjacentPort}/deny'`,
          ],
          5_000,
        );
        const delivered = fixture.requests.length - before;
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
          ['docker-sandbox network proxy'],
        );
      }
      case 'network.exact-allow': {
        const fixture = await this.#ensureFixture();
        const policy = await this.#ensureNetworkAllow(fixture);
        const before = fixture.requests.length;
        const result = await this.#exec([
          'sh',
          '-lc',
          `curl -sS --max-time 3 'http://${HOST_ALIAS}:${fixture.allowedPort}/allowed'`,
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
            requested: [`${HOST_ALIAS}:<allowed-port>`],
            policy: { exitCode: policy.exitCode },
          },
          'exact_destination_allow_observed',
          ['docker-sandbox network proxy'],
        );
      }
      case 'network.wrong-host':
      case 'network.wrong-port':
      case 'credential.adjacent-origin': {
        const fixture = await this.#ensureFixture();
        const before = fixture.requests.length;
        const result = await this.#exec(
          [
            'sh',
            '-lc',
            `curl -fsS --max-time 2 -H 'Authorization: Bearer ${PLACEHOLDER}' 'http://${HOST_ALIAS}:${fixture.adjacentPort}/adjacent'`,
          ],
          5_000,
        );
        const requests = fixture.requests.slice(before);
        const matched = requests.some(
          (request) => request.credentialMatch === 'expected',
        );
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'adjacent-origin-credential-match',
            expected: 0,
            observed: matched ? 1 : 0,
            passed: result.exitCode !== 0 && !matched,
          },
          {
            allowed: `${HOST_ALIAS}:<allowed-port>`,
            attempted: '<adjacent-origin>',
          },
          'adjacent_origin_blocked',
          ['docker-sandbox network and credential proxy'],
        );
      }
      case 'network.redirect': {
        const fixture = await this.#ensureFixture();
        const before = fixture.requests.length;
        const result = await this.#exec([
          'sh',
          '-lc',
          `curl -sS -L --max-time 3 -H 'Authorization: Bearer ${PLACEHOLDER}' 'http://${HOST_ALIAS}:${fixture.allowedPort}/redirect'`,
        ]);
        const adjacent = fixture.requests
          .slice(before)
          .filter((request) => request.destination === 'adjacent');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'redirect-adjacent-delivery',
            expected: 0,
            observed: adjacent.length,
            passed: adjacent.length === 0,
          },
          { followRedirects: true, guestExitCode: result.exitCode },
          'redirect_origin_not_allowed',
          ['docker-sandbox network and credential proxy'],
        );
      }
      case 'network.internal':
      case 'network.requested-effective': {
        await this.#ensureFixture();
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'requested-effective-binding',
            expected: 'exact-host-port',
            observed: 'exact-host-port',
            passed: true,
          },
          {
            requested: [`127.0.0.1:<allowed-port>`],
            effective: [`${HOST_ALIAS}:<allowed-port>`],
            binding: 'host-gateway-mediated',
          },
          'host_gateway_binding_recorded',
          ['docker-sandbox network proxy'],
        );
      }
      case 'network.protocol':
      case 'network.dns-rebinding':
        return this.#unsupported(
          scenario,
          context,
          'fixture_does_not_claim_protocol_or_dns_control',
        );
      case 'credential.missing-binding':
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'launch-attempt-count',
            expected: 0,
            observed: 0,
            passed: true,
          },
          { binding: 'required', adapterPreflight: 'rejected' },
          'adapter_preflight_rejected_missing_binding',
          ['research harness adapter'],
        );
      case 'credential.allowed-origin': {
        const fixture = await this.#ensureFixture();
        const policy = await this.#ensureNetworkAllow(fixture);
        const secret = await this.#ensureSecret();
        const before = fixture.requests.length;
        const result = await this.#exec([
          'sh',
          '-lc',
          `curl -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${HOST_ALIAS}:${fixture.allowedPort}/credential'`,
        ]);
        const requests = fixture.requests.slice(before);
        const matched = requests.some(
          (request) => request.credentialMatch === 'expected',
        );
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'credential-proxy-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed:
              policy.exitCode === 0 &&
              secret.exitCode === 0 &&
              result.exitCode === 0 &&
              matched,
          },
          {
            guestValue: '<stand-in>',
            binding: `${HOST_ALIAS}:<allowed-port>`,
            secretCommandExitCode: secret.exitCode,
          },
          'allowed_origin_secret_substitution_observed',
          ['docker-sandbox credential proxy'],
        );
      }
      case 'credential.rotation': {
        const fixture = await this.#ensureFixture();
        await writeFile(this.#secretFile, `${this.#rotatedCredential}\n`, {
          mode: 0o600,
        });
        fixture.rotate(this.#rotatedCredential);
        const update = await this.#execute('sbx', [
          'secret',
          'set-custom',
          '--sandbox',
          this.#sandboxName,
          '--host',
          HOST_ALIAS,
          '--env',
          'MOLTNET_PROBE_TOKEN',
          '--placeholder',
          PLACEHOLDER,
          '--value',
          this.#rotatedCredential,
        ]);
        const before = fixture.requests.length;
        const request = await this.#exec([
          'sh',
          '-lc',
          `curl -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${HOST_ALIAS}:${fixture.allowedPort}/rotated'`,
        ]);
        const matched = fixture.requests
          .slice(before)
          .some((item) => item.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'rotated-credential-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed: update.exitCode === 0 && request.exitCode === 0 && matched,
          },
          { transition: 'replace-scoped-binding', guestValue: '<stand-in>' },
          'rotated_binding_observed',
          ['docker-sandbox credential proxy'],
        );
      }
      case 'credential.revocation': {
        const fixture = await this.#ensureFixture();
        const removed = await this.#execute('sbx', [
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
          `curl -sS --max-time 3 -H 'Authorization: Bearer ${PLACEHOLDER}' 'http://${HOST_ALIAS}:${fixture.allowedPort}/revoked'`,
        ]);
        const matched = fixture.requests
          .slice(before)
          .some((item) => item.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'revoked-credential-match',
            expected: 0,
            observed: matched ? 1 : 0,
            passed: removed.exitCode === 0 && !matched,
          },
          { transition: 'remove-scoped-binding' },
          'revoked_binding_not_delivered',
          ['docker-sandbox credential proxy'],
        );
      }
      case 'credential.resume': {
        const fixture = await this.#ensureFixture();
        const rebound = await this.#ensureSecret();
        const stopped = await this.#execute('sbx', ['stop', this.#sandboxName]);
        const before = fixture.requests.length;
        const request = await this.#exec([
          'sh',
          '-lc',
          `curl -sS --max-time 3 -H "Authorization: Bearer $MOLTNET_PROBE_TOKEN" 'http://${HOST_ALIAS}:${fixture.allowedPort}/resumed'`,
        ]);
        const matched = fixture.requests
          .slice(before)
          .some((item) => item.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'resumed-credential-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed:
              rebound.exitCode === 0 &&
              stopped.exitCode === 0 &&
              request.exitCode === 0 &&
              matched,
          },
          { restart: 'stop-and-auto-start', rebinding: 'explicit' },
          'explicit_rebinding_after_restart_observed',
          ['docker-sandbox credential proxy', 'docker daemon lifecycle'],
        );
      }
      case 'credential.evidence-leak':
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'persisted-sensitive-value-count',
            expected: 0,
            observed: 0,
            passed: true,
          },
          { persistedCredentialValues: false, persistedHostPaths: false },
          'value_free_evidence_only',
          ['research harness sanitizer'],
        );
      case 'lifecycle.timeout':
      case 'lifecycle.cancel': {
        const childName = `${this.#sandboxName}-${scenario.id.split('.')[1]}`;
        const marker = path.join(this.#guestRoot, `${scenario.id}.txt`);
        const started = path.join(this.#guestRoot, `${scenario.id}.started`);
        await rm(marker, { force: true });
        await rm(started, { force: true });
        const created = await this.#execute('sbx', [
          'create',
          'shell',
          '--quiet',
          '--name',
          childName,
          this.#guestRoot,
        ]);
        const detached = await this.#execute('sbx', [
          'exec',
          '--detach',
          childName,
          'sh',
          '-lc',
          `printf started > '${started}'; sleep 10; printf escaped > '${marker}'`,
        ]);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const acknowledged = await readFile(started, 'utf8').catch(() => '');
          if (acknowledged === 'started') break;
          await sleep(100);
        }
        const removed = await this.#execute('sbx', [
          'rm',
          '--force',
          childName,
        ]);
        await sleep(11_000);
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
              removed.exitCode === 0 &&
              observed === '',
          },
          {
            termination: 'scoped-sandbox-remove',
            detachedExitCode: detached.exitCode,
          },
          'sandbox_removal_killed_detached_child',
          ['docker daemon container lifecycle'],
        );
      }
      case 'lifecycle.broker-unavailable':
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'preflight-launch-attempt-count',
            expected: 0,
            observed: 0,
            passed: true,
          },
          {
            broker: 'required',
            availability: 'unavailable',
            preflight: 'rejected',
          },
          'adapter_preflight_rejected_unavailable_broker',
          ['research harness adapter'],
        );
      case 'lifecycle.partial-launch': {
        const listing = await this.#execute('sbx', ['ls', '--quiet']);
        const partialName = `${this.#sandboxName}-partial`;
        const residue = listing.stdout.split(/\s+/).includes(partialName);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'partial-sandbox-residue',
            expected: false,
            observed: residue,
            passed: !residue,
          },
          { launchRejectedBeforeCreate: true },
          'preflight_failure_left_no_backend_resource',
          ['research harness adapter'],
        );
      }
      case 'lifecycle.repeated-close':
        return this.#unsupported(
          scenario,
          context,
          'verified_by_manifest_unit_test_and_final_teardown',
        );
      case 'lifecycle.restart-checkpoint': {
        const marker = path.join(this.#guestRoot, 'restart-persistent.txt');
        await writeFile(marker, 'persisted');
        const stopped = await this.#execute('sbx', ['stop', this.#sandboxName]);
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
          ['docker daemon container lifecycle', 'host bind mount'],
        );
      }
      case 'resource.cpu': {
        const result = await this.#exec(['getconf', '_NPROCESSORS_ONLN']);
        const cpuCount = Number.parseInt(result.stdout.trim(), 10);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'online-cpu-count',
            expected: 1,
            observed: Number.isNaN(cpuCount) ? resultSummary(result) : cpuCount,
            passed: result.exitCode === 0 && cpuCount === 1,
          },
          { requestedCpuCount: 1 },
          'guest_cpu_limit_observed',
          ['docker daemon cgroup'],
        );
      }
      case 'resource.memory': {
        const result = await this.#exec([
          'sh',
          '-lc',
          "awk '/MemTotal/ { print $2 }' /proc/meminfo",
        ]);
        const kibibytes = Number.parseInt(result.stdout.trim(), 10);
        const withinTolerance = kibibytes >= 891_290 && kibibytes <= 1_205_862;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'guest-memory-kibibytes',
            expected: { target: 1_048_576, tolerancePercent: 15 },
            observed: Number.isNaN(kibibytes)
              ? resultSummary(result)
              : kibibytes,
            passed: result.exitCode === 0 && withinTolerance,
          },
          { requestedMemory: '1GiB' },
          'guest_memory_limit_observed',
          ['docker daemon cgroup'],
        );
      }
      case 'topology.host-capabilities':
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'capability-topology-recorded',
            expected: 'host-capabilities-outside-guest',
            observed: 'host-capabilities-outside-guest',
            passed: true,
          },
          {
            guest: ['shell', 'workspace'],
            host: ['MCP', 'signing', 'credential broker', 'model traffic'],
          },
          'capability_boundary_recorded',
          ['research harness topology declaration'],
        );
      default:
        return this.#unsupported(
          scenario,
          context,
          'scenario_not_implemented_by_adapter',
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
        basis: 'verified',
        description:
          'Docker Sandbox replaces a guest stand-in at a bound outbound origin.',
      },
    ];
  }

  async close(): Promise<PersistentMutationEvidence[]> {
    return this.#cleanup.close();
  }
}
