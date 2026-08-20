import { randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type CredentialProviderFixture,
  startCredentialProviderFixture,
} from './credential-provider-fixture.js';
import {
  assertCredentialAbsent,
  type CommandResult,
  type CredentialRequirement,
  defaultCommandRunner,
  DockerSandboxCredentialAdapter,
  type LocalCredentialBinding,
  type SandboxAgent,
  sanitizeCredentialEvidence,
} from './docker-sandbox-credential-adapter.js';

interface CredentialScenario {
  id: string;
  requirement: CredentialRequirement;
  expected: 'preflight-deny' | 'brokered-success' | 'destination-deny';
  purpose: string;
}

interface ScenarioFile {
  notice: string;
  credentialScenarios: CredentialScenario[];
}

interface ProviderObservation {
  provider: SandboxAgent;
  version: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  expectedOutputObserved: boolean;
  stdout: string;
  stderr: string;
  hookEvidence: string;
  providerStateFileCount: number;
}

const sourceDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(sourceDir, '../../..');
const scenariosPath = join(
  workspaceRoot,
  'tools/test-fixtures/execution-governance/scenarios.json',
);
const hookRecorderPath = join(sourceDir, 'hook-recorder.mjs');
const defaultOutputDir = join(
  workspaceRoot,
  'tools/test-fixtures/execution-governance/observed/docker-sandbox',
);
const credentialMarkerPrefix = 'MOLTNET_M01_SYNTHETIC_';
const destinationHost = 'host.docker.internal';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function initializeWorkspace(
  root: string,
  name: string,
): Promise<string> {
  const workspace = join(root, name);
  await mkdir(workspace, { recursive: true });
  const initialized = await defaultCommandRunner('git', ['init', '--quiet'], {
    cwd: workspace,
    timeoutMs: 10_000,
  });
  if (initialized.code !== 0) {
    throw new Error(
      `could not initialize temporary workspace: ${initialized.stderr}`,
    );
  }
  await copyFile(hookRecorderPath, join(workspace, 'hook-recorder.mjs'));
  return workspace;
}

