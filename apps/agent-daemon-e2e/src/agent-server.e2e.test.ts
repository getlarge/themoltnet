/**
 * `moltnet-agent server` E2E — black-box over the loopback HTTP contract.
 *
 * Spawns the real Agent Server as a child process against an
 * isolated `--root`, then drives it exactly the way the Console does:
 * pairing ceremony → paired JSON API → provider + managed-agent setup →
 * a real daemon run polling the e2e rest-api → stop → shutdown.
 *
 * Deliberately knows nothing about the persistence layer (file names,
 * secret-reference formats, config shapes): every assertion is on the
 * HTTP surface or on the one durable promise that secrets never land in
 * non-secret config files.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type Server,
} from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  claimAgentServerPairing,
  createAgentServerAgent,
  type CreateAgentServerAgentData,
  createClient,
  discoverAgentServerProviderModels,
  getAgentServerStatus,
  listAgentServerAgents,
  listAgentServerProviders,
  listAgentServerRuns,
  putAgentServerProvider,
  startAgentServerPairing,
  startAgentServerRun,
  stopAgentServerRun,
} from '@moltnet/agent-daemon-api-client';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const ALLOWED_ORIGIN = 'http://localhost:5174';
const PAIRING_ORIGIN = 'http://localhost:5175';
const OTHER_ORIGIN = 'http://localhost:9999';
const AGENT_SERVER_TOKEN_HEADER = 'x-moltnet-agent-server-token';
const DAEMON_ROOT = resolve(import.meta.dirname, '../../agent-daemon');
const PROVIDER_ID = 'e2e-local';
const MODEL_ID = 'e2e-fake';
const RAW_API_KEY = 'e2e-secret-key-never-in-config';
const STDERR_TAIL_BYTES = 16 * 1024;

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
  { timeoutMs, intervalMs = 250 }: { timeoutMs: number; intervalMs?: number },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => {
      setTimeout(r, intervalMs);
    });
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
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
 * Top-level navigation GET. Node's `fetch` (undici) drops `Sec-*` request
 * headers as forbidden, so the browser's Fetch-Metadata signal has to be
 * sent over a raw HTTP request.
 */
function navigateTo(url: string): Promise<{ status: number; text: string }> {
  return new Promise((resolveNav, reject) => {
    const req = httpRequest(
      url,
      {
        method: 'GET',
        headers: {
          'sec-fetch-site': 'none',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () =>
          resolveNav({ status: response.statusCode ?? 0, text }),
        );
      },
    );
    req.once('error', reject);
    req.end();
  });
}

/**
 * Spawn `moltnet-agent server` from source. Uses node + tsx's loader flags
 * directly (what the `tsx` CLI does internally) so the supervisor is our
 * direct child: signals reach it unwrapped, and runs it starts re-exec
 * the same absolute loader paths from their own working directory.
 */
