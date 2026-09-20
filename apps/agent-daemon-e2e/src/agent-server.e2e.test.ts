/**
 * `moltnet-agent server` E2E — black-box over the loopback HTTP contract.
 *
 * Spawns the real Agent Server as a child process against an
 * isolated `--root`, then drives it through native process control:
 * native process authorization → JSON API → provider + managed-agent setup →
 * a real daemon run polling the e2e rest-api → stop → shutdown.
 *
 * Deliberately knows nothing about the persistence layer (file names,
 * secret-reference formats, config shapes): every assertion is on the
 * HTTP surface or on the one durable promise that secrets never land in
 * non-secret config files.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createAgentServerAgent,
  type CreateAgentServerAgentData,
  createClient,
  discoverAgentServerProviderModels,
  getAgentServerCatalogue,
  getAgentServerStatus,
  listAgentServerAgents,
  listAgentServerProviders,
  listAgentServerRuns,
  putAgentServerProvider,
  startAgentServerRun,
  stopAgentServerRun,
} from '@moltnet/agent-daemon-api-client';
import {
  type Agent,
  connect,
  readConfig,
  resolveAgentKey,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { enrollTeam, FileSecretProvider } from '@themoltnet/sdk/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const NATIVE_ORIGIN = 'moltnet-agent-desktop://native';
const BROWSER_ORIGIN = 'http://localhost:5175';
const OTHER_ORIGIN = 'http://localhost:9999';
const AGENT_SERVER_TOKEN_HEADER = 'x-moltnet-agent-server-token';
const DAEMON_ROOT = resolve(import.meta.dirname, '../../agent-daemon');
const PROVIDER_ID = 'e2e-local';
const CLI_PROVIDER_ID = 'ollama-e2e-cli';
const MODEL_ID = 'e2e-fake';
const RAW_API_KEY = 'e2e-secret-key-never-in-config';
const CLI_RAW_API_KEY = 'e2e-cli-secret-key-never-in-config';
const STDERR_TAIL_BYTES = 16 * 1024;
let supervisorToken = randomUUID();

function appendStderrTail(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString()}`.slice(-STDERR_TAIL_BYTES);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  {
    timeoutMs,
    intervalMs = 250,
    diagnostics,
  }: {
    timeoutMs: number;
    intervalMs?: number;
    diagnostics?: () => string;
  },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => {
      setTimeout(r, intervalMs);
    });
  }
  throw new Error(
    `condition not met within ${timeoutMs}ms${diagnostics ? `: ${diagnostics()}` : ''}`,
  );
}

function startJsonStub(
  routes: Record<string, unknown>,
  onRequest?: (request: IncomingMessage) => void,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolveStub) => {
    const server = createServer((request, response) => {
      onRequest?.(request);
      const path = new URL(request.url ?? '/', 'http://stub').pathname;
      const payload = routes[path];
      if (payload === undefined) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolveStub({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

/**
 * Spawn `moltnet-agent` from source. Uses node + tsx's loader flags directly
 * (what the `tsx` CLI does internally) so server signals reach the direct
 * child and runs can re-exec the same absolute loader paths from their own
 * working directory.
 */
function spawnAgentCommand(
  args: string[],
  stdin: 'ignore' | 'pipe' = 'ignore',
): ChildProcess {
  // MOLTNET_AGENT_BUNDLE=<payload dir> runs the suite against a built,
  // signed bundle (tools/release/agent-bundle) instead of the source tree:
  // the launcher, the bundled Node runtime, the production dependency
  // tree and the child re-exec path all get exercised. cwd is /tmp so
  // nothing can resolve from the repository by accident.
  const bundle = process.env.MOLTNET_AGENT_BUNDLE;
  // Exercise invalid browser credentials with OAuth configured. An absent
  // configuration intentionally returns 503 rather than asking users to sign in.
  const env = {
    ...process.env,
    MOLTNET_AGENT_SERVER_NATIVE_TOKEN: supervisorToken,
    MOLTNET_OPERATOR_OAUTH_ISSUER: 'http://hydra:4444',
    MOLTNET_OPERATOR_OAUTH_PUBLIC_URL:
      process.env.ORY_HYDRA_PUBLIC_URL ?? 'http://localhost:4444',
    MOLTNET_NATIVE_OAUTH_CLIENT_ID: 'moltnet-native-e2e',
    MOLTNET_CONSOLE_OAUTH_CLIENT_ID: 'moltnet-console-e2e',
    MOLTNET_OPERATOR_API_URL:
      process.env.REST_API_URL ?? 'http://localhost:8080',
  };
  if (bundle) {
    return spawn(join(bundle, 'bin/moltnet-agent'), args, {
      cwd: '/tmp',
      env,
      stdio: [stdin, 'pipe', 'pipe'],
    });
  }
  const tsxDist = join(DAEMON_ROOT, 'node_modules/tsx/dist');
  return spawn(
    process.execPath,
    [
      '--require',
      join(tsxDist, 'preflight.cjs'),
      '--import',
      pathToFileURL(join(tsxDist, 'loader.mjs')).href,
      'src/main.ts',
      ...args,
    ],
    {
      cwd: DAEMON_ROOT,
      env,
      stdio: [stdin, 'pipe', 'pipe'],
    },
  );
}

