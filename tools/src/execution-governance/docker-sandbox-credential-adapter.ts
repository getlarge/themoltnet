import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

export type SandboxAgent = 'claude' | 'codex' | 'shell';

export interface CredentialRequirement {
  id: string;
  required: boolean;
  consumer: string;
  destination: string;
  acceptableDelivery: 'brokered-http-request';
}

export interface LocalCredentialBinding {
  requirementId: string;
  source: {
    kind: 'host-command';
    command: string;
    readinessPath?: string;
  };
}

export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<CommandResult>;

export interface DockerReadiness {
  ready: boolean;
  adapter: 'docker-sandbox';
  adapterVersion?: string;
  bindingReady: boolean;
  credentialStore: 'adapter-managed-host-store';
  policyReady: boolean;
  virtualizationReady: boolean;
  failures: Array<{
    code: string;
    instruction: string;
  }>;
}

export interface EffectiveDockerPolicy {
  source: 'local' | 'organization' | 'unknown';
  preset: 'allow-all' | 'balanced' | 'deny-all' | 'unknown';
  activeNetworkRuleCount: number;
  destination: string;
  destinationDecision: 'allow' | 'deny' | 'unknown';
  wrongDestination: string;
  wrongDestinationDecision: 'allow' | 'deny' | 'unknown';
}

interface DockerPolicyRule {
  id?: string;
  origin?: string;
  layer?: string;
  scope?: string;
  status?: string;
  resource_type?: string;
  decision?: string;
  resources?: string[];
}

interface DockerPolicyList {
  rules?: DockerPolicyRule[];
}

interface DockerDiagnose {
  checks?: Array<{
    name?: string;
    status?: string;
    message?: string;
  }>;
}

export const defaultCommandRunner: CommandRunner = async (
  command,
  args,
  options = {},
) => {
  const startedAt = performance.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const timeout = setTimeout(
    () => child.kill('SIGTERM'),
    options.timeoutMs ?? 300_000,
  );
  const result = await new Promise<Pick<CommandResult, 'code' | 'signal'>>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );
  clearTimeout(timeout);
  return {
    ...result,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    durationMs: Math.round(performance.now() - startedAt),
  };
};

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function combinePolicyJson(...values: string[]): string {
  const rules = values.flatMap(
    (value) => parseJson<DockerPolicyList>(value)?.rules ?? [],
  );
  return JSON.stringify({ rules });
}

function commandFailure(
  label: string,
  result: CommandResult,
  sensitiveValues: string[] = [],
): Error {
  const detail = sanitizeCredentialEvidence(
    `${result.stderr}\n${result.stdout}`.trim(),
    sensitiveValues,
  );
  return new Error(`${label} failed with exit ${result.code}: ${detail}`);
}

export function normalizeDockerVersion(output: string): string | undefined {
  return output.match(/sbx version:\s*(v?[^\s]+)/)?.[1];
}

export function normalizeEffectivePolicy(input: {
  policyJson: string;
  destination: string;
  destinationCheck: CommandResult;
  wrongDestination: string;
  wrongDestinationCheck: CommandResult;
}): EffectiveDockerPolicy {
  const policy = parseJson<DockerPolicyList>(input.policyJson);
  const activeNetworkRules = Array.from(
    new Map(
      (
        policy?.rules?.filter(
          ({ resource_type, status }) =>
            resource_type === 'network' && status === 'active',
        ) ?? []
      ).map((rule) => [
        `${rule.id ?? ''}:${rule.decision ?? ''}:${rule.resources?.join(',') ?? ''}`,
        rule,
      ]),
    ).values(),
  );
  const presetRule = activeNetworkRules.find(({ id }) =>
    id?.startsWith('default-'),
  );
  const catchAllRule = activeNetworkRules.find(({ resources }) =>
    resources?.includes('**'),
  );
  const preset =
    presetRule?.id?.includes('allow-all') || catchAllRule?.decision === 'allow'
      ? 'allow-all'
      : presetRule?.id?.includes('balanced')
        ? 'balanced'
        : presetRule?.id?.includes('deny-all') ||
            catchAllRule?.decision === 'deny'
          ? 'deny-all'
          : 'unknown';
  const source = activeNetworkRules.some(
    ({ origin, layer }) => origin === 'org' || layer === 'org',
  )
    ? 'organization'
    : activeNetworkRules.some(
          ({ origin, layer }) => origin === 'local' || layer === 'local',
        )
      ? 'local'
      : 'unknown';
  const decision = (result: CommandResult): 'allow' | 'deny' | 'unknown' => {
    const normalized = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (normalized.includes('allowed')) return 'allow';
    if (normalized.includes('denied')) return 'deny';
    return 'unknown';
  };
  return {
    source,
    preset,
    activeNetworkRuleCount: activeNetworkRules.length,
    destination: input.destination,
    destinationDecision: decision(input.destinationCheck),
    wrongDestination: input.wrongDestination,
    wrongDestinationDecision: decision(input.wrongDestinationCheck),
  };
}

