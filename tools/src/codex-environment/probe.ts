import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AgentIdentity } from '@moltnet/crypto-service';
import {
  createHostCapabilityRouter,
  createLocalSeedSigner,
} from '@themoltnet/agent-runtime';
import { agentSigningCapability } from '@themoltnet/pi-runtime';
import {
  ensureSnapshot,
  type ManagedVm,
  resumeVm,
} from '@themoltnet/sandbox-gondolin';
import { connect, readConfig } from '@themoltnet/sdk';

import { resolveRepoRoot } from '../repo.js';
import {
  type CodexGondolinEvidence,
  compatibilityProbePassed,
  serializeCompatibilityEvidence,
} from './contracts.js';
import {
  hostAuthenticationCapability,
  preflightBrokeredHostCredential,
  withoutBrokeredMoltNetSecrets,
} from './host-credentials.js';
import {
  type JsonRpcResponse,
  spawnCodexAppServer,
  type SpawnedAppServer,
} from './protocol.js';
import { type ExecServerRelay, startExecServerRelay } from './relay.js';

const execFileAsync = promisify(execFile);
const CODEX_VERSION = '0.149.0';
const CODEX_PACKAGE = `@openai/codex@${CODEX_VERSION}-linux-arm64`;
const MODEL = 'gpt-5.6-luna';
const GUEST_CLI = '/home/agent/bin/moltnet';
const CREDENTIAL_NAME_PATTERN = /SECRET|TOKEN|PRIVATE_KEY/i;
const gondolinPackage = createRequire(import.meta.url)(
  '@earendil-works/gondolin/package.json',
) as { version?: unknown };
const gondolinVersion =
  typeof gondolinPackage.version === 'string'
    ? gondolinPackage.version
    : 'unknown';

