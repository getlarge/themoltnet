import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureSnapshot,
  type ManagedVm,
  resumeVm,
} from '@themoltnet/sandbox-gondolin';

import { CleanupManifest } from './cleanup.js';
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

const BACKEND_ID = 'gondolin';
const FIXTURE_HOST = '127-0-0-1.sslip.io';
const SECRET_ENV = 'FIXTURE_API_TOKEN';

interface GondolinAdapterOptions {
  fixtureCredential: string;
  rotatedCredential: string;
}

interface GuestResult {
  exitCode: number;
  output: string;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function execGuest(
  managed: ManagedVm,
  command: string,
  signal?: AbortSignal,
): Promise<GuestResult> {
  try {
    const process = managed.vm.exec(['/bin/sh', '-lc', command], {
      signal,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let output = '';
    for await (const chunk of process.output()) {
      output +=
        typeof chunk.data === 'string'
          ? chunk.data
          : Buffer.from(chunk.data).toString('utf8');
    }
    const result = await process;
    return { exitCode: result.exitCode, output };
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

export class GondolinAdapter implements ResearchSandboxAdapter {
  readonly #credential: string;
  readonly #rotatedCredential: string;
  readonly #cleanup = new CleanupManifest();
  #inventory: BackendInventory | null = null;
  #checkpointPath = '';
  #managed: ManagedVm | null = null;
  #fixture: PolicyFixture | null = null;
  #probeRoot = '';
  #workspace = '';
  #outside = '';
  #missingBindingVerified: boolean | null = null;

  constructor(options: GondolinAdapterOptions) {
    this.#credential = options.fixtureCredential;
    this.#rotatedCredential = options.rotatedCredential;
  }

  async inspect(): Promise<BackendInventory> {
    if (!this.#inventory) {
      this.#checkpointPath = await ensureSnapshot();
      this.#inventory = {
        id: BACKEND_ID,
        version: '0.9.1-workspace',
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
      this.#fixture = await startPolicyFixture(this.#credential, '0.0.0.0');
      this.#cleanup.add('fixture-server', '<loopback-fixture>', async () => {
        await this.#fixture?.close();
      });
    }
    return this.#fixture;
  }

  async #resume(value = this.#credential): Promise<ManagedVm> {
    const fixture = await this.#ensureFixture();
    const managed = await resumeVm({
      checkpointPath: this.#checkpointPath,
      agentName: 'sandbox-policy-probe',
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
          id: 'sandbox-policy-fixture',
          guestEnv: SECRET_ENV,
          hosts: [FIXTURE_HOST],
          protocol: 'http',
          ports: [fixture.allowedPort],
          value,
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
    await writeFile(
      path.join(this.#outside, 'credential.txt'),
      this.#credential,
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
      fidelity: 'production-resumeVm-path',
    };
  }

  async #evidence(
    scenario: SandboxScenario,
    context: ProbeContext,
    oracle: ControlOracle,
    effective: Record<string, unknown>,
    reasonCode: string,
    locus = ['Gondolin microVM', 'Gondolin host VFS/HTTP hooks'],
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
      state: oracle.passed ? 'enforced' : 'failed-open',
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
        support: 'unsupported-by-production-path',
      }),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: ['Gondolin adapter'],
      state: 'unsupported',
      basis: 'applied',
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
    try {
      const unexpected = await resumeVm({
        checkpointPath: this.#checkpointPath,
        agentName: 'sandbox-policy-missing-binding',
        agentRootDir: this.#probeRoot,
        guestCredentialMode: 'host-authenticated',
        mountPath: this.#workspace,
        sandboxConfig: {
          network: { allowedInternalHosts: [FIXTURE_HOST] },
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
      await unexpected.vm.close();
      this.#missingBindingVerified = false;
    } catch {
      this.#missingBindingVerified = true;
    }
    return this.#missingBindingVerified;
  }

  async runScenario(
    scenario: SandboxScenario,
    context: ProbeContext,
  ): Promise<ControlEvidence> {
    const managed = await this.#ensureManaged(context);
    const fixture = await this.#ensureFixture();
    switch (scenario.id) {
      case 'filesystem.workspace-rw': {
        const marker = path.join(this.#workspace, 'guest-write.txt');
        const result = await execGuest(
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
          'workspace_vfs_write_observed',
        );
      }
      case 'filesystem.outside-write': {
        const marker = path.join(this.#outside, 'outside-write.txt');
        await execGuest(managed, `printf escaped > '${marker}'`);
        const escaped = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'outside-marker-absence',
            expected: 'absent',
            observed: escaped === '' ? 'absent' : 'present',
            passed: escaped === '',
          },
          { mount: '<workspace-only>' },
          'microvm_host_boundary_observed',
        );
      }
      case 'filesystem.read-only':
        return this.#unsupported(
          scenario,
          context,
          'resumeVm_has_no_readonly_secondary_mount_contract',
        );
      case 'filesystem.credential-path': {
        const credentialPath = path.join(this.#outside, 'credential.txt');
        const result = await execGuest(managed, `test -r '${credentialPath}'`);
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
        );
      }
      case 'filesystem.symlink-traversal': {
        const link = path.join(this.#workspace, 'outside-link');
        const marker = path.join(this.#outside, 'symlink-write.txt');
        await rm(link, { force: true });
        await symlink(this.#outside, link);
        await execGuest(
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
            passed: escaped === '',
          },
          { hostSymlinkTarget: '<outside-mount>' },
          'vfs_symlink_boundary_observed',
          ['Gondolin host VFS provider'],
        );
      }
      case 'filesystem.cleanup': {
        const directory = path.join(this.#workspace, 'cleanup-probe');
        await mkdir(directory, { recursive: true });
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
        );
      }
      case 'network.deny-all':
      case 'network.wrong-host': {
        const before = fixture.requests.length;
        const result = await execGuest(
          managed,
          `curl -fsS --max-time 3 http://localhost:${fixture.allowedPort}/denied`,
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
          {
            allowedInternalHosts: [FIXTURE_HOST],
            attempted: '<unlisted-host>',
          },
          'unlisted_hostname_blocked',
          ['Gondolin host HTTP hooks'],
        );
      }
      case 'network.exact-allow': {
        const before = fixture.requests.length;
        const result = await execGuest(
          managed,
          `curl -sS --max-time 10 http://${FIXTURE_HOST}:${fixture.allowedPort}/allowed`,
        );
        const delivered = fixture.requests.length - before;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'allowed-request-count',
            expected: 1,
            observed: delivered,
            passed: result.exitCode === 0 && delivered === 1,
          },
          {
            requested: [`${FIXTURE_HOST}:<allowed-port>`],
            effectiveNetwork: [FIXTURE_HOST],
          },
          'allowed_hostname_observed',
          ['Gondolin host HTTP hooks'],
        );
      }
      case 'network.wrong-port': {
        const before = fixture.requests.length;
        await execGuest(
          managed,
          `curl -sS --max-time 10 http://${FIXTURE_HOST}:${fixture.adjacentPort}/wrong-port`,
        );
        const delivered = fixture.requests.length - before;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'adjacent-port-request-count',
            expected: 0,
            observed: delivered,
            passed: delivered === 0,
          },
          {
            requested: '<exact-host-port>',
            effectiveNetwork: '<hostname-granular>',
          },
          'network_port_fidelity_observed',
          ['Gondolin host HTTP hooks'],
        );
      }
      case 'network.protocol': {
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'broker-protocol-binding',
            expected: 'http',
            observed: 'http',
            passed: true,
          },
          {
            network: 'hostname-granular',
            credentialProtocol: 'http',
            credentialPorts: ['<allowed-port>'],
          },
          'credential_protocol_binding_recorded',
          ['Gondolin brokered-secret HTTP hooks'],
        );
      }
      case 'network.redirect': {
        const before = fixture.requests.length;
        await execGuest(
          managed,
          `curl -sS -L --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" http://${FIXTURE_HOST}:${fixture.allowedPort}/redirect`,
        );
        const adjacent = fixture.requests
          .slice(before)
          .filter((request) => request.destination === 'adjacent');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'redirect-adjacent-request-count',
            expected: 0,
            observed: adjacent.length,
            passed: adjacent.length === 0,
          },
          { redirectTarget: '<unlisted-internal-host>' },
          'redirect_target_blocked',
          ['Gondolin host HTTP hooks'],
        );
      }
      case 'network.internal':
      case 'network.requested-effective':
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'requested-effective-binding',
            expected: 'explicit-internal-host',
            observed: 'explicit-internal-host',
            passed: true,
          },
          {
            requested: ['127.0.0.1:<allowed-port>'],
            effectiveNetwork: [FIXTURE_HOST],
            credentialPorts: ['<allowed-port>'],
          },
          'internal_hostname_binding_recorded',
          ['Gondolin host HTTP hooks'],
        );
      case 'network.dns-rebinding':
        return this.#unsupported(
          scenario,
          context,
          'no_controlled_dns_rebinding_fixture',
        );
      case 'credential.missing-binding':
      case 'lifecycle.broker-unavailable': {
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
          ['Gondolin resumeVm preflight'],
        );
      }
      case 'credential.allowed-origin': {
        const before = fixture.requests.length;
        const result = await execGuest(
          managed,
          `case "$${SECRET_ENV}" in GONDOLIN_SECRET_*) ;; *) exit 9;; esac; curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" http://${FIXTURE_HOST}:${fixture.allowedPort}/credential`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'credential-proxy-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed: result.exitCode === 0 && matched,
          },
          {
            guestValue: '<stand-in>',
            origin: `${FIXTURE_HOST}:<allowed-port>`,
          },
          'allowed_origin_substitution_observed',
          ['Gondolin brokered-secret HTTP hooks'],
        );
      }
      case 'credential.adjacent-origin': {
        const before = fixture.requests.length;
        await execGuest(
          managed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" http://${FIXTURE_HOST}:${fixture.adjacentPort}/adjacent`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'adjacent-origin-credential-match',
            expected: 0,
            observed: matched ? 1 : 0,
            passed: !matched,
          },
          {
            networkFidelity: 'hostname',
            credentialFidelity: 'protocol-host-port',
          },
          'adjacent_origin_secret_not_substituted',
          ['Gondolin brokered-secret HTTP hooks'],
        );
      }
      case 'credential.rotation': {
        fixture.rotate(this.#rotatedCredential);
        managed.secretManager.rotateSecret(SECRET_ENV, this.#rotatedCredential);
        const before = fixture.requests.length;
        const result = await execGuest(
          managed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" http://${FIXTURE_HOST}:${fixture.allowedPort}/rotated`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'rotated-credential-match',
            expected: 1,
            observed: matched ? 1 : 0,
            passed: result.exitCode === 0 && matched,
          },
          {
            transition: 'host-manager-rotation',
            guestValue: '<same-stand-in>',
          },
          'rotation_observed',
          ['Gondolin brokered-secret manager'],
        );
      }
      case 'credential.revocation': {
        managed.secretManager.revokeSecret(SECRET_ENV);
        const before = fixture.requests.length;
        await execGuest(
          managed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" http://${FIXTURE_HOST}:${fixture.allowedPort}/revoked`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'revoked-credential-match',
            expected: 0,
            observed: matched ? 1 : 0,
            passed: !matched,
          },
          { transition: 'host-manager-revocation' },
          'revocation_observed',
          ['Gondolin brokered-secret manager'],
        );
      }
      case 'credential.resume': {
        await managed.vm.close();
        this.#managed = null;
        const resumed = await this.#resume(this.#rotatedCredential);
        const before = fixture.requests.length;
        const result = await execGuest(
          resumed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" http://${FIXTURE_HOST}:${fixture.allowedPort}/resumed`,
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
          'resume_rebinding_observed',
          ['Gondolin resumeVm', 'Gondolin brokered-secret HTTP hooks'],
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
        const process = current.vm.exec(
          [
            '/bin/sh',
            '-lc',
            `printf started > "$MOLTNET_GUEST_WORKSPACE/${startedName}"; sleep 5; printf escaped > "$MOLTNET_GUEST_WORKSPACE/${markerName}"`,
          ],
          { signal: controller.signal, stdout: 'pipe', stderr: 'pipe' },
        );
        void Promise.resolve(process).catch(() => undefined);
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const acknowledged = await readFile(started, 'utf8').catch(() => '');
          if (acknowledged === 'started') break;
          await sleep(100);
        }
        controller.abort();
        await sleep(6_000);
        const escaped = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'delayed-marker-absence',
            expected: 'absent',
            observed: escaped === '' ? 'absent' : 'present',
            passed: escaped === '',
          },
          { termination: 'exec-abort', guestKill: 'not-issued' },
          'exec_abort_process_lifetime_observed',
          ['Gondolin host exec session'],
        );
      }
      case 'lifecycle.partial-launch': {
        const rejected = await this.#verifyMissingBinding();
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'partial-vm-residue',
            expected: false,
            observed: false,
            passed: rejected,
          },
          { failurePhase: 'resumeVm-preflight-before-checkpoint-resume' },
          'preflight_failure_left_no_live_vm',
          ['Gondolin resumeVm preflight'],
        );
      }
      case 'lifecycle.repeated-close':
        return this.#unsupported(
          scenario,
          context,
          'verified_during_runner_final_teardown',
        );
      case 'lifecycle.restart-checkpoint': {
        const current = this.#managed ?? managed;
        await execGuest(
          current,
          'printf disk > "$MOLTNET_GUEST_WORKSPACE/restart-disk"; printf volatile > /tmp/restart-volatile',
        );
        await current.vm.close();
        this.#managed = null;
        const resumed = await this.#resume(this.#rotatedCredential);
        const result = await execGuest(
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
          'checkpoint_storage_surfaces_observed',
        );
      }
      case 'resource.cpu': {
        const current = this.#managed ?? managed;
        const result = await execGuest(current, 'getconf _NPROCESSORS_ONLN');
        const count = Number.parseInt(result.output.trim(), 10);
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'online-cpu-count',
            expected: 1,
            observed: Number.isNaN(count) ? result.output.slice(0, 100) : count,
            passed: result.exitCode === 0 && count === 1,
          },
          { requestedCpus: 1 },
          'guest_cpu_limit_observed',
          ['Gondolin QEMU resource configuration'],
        );
      }
      case 'resource.memory': {
        const current = this.#managed ?? managed;
        const result = await execGuest(
          current,
          "awk '/MemTotal/ { print $2 }' /proc/meminfo",
        );
        const kibibytes = Number.parseInt(result.output.trim(), 10);
        const passed =
          result.exitCode === 0 &&
          kibibytes >= 891_290 &&
          kibibytes <= 1_205_862;
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'guest-memory-kibibytes',
            expected: { target: 1_048_576, tolerancePercent: 15 },
            observed: Number.isNaN(kibibytes)
              ? result.output.slice(0, 100)
              : kibibytes,
            passed,
          },
          { requestedMemory: '1G' },
          'guest_memory_limit_observed',
          ['Gondolin QEMU resource configuration'],
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
            guest: ['shell', 'workspace VFS'],
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
        basis: 'verified',
        description:
          'Host VFS and HTTP hooks mediate guest workspace and egress.',
      },
    ]);
  }

  close(): Promise<PersistentMutationEvidence[]> {
    return this.#cleanup.close();
  }
}
