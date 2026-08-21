import { existsSync, statSync } from 'node:fs';

import type {
  BrokeredCredentialBinding,
  EnforcementRecord,
  PreflightIssue,
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxHandle,
  SandboxLaunchPlan,
} from '@themoltnet/runtime-core';
import { stateForUnavailableControl } from '@themoltnet/runtime-core';

import type { SandboxConfig } from '../snapshot.js';
import {
  type BrokeredSecret,
  type ManagedVm,
  resumeVm,
  type VmConfig,
} from '../vm-manager.js';

export const GONDOLIN_SANDBOX_ADAPTER_ID = 'gondolin';
export const GONDOLIN_SANDBOX_ADAPTER_VERSION = '0.1.0';

/**
 * Base platform hosts `resumeVm` always allows so the Pi kernel can reach its
 * model provider, the MoltNet API, npm, and GitHub. The adapter reports them
 * because a profile's `allowedHosts` is not the full effective allowlist.
 */
export const GONDOLIN_PLATFORM_EGRESS_NOTE =
  'effective allowlist = plan.network.allowedHosts + runtime platform hosts (model provider, MoltNet API, npm, GitHub); matching is hostname-granular with no port component';

export interface GondolinSandboxAdapterOptions {
  /**
   * Trusted local binding: where this machine keeps the Gondolin checkpoint.
   * Either an absolute path or a resolver (e.g. `ensureSnapshot`). Never part
   * of a portable profile.
   */
  checkpoint: string | (() => Promise<string>);
  /**
   * Agent name used only to shape guest paths; in `host-authenticated` mode
   * no agent files are read or injected. Default `sandbox`.
   */
  agentName?: string;
  /** Injectable for tests. */
  resume?: (config: VmConfig) => Promise<ManagedVm>;
  version?: string;
}

function capabilityReport(version: string): SandboxCapabilityReport {
  return {
    adapter: { id: GONDOLIN_SANDBOX_ADAPTER_ID, version },
    capabilities: [
      {
        capability: 'filesystem-scope',
        state: 'enforced',
        locus: 'guest-sandbox',
        reason:
          'workspace is the only host mount; deny paths are shadowed by the VFS layer (deny or tmpfs)',
      },
      {
        capability: 'network-egress',
        state: 'enforced',
        locus: 'host-broker',
        reason: GONDOLIN_PLATFORM_EGRESS_NOTE,
      },
      {
        capability: 'child-process-containment',
        state: 'enforced',
        locus: 'guest-sandbox',
        reason: 'all guest processes share the microVM boundary',
      },
      {
        capability: 'resource-limits',
        state: 'enforced',
        locus: 'guest-sandbox',
        reason: 'memory and cpu are fixed at VM resume',
      },
      {
        capability: 'host-env-isolation',
        state: 'enforced',
        locus: 'guest-sandbox',
        reason:
          'guest environment is explicit; host environment is never inherited',
      },
      {
        capability: 'brokered-credential',
        state: 'enforced',
        locus: 'host-broker',
        reason:
          'guest sees a placeholder; the host HTTP proxy substitutes the value only for the declared host patterns',
      },
      {
        capability: 'timeout-cancellation',
        state: 'enforced',
        locus: 'guest-sandbox',
        reason: 'exec honors an abort signal; timeout is an adapter-side abort',
      },
    ],
    hostPowers: [
      { power: 'host-exec', locus: 'outside-containment' },
      { power: 'host-mcp', locus: 'outside-containment' },
    ],
  };
}

function toSandboxConfig(plan: SandboxLaunchPlan): SandboxConfig {
  return {
    network: {
      allowedHosts: [...plan.network.allowedHosts],
      allowedInternalHosts: [...plan.network.allowedInternalHosts],
    },
    ...(plan.filesystem.denyPaths.length > 0
      ? {
          vfs: {
            shadow: [...plan.filesystem.denyPaths],
            shadowMode: plan.filesystem.denyMode,
          },
        }
      : {}),
    env: { ...plan.env },
    ...(plan.resources ? { resources: { ...plan.resources } } : {}),
  };
}

async function resolveBrokeredSecrets(
  credentials: readonly BrokeredCredentialBinding[],
): Promise<Record<string, BrokeredSecret>> {
  const secrets: Record<string, BrokeredSecret> = {};
  for (const binding of credentials) {
    secrets[binding.envName] = {
      hosts: binding.destinationHosts,
      value: await binding.resolve(),
    };
  }
  return secrets;
}

