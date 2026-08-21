import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

import {
  type BrokeredSecret,
  GONDOLIN_BASE_ALLOWED_HOSTS,
  type ManagedVm,
  resumeVm,
  type SandboxConfig,
  type VmConfig,
} from '@themoltnet/pi-runtime';
import type {
  BrokeredCredentialBinding,
  DestinationConstraint,
  EnforcementRecord,
  PreflightIssue,
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxCleanupReport,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxHandle,
  SandboxLaunchPlan,
} from '@themoltnet/runtime-core';
import {
  destinationExpressible,
  formatDestination,
  stateForUnavailableControl,
} from '@themoltnet/runtime-core';

export const GONDOLIN_SANDBOX_ADAPTER_ID = 'gondolin';
export const GONDOLIN_SANDBOX_ADAPTER_VERSION = '0.2.0';

/** Default MoltNet API host `resumeVm` always allows. */
export const DEFAULT_MOLTNET_API_HOST = 'api.themolt.net';

export const GONDOLIN_PLATFORM_EGRESS_NOTE =
  'egress policy is hostname-granular (no scheme or port); the runtime always permits its platform hosts, which resolution merges into the effective policy';

export interface GondolinSandboxAdapterOptions {
  /**
   * Trusted local binding: where this machine keeps the Gondolin checkpoint.
   * Either an absolute path or a resolver (e.g. `ensureSnapshot`). Never part
   * of a portable intent.
   */
  checkpoint: string | (() => Promise<string>);
  /**
   * Agent name used only to shape guest paths; in `host-authenticated` mode
   * no agent files are read or injected. Default `sandbox`.
   */
  agentName?: string;
  /** MoltNet API host the runtime permits. Default `api.themolt.net`. */
  moltnetApiHost?: string;
  /** Injectable for tests. */
  resume?: (config: VmConfig) => Promise<ManagedVm>;
  version?: string;
}

function mandatoryEgress(apiHost: string): DestinationConstraint[] {
  return [...GONDOLIN_BASE_ALLOWED_HOSTS, apiHost].map((host) => ({ host }));
}

function capabilityReport(
  version: string,
  apiHost: string,
): SandboxCapabilityReport {
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
          'guest sees a placeholder; the host HTTP proxy substitutes the value only for the declared hostnames (no scheme or port narrowing)',
      },
      {
        capability: 'timeout-cancellation',
        state: 'enforced',
        locus: 'guest-sandbox',
        reason:
          'commands run in their own guest session; timeout or abort kills the process group and confirms it is gone',
      },
    ],
    network: { fidelity: 'host', mandatoryEgress: mandatoryEgress(apiHost) },
    hostPowers: [
      { power: 'host-exec', locus: 'outside-containment' },
      { power: 'host-mcp', locus: 'outside-containment' },
    ],
  };
}

function toSandboxConfig(plan: SandboxLaunchPlan): SandboxConfig {
  return {
    network: {
      // Fidelity is `host`: only hostnames reach the proxy policy. Resolution
      // already refused destinations that needed scheme or port narrowing.
      allowedHosts: [
        ...new Set(
          plan.network.requested.allowedDestinations.map((d) => d.host),
        ),
      ],
      allowedInternalHosts: [...plan.network.effective.allowedInternalHosts],
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

export function createGondolinSandboxAdapter(
  options: GondolinSandboxAdapterOptions,
): SandboxAdapter {
  const version = options.version ?? GONDOLIN_SANDBOX_ADAPTER_VERSION;
  const agentName = options.agentName ?? 'sandbox';
  const apiHost = options.moltnetApiHost ?? DEFAULT_MOLTNET_API_HOST;
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
    const inexpressible = [
      ...plan.network.requested.allowedDestinations,
      ...plan.credentials.flatMap((c) => c.destinations),
    ].filter((d) => !destinationExpressible(d, 'host'));
    if (inexpressible.length > 0) {
      issues.push({
        code: 'plan_invalid',
        capability: 'network-egress',
        message: `gondolin cannot narrow destinations by scheme or port: ${inexpressible.map(formatDestination).join(', ')}`,
      });
    }
    const envNames = new Set<string>();
    const requirementIds = new Set<string>();
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
      if (
        envNames.has(binding.envName) ||
        requirementIds.has(binding.requirementId)
      ) {
        issues.push({
          code: 'credential_binding_duplicate',
          requirementId: binding.requirementId,
          message: `credential "${binding.requirementId}" / ${binding.envName} is bound more than once`,
        });
      }
      envNames.add(binding.envName);
      requirementIds.add(binding.requirementId);
    }
    return issues;
  };

  return {
    id: GONDOLIN_SANDBOX_ADAPTER_ID,
    version,
    describe: () => capabilityReport(version, apiHost),
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
      // Order matters: checkpoint and cancellation are validated before any
      // secret is read, so a launch that cannot proceed never touches a value.
      const checkpointPath = await resolveCheckpoint();
      if (!existsSync(checkpointPath)) {
        throw new Error(
          'gondolin launch refused: resolved checkpoint does not exist',
        );
      }
      if (launchOptions.signal?.aborted) {
        throw new Error('gondolin launch aborted before start');
      }
      const brokeredSecrets = await resolveBrokeredSecrets(plan.credentials);
      if (launchOptions.signal?.aborted) {
        throw new Error('gondolin launch aborted after credential resolution');
      }
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
        capabilityReport(version, apiHost),
      );
    },
  };
}