function spawnAgentServer(args: string[]): ChildProcess {
  return spawnAgentCommand(['server', ...args]);
}

async function runAgentCommand(
  args: string[],
  input?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawnAgentCommand(
    args,
    input === undefined ? 'ignore' : 'pipe',
  );
  const exit = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', resolveExit);
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  if (input !== undefined) child.stdin?.end(input);
  const code = await exit;
  return { code, stdout, stderr };
}

/** Owns the supervisor process, its bounded diagnostics, and shutdown. */
class AgentServerSupervisor {
  readonly exit: Promise<number | null>;
  private stderr = '';

  private constructor(
    readonly process: ChildProcess,
    readonly baseUrl: string,
  ) {
    process.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = appendStderrTail(this.stderr, chunk);
    });
    this.exit = new Promise((resolveExit) => {
      process.once('exit', (code) => resolveExit(code));
    });
  }

  static async start(options: {
    root: string;
    apiUrl: string;
    allowedOrigins: readonly string[];
  }): Promise<AgentServerSupervisor> {
    supervisorToken = randomUUID();
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const supervisor = new AgentServerSupervisor(
      spawnAgentServer([
        '--port',
        String(port),
        '--root',
        options.root,
        '--allowed-origins',
        options.allowedOrigins.join(','),
        '--api-url',
        options.apiUrl,
      ]),
      baseUrl,
    );
    await waitFor(
      async () => {
        try {
          return (await fetch(`${baseUrl}/health`)).ok;
        } catch {
          return false;
        }
      },
      { timeoutMs: 60_000 },
    ).catch((error: unknown) => {
      throw new Error(
        `agent server did not become healthy: ${String(error)}\n--- agent server stderr ---\n${supervisor.stderr}`,
      );
    });
    return supervisor;
  }

  async stop(): Promise<void> {
    if (this.process.exitCode !== null) return;
    this.process.kill('SIGTERM');
    await Promise.race([
      this.exit,
      new Promise<void>((resolveTimeout) => {
        setTimeout(resolveTimeout, 15_000);
      }),
    ]);
    if (this.process.exitCode === null) {
      this.process.kill('SIGKILL');
      await this.exit;
    }
  }
}

/** Text config/log files under root; VM disk images are binary artifacts. */
async function configFilesContaining(
  root: string,
  needle: string,
): Promise<string[]> {
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'secrets') continue;
        await walk(path);
      } else if (
        entry.isFile() &&
        /\.(json|jsonl|log|toml)$/.test(entry.name)
      ) {
        const content = await readFile(path, 'utf8').catch((error: unknown) => {
          throw new Error(`could not inspect non-secret config file ${path}`, {
            cause: error,
          });
        });
        if (content.includes(needle)) hits.push(path);
      }
    }
  }
  await walk(root);
  return hits;
}

