import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Provider = 'claude' | 'codex';

interface Scenario {
  id: string;
  prompt: string;
  purpose: string;
}

interface ScenarioFile {
  notice: string;
  scenarios: Scenario[];
}

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface ProbeOptions {
  provider: Provider;
  scenarioId: string;
  outputDir: string;
  keepWorkspace: boolean;
}

interface RpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
  method?: string;
  params?: unknown;
}

const sourceDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(sourceDir, '../../..');
const fixturePath = join(
  workspaceRoot,
  'tools/test-fixtures/execution-governance/scenarios.json',
);
const hookRecorderPath = join(sourceDir, 'hook-recorder.mjs');
const mcpServerPath = join(sourceDir, 'mcp-probe-server.mjs');
const hookEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
] as const;

function hookCommand(): string {
  return `node ${JSON.stringify(hookRecorderPath)}`;
}

function hookConfiguration(): Record<string, unknown> {
  return {
    hooks: Object.fromEntries(
      hookEvents.map((event) => [
        event,
        [
          {
            hooks: [
              {
                type: 'command',
                command: hookCommand(),
              },
            ],
          },
        ],
      ]),
    ),
  };
}

export function sanitizeText(
  value: string,
  replacements: { probeRoot: string; home?: string },
): string {
  let sanitized = value;
  const roots = [`/private${replacements.probeRoot}`, replacements.probeRoot];
  for (const root of roots) {
    sanitized = sanitized.split(root).join('$PROBE_ROOT');
    sanitized = sanitized
      .split(root.replaceAll('/', '-'))
      .join('$PROBE_ROOT_SLUG');
  }
  if (replacements.home) {
    sanitized = sanitized.split(replacements.home).join('$HOME');
  }
  return sanitized;
}

