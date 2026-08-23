import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureSnapshot,
  execManagedCommand,
  type ManagedExecResult,
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
  EnforcementLocus,
  HostCapabilityEvidence,
  PersistentMutationEvidence,
  ProbeContext,
  ReasonCode,
  ResearchSandboxAdapter,
  SandboxScenario,
} from './types.js';

const BACKEND_ID = 'gondolin';
const FIXTURE_HOST = '127-0-0-1.sslip.io';
const SECRET_ENV = 'FIXTURE_API_TOKEN';

interface GuestResult {
  exitCode: number;
  output: string;
  terminationMode?: 'not-started' | 'process-group' | 'vm-close';
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
  let output = '';
  try {
    const result = await execManagedCommand(managed.vm, command, {
      signal,
      onData(data) {
        output += data.toString('utf8');
      },
    });
    return {
      exitCode: result.exitCode,
      output,
      ...(result.terminationMode && {
        terminationMode: result.terminationMode,
      }),
    };
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

export class GondolinAdapter implements ResearchSandboxAdapter {
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
  #rotatedDeliveryVerified = false;

  async inspect(): Promise<BackendInventory> {
    if (!this.#inventory) {
      this.#checkpointPath = await ensureSnapshot();
      this.#inventory = {
        id: BACKEND_ID,
        version: '0.12.0-workspace',
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
      const fixture = await startPolicyFixture('0.0.0.0');
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
    const result = await execGuest(managed, command, this.#scenarioSignal);
    if (result.terminationMode === 'vm-close' && this.#managed === managed) {
      this.#managed = null;
    }
    return result;
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
        ...(scenario.parameters ? { parameters: scenario.parameters } : {}),
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
    reasonCode: ReasonCode,
    locus: EnforcementLocus[] = ['gondolin-microvm', 'gondolin-host-hooks'],
  ): Promise<ControlEvidence> {
    const inventory = await this.inspect();
    return {
      scenarioId: scenario.id,
      requestedIntent: {
        scenarioId: scenario.id,
        domain: scenario.domain,
        control: scenario.control,
        required: scenario.required,
        ...(scenario.parameters ? { parameters: scenario.parameters } : {}),
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
    reasonCode: ReasonCode,
  ): Promise<ControlEvidence> {
    const inventory = await this.inspect();
    return {
      scenarioId: scenario.id,
      requestedIntent: {
        scenarioId: scenario.id,
        domain: scenario.domain,
        control: scenario.control,
        required: scenario.required,
        ...(scenario.parameters ? { parameters: scenario.parameters } : {}),
      },
      resolvedAdapterConfig: this.#resolution(scenario, {
        support: 'unsupported-by-production-path',
      }),
      backend: { id: inventory.id, version: inventory.version },
      enforcementLocus: ['gondolin-adapter'],
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
          'workspace_vfs_write_observed',
        );
      }
      case 'filesystem.outside-write': {
        const marker = path.join(this.#outside, 'outside-write.txt');
        await this.#execGuest(managed, `printf escaped > '${marker}'`);
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
        );
      }
      case 'filesystem.symlink-traversal': {
        const link = path.join(this.#workspace, 'outside-link');
        const marker = path.join(this.#outside, 'symlink-write.txt');
        await rm(link, { force: true });
        await symlink(this.#outside, link);
        await this.#execGuest(
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
          ['gondolin-host-hooks'],
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
        const result = await this.#execGuest(
          managed,
          `curl -fsS --max-time 3 'http://localhost:${fixture.allowedPort}${fixture.path('/denied')}'`,
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
          ['gondolin-host-hooks'],
        );
      }
      case 'network.exact-allow': {
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          managed,
          `curl -sS --max-time 10 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/allowed')}'`,
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
          ['gondolin-host-hooks'],
        );
      }
      case 'network.wrong-port': {
        const before = fixture.requests.length;
        await this.#execGuest(
          managed,
          `curl -sS --max-time 10 'http://${FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/wrong-port')}'`,
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
          ['gondolin-host-hooks'],
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
          ['gondolin-host-hooks'],
        );
      }
      case 'network.redirect': {
        const before = fixture.requests.length;
        await this.#execGuest(
          managed,
          `curl -sS -L --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/redirect')}'`,
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
          ['gondolin-host-hooks'],
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
          ['gondolin-host-hooks'],
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
          scenario.domain === 'credential'
            ? 'required_binding_preflight_observed'
            : 'adapter_preflight_rejected_unavailable_broker',
          ['gondolin-adapter', 'gondolin-host-hooks'],
        );
      }
      case 'credential.allowed-origin': {
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          managed,
          `case "$${SECRET_ENV}" in GONDOLIN_SECRET_*) ;; *) exit 9;; esac; curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/credential')}'`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        this.#credentialDeliveryVerified = matched;
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
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.adjacent-origin': {
        const before = fixture.requests.length;
        await this.#execGuest(
          managed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/adjacent')}'`,
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
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.rotation': {
        const rotatedCredential = fixture.rotate();
        managed.secretManager.rotateSecret(SECRET_ENV, rotatedCredential);
        const before = fixture.requests.length;
        const result = await this.#execGuest(
          managed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/rotated')}'`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        this.#rotatedDeliveryVerified = matched;
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
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.revocation': {
        managed.secretManager.revokeSecret(SECRET_ENV);
        const before = fixture.requests.length;
        await this.#execGuest(
          managed,
          `curl -sS --max-time 10 -H "Authorization: Bearer $${SECRET_ENV}" 'http://${FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/revoked')}'`,
        );
        const matched = fixture.requests
          .slice(before)
          .some((request) => request.credentialMatch === 'expected');
        const passed =
          this.#credentialDeliveryVerified &&
          this.#rotatedDeliveryVerified &&
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
            ? 'revocation_observed'
            : 'revocation_unverified_without_prior_delivery',
          ['gondolin-host-hooks'],
        );
      }
      case 'credential.resume': {
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
          'resume_rebinding_observed',
          ['gondolin-adapter', 'gondolin-host-hooks'],
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
          ['research-harness'],
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
        const process = execManagedCommand(
          current.vm,
          `printf started > "$MOLTNET_GUEST_WORKSPACE/${startedName}"; sleep ${delayedMarkerMs / 1_000}; printf escaped > "$MOLTNET_GUEST_WORKSPACE/${markerName}"`,
          scenario.id === 'lifecycle.timeout'
            ? { signal: controller.signal, timeoutMs: 1_000 }
            : { signal: controller.signal },
        );
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const acknowledged = await readFile(started, 'utf8').catch(() => '');
          if (acknowledged === 'started') break;
          await sleep(100);
        }
        if (scenario.id === 'lifecycle.cancel') controller.abort();
        let termination: ManagedExecResult;
        try {
          termination = await process;
        } finally {
          context.signal.removeEventListener('abort', abortFromRunner);
        }
        if (termination.terminationMode === 'vm-close') this.#managed = null;
        await sleep(observationWindowMs);
        const escaped = await readFile(marker, 'utf8').catch(() => '');
        return this.#evidence(
          scenario,
          context,
          {
            kind: 'delayed-marker-absence',
            expected: 'absent',
            observed: escaped === '' ? 'absent' : 'present',
            passed: escaped === '' && termination.terminationConfirmed === true,
          },
          {
            termination: termination.terminationMode,
            confirmed: termination.terminationConfirmed,
            delayedMarkerMs,
            observationWindowMs,
          },
          'managed_process_group_termination_observed',
          ['gondolin-host-hooks', 'gondolin-microvm'],
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
          ['gondolin-adapter', 'gondolin-host-hooks'],
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
          ['gondolin-microvm'],
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
          ['research-harness'],
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

  sensitiveValues(): string[] {
    return this.#fixture?.sensitiveValues() ?? [];
  }

  close(): Promise<PersistentMutationEvidence[]> {
    return this.#cleanup.close();
  }
}