export function missingBindingReadiness(
  requirement: CredentialRequirement,
): DockerReadiness {
  return {
    ready: false,
    adapter: 'docker-sandbox',
    bindingReady: false,
    credentialStore: 'adapter-managed-host-store',
    policyReady: false,
    virtualizationReady: false,
    failures: [
      {
        code: 'required_binding_missing',
        instruction: `Configure a trusted local binding for required credential "${requirement.id}" with consumer "${requirement.consumer}" and destination "${requirement.destination}" before starting the agent.`,
      },
    ],
  };
}

export function sanitizeCredentialEvidence(
  value: string,
  sensitiveValues: string[],
): string {
  let sanitized = value;
  for (const sensitive of sensitiveValues.filter(Boolean)) {
    sanitized = sanitized.split(sensitive).join('$REDACTED_CREDENTIAL');
  }
  return sanitized;
}

export function assertCredentialAbsent(
  credential: string,
  evidence: Array<{ name: string; value: string }>,
): void {
  const leaked = evidence
    .filter(({ value }) => value.includes(credential))
    .map(({ name }) => name);
  if (leaked.length > 0) {
    throw new Error(
      `synthetic credential appeared in raw evidence: ${leaked.join(', ')}`,
    );
  }
}

export class CleanupStack {
  readonly #actions: Array<{
    label: string;
    action: () => Promise<void>;
  }> = [];

  add(label: string, action: () => Promise<void>): void {
    this.#actions.push({ label, action });
  }

  async run(): Promise<string[]> {
    const errors: string[] = [];
    for (const { label, action } of this.#actions.reverse()) {
      try {
        await action();
      } catch (error) {
        errors.push(`${label}: ${String(error)}`);
      }
    }
    this.#actions.length = 0;
    return errors;
  }
}

/**
 * Probe-local Docker Sandboxes integration. This deliberately is not exported
 * from a package entrypoint and is not a production sandbox contract.
 */
export class DockerSandboxCredentialAdapter {
  readonly #runner: CommandRunner;
  readonly #cleanup = new CleanupStack();
  readonly #credentialStandIns = new Map<string, string>();

  constructor(runner: CommandRunner = defaultCommandRunner) {
    this.#runner = runner;
  }