export function createGondolinSandboxAdapter(
  options: GondolinSandboxAdapterOptions,
): SandboxAdapter {
  const version = options.version ?? GONDOLIN_SANDBOX_ADAPTER_VERSION;
  const agentName = options.agentName ?? 'sandbox';
  const resume = options.resume ?? resumeVm;
  const resolveCheckpoint = async () =>
    typeof options.checkpoint === 'string'
      ? options.checkpoint
      : options.checkpoint();

  const validatePlan = (plan: SandboxLaunchPlan): PreflightIssue[] => {
    const issues: PreflightIssue[] = [];
    if (plan.workspace.mode === 'read-only') {
      issues.push({
        code: 'plan_invalid',
        capability: 'filesystem-scope',
        message:
          'gondolin adapter does not implement a read-only workspace mount yet; request read-write with deny paths',
      });
    }
    for (const denyPath of plan.filesystem.denyPaths) {
      if (denyPath.startsWith('/')) {
        issues.push({
          code: 'plan_invalid',
          capability: 'filesystem-scope',
          message: `deny path "${denyPath}" must be workspace-relative`,
        });
      }
    }
    if (
      !existsSync(plan.workspace.hostPath) ||
      !statSync(plan.workspace.hostPath).isDirectory()
    ) {
      issues.push({
        code: 'workspace_unavailable',
        message: 'workspace host path is not a directory',
      });
    }
    for (const binding of plan.credentials) {
      if (typeof binding.resolve !== 'function') {
        issues.push({
          code: 'credential_binding_missing',
          requirementId: binding.requirementId,
          message: `credential "${binding.requirementId}" has no host-side resolver`,
        });
      }
      if (binding.envName in plan.env) {
        issues.push({
          code: 'plan_invalid',
          requirementId: binding.requirementId,
          message: `credential "${binding.requirementId}" env name collides with an explicit env value`,
        });
      }
    }
    return issues;
  };

  return {
    id: GONDOLIN_SANDBOX_ADAPTER_ID,
    version,
    describe: () => capabilityReport(version),
    async preflight(plan) {
      const issues = validatePlan(plan);
      if (
        typeof options.checkpoint === 'string' &&
        !existsSync(options.checkpoint)
      ) {
        issues.push({
          code: 'adapter_unavailable',
          message: 'gondolin checkpoint is not present on this machine',
        });
      }
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, warnings: [] };
    },
    async launch(plan, launchOptions = {}) {
      const issues = validatePlan(plan);
      if (issues.length > 0) {
        throw new Error(
          `gondolin launch refused: ${issues.map((i) => i.message).join('; ')}`,
        );
      }
      const checkpointPath = await resolveCheckpoint();
      // Values are resolved as late as possible and handed only to the host
      // proxy; they are not retained on the handle.
      const brokeredSecrets = await resolveBrokeredSecrets(plan.credentials);
      const managed = await resume({
        checkpointPath,
        agentName,
        agentRootDir: plan.workspace.hostPath,
        guestCredentialMode: 'host-authenticated',
        mountPath: plan.workspace.hostPath,
        workspaceMode: 'scratch_mount',
        sandboxConfig: toSandboxConfig(plan),
        brokeredSecrets,
        signal: launchOptions.signal,
        onDiagnostic: (diagnostic) =>
          launchOptions.onProgress?.(diagnostic.message),
      });
      return new GondolinHandle(
        { id: GONDOLIN_SANDBOX_ADAPTER_ID, version },
        managed,
        plan,
        capabilityReport(version),
      );
    },
  };
}

class GondolinHandle implements SandboxHandle {
  readonly guestWorkspace: string;
  private closed = false;
  private readonly records: EnforcementRecord[] = [];

  constructor(
    readonly adapter: { id: string; version: string },
    private readonly managed: ManagedVm,
    private readonly plan: SandboxLaunchPlan,
    report: SandboxCapabilityReport,
  ) {
    this.guestWorkspace = managed.guestWorkspace;
    const observedAt = new Date().toISOString();
    for (const capability of report.capabilities) {
      const intended = plan.requirements[capability.capability] ?? 'none';
      if (
        capability.capability === 'brokered-credential' &&
        plan.credentials.length === 0
      ) {
        this.records.push({
          control: capability.capability,
          locus: capability.locus,
          intended,
          state: 'enforced',
          reason: 'no credential requested; nothing delivered',
          observedAt,
        });
        continue;
      }
      this.records.push({
        control: capability.capability,
        locus: capability.locus,
        intended,
        state: capability.state,
        reason: capability.reason,
        observedAt,
      });
    }
    for (const power of report.hostPowers) {
      this.records.push({
        control: power.power,
        locus: power.locus,
        intended: 'none',
        state: 'unsupported',
        reason: 'runs on the host; not contained by the guest VM',
        observedAt,
      });
    }
  }

  observe(): readonly EnforcementRecord[] {
    return [...this.records];
  }

  async exec(
    command: string,
    options: SandboxExecOptions = {},
  ): Promise<SandboxExecResult> {
    if (this.closed) {
      throw new Error('gondolin sandbox is closed');
    }
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      controller.abort();
    };
    if (options.signal?.aborted) onAbort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, options.timeoutMs)
        : undefined;
    try {
      const result = await this.managed.vm.exec(['/bin/sh', '-c', command], {
        signal: controller.signal,
        cwd: options.cwd ?? this.guestWorkspace,
        ...(options.env ? { env: { ...options.env } } : {}),
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut,
        cancelled: cancelled && !timedOut,
      };
    } catch (error) {
      if (timedOut || cancelled) {
        return {
          exitCode: timedOut ? 124 : 130,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          timedOut,
          cancelled: cancelled && !timedOut,
        };
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  async close() {
    if (this.closed) return { cleaned: true, residue: [] };
    this.closed = true;
    const residue: string[] = [];
    try {
      await this.managed.vm.close();
    } catch (error) {
      residue.push(
        `vm.close failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const observedAt = new Date().toISOString();
    for (const record of [...this.records]) {
      if (record.state === 'enforced') {
        this.records.push({
          ...record,
          state: stateForUnavailableControl(record.intended, record.state),
          reason: 'sandbox closed',
          observedAt,
        });
      }
    }
    return { cleaned: residue.length === 0, residue };
  }
}
