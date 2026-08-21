import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  EnforcementRecord,
  PreflightIssue,
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxExecResult,
  SandboxHandle,
  SandboxLaunchPlan,
} from '../sandbox-adapter.js';
import { parseRecipe, type Recipe } from './recipes.js';

export interface ReferenceAdapterOptions {
  /** Simulate an adapter that cannot provide these capabilities. */
  unsupported?: readonly SandboxCapabilityReport['capabilities'][number]['capability'][];
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
  const identity = { id: 'reference-in-memory', version: '0.1.0' };

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
        capability === 'brokered-credential' ? 'host-broker' : 'guest-sandbox',
      reason: unsupported.has(capability)
        ? 'reference adapter configured without it'
        : 'simulated by the in-memory reference adapter; not a real sandbox',
    })),
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
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, warnings: [] };
    },
    async launch(plan) {
      return new ReferenceHandle(identity, plan, describe(), doFetch, loopback);
    },
  };
}

class ReferenceHandle implements SandboxHandle {
  readonly guestWorkspace: string;
  private closed = false;
  private readonly guestTmp = new Map<string, string>();
  private readonly records: EnforcementRecord[] = [];
  private readonly standIns = new Map<
    string,
    { placeholder: string; value?: string; hosts: readonly string[] }
  >();

  constructor(
    readonly adapter: { id: string; version: string },
    private readonly plan: SandboxLaunchPlan,
    report: SandboxCapabilityReport,
    private readonly doFetch: typeof fetch,
    private readonly loopback: Set<string>,
  ) {
    this.guestWorkspace = plan.workspace.hostPath;
    const now = new Date().toISOString();
    for (const c of report.capabilities) {
      this.records.push({
        control: c.capability,
        locus: c.locus,
        intended: plan.requirements[c.capability] ?? 'none',
        state: c.state,
        reason: c.reason,
        observedAt: now,
      });
    }
    for (const binding of plan.credentials) {
      this.standIns.set(binding.envName, {
        placeholder: `standin-${binding.requirementId}`,
        hosts: binding.destinationHosts,
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

  private isLoopbackAllowed(hostname: string): boolean {
    const matches = (patterns: readonly string[]) =>
      patterns.some(
        (p) =>
          p === hostname ||
          (p.startsWith('*.') && hostname.endsWith(p.slice(1))),
      );
    if (this.loopback.has(hostname)) {
      return (
        matches(this.plan.network.allowedInternalHosts) &&
        matches(this.plan.network.allowedHosts)
      );
    }
    return matches(this.plan.network.allowedHosts);
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
      case 'write-file-via-child': {
        if (recipe.path.startsWith(this.guestWorkspace)) {
          if (this.denied(recipe.path)) return err(1, 'permission denied');
          mkdirSync(path.dirname(recipe.path), { recursive: true });
          writeFileSync(recipe.path, recipe.content, 'utf8');
          return ok();
        }
        this.guestTmp.set(recipe.path, recipe.content);
        return ok();
      }
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
      case 'sleep': {
        const ms = recipe.seconds * 1000;
        const timeout = options.timeoutMs;
        return new Promise<SandboxExecResult>((resolve) => {
          const timers: NodeJS.Timeout[] = [];
          const done = setTimeout(() => {
            timers.forEach(clearTimeout);
            resolve(ok());
          }, ms);
          timers.push(done);
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
              });
            },
            { once: true },
          );
        });
      }
      case 'http-get': {
        const url = new URL(recipe.url);
        if (!this.isLoopbackAllowed(url.hostname))
          return err(7, `blocked: ${url.hostname}`);
        const headers: Record<string, string> = {};
        if (recipe.bearerEnv) {
          const standIn = this.standIns.get(recipe.bearerEnv);
          if (standIn) {
            const allowedForHost = standIn.hosts.some(
              (h) => h === url.hostname,
            );
            if (!allowedForHost)
              return err(22, 'credential not permitted for destination');
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

  async close() {
    this.closed = true;
    this.guestTmp.clear();
    const now = new Date().toISOString();
    for (const record of [...this.records]) {
      if (record.state === 'enforced') {
        this.records.push({
          ...record,
          state:
            record.intended === 'required'
              ? 'failed'
              : record.intended === 'preferred'
                ? 'degraded'
                : 'failed-open',
          reason: 'sandbox closed',
          observedAt: now,
        });
      }
    }
    return { cleaned: true, residue: [] };
  }
}