async function resolveBrokeredSecrets(
  credentials: readonly BrokeredCredentialBinding[],
): Promise<Record<string, BrokeredSecret>> {
  const secrets: Record<string, BrokeredSecret> = {};
  for (const binding of credentials) {
    secrets[binding.envName] = {
      hosts: [...new Set(binding.destinations.map((d) => d.host))],
      value: await binding.resolve(),
    };
  }
  return secrets;
}

/**
 * Guest-side wrapper: run the command as its own session leader so the
 * whole process group can be killed on timeout or abort. The pgid file is
 * guest-local tmpfs state and is removed on exit.
 */
function wrapForTermination(command: string, pgidFile: string): string[] {
  const script = [
    'set -u',
    'setsid /bin/sh -c "$1" </dev/null &',
    'pid=$!',
    'printf %s "$pid" > "$2"',
    'wait "$pid"',
    'rc=$?',
    'rm -f "$2"',
    'exit "$rc"',
  ].join('\n');
  return ['/bin/sh', '-c', script, 'moltnet-exec', command, pgidFile];
}

const KILL_SCRIPT = [
  'pgid=$(cat "$1" 2>/dev/null) || exit 0',
  'kill -KILL -- "-$pgid" 2>/dev/null',
  'kill -KILL "$pgid" 2>/dev/null',
  'rm -f "$1"',
  // Confirm: neither the group nor the leader answers signal 0.
  'if kill -0 -- "-$pgid" 2>/dev/null || kill -0 "$pgid" 2>/dev/null; then exit 3; fi',
  'exit 0',
].join('\n');

class GondolinHandle implements SandboxHandle {
  readonly guestWorkspace: string;
  private closed = false;
  private closeReport: Promise<SandboxCleanupReport> | null = null;
  private readonly records: EnforcementRecord[] = [];

