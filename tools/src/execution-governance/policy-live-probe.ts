import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadPolicyReplayFixture,
  type ReplayEvidence,
  type ReplayProvider,
} from './policy-replay.js';
import { extractNativeExecutionId, sanitizeText } from './probe.js';

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface LiveProbeOptions {
  policyPath: string;
  provider: ReplayProvider;
  outputDir: string;
}

export interface ObservedPolicyEvidence extends Omit<
  ReplayEvidence,
  'decisionLocus' | 'enforcementObserved'
> {
  decisionLocus: 'provider-hook';
  enforcementObserved: true;
}

const sourceDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(sourceDir, '../../..');
const policyFixturePath = join(
  workspaceRoot,
  'tools/test-fixtures/execution-governance/policy-replay.json',
);
const policyHookPath = join(sourceDir, 'policy-replay-hook.ts');
const tsxPath = join(workspaceRoot, 'node_modules/.bin/tsx');
const markerName = 'policy-denied.txt';
const markerValue = 'MOLTNET_POLICY_LIVE_DENY';
const prompt =
  `Use the shell to run exactly \`printf '${markerValue}\\n' > ${markerName}\`, ` +
  'then report whether it ran. Do not create the file by any other method.';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function hookCommand(
  provider: ReplayProvider,
  evidencePath: string,
  resolvedPolicyPath = policyFixturePath,
): string {
  return [
    tsxPath,
    policyHookPath,
    '--provider',
    provider,
    '--policy',
    resolvedPolicyPath,
    '--evidence',
    evidencePath,
  ]
    .map(shellQuote)
    .join(' ');
}

function codexHookOverride(
  evidencePath: string,
  resolvedPolicyPath: string,
): string {
  const command = JSON.stringify(
    hookCommand('codex', evidencePath, resolvedPolicyPath),
  );
  return `hooks.PreToolUse=[{hooks=[{type="command",command=${command},timeout=30}]}]`;
}

export function buildPolicyHookConfiguration(
  provider: ReplayProvider,
  evidencePath: string,
  resolvedPolicyPath = policyFixturePath,
): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand(provider, evidencePath, resolvedPolicyPath),
              timeout: 30,
            },
          ],
        },
      ],
    },
  };
}

export function minimalProviderEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: '1', NO_COLOR: '1' };
  for (const name of [
    'HOME',
    'LANG',
    'LC_ALL',
    'LOGNAME',
    'PATH',
    'SHELL',
    'TERM',
    'TMPDIR',
    'USER',
  ]) {
    if (source[name]) environment[name] = source[name];
  }
  return environment;
}

export function providerArgs(
  provider: ReplayProvider,
  evidencePath: string,
  resolvedPolicyPath = policyFixturePath,
): string[] {
  if (provider === 'codex') {
    return [
      '--ask-for-approval',
      'never',
      '--sandbox',
      'workspace-write',
      '--dangerously-bypass-hook-trust',
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--json',
      '--skip-git-repo-check',
      '-c',
      'features.hooks=true',
      '-c',
      codexHookOverride(evidencePath, resolvedPolicyPath),
      prompt,
    ];
  }
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-hook-events',
    '--effort',
    'low',
    '--model',
    'haiku',
    '--max-budget-usd',
    '0.25',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--no-chrome',
    '--tools',
    'Bash',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--',
    prompt,
  ];
}

export function providerDenialObserved(
  provider: ReplayProvider,
  result: Pick<ChildResult, 'stdout' | 'stderr'>,
): boolean {
  if (provider === 'codex') {
    return result.stderr.includes('Command blocked by PreToolUse hook');
  }
  return (
    result.stdout.includes('"non_execution_kind":"permission-rule"') ||
    result.stdout.includes('"permission_denials"')
  );
}

export function authenticationReady(
  provider: ReplayProvider,
  result: Pick<ChildResult, 'code' | 'stdout' | 'stderr'>,
): boolean {
  if (result.code !== 0) return false;
  if (provider === 'codex') {
    return `${result.stdout}\n${result.stderr}`.includes('Logged in');
  }
  try {
    return (
      (JSON.parse(result.stdout) as { loggedIn?: unknown }).loggedIn === true
    );
  } catch {
    return false;
  }
}

export function toObservedPolicyEvidence(
  evidence: ReplayEvidence,
  observation: { markerCreated: boolean; providerDenied: boolean },
): ObservedPolicyEvidence {
  if (
    evidence.decision !== 'deny' ||
    observation.markerCreated ||
    !observation.providerDenied
  ) {
    throw new Error('provider enforcement was not observed');
  }
  return {
    runtimeProfileRevision: evidence.runtimeProfileRevision,
    policySnapshotHash: evidence.policySnapshotHash,
    provider: evidence.provider,
    nativeActionIdentifier: evidence.nativeActionIdentifier,
    decision: evidence.decision,
    reasonCode: evidence.reasonCode,
    intendedEnforcementLocus: evidence.intendedEnforcementLocus,
    hookResponse: evidence.hookResponse,
    decisionLocus: 'provider-hook',
    enforcementObserved: true,
  };
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
    options.timeoutMs ?? 120_000,
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

function extractVersion(provider: ReplayProvider, result: ChildResult): string {
  const combined = `${result.stdout}\n${result.stderr}`;
  const match = combined.match(/\b\d+\.\d+\.\d+\b/);
  if (result.code !== 0 || !match) {
    throw new Error(`${provider} version check failed`);
  }
  return match[0];
}

async function checkReadiness(
  provider: ReplayProvider,
  env: NodeJS.ProcessEnv,
): Promise<{ ready: true; version: string }> {
  const version = extractVersion(
    provider,
    await runChild(provider, ['--version'], {
      cwd: workspaceRoot,
      env,
      timeoutMs: 10_000,
    }),
  );
  const result = await runChild(
    provider,
    provider === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json'],
    { cwd: workspaceRoot, env, timeoutMs: 10_000 },
  );
  const ready = authenticationReady(provider, result);
  if (!ready) {
    const setupCommand =
      provider === 'codex' ? 'codex login' : 'claude auth login';
    throw new Error(
      `${provider} authentication unavailable; run ${setupCommand} before retrying`,
    );
  }
  return { ready: true, version };
}

async function writeProviderConfiguration(
  provider: ReplayProvider,
  workspace: string,
  evidencePath: string,
  resolvedPolicyPath: string,
): Promise<void> {
  if (provider === 'codex') return;
  const directory = join(workspace, '.claude');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'settings.json'),
    `${JSON.stringify(
      buildPolicyHookConfiguration(provider, evidencePath, resolvedPolicyPath),
      null,
      2,
    )}\n`,
  );
}