export function extractNativeExecutionId(
  provider: Provider,
  stream: string,
): string | undefined {
  for (const line of stream.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (
        provider === 'codex' &&
        event.type === 'thread.started' &&
        typeof event.thread_id === 'string'
      ) {
        return event.thread_id;
      }
      if (provider === 'claude' && typeof event.session_id === 'string') {
        return event.session_id;
      }
    } catch {
      // Provider stderr can be interleaved by wrappers. Non-JSON lines are kept
      // as evidence but do not participate in identifier extraction.
    }
  }
  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runChild(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<ChildResult> {
  const startedAt = performance.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const timeout = setTimeout(
    () => child.kill('SIGTERM'),
    options.timeoutMs ?? 240_000,
  );
  const result = await new Promise<Pick<ChildResult, 'code' | 'signal'>>(
    (resolveResult, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveResult({ code, signal }));
    },
  );
  clearTimeout(timeout);
  return {
    ...result,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function commandVersion(command: Provider): Promise<string> {
  const result = await runChild(command, ['--version'], {
    cwd: workspaceRoot,
    env: process.env,
    timeoutMs: 10_000,
  });
  return `${result.stdout}${result.stderr}`.trim();
}

async function runCodexAppServerProbe(options: {
  workspace: string;
  codexHome: string;
  hostDir: string;
  outputDir: string;
  probeRoot: string;
}): Promise<void> {
  const marker = join(options.hostDir, 'app-server-host-marker.txt');
  const hookLog = join(options.probeRoot, 'app-server.hooks.jsonl');
  const child = spawn('codex', ['app-server', '--stdio'], {
    cwd: options.workspace,
    env: {
      ...process.env,
      CODEX_HOME: options.codexHome,
      MOLTNET_PROBE_HOOK_LOG: hookLog,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const messages: string[] = [];
  const stderr: Buffer[] = [];
  const pending = new Map<
    number,
    { resolve: (message: RpcResponse) => void; reject: (error: Error) => void }
  >();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    messages.push(line);
    try {
      const message = JSON.parse(line) as RpcResponse;
      if (typeof message.id === 'number') {
        pending.get(message.id)?.resolve(message);
        pending.delete(message.id);
      }
    } catch {
      // Preserve non-JSON server output as evidence without treating it as a
      // protocol response.
    }
  });
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  const request = async (
    id: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<RpcResponse> => {
    const response = new Promise<RpcResponse>((resolveResponse, reject) => {
      pending.set(id, { resolve: resolveResponse, reject });
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return Promise.race([
      response,
      delay(10_000).then(() => {
        pending.delete(id);
        throw new Error(`app-server request timed out: ${method}`);
      }),
    ]);
  };

  let threadId: string | undefined;
  let shellResponse: RpcResponse | undefined;
  try {
    await request(1, 'initialize', {
      clientInfo: { name: 'moltnet-boundary-probe', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      `${JSON.stringify({ method: 'initialized', params: {} })}\n`,
    );
    const started = await request(2, 'thread/start', {
      cwd: options.workspace,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
    });
    const thread = started.result?.thread as
      | Record<string, unknown>
      | undefined;
    threadId = typeof thread?.id === 'string' ? thread.id : undefined;
    if (!threadId) throw new Error('app-server did not return a thread id');
    shellResponse = await request(3, 'thread/shellCommand', {
      threadId,
      command: `printf 'app-server-host\\n' > ${JSON.stringify(marker)}`,
    });
    for (
      let attempt = 0;
      attempt < 50 && !(await pathExists(marker));
      attempt += 1
    ) {
      await delay(100);
    }
  } finally {
    const closed = new Promise<void>((resolveClose) => {
      child.once('close', () => resolveClose());
    });
    child.kill('SIGTERM');
    await closed;
    for (const waiter of pending.values()) {
      waiter.reject(new Error('app-server stopped before responding'));
    }
    lines.close();
  }

  const evidenceDir = join(options.outputDir, 'app-server-host');
  await writeEvidence(
    evidenceDir,
    'stream.jsonl',
    `${messages.join('\n')}\n`,
    options.probeRoot,
  );
  await writeEvidence(
    evidenceDir,
    'stderr.txt',
    Buffer.concat(stderr).toString('utf8'),
    options.probeRoot,
  );
  const hookEvidence = (await pathExists(hookLog))
    ? await readFile(hookLog, 'utf8')
    : '';
  await writeEvidence(
    evidenceDir,
    'hooks.jsonl',
    hookEvidence,
    options.probeRoot,
  );
  await writeEvidence(
    evidenceDir,
    'outcome.json',
    `${JSON.stringify(
      {
        provider: 'codex',
        surface: 'app-server',
        method: 'thread/shellCommand',
        configuredThreadSandbox: 'read-only',
        nativeExecutionId: threadId,
        responseError: shellResponse?.error ?? null,
        hostWrite: await pathExists(marker),
        hookEventCount: hookEvidence.trim()
          ? hookEvidence.trim().split('\n').length
          : 0,
      },
      null,
      2,
    )}\n`,
    options.probeRoot,
  );
}

function codexArgs(
  scenario: Scenario,
  workspace: string,
  approvalPolicy: 'never' | 'on-request',
  mcpEnv: Record<string, string>,
  configuredMcpServerPath: string,
): string[] {
  const sandbox =
    approvalPolicy === 'on-request' ? 'read-only' : 'workspace-write';
  return [
    '--ask-for-approval',
    approvalPolicy,
    'exec',
    '--json',
    '--dangerously-bypass-hook-trust',
    '--skip-git-repo-check',
    '--sandbox',
    sandbox,
    '-C',
    workspace,
    '-c',
    'mcp_servers.probe.command="node"',
    '-c',
    `mcp_servers.probe.args=${JSON.stringify([configuredMcpServerPath])}`,
    ...Object.entries(mcpEnv).flatMap(([name, value]) => [
      '-c',
      `mcp_servers.probe.env.${name}=${JSON.stringify(value)}`,
    ]),
    scenario.prompt,
  ];
}

function claudeArgs(
  scenario: Scenario,
  permissionMode: 'acceptEdits' | 'dontAsk' | 'manual',
  mcpConfig: string,
): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-hook-events',
    '--effort',
    'low',
    '--max-budget-usd',
    '1',
    '--permission-mode',
    permissionMode,
    ...(scenario.id === 'mcp-execution'
      ? [
          '--allowedTools',
          'mcp__probe__probe_echo,mcp__probe__probe_write_host,mcp__probe__probe_network',
        ]
      : []),
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--',
    scenario.prompt,
  ];
}

function scenarioPermissions(scenarioId: string): {
  codex: 'never' | 'on-request';
  claude: 'acceptEdits' | 'dontAsk' | 'manual';
} {
  if (scenarioId.startsWith('approval-')) {
    return { codex: 'on-request', claude: 'manual' };
  }
  if (scenarioId === 'mcp-execution') {
    return { codex: 'on-request', claude: 'dontAsk' };
  }
  if (scenarioId === 'covered-actions') {
    return { codex: 'never', claude: 'acceptEdits' };
  }
  return { codex: 'never', claude: 'dontAsk' };
}

function interpolateScenario(
  scenario: Scenario,
  values: { outsideFile: string; loopbackUrl: string },
): Scenario {
  return {
    ...scenario,
    prompt: scenario.prompt
      .replaceAll('{{OUTSIDE_FILE}}', JSON.stringify(values.outsideFile))
      .replaceAll('{{LOOPBACK_URL}}', values.loopbackUrl),
  };
}

async function writeProviderConfiguration(
  provider: Provider,
  workspace: string,
): Promise<void> {
  const config = hookConfiguration();
  if (provider === 'claude') {
    Object.assign(config, {
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        failIfUnavailable: true,
      },
    });
  }
  const directory =
    provider === 'codex' ? workspace : join(workspace, '.claude');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, provider === 'codex' ? 'hooks.json' : 'settings.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function writeEvidence(
  outputDir: string,
  name: string,
  value: string,
  probeRoot: string,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, name),
    sanitizeText(value, { probeRoot, home: homedir() }),
  );
}

async function runResume(
  provider: Provider,
  nativeId: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  mcpConfig: string,
): Promise<ChildResult> {
  if (provider === 'codex') {
    return runChild(
      'codex',
      [
        '--ask-for-approval',
        'never',
        'exec',
        'resume',
        '--json',
        '--dangerously-bypass-hook-trust',
        '--skip-git-repo-check',
        nativeId,
        'Reply exactly RESUME_PROBE_OK without using tools.',
      ],
      { cwd: workspace, env },
    );
  }
  return runChild(
    'claude',
    [
      '-p',
      '--resume',
      nativeId,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-hook-events',
      '--effort',
      'low',
      '--max-budget-usd',
      '1',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
      '--mcp-config',
      mcpConfig,
      '--',
      'Reply exactly RESUME_PROBE_OK without using tools.',
    ],
    { cwd: workspace, env },
  );
}

export async function runProbe(options: ProbeOptions): Promise<void> {
  const fixtures = JSON.parse(
    await readFile(fixturePath, 'utf8'),
  ) as ScenarioFile;
  const requested =
    options.scenarioId === 'all'
      ? fixtures.scenarios
      : fixtures.scenarios.filter(({ id }) => id === options.scenarioId);
  if (requested.length === 0) {
    throw new Error(`unknown scenario: ${options.scenarioId}`);
  }

  const probeRoot = await mkdtemp(join(tmpdir(), 'moltnet-governance-probe-'));
  const workspace = join(probeRoot, 'workspace');
  const hostDir = join(probeRoot, 'host-side');
  const sandboxTarget = join(options.outputDir, '.sandbox-host-marker.txt');
  const codexHome = join(probeRoot, 'codex-home');
  await mkdir(workspace, { recursive: true });
  await mkdir(hostDir, { recursive: true });
  const gitInit = await runChild('git', ['init', '--quiet'], {
    cwd: workspace,
    env: process.env,
    timeoutMs: 10_000,
  });
  if (gitInit.code !== 0) {
    throw new Error(`could not initialize probe repository: ${gitInit.stderr}`);
  }
  await writeFile(join(workspace, 'editable.txt'), 'BEFORE\n');
  await writeFile(join(workspace, 'child-source.txt'), 'SUBAGENT_SOURCE\n');
  if (options.provider === 'codex') {
    await mkdir(codexHome, { recursive: true });
    await symlink(
      join(homedir(), '.codex/auth.json'),
      join(codexHome, 'auth.json'),
    );
  }
  await writeProviderConfiguration(
    options.provider,
    options.provider === 'codex' ? codexHome : workspace,
  );

  const httpServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('loopback-network-ok\n');
  });
  await new Promise<void>((resolveListen) => {
    httpServer.listen(0, '127.0.0.1', resolveListen);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('probe loopback server did not expose a TCP port');
  }
  const loopbackUrl = `http://127.0.0.1:${address.port}/probe`;
  const inventory = {
    notice: fixtures.notice,
    provider: options.provider,
    providerVersion: await commandVersion(options.provider),
    platform: `${process.platform}-${process.arch}`,
    capturedAt: new Date().toISOString(),
    appServerAvailable: options.provider === 'codex',
    hookConfigLayer:
      options.provider === 'codex' ? 'isolated-user' : 'isolated-project',
    desktopApplicationPresent: await pathExists(
      options.provider === 'codex'
        ? '/Applications/ChatGPT.app'
        : '/Applications/Claude.app',
    ),
  };
  await writeEvidence(
    options.outputDir,
    'inventory.json',
    `${JSON.stringify(inventory, null, 2)}\n`,
    probeRoot,
  );
  try {
    if (options.provider === 'codex') {
      await runCodexAppServerProbe({
        workspace,
        codexHome,
        hostDir,
        outputDir: options.outputDir,
        probeRoot,
      });
    }
    for (const fixture of requested) {
      const scenario = interpolateScenario(fixture, {
        outsideFile: sandboxTarget,
        loopbackUrl,
      });
      await Promise.all(
        [
          'shell-parent.txt',
          'shell-child.txt',
          'hook-denied.txt',
          'hook-ask.txt',
          'approval-allowed.txt',
          'approval-denied.txt',
          'hook-unavailable.txt',
        ].map((name) => rm(join(workspace, name), { force: true })),
      );
      await rm(sandboxTarget, { force: true });
      await writeFile(join(workspace, 'editable.txt'), 'BEFORE\n');
      const scenarioDir = join(options.outputDir, scenario.id);
      const hookLog = join(probeRoot, `${scenario.id}.hooks.jsonl`);
      const mcpLog = join(probeRoot, `${scenario.id}.mcp.jsonl`);
      const hostMarker = join(hostDir, `${scenario.id}.mcp-host-marker.txt`);
      const configuredMcpServerPath =
        scenario.id === 'mcp-unavailable'
          ? join(probeRoot, 'missing-mcp-server.mjs')
          : mcpServerPath;
      const mcpConfig = JSON.stringify({
        mcpServers: {
          probe: {
            command: 'node',
            args: [configuredMcpServerPath],
            env: {
              MOLTNET_PROBE_HOST_MARKER: hostMarker,
              MOLTNET_PROBE_LOOPBACK_URL: loopbackUrl,
              MOLTNET_PROBE_MCP_LOG: mcpLog,
            },
          },
        },
      });
      const env = {
        ...process.env,
        ...(options.provider === 'codex' ? { CODEX_HOME: codexHome } : {}),
        MOLTNET_PROBE_PROVIDER: options.provider,
        MOLTNET_PROBE_HOOK_LOG: hookLog,
        MOLTNET_PROBE_MCP_LOG: mcpLog,
        MOLTNET_PROBE_HOST_MARKER: hostMarker,
        MOLTNET_PROBE_LOOPBACK_URL: loopbackUrl,
      };
      const permissions = scenarioPermissions(scenario.id);
      const args =
        options.provider === 'codex'
          ? codexArgs(
              scenario,
              workspace,
              permissions.codex,
              {
                MOLTNET_PROBE_HOST_MARKER: hostMarker,
                MOLTNET_PROBE_LOOPBACK_URL: loopbackUrl,
                MOLTNET_PROBE_MCP_LOG: mcpLog,
              },
              configuredMcpServerPath,
            )
          : claudeArgs(scenario, permissions.claude, mcpConfig);
      const result = await runChild(options.provider, args, {
        cwd: workspace,
        env,
      });
      await writeEvidence(
        scenarioDir,
        'stream.jsonl',
        result.stdout,
        probeRoot,
      );
      await writeEvidence(scenarioDir, 'stderr.txt', result.stderr, probeRoot);
      const nativeExecutionId = extractNativeExecutionId(
        options.provider,
        result.stdout,
      );
      let resume: ChildResult | undefined;
      if (scenario.id === 'lifecycle' && nativeExecutionId) {
        resume = await runResume(
          options.provider,
          nativeExecutionId,
          workspace,
          env,
          mcpConfig,
        );
        await writeEvidence(
          scenarioDir,
          'resume-stream.jsonl',
          resume.stdout,
          probeRoot,
        );
        await writeEvidence(
          scenarioDir,
          'resume-stderr.txt',
          resume.stderr,
          probeRoot,
        );
      }
      const hookEvidence = (await pathExists(hookLog))
        ? await readFile(hookLog, 'utf8')
        : '';
      const mcpEvidence = (await pathExists(mcpLog))
        ? await readFile(mcpLog, 'utf8')
        : '';
      await writeEvidence(scenarioDir, 'hooks.jsonl', hookEvidence, probeRoot);
      await writeEvidence(scenarioDir, 'mcp.jsonl', mcpEvidence, probeRoot);

      const outcomes = {
        provider: options.provider,
        scenario: scenario.id,
        purpose: scenario.purpose,
        nativeExecutionId,
        exitCode: result.code,
        signal: result.signal,
        durationMs: result.durationMs,
        resume: resume && {
          exitCode: resume.code,
          signal: resume.signal,
          durationMs: resume.durationMs,
        },
        artifacts: {
          shellParent: await pathExists(join(workspace, 'shell-parent.txt')),
          nativeEdit:
            (await readFile(join(workspace, 'editable.txt'), 'utf8')) ===
            'AFTER\n',
          shellChild: await pathExists(join(workspace, 'shell-child.txt')),
          hookDenied: await pathExists(join(workspace, 'hook-denied.txt')),
          hookAsk: await pathExists(join(workspace, 'hook-ask.txt')),
          approvalAllowed:
            scenario.id === 'approval-allow' &&
            mcpEvidence.includes('MOLTNET_PROBE_APPROVAL_ALLOW'),
          approvalDenied:
            scenario.id === 'approval-deny' &&
            hookEvidence.includes('"hook_event_name":"PermissionRequest"') &&
            hookEvidence.includes('MOLTNET_PROBE_APPROVAL_DENY') &&
            !mcpEvidence.includes('MOLTNET_PROBE_APPROVAL_DENY'),
          sandboxEscape: await pathExists(sandboxTarget),
          unavailableHookAction: await pathExists(
            join(workspace, 'hook-unavailable.txt'),
          ),
          hostMcpWrite: await pathExists(hostMarker),
          mcpServerInitialized: mcpEvidence.includes('"method":"initialize"'),
          mcpToolDispatched: mcpEvidence.includes('"method":"tools/call"'),
        },
      };
      await writeEvidence(
        scenarioDir,
        'outcome.json',
        `${JSON.stringify(outcomes, null, 2)}\n`,
        probeRoot,
      );
    }
  } finally {
    await rm(sandboxTarget, { force: true });
    await new Promise<void>((resolveClose, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolveClose();
      });
    });
    if (options.keepWorkspace) {
      process.stderr.write(`probe workspace retained at ${probeRoot}\n`);
    } else {
      await rm(probeRoot, { recursive: true, force: true });
    }
  }
}

function parseOptions(argv: string[]): ProbeOptions {
  let provider: Provider | undefined;
  let scenarioId = 'all';
  let outputDir: string | undefined;
  let keepWorkspace = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--provider') provider = argv[++index] as Provider;
    else if (argument === '--scenario') scenarioId = argv[++index] ?? 'all';
    else if (argument === '--output') outputDir = argv[++index];
    else if (argument === '--keep-workspace') keepWorkspace = true;
  }
  if (provider !== 'codex' && provider !== 'claude') {
    throw new Error('--provider must be codex or claude');
  }
  if (!outputDir) throw new Error('--output is required');
  return {
    provider,
    scenarioId,
    outputDir: isAbsolute(outputDir)
      ? outputDir
      : resolve(workspaceRoot, outputDir),
    keepWorkspace,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runProbe(parseOptions(process.argv.slice(2)));
}
