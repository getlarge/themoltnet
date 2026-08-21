import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type DestinationConstraint, destinationWithin } from '../intent.js';
import type {
  EnforcementRecord,
  NetworkFidelity,
  PreflightIssue,
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxExecResult,
  SandboxHandle,
  SandboxLaunchPlan,
} from '../sandbox-adapter.js';
import { stateForUnavailableControl } from '../states.js';
import { parseRecipe, type Recipe } from './recipes.js';

export interface ReferenceAdapterOptions {
  /** Simulate an adapter that cannot provide these capabilities. */
  unsupported?: readonly SandboxCapabilityReport['capabilities'][number]['capability'][];
  /** Simulated destination granularity. Default `host-port`. */
  fidelity?: NetworkFidelity;
  /** Simulated platform egress the adapter always permits. Default none. */
  mandatoryEgress?: readonly DestinationConstraint[];
  /** Make `fetch` observable; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Hostnames treated as loopback aliases the simulated guest can resolve. */
  loopbackHostnames?: readonly string[];
}

/**
 * In-memory reference implementation. It simulates the recipes the
 * conformance suite issues so the suite's semantics are testable without a
 * sandbox. It is not a sandbox, and it says so in its capability report.
 */
export function createReferenceSandboxAdapter(
  options: ReferenceAdapterOptions = {},
): SandboxAdapter {
  const unsupported = new Set(options.unsupported ?? []);
  const doFetch = options.fetch ?? fetch;
  const loopback = new Set(
    options.loopbackHostnames ?? ['127.0.0.1', 'localhost'],
  );
  const identity = { id: 'reference-in-memory', version: '0.2.0' };
  const fidelity = options.fidelity ?? 'host-port';

  const describe = (): SandboxCapabilityReport => ({
    adapter: identity,
    capabilities: (
      [
        'filesystem-scope',
        'network-egress',
        'child-process-containment',
        'resource-limits',
        'host-env-isolation',
        'brokered-credential',
        'timeout-cancellation',
      ] as const
    ).map((capability) => ({
      capability,
      state: unsupported.has(capability) ? 'unsupported' : 'enforced',
      locus:
        capability === 'brokered-credential' || capability === 'network-egress'
          ? 'host-broker'
          : 'guest-sandbox',
      reason: unsupported.has(capability)
        ? 'reference adapter configured without it'
        : 'simulated by the in-memory reference adapter; not a real sandbox',
    })),
    network: { fidelity, mandatoryEgress: options.mandatoryEgress ?? [] },
    hostPowers: [
      { power: 'host-exec', locus: 'outside-containment' },
      { power: 'host-mcp', locus: 'outside-containment' },
    ],
  });

  return {
    id: identity.id,
    version: identity.version,
    describe,
    async preflight(plan) {
      const issues: PreflightIssue[] = [];
      for (const [capability, level] of Object.entries(plan.requirements)) {
        if (level === 'required' && unsupported.has(capability as never)) {
          issues.push({
            code: 'capability_unsupported',
            capability: capability as never,
            message: `reference adapter cannot provide ${capability}`,
          });
        }
      }
      const names = new Set<string>();
      for (const binding of plan.credentials) {
        if (names.has(binding.envName)) {
          issues.push({
            code: 'credential_binding_duplicate',
            requirementId: binding.requirementId,
            message: `duplicate brokered env name ${binding.envName}`,
          });
        }
        names.add(binding.envName);
      }
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, warnings: [] };
    },
    async launch(plan, launchOptions) {
      if (launchOptions?.signal?.aborted) {
        throw new Error('launch aborted before start');
      }
      return new ReferenceHandle(identity, plan, describe(), doFetch, loopback);
    },
  };
}

function matchesDestination(
  url: URL,
  destinations: readonly DestinationConstraint[],
  fidelity: NetworkFidelity,
): boolean {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  return destinations.some((d) =>
    destinationWithin(
      {
        host: url.hostname,
        ...(fidelity !== 'host' ? { port } : {}),
        ...(fidelity === 'origin' ? { scheme } : {}),
      },
      fidelity === 'host'
        ? { host: d.host }
        : fidelity === 'host-port'
          ? { host: d.host, ...(d.port !== undefined ? { port: d.port } : {}) }
          : d,
    ),
  );
}

class ReferenceHandle implements SandboxHandle {
  readonly guestWorkspace: string;
  private closed = false;
  private closeReport: Promise<{ cleaned: boolean; residue: string[] }> | null =
    null;
  private readonly guestTmp = new Map<string, string>();
  private readonly records: EnforcementRecord[] = [];
  private readonly standIns = new Map<
    string,
    { placeholder: string; hosts: readonly DestinationConstraint[] }
  >();
  private readonly fidelity: NetworkFidelity;

  constructor(
    readonly adapter: { id: string; version: string },
    private readonly plan: SandboxLaunchPlan,
    report: SandboxCapabilityReport,
    private readonly doFetch: typeof fetch,
    private readonly loopback: Set<string>,
  ) {
    this.guestWorkspace = plan.workspace.hostPath;
    this.fidelity = report.network.fidelity;
    const recordedAt = new Date().toISOString();
    for (const c of report.capabilities) {
      this.records.push({
        control: c.capability,
        locus: c.locus,
        intended: plan.requirements[c.capability] ?? 'none',
        state: c.state,
        // The reference adapter configures every simulated control at
        // launch, so its records are `applied`, not merely declared.
        basis: c.state === 'enforced' ? 'applied' : 'declared',
        reason: c.reason,
        recordedAt,
      });
    }
    for (const binding of plan.credentials) {
      this.standIns.set(binding.envName, {
        placeholder: `standin-${binding.requirementId}`,
        hosts: binding.destinations,
      });
    }
  }