async function filesBelow(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await filesBelow(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function readTextEvidence(
  roots: string[],
): Promise<Array<{ name: string; value: string }>> {
  const evidence: Array<{ name: string; value: string }> = [];
  for (const root of roots) {
    for (const path of await filesBelow(root)) {
      const value = await readFile(path);
      if (!value.includes(0)) {
        evidence.push({ name: path, value: value.toString('utf8') });
      }
    }
  }
  return evidence;
}

function hookConfiguration(command: string): Record<string, unknown> {
  const events = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'PostToolUseFailure',
    'Stop',
    'SessionEnd',
  ];
  return {
    hooks: Object.fromEntries(
      events.map((event) => [
        event,
        [{ hooks: [{ type: 'command', command }] }],
      ]),
    ),
  };
}

async function configureHooks(input: {
  provider: SandboxAgent;
  workspace: string;
  stateDirectory: string;
}): Promise<string> {
  const hookLog = join(input.workspace, `${input.provider}-hooks.jsonl`);
  const recorder = join(input.workspace, 'hook-recorder.mjs');
  const config = hookConfiguration(`node ${shellQuote(recorder)}`);
  if (input.provider === 'codex') {
    await mkdir(input.stateDirectory, { recursive: true });
    await writeFile(
      join(input.stateDirectory, 'hooks.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  } else if (input.provider === 'claude') {
    const directory = join(input.workspace, '.claude');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'settings.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  }
  return hookLog;
}

function safeText(input: {
  value: string;
  credential: string;
  probeRoot: string;
  ports: number[];
  standIns: string[];
}): string {
  let value = sanitizeCredentialEvidence(input.value, [input.credential]);
  value = value.replaceAll(
    input.probeRoot.replaceAll('/', '-'),
    '$PROBE_ROOT_SLUG',
  );
  value = value.replaceAll(input.probeRoot, '$PROBE_ROOT');
  value = value.replaceAll(homedir(), '$HOME');
  for (const port of input.ports)
    value = value.replaceAll(String(port), '$FIXTURE_PORT');
  for (const standIn of input.standIns)
    value = value.replaceAll(standIn, '$CREDENTIAL_STAND_IN');
  return value;
}

async function createResolver(
  root: string,
  credential: string,
): Promise<LocalCredentialBinding> {
  const credentialPath = join(root, 'synthetic-credential');
  const resolverPath = join(root, 'credential-resolver.mjs');
  await writeFile(credentialPath, `${credential}\n`, { mode: 0o600 });
  await chmod(credentialPath, 0o600);
  await writeFile(
    resolverPath,
    "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync(process.argv[2], 'utf8').trim());\n",
    { mode: 0o700 },
  );
  await chmod(resolverPath, 0o700);
  return {
    requirementId: 'fixture.http.bearer',
    source: {
      kind: 'host-command',
      command: `${shellQuote(process.execPath)} ${shellQuote(resolverPath)} ${shellQuote(credentialPath)}`,
      readinessPath: credentialPath,
    },
  };
}

function requireScenario(
  scenarios: CredentialScenario[],
  id: string,
): CredentialScenario {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`missing credential scenario: ${id}`);
  return scenario;
}

async function createConfiguredSandbox(input: {
  agent: SandboxAgent;
  root: string;
  requirement: CredentialRequirement;
  binding: LocalCredentialBinding;
  fixturePort: number;
  wrongPort: number;
  standIn: string;
}): Promise<{
  adapter: DockerSandboxCredentialAdapter;
  sandbox: string;
  workspace: string;
  policy: Awaited<
    ReturnType<DockerSandboxCredentialAdapter['inspectEffectivePolicy']>
  >;
}> {
  const adapter = new DockerSandboxCredentialAdapter();
  const readiness = await adapter.preflight(input.requirement, input.binding);
  if (!readiness.ready)
    throw new Error(`preflight failed: ${JSON.stringify(readiness.failures)}`);
  const workspace = await initializeWorkspace(
    input.root,
    `${input.agent}-workspace`,
  );
  const sandbox = `moltnet-m01-${input.agent}-${randomUUID().slice(0, 8)}`;
  try {
    await adapter.createSandbox({
      name: sandbox,
      agent: input.agent,
      workspace,
    });
    await adapter.bindCredential({
      sandbox,
      destinationHosts: [destinationHost, 'localhost'],
      envName:
        input.agent === 'codex'
          ? 'OPENAI_API_KEY'
          : input.agent === 'claude'
            ? 'ANTHROPIC_API_KEY'
            : 'MOLTNET_PROBE_CREDENTIAL',
      resolverCommand: input.binding.source.command,
      standIn: input.standIn,
    });
    await adapter.allowHostFixture({ sandbox, port: input.fixturePort });
    const policy = await adapter.inspectEffectivePolicy({
      sandbox,
      destinationPort: input.fixturePort,
      wrongDestinationPort: input.wrongPort,
    });
    if (
      policy.destinationDecision !== 'allow' ||
      policy.wrongDestinationDecision !== 'deny'
    ) {
      throw new Error(
        `effective policy did not isolate destinations: ${JSON.stringify(policy)}`,
      );
    }
    return { adapter, sandbox, workspace, policy };
  } catch (error) {
    const cleanupErrors = await adapter.cleanup();
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors.map((message) => new Error(message))],
        `${input.agent} sandbox setup and cleanup failed`,
      );
    }
    throw error;
  }
}

async function runWithAdapterCleanup<T>(
  adapter: DockerSandboxCredentialAdapter,
  label: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    const result = await action();
    const cleanupErrors = await adapter.cleanup();
    if (cleanupErrors.length > 0) {
      throw new Error(`${label} cleanup failed: ${cleanupErrors.join('; ')}`);
    }
    return result;
  } catch (error) {
    const cleanupErrors = await adapter.cleanup();
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors.map((message) => new Error(message))],
        `${label} scenario and cleanup failed`,
      );
    }
    throw error;
  }
}