  constructor(
    readonly adapter: { id: string; version: string },
    private readonly managed: ManagedVm,
    private readonly plan: SandboxLaunchPlan,
    report: SandboxCapabilityReport,
  ) {
    this.guestWorkspace = managed.guestWorkspace;
    const recordedAt = new Date().toISOString();
    const applied = (
      control: EnforcementRecord['control'],
      reason: string,
    ): void => {
      const declared = report.capabilities.find(
        (c) => c.capability === control,
      );
      this.records.push({
        control,
        locus: declared?.locus ?? 'guest-sandbox',
        intended:
          plan.requirements[control as keyof typeof plan.requirements] ??
          'none',
        state: 'enforced',
        basis: 'applied',
        reason,
        recordedAt,
      });
    };
    // Controls configured for this launch are `applied`; the VM boundary
    // itself is structural and recorded as applied with its reason.
    applied(
      'filesystem-scope',
      `workspace mounted read-write; ${plan.filesystem.denyPaths.length} deny path(s) shadowed (${plan.filesystem.denyMode})`,
    );
    applied(
      'network-egress',
      `host proxy allowlist: ${plan.network.effective.allowedDestinations.map((d) => d.host).join(', ')} (hostname-granular)`,
    );
    applied('child-process-containment', 'microVM boundary');
    applied('host-env-isolation', 'explicit guest environment only');
    if (plan.resources) {
      applied(
        'resource-limits',
        `memory=${plan.resources.memory ?? 'default'} cpus=${plan.resources.cpus ?? 'default'}`,
      );
    } else {
      this.records.push({
        control: 'resource-limits',
        locus: 'guest-sandbox',
        intended: plan.requirements['resource-limits'] ?? 'none',
        state: 'enforced',
        basis: 'declared',
        reason: 'runtime defaults; no explicit limits requested',
        recordedAt,
      });
    }
    applied(
      'brokered-credential',
      plan.credentials.length === 0
        ? 'no credential requested; nothing delivered'
        : `${plan.credentials.length} placeholder(s) substituted only for ${plan.credentials.flatMap((c) => c.destinations.map((d) => d.host)).join(', ')}`,
    );
    this.records.push({
      control: 'timeout-cancellation',
      locus: 'guest-sandbox',
      intended: plan.requirements['timeout-cancellation'] ?? 'none',
      state: 'enforced',
      basis: 'declared',
      reason: 'confirmed per command when a timeout or abort occurs',
      recordedAt,
    });
    for (const power of report.hostPowers) {
      this.records.push({
        control: power.power,
        locus: power.locus,
        intended: 'none',
        state: 'unsupported',
        basis: 'declared',
        reason: 'runs on the host; not contained by the guest VM',
        recordedAt,
      });
    }
  }

  observe(): readonly EnforcementRecord[] {
    return [...this.records];
  }

  private async killGroup(pgidFile: string): Promise<boolean> {
    try {
      const r = await this.managed.vm.exec(
        ['/bin/sh', '-c', KILL_SCRIPT, 'moltnet-kill', pgidFile],
        {},
      );
      return r.exitCode === 0;
    } catch {
      return false;
    }
  }

  async exec(
    command: string,
    options: SandboxExecOptions = {},
  ): Promise<SandboxExecResult> {
    if (this.closed) {
      throw new Error('gondolin sandbox is closed');
    }
    const pgidFile = `/tmp/.moltnet-exec-${randomBytes(6).toString('hex')}.pgid`;
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
      const result = await this.managed.vm.exec(
        wrapForTermination(command, pgidFile),
        {
          signal: controller.signal,
          cwd: options.cwd ?? this.guestWorkspace,
          ...(options.env ? { env: { ...options.env } } : {}),
        },
      );
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut,
        cancelled: cancelled && !timedOut,
      };
    } catch (error) {
      if (timedOut || cancelled) {
        // Gondolin only drops the host session on abort; kill the guest
        // process group ourselves and confirm it is gone.
        const terminationConfirmed = await this.killGroup(pgidFile);
        this.records.push({
          control: 'timeout-cancellation',
          locus: 'guest-sandbox',
          intended: this.plan.requirements['timeout-cancellation'] ?? 'none',
          state: terminationConfirmed ? 'enforced' : 'failed-open',
          basis: 'applied',
          reason: terminationConfirmed
            ? `${timedOut ? 'timeout' : 'abort'}: guest process group killed and confirmed gone`
            : `${timedOut ? 'timeout' : 'abort'}: guest process group could not be confirmed terminated`,
          recordedAt: new Date().toISOString(),
        });
        return {
          exitCode: timedOut ? 124 : 130,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          timedOut,
          cancelled: cancelled && !timedOut,
          terminationConfirmed,
        };
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  close(): Promise<SandboxCleanupReport> {
    this.closeReport ??= (async () => {
      this.closed = true;
      const residue: string[] = [];
      try {
        await this.managed.vm.close();
      } catch (error) {
        residue.push(
          `vm.close failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const recordedAt = new Date().toISOString();
      for (const record of [...this.records]) {
        if (record.state === 'enforced') {
          this.records.push({
            ...record,
            state: stateForUnavailableControl(record.intended, record.state),
            basis: 'applied',
            reason: 'sandbox closed',
            recordedAt,
          });
        }
      }
      return { cleaned: residue.length === 0, residue };
    })();
    return this.closeReport;
  }
}