describe.sequential('moltnet-agent server (loopback supervisor)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let personalTeamId: string;
  let privateDiaryId: string;
  let teamId: string;
  let agentServerRoot: string;
  let supervisor: AgentServerSupervisor;
  let base: string;
  let token: string;
  let modelStub: { server: Server; url: string };
  let modelStubAuthorization: string | undefined;
  let tagsStub: { server: Server; url: string };
  const agentName = `agent-server-e2e-${Date.now().toString(36)}`;
  const profileName = `agent-server-e2e-profile-${Date.now().toString(36)}`;
  let managedSubjectId: string;
  let runId: string;

  function agentServerClient(origin = NATIVE_ORIGIN, paired = true) {
    return createClient({
      baseUrl: base,
      credentials: 'omit',
      headers: {
        origin,
        ...(paired ? { [AGENT_SERVER_TOKEN_HEADER]: token } : {}),
      },
    });
  }

  /** Read the SSE log tail for up to `timeoutMs`, resolving early on `until`. */
  async function readRunLogs(
    id: string,
    until: (chunk: string) => boolean,
    timeoutMs: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let text = '';
    try {
      const response = await fetch(`${base}/v1/runs/${id}/logs`, {
        headers: { origin: NATIVE_ORIGIN, [AGENT_SERVER_TOKEN_HEADER]: token },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) return text;
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (until(text)) {
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) throw error;
    } finally {
      clearTimeout(timer);
    }
    return text;
  }

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('agent-server-e2e-owner');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    personalTeamId = creds.personalTeamId;
    const team = await agent.teams.create({
      name: `agent-server-e2e-team-${Date.now().toString(36)}`,
    });
    teamId = team.id;
    const diary = await agent.diaries.create(
      { name: `agent-server-e2e-diary-${Date.now().toString(36)}` },
      { teamId },
    );
    privateDiaryId = diary.id;

    modelStub = await startJsonStub(
      {
        '/v1/models': { data: [{ id: MODEL_ID }, { id: 'e2e-other' }] },
      },
      (request) => {
        if (request.url === '/v1/models') {
          modelStubAuthorization = request.headers.authorization;
        }
      },
    );
    tagsStub = await startJsonStub({
      '/api/tags': { models: [{ name: 'tags-only-model' }] },
      // Ollama Cloud omits capabilities from /api/tags, so the daemon falls
      // back to a per-model /api/show probe. Serving it here exercises
      // modality detection through the real HTTP surface.
      '/api/show': { capabilities: ['completion', 'vision'] },
    });

    agentServerRoot = await mkdtemp(
      join(tmpdir(), 'moltnet-agent-server-e2e-'),
    );
    supervisor = await AgentServerSupervisor.start({
      root: agentServerRoot,
      apiUrl: harness.restApiUrl,
      allowedOrigins: [BROWSER_ORIGIN],
    });
    base = supervisor.baseUrl;
  });

  afterAll(async () => {
    await supervisor?.stop();
    await Promise.all(
      [modelStub, tagsStub].map(
        (stub) =>
          new Promise<void>((resolveClose, rejectClose) => {
            stub.server.close((error) =>
              error ? rejectClose(error) : resolveClose(),
            );
          }),
      ),
    );
    if (agentServerRoot)
      await rm(agentServerRoot, { recursive: true, force: true });
    await harness?.teardown();
  });

  it('answers health without authorization and gates the JSON API', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);

    const unpaired = await getAgentServerStatus({
      client: agentServerClient(NATIVE_ORIGIN, false),
    });
    expect(unpaired.response.status).toBe(401);
    expect(unpaired.error?.code).toBe('authorization_required');

    const foreign = await getAgentServerStatus({
      client: agentServerClient(OTHER_ORIGIN, false),
    });
    expect(foreign.response.status).toBe(403);
  });

  function authorizeNative() {
    token = supervisorToken;
  }

  it('authorizes native control and rejects its token from a browser origin', async () => {
    authorizeNative();
    const status = await getAgentServerStatus({
      client: agentServerClient(),
    });
    expect(status.response.status).toBe(200);
    expect(status.data).toMatchObject({
      agents: [],
      identities: [],
      providers: {},
      runs: [],
    });
    expect(Array.isArray(status.data?.subscriptions)).toBe(true);

    // A token presented from another origin is not honoured.
    const crossOrigin = await getAgentServerStatus({
      client: agentServerClient(BROWSER_ORIGIN),
    });
    expect(crossOrigin.response.status).toBe(401);
  });

  it('discovers models from OpenAI-compatible and Ollama endpoints, failing closed otherwise', async () => {
    const openaiProvider = 'e2e-discovery-openai';
    const savedOpenai = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: openaiProvider },
      body: {
        api: 'openai-completions',
        baseUrl: `${modelStub.url}/v1`,
        envName: 'MOLTNET_PROVIDER_E2E_DISCOVERY_OPENAI_API_KEY',
        models: [],
        apiKey: 'unused',
      },
    });
    expect(savedOpenai.response.status).toBe(200);
    const openai = await discoverAgentServerProviderModels({
      client: agentServerClient(),
      path: { providerId: openaiProvider },
    });
    expect(openai.response.status).toBe(200);
    expect(openai.data).toEqual({
      models: [{ id: MODEL_ID }, { id: 'e2e-other' }],
    });

    const ollamaProvider = 'ollama-e2e-discovery';
    const savedOllama = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: ollamaProvider },
      body: {
        api: 'openai-completions',
        baseUrl: `${tagsStub.url}/v1`,
        envName: 'MOLTNET_PROVIDER_OLLAMA_E2E_DISCOVERY_API_KEY',
        models: [],
      },
    });
    expect(savedOllama.response.status).toBe(200);
    const ollama = await discoverAgentServerProviderModels({
      client: agentServerClient(),
      path: { providerId: ollamaProvider },
    });
    expect(ollama.response.status).toBe(200);
    expect(ollama.data).toEqual({
      models: [{ id: 'tags-only-model', input: ['text', 'image'] }],
    });

    const deadProvider = 'e2e-discovery-dead';
    const savedDead = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: deadProvider },
      body: {
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${await freePort()}/v1`,
        envName: 'MOLTNET_PROVIDER_E2E_DISCOVERY_DEAD_API_KEY',
        models: [],
      },
    });
    expect(savedDead.response.status).toBe(200);
    const dead = await discoverAgentServerProviderModels({
      client: agentServerClient(),
      path: { providerId: deadProvider },
    });
    expect(dead.response.status).toBe(502);
    expect(dead.error?.code).toBe('discovery_unavailable');

    const bogus = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: 'e2e-discovery-bogus' },
      body: {
        api: 'openai-completions',
        baseUrl: 'ftp://nope',
        envName: 'MOLTNET_PROVIDER_E2E_DISCOVERY_BOGUS_API_KEY',
        models: [],
      },
    });
    expect(bogus.response.status).toBe(400);

    const metadataAddress = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: 'e2e-discovery-metadata' },
      body: {
        api: 'openai-completions',
        baseUrl: 'http://169.254.169.254/latest/meta-data',
        envName: 'MOLTNET_PROVIDER_E2E_DISCOVERY_METADATA_API_KEY',
        models: [],
      },
    });
    expect(metadataAddress.response.status).toBe(400);
    expect(metadataAddress.error?.code).toBe('invalid_provider');

    let redirectedRequestReachedTarget = false;
    const redirectTarget = await startJsonStub(
      {
        '/v1/models': { data: [{ id: 'must-not-be-returned' }] },
      },
      () => {
        redirectedRequestReachedTarget = true;
      },
    );
    const redirector = await new Promise<{ server: Server; url: string }>(
      (resolveRedirector) => {
        const server = createServer((_request, response) => {
          response.writeHead(302, {
            location: `${redirectTarget.url}/v1/models`,
          });
          response.end();
        });
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          const port =
            typeof address === 'object' && address ? address.port : 0;
          resolveRedirector({ server, url: `http://127.0.0.1:${port}` });
        });
      },
    );
    try {
      const redirected = await putAgentServerProvider({
        client: agentServerClient(),
        path: { providerId: 'e2e-discovery-redirect' },
        body: {
          api: 'openai-completions',
          baseUrl: `${redirector.url}/v1`,
          envName: 'MOLTNET_PROVIDER_E2E_DISCOVERY_REDIRECT_API_KEY',
          models: [],
          apiKey: 'redirect-secret',
        },
      });
      expect(redirected.response.status).toBe(200);
      const redirectedDiscovery = await discoverAgentServerProviderModels({
        client: agentServerClient(),
        path: { providerId: 'e2e-discovery-redirect' },
      });
      expect(redirectedDiscovery.response.status).toBe(502);
      expect(redirectedDiscovery.error?.code).toBe('discovery_unavailable');
      expect(redirectedRequestReachedTarget).toBe(false);
    } finally {
      await Promise.all(
        [redirector.server, redirectTarget.server].map(
          (server) =>
            new Promise<void>((resolveClose, rejectClose) => {
              server.close((error) =>
                error ? rejectClose(error) : resolveClose(),
              );
            }),
        ),
      );
    }
  });

  it('stores a provider with a write-only API key that never reaches config files or responses', async () => {
    const saved = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: PROVIDER_ID },
      body: {
        api: 'openai-completions',
        baseUrl: `${modelStub.url}/v1`,
        envName: 'MOLTNET_PROVIDER_E2E_LOCAL_API_KEY',
        models: [{ id: MODEL_ID }],
        apiKey: RAW_API_KEY,
      },
    });
    expect(saved.response.status).toBe(200);
    expect(saved.data).toMatchObject({
      api: 'openai-completions',
      envName: 'MOLTNET_PROVIDER_E2E_LOCAL_API_KEY',
      models: [{ id: MODEL_ID }],
      hasApiKey: true,
    });
    expect(JSON.stringify(saved.data)).not.toContain(RAW_API_KEY);

    // Updating without a key keeps the stored one.
    const updated = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: PROVIDER_ID },
      body: {
        api: 'openai-completions',
        baseUrl: `${modelStub.url}/v1`,
        envName: 'MOLTNET_PROVIDER_E2E_LOCAL_API_KEY',
        models: [{ id: MODEL_ID }, { id: 'e2e-other' }],
      },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.data).toMatchObject({ hasApiKey: true });
    expect(JSON.stringify(updated.data)).not.toContain(RAW_API_KEY);

    const discoveredAfterKeylessUpdate =
      await discoverAgentServerProviderModels({
        client: agentServerClient(),
        path: { providerId: PROVIDER_ID },
      });
    expect(discoveredAfterKeylessUpdate.response.status).toBe(200);
    expect(modelStubAuthorization).toBe(`Bearer ${RAW_API_KEY}`);

    const listed = await listAgentServerProviders({
      client: agentServerClient(),
    });
    expect(listed.response.status).toBe(200);
    expect(JSON.stringify(listed.data)).not.toContain(RAW_API_KEY);

    expect(await configFilesContaining(agentServerRoot, RAW_API_KEY)).toEqual(
      [],
    );
  });

  it('shares provider state between the real CLI process and Agent Server', async () => {
    const set = await runAgentCommand(
      [
        'providers',
        'set',
        CLI_PROVIDER_ID,
        '--root',
        agentServerRoot,
        '--base-url',
        `${tagsStub.url}/v1`,
        '--model',
        'cli-initial',
        '--api-key-stdin',
      ],
      `${CLI_RAW_API_KEY}\n`,
    );
    expect(set.code, set.stderr).toBe(0);
    expect(JSON.parse(set.stdout)).toMatchObject({
      id: CLI_PROVIDER_ID,
      hasApiKey: true,
      models: [{ id: 'cli-initial' }],
    });
    expect(`${set.stdout}${set.stderr}`).not.toContain(CLI_RAW_API_KEY);

    const listedAfterCliSet = await listAgentServerProviders({
      client: agentServerClient(),
    });
    expect(listedAfterCliSet.response.status).toBe(200);
    expect(listedAfterCliSet.data?.[CLI_PROVIDER_ID]).toMatchObject({
      baseUrl: `${tagsStub.url}/v1`,
      hasApiKey: true,
      models: [{ id: 'cli-initial' }],
    });

    const discovered = await runAgentCommand([
      'providers',
      'discover',
      CLI_PROVIDER_ID,
      '--root',
      agentServerRoot,
      '--save',
      '--json',
    ]);
    expect(discovered.code, discovered.stderr).toBe(0);
    expect(JSON.parse(discovered.stdout)).toEqual({
      models: [{ id: 'tags-only-model', input: ['text', 'image'] }],
    });

    const listedAfterDiscovery = await listAgentServerProviders({
      client: agentServerClient(),
    });
    // `discover --save` persists the detected capability, so the operator
    // never has to declare it by hand.
    expect(listedAfterDiscovery.data?.[CLI_PROVIDER_ID]?.models).toEqual([
      { id: 'tags-only-model', input: ['text', 'image'] },
    ]);

    const updatedOverHttp = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: CLI_PROVIDER_ID },
      body: {
        api: 'openai-completions',
        baseUrl: `${tagsStub.url}/v1`,
        envName: 'MOLTNET_PROVIDER_OLLAMA_E2E_CLI_API_KEY',
        models: [{ id: 'http-updated' }],
      },
    });
    expect(updatedOverHttp.response.status).toBe(200);
    expect(updatedOverHttp.data?.hasApiKey).toBe(true);

    const cliList = await runAgentCommand([
      'providers',
      'list',
      '--root',
      agentServerRoot,
      '--json',
    ]);
    expect(cliList.code, cliList.stderr).toBe(0);
    const cliListPayload = JSON.parse(cliList.stdout) as {
      configuredProviders: Record<
        string,
        { hasApiKey: boolean; models: { id: string }[] }
      >;
    };
    expect(cliListPayload.configuredProviders[CLI_PROVIDER_ID]).toMatchObject({
      hasApiKey: true,
      models: [{ id: 'http-updated' }],
    });
    expect(`${cliList.stdout}${cliList.stderr}`).not.toContain(CLI_RAW_API_KEY);

    const removed = await runAgentCommand([
      'providers',
      'remove',
      CLI_PROVIDER_ID,
      '--root',
      agentServerRoot,
      '--yes',
    ]);
    expect(removed.code, removed.stderr).toBe(0);

    const listedAfterRemove = await listAgentServerProviders({
      client: agentServerClient(),
    });
    expect(listedAfterRemove.response.status).toBe(200);
    expect(listedAfterRemove.data).not.toHaveProperty(CLI_PROVIDER_ID);
    expect(
      await configFilesContaining(agentServerRoot, CLI_RAW_API_KEY),
    ).toEqual([]);
  });

  it('refuses a managed agent without an invitation code', async () => {
    const result = await createAgentServerAgent({
      client: agentServerClient(),
      // Intentional negative request: verify server-side schema enforcement.
      body: {
        kind: 'managed',
        name: 'stranded',
      } as unknown as CreateAgentServerAgentData['body'],
    });
    expect(result.response.status).toBe(400);
  });

  it('creates a managed agent from a team invitation code and captures the team binding', async () => {
    const invite = await agent.teams.invites.create(teamId, {
      role: 'member',

      expiresInHours: 1,
    });

    const created = await createAgentServerAgent({
      client: agentServerClient(),
      body: {
        kind: 'managed',
        name: agentName,
        enrollmentToken: invite.code,
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.data).toMatchObject({
      kind: 'managed',
      agentName,
      teamId,
      hasAgentKey: true,
      hasPrivateKey: true,
    });
    const view = created.data!;
    expect(view.subjectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(view.fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    // Presence booleans only — never key material or reference strings.
    expect(Object.keys(created.data!)).not.toEqual(
      expect.arrayContaining([
        'agentKeyRef',
        'privateKeyRef',
        'agentKey',
        'privateKey',
      ]),
    );
    // The team-member path parameter is a Keto subject, so pin the durable
    // agents.id rather than the Ory identity.
    managedSubjectId = view.subjectId!;

    const listed = await listAgentServerAgents({
      client: agentServerClient(),
    });
    expect(listed.response.status).toBe(200);
    expect(listed.data).toEqual([expect.objectContaining({ agentName })]);

    const status = await getAgentServerStatus({
      client: agentServerClient(),
    });
    expect(status.response.status).toBe(200);
    expect(status.data?.identities).toContainEqual({
      alias: agentName,
      activated: true,
      hasAgentKey: true,
    });

    // Single-use: the same code cannot enrol a second agent.
    const replay = await createAgentServerAgent({
      client: agentServerClient(),
      body: {
        kind: 'managed',
        name: `${agentName}-replay`,
        enrollmentToken: invite.code,
      },
    });
    expect(replay.response.status).toBe(400);
    expect(replay.error?.code).toBe('registration_failed');
  });

  it('refuses to start a run without an exact team slot', async () => {
    const result = await startAgentServerRun({
      client: agentServerClient(),
      body: {
        agent: agentName,
        teamId: personalTeamId,
        profiles: [profileName],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(result.response.status).toBe(400);
    expect(result.error?.code).toBe('agent_key_missing');
    expect(result.error?.message).toBe(
      'No credential is indexed for this team.',
    );
  });

  it('starts a daemon run that polls the API, streams its logs, and stops on request', async () => {
    // Arrange: the agent must be an executor to claim tasks; profile pins
    // the provider/model pair configured above.
    await agent.teams.updateMemberRole(teamId, managedSubjectId, 'executor');
    await agent.runtimeProfiles.create(
      {
        name: profileName,
        runtimeKind: 'gondolin_pi',
        provider: PROVIDER_ID,
        model: MODEL_ID,
        sandbox: {},
      },
      { teamId },
    );

    // Act
    const started = await startAgentServerRun({
      client: agentServerClient(),
      body: {
        agent: agentName,
        teamId,
        profiles: [profileName],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(started.response.status).toBe(201);
    const record = started.data!;
    expect(record.status).toBe('running');
    runId = record.id;

    // Assert: the child daemon really came up and is polling as the agent.
    // `agent-daemon.starting` is the info-level proof the child resolved
    // the profile/model pair and connected as the agent; keep reading a
    // little longer to catch an immediate crash (fatal / error level).
    const logs = await readRunLogs(
      runId,
      (text) =>
        text.includes('[fatal]') ||
        text.includes('"level":50') ||
        (text.includes('agent-daemon.starting') &&
          text.includes(`"boundTeamId":"${teamId}"`)),
      60_000,
    );
    expect(logs).toContain('agent-daemon.starting');
    expect(logs).toContain(`"boundTeamId":"${teamId}"`);
    expect(logs).not.toContain('[fatal]');
    expect(logs).not.toContain('"level":50');

    // Startup logs alone do not prove the daemon owns the polling loop.
    // A real queued task must transition out of the queue under this run.
    const task = await agent.tasks.create(
      {
        taskType: 'freeform',
        title: 'agent server polling e2e',
        diaryId: privateDiaryId,
        input: { brief: 'Prove the agent-server-launched daemon claims work.' },
      },
      { teamId },
    );
    await waitFor(
      async () => {
        const current = await agent.tasks.get(task.id);
        return current.status === 'dispatched' || current.status === 'running';
      },
      { timeoutMs: 60_000 },
    );

    const listed = await listAgentServerRuns({ client: agentServerClient() });
    expect(listed.data).toEqual([
      expect.objectContaining({ id: runId, status: 'running', active: true }),
    ]);

    const stopped = await stopAgentServerRun({
      client: agentServerClient(),
      path: { runId },
    });
    expect(stopped.response.status).toBe(200);
    await waitFor(
      async () => {
        const runs =
          (
            await listAgentServerRuns({
              client: agentServerClient(),
            })
          ).data ?? [];
        return runs.some(
          (run) =>
            run.id === runId &&
            run.active === false &&
            run.status === 'stopped',
        );
      },
      { timeoutMs: 20_000 },
    );

    const unknown = await stopAgentServerRun({
      client: agentServerClient(),
      path: { runId: 'does-not-exist' },
    });
    expect(unknown.response.status).toBe(404);
  }, 120_000);

  async function enrollSecondTeam() {
    const configDir = join(agentServerRoot, 'identities', agentName);
    const provider = new FileSecretProvider({
      root: join(agentServerRoot, 'secrets'),
      writable: true,
    });
    const registry = new SecretProviderRegistry().register(provider);
    const initial = await readConfig(configDir);
    expect(initial).not.toBeNull();
    const secretA = await resolveAgentKey(initial!, registry, teamId);
    expect(secretA).toBeTruthy();
    const agentA = await connect({
      agentKey: secretA!,
      apiUrl: harness.restApiUrl,
    });
    const teamB = await agent.teams.create({
      name: `concurrent-${randomUUID()}`,
    });
    const invitation = await agent.teams.invites.create(teamB.id, {
      role: 'executor',
      expiresInHours: 1,
    });
    const enrolled = await enrollTeam({
      agent: agentA,
      code: invitation.code,
      idempotencyKey: randomUUID(),
      configDir,
      secretProvider: provider,
    });
    expect(enrolled.teamId).toBe(teamB.id);
    const current = await readConfig(configDir);
    const secretB = await resolveAgentKey(current!, registry, teamB.id);
    expect(secretB).toBeTruthy();
    expect(secretB).not.toBe(secretA);
    const agentB = await connect({
      agentKey: secretB!,
      apiUrl: harness.restApiUrl,
    });
    await expect(
      agentB.diaries.get(privateDiaryId, { teamId }),
    ).rejects.toThrow();
    const diaryB = await agent.diaries.create(
      { name: `concurrent-${randomUUID()}` },
      { teamId: teamB.id },
    );
    await expect(
      agentA.diaries.get(diaryB.id, { teamId: teamB.id }),
    ).rejects.toThrow();
    const profileB = await agent.runtimeProfiles.create(
      {
        name: `concurrent-${randomUUID()}`,
        runtimeKind: 'gondolin_pi',
        provider: PROVIDER_ID,
        model: MODEL_ID,
        sandbox: {},
      },
      { teamId: teamB.id },
    );
    return {
      secretA: secretA!,
      secretB: secretB!,
      agentA,
      agentB,
      teamB,
      diaryB,
      profileB,
    };
  }

  function teamRunLifecycle(secrets: readonly string[]) {
    const start = (id: string, profile: string) =>
      startAgentServerRun({
        client: agentServerClient(),
        body: {
          agent: agentName,
          teamId: id,
          profiles: [profile],
          taskTypes: ['freeform'],
          mode: 'poll',
        },
      });
    const assertStarted = async (runId: string, expectedTeam: string) => {
      const log = await readRunLogs(
        runId,
        (text) =>
          text.includes('agent-daemon.starting') || text.includes('[fatal]'),
        180_000,
      );
      const status = (
        await listAgentServerRuns({ client: agentServerClient() })
      ).data?.find((run) => run.id === runId);
      // Diagnostics are an allowlisted projection, never raw config, task input or logs.
      const context = JSON.stringify({
        stage: 'startup',
        teamId: expectedTeam,
        runId,
        status: status?.status,
        active: status?.active,
        exitCode: status?.exitCode,
        startupSeen: log.includes('agent-daemon.starting'),
        fatalSeen: log.includes('[fatal]'),
      });
      expect(log.includes('agent-daemon.starting'), context).toBe(true);
      expect(log.includes(`"boundTeamId":"${expectedTeam}"`), context).toBe(
        true,
      );
      expect(
        secrets.some((secret) => log.includes(secret)),
        context,
      ).toBe(false);
      expect(log.includes('[fatal]'), context).toBe(false);
    };
    const startBoth = async (otherTeam: string, otherProfile: string) => {
      const responses = await Promise.all([
        start(teamId, profileName),
        start(otherTeam, otherProfile),
      ]);
      for (const response of responses)
        expect(response.response.status, JSON.stringify(response.error)).toBe(
          201,
        );
      const runs = responses.map((response, index) => ({
        runId: response.data!.id,
        teamId: index === 0 ? teamId : otherTeam,
      }));
      await Promise.all(
        runs.map((run) => assertStarted(run.runId, run.teamId)),
      );
      return runs;
    };
    const waitForClaims = async (
      tasks: { id: string }[],
      runs: { runId: string; teamId: string }[],
      stage: string,
    ) => {
      let diagnostic = JSON.stringify({
        stage,
        tasks: tasks.map(({ id }) => id),
        runs,
      });
      await waitFor(
        async () => {
          const current = await Promise.all(
            tasks.map(({ id }) => agent.tasks.get(id)),
          );
          const running = await listAgentServerRuns({
            client: agentServerClient(),
          });
          diagnostic = JSON.stringify({
            stage,
            tasks: current.map(({ id, teamId: taskTeam, status }) => ({
              id,
              teamId: taskTeam,
              status,
            })),
            runs: runs.map(({ runId, teamId: runTeam }) => {
              const run = running.data?.find(({ id }) => id === runId);
              return {
                runId,
                teamId: runTeam,
                status: run?.status,
                active: run?.active,
                exitCode: run?.exitCode,
              };
            }),
          });
          return current.every((task) => task.status !== 'queued');
        },
        { timeoutMs: 60_000, intervalMs: 1000, diagnostics: () => diagnostic },
      );
    };
    const waitForRevocation = async (
      run: { runId: string; teamId: string },
      since: number,
    ) => {
      const hasAuthorizationFailure = (text: string) =>
        text.split('\n').some((line) => {
          if (!line.startsWith('data: ')) return false;
          try {
            const event = JSON.parse(line.slice(6)) as {
              time?: number;
              teamId?: string;
              msg?: string;
              err?: { statusCode?: number };
            };
            return (
              typeof event.time === 'number' &&
              event.time >= since &&
              event.teamId === run.teamId &&
              event.msg === 'polling-api.list_failed' &&
              (event.err?.statusCode === 401 || event.err?.statusCode === 403)
            );
          } catch {
            return false;
          }
        });
      const log = await readRunLogs(run.runId, hasAuthorizationFailure, 60_000);
      const context = JSON.stringify({ stage: 'revoked poll', ...run });
      expect(hasAuthorizationFailure(log), context).toBe(true);
      expect(
        secrets.some((secret) => log.includes(secret)),
        context,
      ).toBe(false);
    };
    return { start, startBoth, waitForClaims, waitForRevocation };
  }

  async function restartTeamSupervisor() {
    await supervisor.stop();
    supervisor = await AgentServerSupervisor.start({
      root: agentServerRoot,
      apiUrl: harness.restApiUrl,
      allowedOrigins: [BROWSER_ORIGIN],
    });
    base = supervisor.baseUrl;
    // Native tokens are process-local; persisted agent credentials are not.
    const stale = await getAgentServerStatus({ client: agentServerClient() });
    expect(stale.response.status).toBe(401);
    authorizeNative();
  }

  it('enrolls a second team, runs both concurrently, reconnects after restart and isolates revocation', async () => {
    const { secretA, secretB, agentA, agentB, teamB, diaryB, profileB } =
      await enrollSecondTeam();
    const catalogue = await getAgentServerCatalogue({
      client: agentServerClient(),
      query: { identity: agentName },
    });
    expect(catalogue.response.status).toBe(200);
    expect(catalogue.data?.teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ teamId, available: true }),
        expect.objectContaining({ teamId: teamB.id, available: true }),
      ]),
    );
    expect(JSON.stringify(catalogue.data)).not.toContain(secretA);
    expect(JSON.stringify(catalogue.data)).not.toContain(secretB);
    const lifecycle = teamRunLifecycle([secretA, secretB]);
    const runs = await lifecycle.startBoth(teamB.id, profileB.id);
    const tasks = await Promise.all(
      [
        [teamId, privateDiaryId],
        [teamB.id, diaryB.id],
      ].map(([id, diaryId]) =>
        agent.tasks.create(
          {
            taskType: 'freeform',
            title: 'concurrent team polling',
            diaryId,
            input: { brief: 'Verify independently authenticated task claim.' },
          },
          { teamId: id },
        ),
      ),
    );
    await lifecycle.waitForClaims(tasks, runs, 'concurrent claims');
    const running = await listAgentServerRuns({ client: agentServerClient() });
    for (const { runId } of runs)
      expect(running.data).toContainEqual(
        expect.objectContaining({ id: runId, active: true }),
      );

    await restartTeamSupervisor();
    const restarted = await lifecycle.startBoth(teamB.id, profileB.id);
    const aKeys = await agent.agentKeys.list(
      { agentId: managedSubjectId, status: 'active' },
      { teamId },
    );
    expect(aKeys.items).toHaveLength(1);
    await agent.agentKeys.revoke(
      aKeys.items[0].id,
      { reason: 'superseded' },
      { teamId },
    );
    await expect(agentA.agents.whoami()).rejects.toThrow();
    await expect(agentB.agents.whoami()).resolves.toMatchObject({
      subjectId: managedSubjectId,
    });
    const rejected = await lifecycle.start(teamId, profileName);
    expect(rejected.response.status).toBe(400);
    expect(rejected.error).toEqual({
      code: 'verification_failed',
      message: `Cannot start agent "${agentName}" for team "${teamId}": credential verification failed. Check the selected team key and activation.`,
    });
    expect(
      [secretA, secretB].some((secret) =>
        JSON.stringify(rejected.error).includes(secret),
      ),
    ).toBe(false);
    const afterRevocation = await getAgentServerCatalogue({
      client: agentServerClient(),
      query: { identity: agentName },
    });
    expect(afterRevocation.response.status).toBe(200);
    expect(afterRevocation.data?.teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId,
          available: false,
        }),
        expect.objectContaining({ teamId: teamB.id, available: true }),
      ]),
    );
    expect(
      afterRevocation.data?.profiles.every(
        (profile) => profile.teamId !== teamId,
      ),
    ).toBe(true);
    expect(
      afterRevocation.data?.teams.find((team) => team.teamId === teamId)
        ?.credential?.keyId,
    ).toBe(aKeys.items[0].id);
    expect(afterRevocation.data?.defaultTeamId).toBe(teamB.id);
    const deniedTask = await agent.tasks.create(
      {
        taskType: 'freeform',
        title: 'revoked team cannot claim',
        diaryId: privateDiaryId,
        input: { brief: 'This must remain queued after revocation.' },
      },
      { teamId },
    );
    // Require a denied poll after this task exists, not a historical failure.
    const deniedTaskCreatedAt = Date.now();
    const afterRevoke = await agent.tasks.create(
      {
        taskType: 'freeform',
        title: 'other team remains active',
        diaryId: diaryB.id,
        input: { brief: 'Verify B continues after A revocation.' },
      },
      { teamId: teamB.id },
    );
    await Promise.all([
      lifecycle.waitForClaims(
        [afterRevoke],
        restarted,
        'claim after other team revocation',
      ),
      lifecycle.waitForRevocation(restarted[0], deniedTaskCreatedAt),
    ]);
    expect((await agent.tasks.get(deniedTask.id)).status).toBe('queued');
    expect(await configFilesContaining(agentServerRoot, secretA)).toEqual([]);
    expect(await configFilesContaining(agentServerRoot, secretB)).toEqual([]);
    // Native renewal and predecessor preservation are exercised by the real
    // Console approval journey. This suite keeps offline run/revocation coverage.
    const activeB = await agent.agentKeys.list(
      { agentId: managedSubjectId, status: 'active' },
      { teamId: teamB.id },
    );
    const activeBKeyId = activeB.items[0].id;
    await Promise.all(
      restarted.map(({ runId }) =>
        stopAgentServerRun({
          client: agentServerClient(),
          path: { runId },
        }),
      ),
    );
    await restartTeamSupervisor();
    const restartedCatalogue = await getAgentServerCatalogue({
      client: agentServerClient(),
      query: { identity: agentName },
    });
    expect(
      restartedCatalogue.data?.teams.find((team) => team.teamId === teamB.id),
    ).toMatchObject({
      available: true,
      credential: { keyId: activeBKeyId },
    });
    expect(
      restartedCatalogue.data?.teams.find((team) => team.teamId === teamId),
    ).toMatchObject({
      available: false,
      credential: { keyId: aKeys.items[0].id },
    });
    const replacementRun = await lifecycle.start(teamB.id, profileB.id);
    expect(replacementRun.response.status).toBe(201);
    expect(replacementRun.data?.credential?.keyId).toBe(activeBKeyId);
    await stopAgentServerRun({
      client: agentServerClient(),
      path: { runId: replacementRun.data!.id },
    });
  }, 600_000);

  it('shuts down cleanly on SIGTERM', async () => {
    await supervisor.stop();
    const code = await supervisor.exit;
    expect(code).toBe(143);
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  }, 30_000);
});