async function runShellBoundary(input: {
  root: string;
  requirement: CredentialRequirement;
  binding: LocalCredentialBinding;
  allowed: CredentialProviderFixture;
  wrong: CredentialProviderFixture;
  credential: string;
  standIn: string;
}): Promise<{
  policy: Awaited<
    ReturnType<DockerSandboxCredentialAdapter['inspectEffectivePolicy']>
  >;
  allowed: CommandResult;
  wrong: CommandResult;
  guestSawStandIn: boolean;
  cleanupErrors: string[];
}> {
  const configured = await createConfiguredSandbox({
    agent: 'shell',
    root: input.root,
    requirement: input.requirement,
    binding: input.binding,
    fixturePort: input.allowed.port,
    wrongPort: input.wrong.port,
    standIn: input.standIn,
  });
  return runWithAdapterCleanup(configured.adapter, 'shell', async () => {
    const inspection = await configured.adapter.exec({
      sandbox: configured.sandbox,
      command: 'sh',
      args: [
        '-c',
        'test "$MOLTNET_PROBE_CREDENTIAL" = "$EXPECTED_STAND_IN" && printf "stand-in-only\\n"',
      ],
      env: { EXPECTED_STAND_IN: input.standIn },
    });
    const allowed = await configured.adapter.exec({
      sandbox: configured.sandbox,
      command: 'sh',
      args: [
        '-c',
        `curl --fail --silent --show-error -H "Authorization: Bearer $MOLTNET_PROBE_CREDENTIAL" http://${destinationHost}:${input.allowed.port}/shell`,
      ],
    });
    const wrong = await configured.adapter.exec({
      sandbox: configured.sandbox,
      command: 'sh',
      args: [
        '-c',
        `curl --connect-timeout 3 --max-time 5 --fail --silent --show-error -H "Authorization: Bearer $MOLTNET_PROBE_CREDENTIAL" http://${destinationHost}:${input.wrong.port}/wrong`,
      ],
      timeoutMs: 15_000,
    });
    for (const [name, result] of [
      ['inspection', inspection],
      ['allowed', allowed],
      ['wrong', wrong],
    ] as const) {
      assertCredentialAbsent(input.credential, [
        { name: `${name}.stdout`, value: result.stdout },
        { name: `${name}.stderr`, value: result.stderr },
      ]);
    }
    return {
      policy: configured.policy,
      allowed,
      wrong,
      guestSawStandIn:
        inspection.code === 0 && inspection.stdout.includes('stand-in-only'),
      cleanupErrors: [],
    };
  });
}