function spawnAgentServer(args: string[]): ChildProcess {
  // MOLTNET_AGENT_BUNDLE=<payload dir> runs the suite against a built,
  // signed bundle (tools/release/agent-bundle) instead of the source tree:
  // the launcher, the bundled Node runtime, the production dependency
  // tree and the child re-exec path all get exercised. cwd is /tmp so
  // nothing can resolve from the repository by accident.
  const bundle = process.env.MOLTNET_AGENT_BUNDLE;
  if (bundle) {
    return spawn(join(bundle, 'bin/moltnet-agent'), ['server', ...args], {
      cwd: '/tmp',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
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
      'server',
      ...args,
    ],
    { cwd: DAEMON_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
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

/** Files under `root` (excluding the secrets directory) that contain `needle`. */
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
      } else if (entry.isFile()) {
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
  let managedIdentityId: string;
  let runId: string;

  function agentServerClient(origin = ALLOWED_ORIGIN, paired = true) {
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
        headers: { origin: ALLOWED_ORIGIN, [AGENT_SERVER_TOKEN_HEADER]: token },
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
    });

    agentServerRoot = await mkdtemp(
      join(tmpdir(), 'moltnet-agent-server-e2e-'),
    );
    supervisor = await AgentServerSupervisor.start({
      root: agentServerRoot,
      apiUrl: harness.restApiUrl,
      allowedOrigins: [ALLOWED_ORIGIN, PAIRING_ORIGIN],
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

  it('answers health without pairing and gates the JSON API behind pairing', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);

    const unpaired = await getAgentServerStatus({
      client: agentServerClient(ALLOWED_ORIGIN, false),
    });
    expect(unpaired.response.status).toBe(401);
    expect(unpaired.error?.code).toBe('pairing_required');

    const foreign = await getAgentServerStatus({
      client: agentServerClient(OTHER_ORIGIN, false),
    });
    expect(foreign.response.status).toBe(403);
  });

  it('completes the pairing ceremony and binds the token to the origin', async () => {
    // Arrange: the Console starts a pairing from its own origin.
    const started = await startAgentServerPairing({
      client: agentServerClient(ALLOWED_ORIGIN, false),
    });
    expect(started.response.status).toBe(201);
    const { pairingId, approvalPath } = started.data!;
    expect(approvalPath).toBe(`/pairings/${pairingId}`);

    // Act: the user opens the approval page (a top-level navigation)...
    const fetched = await fetch(`${base}${approvalPath}`);
    expect(fetched.status).toBe(400); // never as a plain fetch
    const approval = await navigateTo(`${base}${approvalPath}`);
    expect(approval.status).toBe(200);
    const html = approval.text;
    expect(html).toContain(ALLOWED_ORIGIN);
    const confirmToken = /name="confirmToken" value="([^"]+)"/.exec(html)?.[1];
    expect(confirmToken).toBeTruthy();

    // ...and submits the same-origin approval form.
    const confirmed = await fetch(`${base}/pairings/${pairingId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ confirmToken: confirmToken ?? '' }),
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.text()).toContain('Connection approved');

    // Assert: only the pairing origin can claim the token.
    const stolen = await claimAgentServerPairing({
      client: agentServerClient(PAIRING_ORIGIN, false),
      path: { pairingId },
    });
    expect(stolen.response.status).toBe(403);
    expect(stolen.error?.code).toBe('pairing_origin_mismatch');

    const claimed = await claimAgentServerPairing({
      client: agentServerClient(ALLOWED_ORIGIN, false),
      path: { pairingId },
    });
    expect(claimed.response.status).toBe(200);
    token = claimed.data!.token;
    expect(token.length).toBeGreaterThan(20);

    const status = await getAgentServerStatus({
      client: agentServerClient(),
    });
    expect(status.response.status).toBe(200);
    expect(status.data).toMatchObject({
      agents: [],
      providers: {},
      runs: [],
    });
    expect(Array.isArray(status.data?.subscriptions)).toBe(true);

    // A token presented from another origin is not honoured.
    const crossOrigin = await getAgentServerStatus({
      client: agentServerClient(PAIRING_ORIGIN),
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
    expect(openai.data).toEqual({ models: [MODEL_ID, 'e2e-other'] });

    const ollamaProvider = 'e2e-discovery-ollama';
    const savedOllama = await putAgentServerProvider({
      client: agentServerClient(),
      path: { providerId: ollamaProvider },
      body: {
        api: 'openai-completions',
        baseUrl: `${tagsStub.url}/v1`,
        envName: 'MOLTNET_PROVIDER_E2E_DISCOVERY_OLLAMA_API_KEY',
        models: [],
      },
    });
    expect(savedOllama.response.status).toBe(200);
    const ollama = await discoverAgentServerProviderModels({
      client: agentServerClient(),
      path: { providerId: ollamaProvider },
    });
    expect(ollama.response.status).toBe(200);
    expect(ollama.data).toEqual({ models: ['tags-only-model'] });

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
        models: [MODEL_ID],
        apiKey: RAW_API_KEY,
      },
    });
    expect(saved.response.status).toBe(200);
    expect(saved.data).toMatchObject({
      api: 'openai-completions',
      envName: 'MOLTNET_PROVIDER_E2E_LOCAL_API_KEY',
      models: [MODEL_ID],
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
        models: [MODEL_ID, 'e2e-other'],
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
      maxUses: 1,
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
    expect(view.identityId).toMatch(/^[0-9a-f-]{36}$/);
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
    managedIdentityId = view.identityId!;

    const listed = await listAgentServerAgents({
      client: agentServerClient(),
    });
    expect(listed.response.status).toBe(200);
    expect(listed.data).toEqual([expect.objectContaining({ agentName })]);

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

  it('refuses to start a run in a team the agent key is not bound to', async () => {
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
    expect(result.error?.code).toBe('invalid_spec');
    expect(result.error?.message).toContain('bound to team');
  });

  it('starts a daemon run that polls the API, streams its logs, and stops on request', async () => {
    // Arrange: the agent must be an executor to claim tasks; profile pins
    // the provider/model pair configured above.
    await agent.teams.updateMemberRole(teamId, managedIdentityId, 'executor');
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

  it('shuts down cleanly on SIGTERM', async () => {
    await supervisor.stop();
    const code = await supervisor.exit;
    expect(code).toBe(143);
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  }, 30_000);
});