interface NpmPackResult {
  filename?: unknown;
  integrity?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function responseStatus(value: unknown): string {
  const status = asRecord(value).status;
  return typeof status === 'string' ? status : 'unknown';
}

function parseCodexVersion(output: string): string {
  const match = /codex-cli\s+(\S+)/.exec(output.trim());
  if (!match?.[1])
    throw new Error(`unexpected Codex version output: ${output}`);
  return match[1];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function resolveAgentName(): string {
  if (process.env.MOLTNET_AGENT_NAME) return process.env.MOLTNET_AGENT_NAME;
  const match = /(?:^|\/)\.moltnet\/([^/]+)\/gitconfig$/.exec(
    process.env.GIT_CONFIG_GLOBAL ?? '',
  );
  if (match?.[1]) return match[1];
  throw new Error(
    'set MOLTNET_AGENT_NAME or GIT_CONFIG_GLOBAL before running the probe',
  );
}

function resolveAgentDirectory(repoRoot: string, agentName: string): string {
  const activatedPath = process.env.MOLTNET_CREDENTIALS_PATH;
  return activatedPath
    ? path.dirname(activatedPath)
    : path.join(repoRoot, '.moltnet', agentName);
}

async function stageGuestCli(): Promise<Uint8Array> {
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moltnet-codex-guest-cli-'),
  );
  const outputPath = path.join(outputDirectory, 'moltnet');
  try {
    await execFileAsync('go', ['build', '-o', outputPath, '.'], {
      cwd: path.join(await resolveRepoRoot(), 'apps/moltnet-cli'),
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: 'linux',
        GOARCH: 'arm64',
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    return await readFile(outputPath);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

function notificationItem(message: JsonRpcResponse): Record<string, unknown> {
  return asRecord(asRecord(message.params).item);
}

async function stageGuestCodex(probeRoot: string): Promise<{
  binary: string;
  integrity: string;
}> {
  const packed = await execFileAsync(
    'npm',
    ['pack', '--json', '--pack-destination', probeRoot, CODEX_PACKAGE],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const packOutput = JSON.parse(packed.stdout) as unknown;
  const pack = (
    Array.isArray(packOutput)
      ? packOutput[0]
      : Object.values(asRecord(packOutput))[0]
  ) as NpmPackResult | undefined;
  if (
    !pack ||
    typeof pack.filename !== 'string' ||
    typeof pack.integrity !== 'string'
  ) {
    throw new Error('npm pack did not return filename and integrity');
  }
  const tarballPath = path.join(probeRoot, pack.filename);
  const observedIntegrity = `sha512-${createHash('sha512')
    .update(await readFile(tarballPath))
    .digest('base64')}`;
  if (observedIntegrity !== pack.integrity) {
    throw new Error('downloaded Codex package integrity did not match npm');
  }
  const packageRoot = path.join(probeRoot, 'codex-package');
  await mkdir(packageRoot);
  await execFileAsync('tar', ['-xzf', tarballPath, '-C', packageRoot], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    binary: path.join(
      packageRoot,
      'package/vendor/aarch64-unknown-linux-musl/bin/codex',
    ),
    integrity: pack.integrity,
  };
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('the retained spike currently supports macOS ARM64 only');
}

const repoRoot = await resolveRepoRoot();
const agentName = resolveAgentName();
const agentDirectory = resolveAgentDirectory(repoRoot, agentName);
const agentConfig = await readConfig(agentDirectory);
if (!agentConfig) {
  throw new Error(`credential preflight failed: required_binding_missing`);
}
const credentialPreflight = preflightBrokeredHostCredential(
  agentConfig,
  process.env,
);
if (credentialPreflight !== 'ready') {
  throw new Error(
    `credential preflight failed: ${credentialPreflight}; run the probe through the released moltnet start broker`,
  );
}
const brokeredClientId = process.env.MOLTNET_CLIENT_ID;
const brokeredClientSecret = process.env.MOLTNET_CLIENT_SECRET;
if (!brokeredClientId || !brokeredClientSecret) {
  throw new Error('moltnet start did not deliver the configured OAuth binding');
}
const hostAgent = await connect({
  clientId: brokeredClientId,
  clientSecret: brokeredClientSecret,
  apiUrl: agentConfig.endpoints.api,
});
const agentIdentity: AgentIdentity = {
  agentName,
  identityId: agentConfig.identity_id,
  publicKey: agentConfig.keys.public_key,
  fingerprint: agentConfig.keys.fingerprint,
  gitName: agentConfig.git?.name ?? agentName,
  gitEmail:
    agentConfig.git?.email ??
    `${agentConfig.identity_id}+${agentName}[bot]@users.noreply.github.com`,
};
const hostSigner = createLocalSeedSigner({
  privateKeySeed: agentConfig.keys.private_key,
  agent: hostAgent,
  identity: agentIdentity,
});
const revision = (
  await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
).stdout.trim();
const hostCodexBinary = process.env.MOLTNET_CODEX_BIN ?? 'codex';
const hostCodexVersion = parseCodexVersion(
  (await execFileAsync(hostCodexBinary, ['--version'])).stdout,
);
if (hostCodexVersion !== CODEX_VERSION) {
  throw new Error(
    `host Codex ${hostCodexVersion} does not match pinned ${CODEX_VERSION}`,
  );
}

const probeRoot = await mkdtemp(
  path.join(os.tmpdir(), 'moltnet-codex-gondolin-'),
);
const proofPath = path.join(probeRoot, 'guest-proof.txt');
const envNamesPath = path.join(probeRoot, 'guest-env-names.txt');
const capabilityProofPath = path.join(probeRoot, 'capability-proof.txt');
const delayedMarkerPath = path.join(probeRoot, 'delayed-marker.txt');
const hostOnlySentinel = `moltnet-host-only-${randomUUID()}`;

let managed: ManagedVm | undefined;
let relay: ExecServerRelay | undefined;
let app: SpawnedAppServer | undefined;
let cleanupComplete = false;
let runError: unknown;
let packageIntegrity = '';
let guestCodexVersion = '';
let environmentStatusBeforeConnect = 'unknown';
let environmentStatusAfterConnect = 'unknown';
let commandStarted = false;
let commandCompleted = false;
let commandExitCode: number | null = null;
let turnCompleted = false;
let hostSigningKeyProjected = false;
const capabilityEvents: Array<[Record<string, unknown>, string]> = [];

try {
  const stagedCodex = await stageGuestCodex(probeRoot);
  const guestCli = await stageGuestCli();
  packageIntegrity = stagedCodex.integrity;
  const checkpointPath = await ensureSnapshot({
    onProgress: (message) => process.stderr.write(`${message}\n`),
  });
  const capabilityRouter = createHostCapabilityRouter({
    capabilities: [agentSigningCapability, hostAuthenticationCapability],
    context: {
      taskId: 'codex-gondolin-compatibility',
      attemptN: 1,
      teamId: 'probe',
      agent: hostAgent,
      identity: agentIdentity,
    },
    injected: { signer: hostSigner },
    paths: { mountPath: probeRoot },
    logger: {
      info: (fields, message) => capabilityEvents.push([fields, message]),
      warn: (fields, message) => capabilityEvents.push([fields, message]),
    },
  });
  capabilityRouter.setPolicy({
    enforcement: 'enforce',
    allowedTools: new Set([
      'capability:agent-signing:sign-git-commit',
      'capability:host-auth-check:whoami',
    ]),
  });
  const guestProjection = {
    env: capabilityRouter.guestProjection.env,
    files: [
      ...capabilityRouter.guestProjection.files,
      { path: GUEST_CLI, content: guestCli, mode: 0o755 },
    ],
    services: capabilityRouter.guestProjection.services.map((service) => ({
      ...service,
      command: [GUEST_CLI, ...service.command.slice(1)],
    })),
  };
  const projectedText = [
    ...Object.values(guestProjection.env),
    ...guestProjection.files.flatMap((file) =>
      typeof file.content === 'string' ? [file.content] : [],
    ),
    ...guestProjection.services.flatMap((service) => [
      ...service.command,
      ...Object.values(service.env ?? {}),
    ]),
  ].join('\n');
  hostSigningKeyProjected = projectedText.includes(
    agentConfig.keys.private_key,
  );
  managed = await resumeVm({
    checkpointPath,
    agentName,
    agentRootDir: repoRoot,
    mountPath: probeRoot,
    workspaceMode: 'scratch_mount',
    sandboxConfig: { resources: { memory: '2G', cpus: 2 } },
    hostOrigins: capabilityRouter.origins,
    guestProjection,
  });
  const guestVersionResult = await managed.vm.exec([
    stagedCodex.binary,
    '--version',
  ]);
  if (!guestVersionResult.ok) {
    throw new Error('guest Codex version command failed');
  }
  guestCodexVersion = parseCodexVersion(guestVersionResult.stdout);
  if (guestCodexVersion !== CODEX_VERSION) {
    throw new Error(
      `guest Codex ${guestCodexVersion} does not match pinned ${CODEX_VERSION}`,
    );
  }

  const activeVm = managed;
  relay = await startExecServerRelay({
    createExecServer: () =>
      activeVm.vm.exec(
        [stagedCodex.binary, 'exec-server', '--listen', 'stdio'],
        { stdin: true, stdout: 'pipe', stderr: 'pipe' },
      ),
    onGuestStderr: (text) => {
      if (process.env.MOLTNET_CODEX_PROBE_DEBUG === '1') {
        process.stderr.write(text);
      }
    },
  });
  app = spawnCodexAppServer({
    codexBinary: hostCodexBinary,
    cwd: repoRoot,
    env: withoutBrokeredMoltNetSecrets(
      {
        ...process.env,
        MOLTNET_HOST_ONLY_SENTINEL: hostOnlySentinel,
      },
      brokeredClientSecret,
    ),
  });
  const client = app.client;
  await client.request('initialize', {
    clientInfo: { name: 'moltnet-gondolin-spike', version: '0.0.0' },
    capabilities: { experimentalApi: true },
  });
  client.notify('initialized', {});

  const environmentId = `moltnet-gondolin-${randomUUID()}`;
  await client.request('environment/add', {
    environmentId,
    execServerUrl: relay.url,
    connectTimeoutMs: 5_000,
  });
  environmentStatusBeforeConnect = responseStatus(
    await client.request('environment/status', { environmentId }),
  );
  await client.request('environment/info', { environmentId });
  environmentStatusAfterConnect = responseStatus(
    await client.request('environment/status', { environmentId }),
  );

  const started = asRecord(
    await client.request('thread/start', {
      ephemeral: true,
      cwd: probeRoot,
      environments: [
        { environmentId, cwd: probeRoot, runtimeWorkspaceRoots: [probeRoot] },
      ],
    }),
  );
  const threadId = asRecord(started.thread).id;
  if (typeof threadId !== 'string') {
    throw new Error('Codex App Server did not return a thread id');
  }

  const delayedCommand = `sleep 3; printf survived > ${shellQuote(delayedMarkerPath)}`;
  const command = [
    `uname -s > ${shellQuote(proofPath)}`,
    `printf 'guest-exec-server\\n' >> ${shellQuote(proofPath)}`,
    `env | cut -d= -f1 | sort > ${shellQuote(envNamesPath)}`,
    `cd ${shellQuote(probeRoot)}`,
    `${GUEST_CLI} capability call host-auth-check whoami --json '{}' > host-auth.json`,
    `grep -q '"authenticated": true' host-auth.json`,
    `grep -q '"agentSubject": true' host-auth.json`,
    `grep -q '"identityMatched": true' host-auth.json`,
    `git init -q signed-repo`,
    `cd signed-repo`,
    `git commit -q -S --allow-empty -m 'signed through host capability'`,
    `git verify-commit HEAD`,
    `cd ..`,
    `if ${GUEST_CLI} capability call agent-signing sign-diary-entry --json '{"signingRequestId":"11111111-2222-4333-8444-555555555555"}' >/dev/null 2>&1; then exit 23; fi`,
    `printf 'authenticated-host-call=true\\nagent-subject=true\\nidentity-matched=true\\ngit-signature-verified=true\\ndenied-operation=true\\n' > ${shellQuote(capabilityProofPath)}`,
    `printf 'private-key-files=' >> ${shellQuote(capabilityProofPath)}`,
    `find /home/agent -name id_ed25519 -type f 2>/dev/null | wc -l | tr -d ' ' >> ${shellQuote(capabilityProofPath)}`,
    `printf '\\ncredential-directories=' >> ${shellQuote(capabilityProofPath)}`,
    `find /home/agent -name .moltnet -type d 2>/dev/null | wc -l | tr -d ' ' >> ${shellQuote(capabilityProofPath)}`,
    `printf '\\n' >> ${shellQuote(capabilityProofPath)}`,
    `setsid sh -c ${shellQuote(delayedCommand)} >/dev/null 2>&1 &`,
  ].join('; ');
  await client.request('turn/start', {
    threadId,
    approvalPolicy: 'never',
    effort: 'low',
    model: MODEL,
    environments: [
      { environmentId, cwd: probeRoot, runtimeWorkspaceRoots: [probeRoot] },
    ],
    sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' },
    input: [
      {
        type: 'text',
        text:
          'Run exactly one shell command for this compatibility probe, then reply done. ' +
          `The command is: ${command}`,
      },
    ],
  });
  const completedTurn = await client.waitForNotification(
    (message) =>
      message.method === 'turn/completed' &&
      asRecord(message.params).threadId === threadId,
    120_000,
  );
  turnCompleted =
    asRecord(asRecord(completedTurn.params).turn).status === 'completed';

  const commandEvents = client
    .notifications()
    .filter((message) => notificationItem(message).type === 'commandExecution');
  commandStarted = commandEvents.some(
    (message) => message.method === 'item/started',
  );
  const completedCommand = commandEvents.find(
    (message) => message.method === 'item/completed',
  );
  if (completedCommand) {
    const item = notificationItem(completedCommand);
    commandCompleted = item.status === 'completed';
    commandExitCode = typeof item.exitCode === 'number' ? item.exitCode : null;
  }
} catch (error) {
  runError = error;
}

const cleanupErrors: unknown[] = [];
for (const close of [
  () => app?.close(),
  () => relay?.close(),
  () => managed?.services.stop(),
  () => managed?.vm.close(),
]) {
  try {
    await close();
  } catch (error) {
    cleanupErrors.push(error);
  }
}
cleanupComplete = cleanupErrors.length === 0;

if (runError) {
  await rm(probeRoot, { recursive: true, force: true });
  throw runError;
}
if (cleanupErrors.length > 0) {
  await rm(probeRoot, { recursive: true, force: true });
  throw new AggregateError(cleanupErrors, 'compatibility probe cleanup failed');
}

await new Promise((resolve) => {
  setTimeout(resolve, 4_500);
});
const delayedMarkerAfterVmClose = await readFile(delayedMarkerPath)
  .then(() => true)
  .catch(() => false);
const proof = (await readFile(proofPath, 'utf8')).trim().split('\n');
const capabilityProof = Object.fromEntries(
  (await readFile(capabilityProofPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => line.split('=', 2)),
);
const environmentNames = (await readFile(envNamesPath, 'utf8'))
  .split('\n')
  .filter(Boolean);
const evidence: CodexGondolinEvidence = {
  schemaVersion: 2,
  probe: 'codex-gondolin-compatibility',
  sourceRevision: revision,
  host: {
    os: process.platform,
    architecture: process.arch,
    codexVersion: hostCodexVersion,
  },
  guest: {
    os: 'linux',
    architecture: 'arm64',
    codexVersion: guestCodexVersion,
  },
  gondolinVersion,
  codexPackage: {
    specifier: CODEX_PACKAGE,
    integrity: packageIntegrity,
  },
  model: MODEL,
  transport: {
    environmentStatusBeforeConnect,
    environmentStatusAfterConnect,
    relayConnectionCount: relay?.connectionCount() ?? 0,
  },
  execution: {
    commandStarted,
    commandCompleted,
    commandExitCode,
    turnCompleted,
    guestOsMarker: proof[0] ?? '<missing>',
    guestExecutorMarker: proof[1] ?? '<missing>',
  },
  hostCredentialCapability: {
    credentialPreflight,
    authenticatedHostCall:
      capabilityProof['authenticated-host-call'] === 'true',
    authenticatedAgentSubject: capabilityProof['agent-subject'] === 'true',
    authenticatedIdentityMatched:
      capabilityProof['identity-matched'] === 'true',
    gitCommitSignatureVerified:
      capabilityProof['git-signature-verified'] === 'true',
    allowedOperations: capabilityEvents
      .filter(([, message]) => message === 'host_capability.allowed')
      .map(
        ([fields]) =>
          `${String(fields.capability)}/${String(fields.operation)}`,
      )
      .sort(),
    deniedOperations: capabilityEvents
      .filter(([, message]) => message === 'host_capability.denied')
      .map(
        ([fields]) =>
          `${String(fields.capability)}/${String(fields.operation)}`,
      )
      .sort(),
  },
  isolation: {
    hostOnlySentinelProjected: environmentNames.includes(
      'MOLTNET_HOST_ONLY_SENTINEL',
    ),
    credentialShapedEnvironmentNames: environmentNames.filter((name) =>
      CREDENTIAL_NAME_PATTERN.test(name),
    ),
    hostSigningKeyProjected,
    guestPrivateKeyFiles: Number(capabilityProof['private-key-files']),
    guestCredentialDirectories: Number(
      capabilityProof['credential-directories'],
    ),
    delayedMarkerAfterVmClose,
  },
  cleanupComplete,
  limitations: [
    'Host credential access is capability-mediated; the guest receives no raw credential.',
    'Does not prove exact-origin HTTP credential delivery.',
    'Does not establish Docker compatibility.',
    'Uses experimental Codex remote-environment interfaces.',
  ],
};

const outputDirectory = path.join(
  repoRoot,
  'tools/test-fixtures/codex-environment/observed',
);
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(
  outputDirectory,
  `codex-${CODEX_VERSION}-gondolin-${gondolinVersion}-${process.platform}-${process.arch}.json`,
);
const temporaryOutputPath = `${outputPath}.tmp-${process.pid}`;
try {
  await writeFile(
    temporaryOutputPath,
    serializeCompatibilityEvidence(evidence, [hostOnlySentinel]),
  );
  await rename(temporaryOutputPath, outputPath);
} finally {
  await rm(temporaryOutputPath, { force: true });
  await rm(probeRoot, { recursive: true, force: true });
}

process.stdout.write(`${outputPath}\n`);
process.exitCode = compatibilityProbePassed(evidence) ? 0 : 1;