  observe(): readonly EnforcementRecord[] {
    return [...this.records];
  }

  private denied(guestPath: string): boolean {
    const rel = path.posix.relative(this.guestWorkspace, guestPath);
    if (rel.startsWith('..')) return false;
    return this.plan.filesystem.denyPaths.some(
      (deny) => rel === deny || rel.startsWith(`${deny}/`),
    );
  }

  private egressAllowed(url: URL): boolean {
    if (
      this.loopback.has(url.hostname) &&
      !this.plan.network.effective.allowedInternalHosts.includes(url.hostname)
    ) {
      return false;
    }
    return matchesDestination(
      url,
      this.plan.network.effective.allowedDestinations,
      this.fidelity,
    );
  }

  async exec(
    command: string,
    options: Parameters<SandboxHandle['exec']>[1] = {},
  ): Promise<SandboxExecResult> {
    if (this.closed) throw new Error('reference sandbox is closed');
    const recipe = parseRecipe(command);
    if (!recipe) {
      return {
        exitCode: 127,
        stdout: '',
        stderr: 'reference adapter only runs conformance recipes',
        timedOut: false,
        cancelled: false,
      };
    }
    return this.runRecipe(recipe, options);
  }

  private writeGuest(target: string, content: string): SandboxExecResult {
    if (target.startsWith(this.guestWorkspace)) {
      if (this.denied(target)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'permission denied',
          timedOut: false,
          cancelled: false,
        };
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    } else {
      this.guestTmp.set(target, content);
    }
    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: false,
    };
  }

  private async runRecipe(
    recipe: Recipe,
    options: NonNullable<Parameters<SandboxHandle['exec']>[1]>,
  ): Promise<SandboxExecResult> {
    const ok = (stdout = ''): SandboxExecResult => ({
      exitCode: 0,
      stdout,
      stderr: '',
      timedOut: false,
      cancelled: false,
    });
    const err = (code: number, stderr: string): SandboxExecResult => ({
      exitCode: code,
      stdout: '',
      stderr,
      timedOut: false,
      cancelled: false,
    });
    switch (recipe.op) {
      case 'write-file':
      case 'write-file-via-child':
        return this.writeGuest(recipe.path, recipe.content);
      case 'read-file': {
        const content = this.guestTmp.get(recipe.path);
        return content === undefined ? err(1, 'no such file') : ok(content);
      }
      case 'print-env': {
        const standIn = this.standIns.get(recipe.name);
        if (standIn) return ok(standIn.placeholder);
        return ok(
          this.plan.env[recipe.name] ?? options.env?.[recipe.name] ?? '',
        );
      }
      case 'sleep':
      case 'delayed-write': {
        const ms =
          (recipe.op === 'sleep' ? recipe.seconds : recipe.delaySeconds) * 1000;
        const timeout = options.timeoutMs;
        return new Promise<SandboxExecResult>((resolve) => {
          const timers: NodeJS.Timeout[] = [];
          const done = setTimeout(() => {
            timers.forEach(clearTimeout);
            resolve(
              recipe.op === 'delayed-write'
                ? this.writeGuest(recipe.path, recipe.content)
                : ok(),
            );
          }, ms);
          timers.push(done);
          // Termination is simulated by clearing the pending write: a
          // killed process group never performs its side effect.
          if (timeout !== undefined && timeout < ms) {
            timers.push(
              setTimeout(() => {
                clearTimeout(done);
                resolve({
                  exitCode: 124,
                  stdout: '',
                  stderr: 'timeout',
                  timedOut: true,
                  cancelled: false,
                  terminationConfirmed: true,
                });
              }, timeout),
            );
          }
          options.signal?.addEventListener(
            'abort',
            () => {
              timers.forEach(clearTimeout);
              resolve({
                exitCode: 130,
                stdout: '',
                stderr: 'aborted',
                timedOut: false,
                cancelled: true,
                terminationConfirmed: true,
              });
            },
            { once: true },
          );
        });
      }
      case 'http-get': {
        const url = new URL(recipe.url);
        if (!this.egressAllowed(url)) return err(7, `blocked: ${url.hostname}`);
        const headers: Record<string, string> = {};
        if (recipe.bearerEnv) {
          const standIn = this.standIns.get(recipe.bearerEnv);
          if (standIn) {
            if (!matchesDestination(url, standIn.hosts, this.fidelity)) {
              return err(22, 'credential not permitted for destination');
            }
            const binding = this.plan.credentials.find(
              (c) => c.envName === recipe.bearerEnv,
            );
            const value = binding
              ? await binding.resolve()
              : standIn.placeholder;
            headers.authorization = `Bearer ${value}`;
          }
        }
        try {
          const response = await this.doFetch(url, { headers });
          return response.ok
            ? ok(await response.text())
            : err(22, `HTTP ${response.status}`);
        } catch (error) {
          return err(7, error instanceof Error ? error.message : String(error));
        }
      }
    }
  }

  close() {
    this.closeReport ??= (async () => {
      this.closed = true;
      this.guestTmp.clear();
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
      return { cleaned: true, residue: [] as string[] };
    })();
    return this.closeReport;
  }
}