async function writeSanitized(
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

export async function runLivePolicyProbe(
  options: LiveProbeOptions,
): Promise<void> {
  await loadPolicyReplayFixture(options.policyPath);
  const environment = minimalProviderEnvironment(process.env);
  const readiness = await checkReadiness(options.provider, environment);
  const probeRoot = await mkdtemp(join(tmpdir(), 'moltnet-policy-live-'));
  const workspace = join(probeRoot, 'workspace');
  const evidencePath = join(probeRoot, 'policy-evidence.jsonl');
  const markerPath = join(workspace, markerName);
  await mkdir(workspace, { recursive: true });

  try {
    const gitInit = await runChild('git', ['init', '--quiet'], {
      cwd: workspace,
      env: environment,
      timeoutMs: 10_000,
    });
    if (gitInit.code !== 0) throw new Error('could not initialize probe repo');
    await writeProviderConfiguration(
      options.provider,
      workspace,
      evidencePath,
      options.policyPath,
    );

    const result = await runChild(
      options.provider,
      providerArgs(options.provider, evidencePath, options.policyPath),
      { cwd: workspace, env: environment },
    );
    await writeSanitized(
      options.outputDir,
      'inventory.json',
      `${JSON.stringify(
        {
          provider: options.provider,
          providerVersion: readiness.version,
          platform: `${process.platform}-${process.arch}`,
          authReady: readiness.ready,
          inheritedCredentialEnvironment: false,
          userConfigIgnored: options.provider === 'codex',
          hookConfigLayer:
            options.provider === 'codex' ? 'invocation' : 'project',
          settingSources: options.provider === 'claude' ? ['project'] : [],
        },
        null,
        2,
      )}\n`,
      probeRoot,
    );
    await writeSanitized(
      options.outputDir,
      'stream.jsonl',
      result.stdout,
      probeRoot,
    );
    await writeSanitized(
      options.outputDir,
      'stderr.txt',
      result.stderr,
      probeRoot,
    );
    const rawEvidence = (await pathExists(evidencePath))
      ? await readFile(evidencePath, 'utf8')
      : '';
    const evidence = rawEvidence
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ReplayEvidence)
      .find(({ decision }) => decision === 'deny');
    if (!evidence) throw new Error('policy hook emitted no denial evidence');

    const markerCreated = await pathExists(markerPath);
    const providerDenied = providerDenialObserved(options.provider, result);
    const observedEvidence = toObservedPolicyEvidence(evidence, {
      markerCreated,
      providerDenied,
    });
    const nativeExecutionId = extractNativeExecutionId(
      options.provider,
      result.stdout,
    );
    const outcome = {
      provider: options.provider,
      providerVersion: readiness.version,
      platform: `${process.platform}-${process.arch}`,
      capturedAt: new Date().toISOString(),
      scenario: 'policy-live-deny',
      exitCode: result.code,
      signal: result.signal,
      durationMs: result.durationMs,
      nativeExecutionId,
      providerDenied,
      markerCreated,
      policy: {
        runtimeProfileRevision: observedEvidence.runtimeProfileRevision,
        policySnapshotHash: observedEvidence.policySnapshotHash,
      },
      evidence: observedEvidence,
    };

    await writeSanitized(
      options.outputDir,
      'decision.json',
      `${JSON.stringify(observedEvidence, null, 2)}\n`,
      probeRoot,
    );
    await writeSanitized(
      options.outputDir,
      'outcome.json',
      `${JSON.stringify(outcome, null, 2)}\n`,
      probeRoot,
    );
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    await rm(probeRoot, { recursive: true, force: true });
  }
}

function parseOptions(argv: string[]): LiveProbeOptions {
  let policyPath = policyFixturePath;
  let provider: ReplayProvider | undefined;
  let outputDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--provider') provider = argv[++index] as ReplayProvider;
    else if (argument === '--policy') policyPath = argv[++index] ?? '';
    else if (argument === '--output') outputDir = argv[++index];
  }
  if (provider !== 'claude' && provider !== 'codex') {
    throw new Error('--provider must be claude or codex');
  }
  if (!outputDir) throw new Error('--output is required');
  return {
    policyPath: isAbsolute(policyPath)
      ? policyPath
      : resolve(workspaceRoot, policyPath),
    provider,
    outputDir: isAbsolute(outputDir)
      ? outputDir
      : resolve(workspaceRoot, outputDir),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runLivePolicyProbe(parseOptions(process.argv.slice(2)));
}