  async preflight(
    requirement: CredentialRequirement,
    binding?: LocalCredentialBinding,
  ): Promise<DockerReadiness> {
    if (!binding) return missingBindingReadiness(requirement);
    if (binding.requirementId !== requirement.id) {
      return {
        ...missingBindingReadiness(requirement),
        failures: [
          {
            code: 'binding_requirement_mismatch',
            instruction: `Bind the local source to requirement "${requirement.id}" instead of "${binding.requirementId}".`,
          },
        ],
      };
    }
    if (
      binding.source.readinessPath &&
      !(await localBindingSourceReady(binding.source.readinessPath))
    ) {
      return {
        ...missingBindingReadiness(requirement),
        failures: [
          {
            code: 'binding_source_unavailable',
            instruction: `Make the configured local source for requirement "${requirement.id}" available to the Docker Sandbox adapter, then rerun preflight.`,
          },
        ],
      };
    }

    const version = await this.#runner('sbx', ['version'], {
      timeoutMs: 15_000,
    });
    const diagnosed = await this.#runner(
      'sbx',
      ['diagnose', '--output', 'json'],
      { timeoutMs: 30_000 },
    );
    const policy = await this.#runner('sbx', ['policy', 'ls', '--json'], {
      timeoutMs: 30_000,
    });
    const versionValue = normalizeDockerVersion(
      `${version.stdout}\n${version.stderr}`,
    );
    const diagnosis = parseJson<DockerDiagnose>(diagnosed.stdout);
    const virtualizationReady =
      diagnosis?.checks?.some(
        ({ name, status }) => name === 'Virtualization' && status === 'pass',
      ) ?? false;
    const policyReady = policy.code === 0 && Boolean(parseJson(policy.stdout));
    const failures: DockerReadiness['failures'] = [];
    if (!versionValue) {
      failures.push({
        code: 'adapter_unavailable',
        instruction:
          'Install Docker Sandboxes and ensure `sbx version` succeeds before starting the agent.',
      });
    }
    if (!virtualizationReady) {
      failures.push({
        code: 'virtualization_unavailable',
        instruction:
          'Run `sbx diagnose --output json` and resolve the reported virtualization prerequisite before starting the agent.',
      });
    }
    if (!policyReady) {
      failures.push({
        code: 'network_policy_unavailable',
        instruction:
          'Initialize an sbx network preset explicitly, then rerun preflight; the adapter does not choose or reset machine policy.',
      });
    }
    return {
      ready: failures.length === 0,
      adapter: 'docker-sandbox',
      adapterVersion: versionValue,
      bindingReady: true,
      credentialStore: 'adapter-managed-host-store',
      policyReady,
      virtualizationReady,
      failures,
    };
  }

  async createSandbox(input: {
    name: string;
    agent: SandboxAgent;
    workspace: string;
  }): Promise<CommandResult> {
    const result = await this.#runner(
      'sbx',
      ['create', '--name', input.name, input.agent, input.workspace],
      { timeoutMs: 600_000 },
    );
    if (result.code !== 0) throw commandFailure('sbx create', result);
    this.#cleanup.add(`remove sandbox ${input.name}`, async () => {
      const removed = await this.#runner('sbx', ['rm', input.name, '--force'], {
        timeoutMs: 300_000,
      });
      if (removed.code !== 0) throw commandFailure('sbx rm', removed);
    });
    return result;
  }

  async bindCredential(input: {
    sandbox: string;
    destinationHosts: string[];
    envName: string;
    resolverCommand: string;
    standIn: string;
  }): Promise<void> {
    const result = await this.#runner(
      'sbx',
      [
        'secret',
        'set-custom',
        '--sandbox',
        input.sandbox,
        ...input.destinationHosts.flatMap((host) => ['--host', host]),
        '--env',
        input.envName,
        '--command',
        input.resolverCommand,
        '--placeholder',
        input.standIn,
        '--refresh',
        'on-demand',
      ],
      { timeoutMs: 60_000 },
    );
    if (result.code !== 0) {
      throw commandFailure('sbx secret set-custom', result);
    }
    this.#credentialStandIns.set(input.envName, input.standIn);
    this.#cleanup.add(`remove credential for ${input.sandbox}`, async () => {
      const removed = await this.#runner(
        'sbx',
        [
          'secret',
          'rm',
          '--sandbox',
          input.sandbox,
          '--placeholder',
          input.standIn,
          '--force',
        ],
        { timeoutMs: 60_000 },
      );
      if (removed.code !== 0) {
        throw commandFailure('sbx secret rm', removed);
      }
      this.#credentialStandIns.delete(input.envName);
    });
  }

  async allowHostFixture(input: {
    sandbox: string;
    port: number;
  }): Promise<string> {
    const resource = `localhost:${input.port}`;
    const result = await this.#runner(
      'sbx',
      ['policy', 'allow', 'network', '--sandbox', input.sandbox, resource],
      { timeoutMs: 30_000 },
    );
    if (result.code !== 0) throw commandFailure('sbx policy allow', result);
    this.#cleanup.add(`remove network rule for ${input.sandbox}`, async () => {
      const removed = await this.#runner(
        'sbx',
        [
          'policy',
          'rm',
          'network',
          '--sandbox',
          input.sandbox,
          '--resource',
          resource,
        ],
        { timeoutMs: 30_000 },
      );
      if (removed.code !== 0) {
        throw commandFailure('sbx policy rm', removed);
      }
    });
    return resource;
  }

  async inspectEffectivePolicy(input: {
    sandbox: string;
    destinationPort: number;
    wrongDestinationPort: number;
  }): Promise<EffectiveDockerPolicy> {
    const destination = `localhost:${input.destinationPort}`;
    const wrongDestination = `localhost:${input.wrongDestinationPort}`;
    const [globalPolicy, sandboxPolicy, allowed, wrong] = await Promise.all([
      this.#runner('sbx', ['policy', 'ls', '--json'], {
        timeoutMs: 30_000,
      }),
      this.#runner('sbx', ['policy', 'ls', input.sandbox, '--json'], {
        timeoutMs: 30_000,
      }),
      this.#runner(
        'sbx',
        ['policy', 'check', 'network', '--sandbox', input.sandbox, destination],
        { timeoutMs: 30_000 },
      ),
      this.#runner(
        'sbx',
        [
          'policy',
          'check',
          'network',
          '--sandbox',
          input.sandbox,
          wrongDestination,
        ],
        { timeoutMs: 30_000 },
      ),
    ]);
    if (globalPolicy.code !== 0) {
      throw commandFailure('sbx global policy ls', globalPolicy);
    }
    if (sandboxPolicy.code !== 0) {
      throw commandFailure('sbx sandbox policy ls', sandboxPolicy);
    }
    return normalizeEffectivePolicy({
      policyJson: combinePolicyJson(globalPolicy.stdout, sandboxPolicy.stdout),
      destination,
      destinationCheck: allowed,
      wrongDestination,
      wrongDestinationCheck: wrong,
    });
  }

  async exec(input: {
    sandbox: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<CommandResult> {
    const envArgs = Object.entries({
      ...(input.env ?? {}),
      ...Object.fromEntries(this.#credentialStandIns),
    }).flatMap(([name, value]) => ['--env', `${name}=${value}`]);
    return this.#runner(
      'sbx',
      ['exec', ...envArgs, input.sandbox, input.command, ...input.args],
      { timeoutMs: input.timeoutMs ?? 300_000 },
    );
  }

  async cleanup(): Promise<string[]> {
    return this.#cleanup.run();
  }
}

export async function localBindingSourceReady(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