async function runProvider(input: {
  provider: 'codex' | 'claude';
  root: string;
  requirement: CredentialRequirement;
  binding: LocalCredentialBinding;
  allowed: CredentialProviderFixture;
  wrong: CredentialProviderFixture;
  credential: string;
  standIn: string;
}): Promise<{ observation: ProviderObservation; cleanupErrors: string[] }> {
  const configured = await createConfiguredSandbox({
    agent: input.provider,
    root: input.root,
    requirement: input.requirement,
    binding: input.binding,
    fixturePort: input.allowed.port,
    wrongPort: input.wrong.port,
    standIn: input.standIn,
  });
  const stateDirectory = join(configured.workspace, `${input.provider}-state`);
  const hookLog = await configureHooks({
    provider: input.provider,
    workspace: configured.workspace,
    stateDirectory,
  });
  return runWithAdapterCleanup(configured.adapter, input.provider, async () => {
    const versionResult = await configured.adapter.exec({
      sandbox: configured.sandbox,
      command: input.provider,
      args: ['--version'],
      timeoutMs: 60_000,
    });
    const baseUrl = `http://${destinationHost}:${input.allowed.port}/${input.provider}/v1`;
    const env = {
      MOLTNET_PROBE_HOOK_LOG: hookLog,
      ...(input.provider === 'codex'
        ? { CODEX_HOME: stateDirectory, OPENAI_BASE_URL: baseUrl }
        : {
            CLAUDE_CONFIG_DIR: stateDirectory,
            ANTHROPIC_BASE_URL: baseUrl.replace(/\/v1$/, ''),
          }),
    };
    const result = await configured.adapter.exec({
      sandbox: configured.sandbox,
      command: input.provider,
      args:
        input.provider === 'codex'
          ? [
              '-c',
              'model_provider="moltnet_fixture"',
              '-c',
              'model_providers.moltnet_fixture.name="MoltNet synthetic fixture"',
              '-c',
              `model_providers.moltnet_fixture.base_url=${JSON.stringify(baseUrl)}`,
              '-c',
              'model_providers.moltnet_fixture.env_key="OPENAI_API_KEY"',
              '-c',
              'model_providers.moltnet_fixture.wire_api="responses"',
              '-c',
              'model_providers.moltnet_fixture.supports_websockets=false',
              '-c',
              'model_providers.moltnet_fixture.request_max_retries=0',
              '-c',
              'model_providers.moltnet_fixture.stream_max_retries=0',
              '--ask-for-approval',
              'never',
              'exec',
              '--json',
              '--dangerously-bypass-hook-trust',
              '--skip-git-repo-check',
              '--sandbox',
              'workspace-write',
              '--model',
              'moltnet-synthetic',
              'Reply exactly CODEX_SANDBOX_PROBE_OK without using tools.',
            ]
          : [
              '-p',
              '--output-format',
              'stream-json',
              '--verbose',
              '--include-hook-events',
              '--effort',
              'low',
              '--permission-mode',
              'dontAsk',
              '--setting-sources',
              'project',
              '--model',
              'moltnet-synthetic',
              '--',
              'Reply exactly CLAUDE_SANDBOX_PROBE_OK without using tools.',
            ],
      env,
      timeoutMs: 180_000,
    });
    const hookEvidence = (await pathExists(hookLog))
      ? await readFile(hookLog, 'utf8')
      : '';
    const diskEvidence = await readTextEvidence([
      configured.workspace,
      stateDirectory,
    ]);
    assertCredentialAbsent(input.credential, [
      { name: `${input.provider}.version.stdout`, value: versionResult.stdout },
      { name: `${input.provider}.version.stderr`, value: versionResult.stderr },
      { name: `${input.provider}.stdout`, value: result.stdout },
      { name: `${input.provider}.stderr`, value: result.stderr },
      { name: `${input.provider}.hooks`, value: hookEvidence },
      ...diskEvidence,
    ]);
    const expectedOutput = `${input.provider.toUpperCase()}_SANDBOX_PROBE_OK`;
    return {
      observation: {
        provider: input.provider,
        version: `${versionResult.stdout}\n${versionResult.stderr}`.trim(),
        exitCode: result.code,
        signal: result.signal,
        expectedOutputObserved: result.stdout.includes(expectedOutput),
        stdout: result.stdout,
        stderr: result.stderr,
        hookEvidence,
        providerStateFileCount: diskEvidence.length,
      },
      cleanupErrors: [],
    };
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const fixture = JSON.parse(
    await readFile(scenariosPath, 'utf8'),
  ) as ScenarioFile;
  const missing = requireScenario(
    fixture.credentialScenarios,
    'credential-missing-binding',
  );
  const allowedScenario = requireScenario(
    fixture.credentialScenarios,
    'credential-allowed-destination',
  );
  const wrongScenario = requireScenario(
    fixture.credentialScenarios,
    'credential-wrong-destination',
  );
  const probeRoot = await mkdtemp(join(tmpdir(), 'moltnet-credential-probe-'));
  const credential = `${credentialMarkerPrefix}${randomUUID().replaceAll('-', '')}`;
  const shellStandIn = `moltnet-shell-${randomUUID()}`;
  const codexStandIn = `sk-moltnet-codex-${randomUUID()}`;
  const claudeStandIn = `sk-ant-moltnet-claude-${randomUUID()}`;
  const outputArgIndex = process.argv.indexOf('--output');
  const outputDir =
    outputArgIndex >= 0
      ? resolve(process.argv[outputArgIndex + 1] ?? '')
      : defaultOutputDir;
  const allowedFixture = await startCredentialProviderFixture(credential);
  const wrongFixture = await startCredentialProviderFixture(credential);
  let cleanupComplete = false;
  try {
    const binding = await createResolver(probeRoot, credential);
    const missingAdapter = new DockerSandboxCredentialAdapter();
    const missingReadiness = await missingAdapter.preflight(
      missing.requirement,
    );
    const shell = await runShellBoundary({
      root: probeRoot,
      requirement: allowedScenario.requirement,
      binding,
      allowed: allowedFixture,
      wrong: wrongFixture,
      credential,
      standIn: shellStandIn,
    });
    const codex = await runProvider({
      provider: 'codex',
      root: probeRoot,
      requirement: allowedScenario.requirement,
      binding,
      allowed: allowedFixture,
      wrong: wrongFixture,
      credential,
      standIn: codexStandIn,
    });
    const claude = await runProvider({
      provider: 'claude',
      root: probeRoot,
      requirement: allowedScenario.requirement,
      binding,
      allowed: allowedFixture,
      wrong: wrongFixture,
      credential,
      standIn: claudeStandIn,
    });
    const assertions = {
      missingBindingPreventedLaunch: !missingReadiness.ready,
      shellAllowedSucceeded: shell.allowed.code === 0,
      guestSawStandIn: shell.guestSawStandIn,
      wrongDestinationFailed: shell.wrong.code !== 0,
      wrongDestinationReceivedNoRequest: wrongFixture.requests.length === 0,
      allowedRequestsAllResolved: allowedFixture.requests.every(
        ({ credentialMatched }) => credentialMatched,
      ),
      codexCompleted: codex.observation.expectedOutputObserved,
      claudeCompleted: claude.observation.expectedOutputObserved,
      codexExitCode: codex.observation.exitCode,
      claudeExitCode: claude.observation.exitCode,
      allowedRequestCount: allowedFixture.requests.length,
    };
    if (
      Object.entries(assertions).some(
        ([name, value]) =>
          !name.endsWith('ExitCode') &&
          name !== 'allowedRequestCount' &&
          value !== true,
      )
    ) {
      const diagnosticSanitization = {
        credential,
        probeRoot,
        ports: [allowedFixture.port, wrongFixture.port],
        standIns: [shellStandIn, codexStandIn, claudeStandIn],
      };
      const providerDiagnostics = {
        codex: safeText({
          value: `${codex.observation.stderr}\n${codex.observation.stdout}`,
          ...diagnosticSanitization,
        }).slice(-4_000),
        claude: safeText({
          value: `${claude.observation.stderr}\n${claude.observation.stdout}`,
          ...diagnosticSanitization,
        }).slice(-4_000),
      };
      throw new Error(
        `one or more credential conformance assertions failed: ${JSON.stringify({ assertions, providerDiagnostics })}`,
      );
    }
    const raw = [
      { name: 'shell.allowed.stdout', value: shell.allowed.stdout },
      { name: 'shell.allowed.stderr', value: shell.allowed.stderr },
      { name: 'shell.wrong.stdout', value: shell.wrong.stdout },
      { name: 'shell.wrong.stderr', value: shell.wrong.stderr },
      { name: 'codex.stdout', value: codex.observation.stdout },
      { name: 'codex.stderr', value: codex.observation.stderr },
      { name: 'codex.hooks', value: codex.observation.hookEvidence },
      { name: 'claude.stdout', value: claude.observation.stdout },
      { name: 'claude.stderr', value: claude.observation.stderr },
      { name: 'claude.hooks', value: claude.observation.hookEvidence },
    ];
    assertCredentialAbsent(credential, raw);
    const sanitization = {
      credential,
      probeRoot,
      ports: [allowedFixture.port, wrongFixture.port],
      standIns: [shellStandIn, codexStandIn, claudeStandIn],
    };
    const inventory = {
      notice: fixture.notice,
      adapter: 'docker-sandbox',
      adapterVersion: (
        await defaultCommandRunner('sbx', ['version'])
      ).stdout.trim(),
      platform: `${process.platform}-${process.arch}`,
      capturedAt: new Date().toISOString(),
      syntheticCredential: {
        source: 'sandbox-scoped temporary host resolver',
        valueRecorded: false,
        markerAbsentFromEvidence: true,
      },
      requirements: {
        missing: missing.requirement,
        allowed: allowedScenario.requirement,
        wrong: wrongScenario.requirement,
      },
    };
    const outcomes = {
      missingBinding: {
        readiness: missingReadiness,
        agentLaunchAttempted: false,
      },
      shell: {
        guestSawStandIn: shell.guestSawStandIn,
        allowedExitCode: shell.allowed.code,
        wrongDestinationExitCode: shell.wrong.code,
        policy: {
          ...shell.policy,
          destination: 'fixture.allowed',
          wrongDestination: 'fixture.denied',
        },
      },
      destinations: {
        allowedRequests: allowedFixture.requests,
        wrongDestinationRequestCount: wrongFixture.requests.length,
      },
      providers: [codex.observation, claude.observation].map((observation) => ({
        ...observation,
        stdout: undefined,
        stderr: undefined,
        hookEvidence: undefined,
      })),
      cleanupComplete: true,
    };
    await writeJson(join(outputDir, 'inventory.json'), inventory);
    await writeJson(join(outputDir, 'outcomes.json'), outcomes);
    for (const observation of [codex.observation, claude.observation]) {
      const directory = join(outputDir, observation.provider);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'stream.jsonl'),
        safeText({ value: observation.stdout, ...sanitization }),
      );
      await writeFile(
        join(directory, 'stderr.txt'),
        safeText({ value: observation.stderr, ...sanitization }),
      );
      await writeFile(
        join(directory, 'hooks.jsonl'),
        safeText({ value: observation.hookEvidence, ...sanitization }),
      );
    }
    await writeFile(
      join(outputDir, 'shell-allowed.txt'),
      safeText({ value: shell.allowed.stdout, ...sanitization }),
    );
    await writeFile(
      join(outputDir, 'shell-wrong-stderr.txt'),
      safeText({ value: shell.wrong.stderr, ...sanitization }),
    );
    const written = await readTextEvidence([outputDir]);
    assertCredentialAbsent(credential, written);
    if (written.some(({ value }) => value.includes(credentialMarkerPrefix))) {
      throw new Error('synthetic marker prefix appeared in observed fixtures');
    }
    cleanupComplete = true;
    process.stdout.write(
      `${JSON.stringify({ outputDir, outcomes }, null, 2)}\n`,
    );
  } finally {
    await Promise.allSettled([allowedFixture.close(), wrongFixture.close()]);
    await rm(probeRoot, { recursive: true, force: true });
    if (!cleanupComplete) {
      process.stderr.write(
        'credential probe stopped before evidence completion; temporary fixtures removed\n',
      );
    }
  }
}

if (
  process.argv[1] &&
  basename(process.argv[1]).startsWith('credential-probe')
) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
