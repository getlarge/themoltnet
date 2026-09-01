/**
 * `moltnet-agent serve` E2E — black-box over the loopback HTTP contract.
 *
 * Spawns the real `serve` supervisor as a child process against an
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
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const ALLOWED_ORIGIN = 'http://localhost:5174';
const OTHER_ORIGIN = 'http://localhost:9999';
const SERVE_TOKEN_HEADER = 'x-moltnet-serve-token';
const DAEMON_ROOT = resolve(import.meta.dirname, '../../agent-daemon');
const PROVIDER_ID = 'e2e-local';
const MODEL_ID = 'e2e-fake';
const RAW_API_KEY = 'e2e-secret-key-never-in-config';

interface CallInit {
  method?: string;
  body?: unknown;
  token?: string;
  origin?: string | null;
  headers?: Record<string, string>;
}

interface CallResult {
  status: number;
  json: unknown;
  text: string;
}

interface ServeError {
  code?: string;
  message?: string;
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
): Promise<{ server: Server; url: string }> {
  return new Promise((resolveStub) => {
    const server = createServer((request, response) => {
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
 * Spawn `moltnet-agent serve` from source. Uses node + tsx's loader flags
 * directly (what the `tsx` CLI does internally) so the supervisor is our
 * direct child: signals reach it unwrapped, and runs it starts re-exec
 * the same absolute loader paths from their own working directory.
 */
function spawnServe(args: string[]): ChildProcess {
  // MOLTNET_AGENT_BUNDLE=<payload dir> runs the suite against a built,
  // signed bundle (tools/release/agent-bundle) instead of the source tree:
  // the launcher, the bundled Node runtime, the production dependency
  // tree and the child re-exec path all get exercised. cwd is /tmp so
  // nothing can resolve from the repository by accident.
  const bundle = process.env.MOLTNET_AGENT_BUNDLE;
  if (bundle) {
    return spawn(join(bundle, 'bin/moltnet-agent'), ['serve', ...args], {
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
      'serve',
      ...args,
    ],
    { cwd: DAEMON_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
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
        const content = await readFile(path, 'utf8').catch(() => '');
        if (content.includes(needle)) hits.push(path);
      }
    }
  }
  await walk(root);
  return hits;
}

describe('moltnet-agent serve (loopback supervisor)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let personalTeamId: string;
  let teamId: string;
  let serveRoot: string;
  let serve: ChildProcess;
  let serveExit: Promise<number | null>;
  let serveStderr = '';
  let base: string;
  let token: string;
  let modelStub: { server: Server; url: string };
  let tagsStub: { server: Server; url: string };
  const agentName = `serve-e2e-${Date.now().toString(36)}`;
  const profileName = `serve-e2e-profile-${Date.now().toString(36)}`;
  let managedIdentityId: string;
  let runId: string;

  async function call(path: string, init: CallInit = {}): Promise<CallResult> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.origin !== null) headers.origin = init.origin ?? ALLOWED_ORIGIN;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.token) headers[SERVE_TOKEN_HEADER] = init.token;
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
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
        headers: { origin: ALLOWED_ORIGIN, [SERVE_TOKEN_HEADER]: token },
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
    const creds = await harness.createAgent('serve-e2e-owner');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    personalTeamId = creds.personalTeamId;
    const team = await agent.teams.create({
      name: `serve-e2e-team-${Date.now().toString(36)}`,
    });
    teamId = team.id;

    modelStub = await startJsonStub({
      '/v1/models': { data: [{ id: MODEL_ID }, { id: 'e2e-other' }] },
    });
    tagsStub = await startJsonStub({
      '/api/tags': { models: [{ name: 'tags-only-model' }] },
    });

    serveRoot = await mkdtemp(join(tmpdir(), 'moltnet-serve-e2e-'));
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    serve = spawnServe([
      '--port',
      String(port),
      '--root',
      serveRoot,
      '--allowed-origins',
      ALLOWED_ORIGIN,
      '--api-url',
      harness.restApiUrl,
    ]);
    serve.stderr?.on('data', (chunk: Buffer) => {
      serveStderr += chunk.toString();
    });
    serveExit = new Promise((resolveExit) => {
      serve.once('exit', (code) => resolveExit(code));
    });
    await waitFor(
      async () => {
        try {
          const response = await fetch(`${base}/health`);
          return response.ok;
        } catch {
          return false;
        }
      },
      { timeoutMs: 60_000 },
    ).catch((error: unknown) => {
      throw new Error(
        `serve did not become healthy: ${String(error)}\n--- serve stderr ---\n${serveStderr}`,
      );
    });
  });

  afterAll(async () => {
    if (serve && serve.exitCode === null) {
      serve.kill('SIGTERM');
      await Promise.race([
        serveExit,
        new Promise((r) => {
          setTimeout(r, 15_000);
        }),
      ]);
      if (serve.exitCode === null) serve.kill('SIGKILL');
    }
    modelStub?.server.close();
    tagsStub?.server.close();
    if (serveRoot) await rm(serveRoot, { recursive: true, force: true });
    await harness?.teardown();
  });

  it('answers health without pairing and gates the JSON API behind pairing', async () => {
    expect((await call('/health', { origin: null })).status).toBe(200);

    const unpaired = await call('/v1/status');
    expect(unpaired.status).toBe(401);
    expect((unpaired.json as ServeError).code).toBe('pairing_required');

    const foreign = await call('/v1/status', { origin: OTHER_ORIGIN });
    expect(foreign.status).toBe(403);
  });

  it('completes the pairing ceremony and binds the token to the origin', async () => {
    // Arrange: the Console starts a pairing from its own origin.
    const started = await call('/v1/pairings', { method: 'POST' });
    expect(started.status).toBe(201);
    const { pairingId, approvalPath } = started.json as {
      pairingId: string;
      approvalPath: string;
    };
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
    const stolen = await call(`/v1/pairings/${pairingId}/claim`, {
      method: 'POST',
      origin: OTHER_ORIGIN,
    });
    expect(stolen.status).toBeGreaterThanOrEqual(400);

    const claimed = await call(`/v1/pairings/${pairingId}/claim`, {
      method: 'POST',
    });
    expect(claimed.status).toBe(200);
    token = (claimed.json as { token: string }).token;
    expect(token.length).toBeGreaterThan(20);

    const status = await call('/v1/status', { token });
    expect(status.status).toBe(200);
    expect(status.json).toMatchObject({
      agents: [],
      providers: {},
      runs: [],
    });
    expect(
      Array.isArray((status.json as { subscriptions: unknown }).subscriptions),
    ).toBe(true);

    // A token presented from another origin is not honoured.
    const crossOrigin = await call('/v1/status', {
      token,
      origin: OTHER_ORIGIN,
    });
    expect(crossOrigin.status).toBe(403);
  });

  it('discovers models from OpenAI-compatible and Ollama endpoints, failing closed otherwise', async () => {
    const openai = await call('/v1/providers/discover-models', {
      method: 'POST',
      token,
      body: { baseUrl: `${modelStub.url}/v1`, apiKey: 'unused' },
    });
    expect(openai.status).toBe(200);
    expect(openai.json).toEqual({ models: [MODEL_ID, 'e2e-other'] });

    const ollama = await call('/v1/providers/discover-models', {
      method: 'POST',
      token,
      body: { baseUrl: `${tagsStub.url}/v1` },
    });
    expect(ollama.status).toBe(200);
    expect(ollama.json).toEqual({ models: ['tags-only-model'] });

    const dead = await call('/v1/providers/discover-models', {
      method: 'POST',
      token,
      body: { baseUrl: `http://127.0.0.1:${await freePort()}/v1` },
    });
    expect(dead.status).toBe(502);
    expect((dead.json as ServeError).code).toBe('discovery_failed');

    const bogus = await call('/v1/providers/discover-models', {
      method: 'POST',
      token,
      body: { baseUrl: 'ftp://nope' },
    });
    expect(bogus.status).toBe(400);
  });

  it('stores a provider with a write-only API key that never reaches config files or responses', async () => {
    const saved = await call(`/v1/providers/${PROVIDER_ID}`, {
      method: 'PUT',
      token,
      body: {
        api: 'openai-completions',
        baseUrl: `${modelStub.url}/v1`,
        envName: 'E2E_LOCAL_API_KEY',
        models: [MODEL_ID],
        apiKey: RAW_API_KEY,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      api: 'openai-completions',
      envName: 'E2E_LOCAL_API_KEY',
      models: [MODEL_ID],
      hasApiKey: true,
    });
    expect(saved.text).not.toContain(RAW_API_KEY);

    // Updating without a key keeps the stored one.
    const updated = await call(`/v1/providers/${PROVIDER_ID}`, {
      method: 'PUT',
      token,
      body: {
        api: 'openai-completions',
        baseUrl: `${modelStub.url}/v1`,
        envName: 'E2E_LOCAL_API_KEY',
        models: [MODEL_ID, 'e2e-other'],
      },
    });
    expect(updated.json).toMatchObject({ hasApiKey: true });

    const listed = await call('/v1/providers', { token });
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(RAW_API_KEY);

    expect(await configFilesContaining(serveRoot, RAW_API_KEY)).toEqual([]);
  });

  it('refuses a managed agent without an invitation code', async () => {
    const result = await call('/v1/agents', {
      method: 'POST',
      token,
      body: { kind: 'managed', name: 'stranded', apiUrl: harness.restApiUrl },
    });
    expect(result.status).toBe(400);
  });

  it('creates a managed agent from a team invitation code and captures the team binding', async () => {
    const enrollment = await agent.agentEnrollments.create(
      { expiresInMinutes: 15 },
      { teamId },
    );

    const created = await call('/v1/agents', {
      method: 'POST',
      token,
      body: {
        kind: 'managed',
        name: agentName,
        apiUrl: harness.restApiUrl,
        enrollmentToken: enrollment.token,
      },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      kind: 'managed',
      agentName,
      teamId,
      hasAgentKey: true,
      hasPrivateKey: true,
    });
    const view = created.json as { identityId: string; fingerprint: string };
    expect(view.identityId).toMatch(/^[0-9a-f-]{36}$/);
    expect(view.fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    // Presence booleans only — never key material or reference strings.
    expect(Object.keys(created.json as object)).not.toEqual(
      expect.arrayContaining(['agentKeyRef', 'privateKeyRef', 'agentKey']),
    );
    managedIdentityId = view.identityId;

    const listed = await call('/v1/agents', { token });
    expect(listed.status).toBe(200);
    expect(listed.json).toEqual([expect.objectContaining({ agentName })]);

    // Single-use: the same code cannot enrol a second agent.
    const replay = await call('/v1/agents', {
      method: 'POST',
      token,
      body: {
        kind: 'managed',
        name: `${agentName}-replay`,
        apiUrl: harness.restApiUrl,
        enrollmentToken: enrollment.token,
      },
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses to start a run in a team the agent key is not bound to', async () => {
    const result = await call('/v1/runs', {
      method: 'POST',
      token,
      body: {
        agent: agentName,
        teamId: personalTeamId,
        profiles: [profileName],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(result.status).toBe(400);
    expect((result.json as ServeError).code).toBe('invalid_spec');
    expect((result.json as ServeError).message).toContain('bound to team');
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
    const started = await call('/v1/runs', {
      method: 'POST',
      token,
      body: {
        agent: agentName,
        teamId,
        profiles: [profileName],
        taskTypes: ['freeform'],
        mode: 'poll',
      },
    });
    expect(started.status).toBe(201);
    const record = started.json as { id: string; status: string; pid?: number };
    expect(record.status).toBe('running');
    runId = record.id;

    // Assert: the child daemon really came up and is polling as the agent.
    // `agent-daemon.starting` is the info-level proof the child resolved
    // the profile/model pair and connected as the agent; keep reading a
    // little longer to catch an immediate crash (fatal / error level).
    const logs = await readRunLogs(
      runId,
      (text) => text.includes('[fatal]') || text.includes('"level":50'),
      15_000,
    );
    expect(logs).toContain('agent-daemon.starting');
    expect(logs).toContain(`"boundTeamId":"${teamId}"`);
    expect(logs).not.toContain('[fatal]');
    expect(logs).not.toContain('"level":50');

    const listed = await call('/v1/runs', { token });
    expect(listed.json).toEqual([
      expect.objectContaining({ id: runId, status: 'running', active: true }),
    ]);

    const stopped = await call(`/v1/runs/${runId}`, {
      method: 'DELETE',
      token,
    });
    expect(stopped.status).toBe(200);
    await waitFor(
      async () => {
        const runs = (await call('/v1/runs', { token })).json as {
          id: string;
          active: boolean;
        }[];
        return runs.some((run) => run.id === runId && run.active === false);
      },
      { timeoutMs: 20_000 },
    );

    const unknown = await call('/v1/runs/does-not-exist', {
      method: 'DELETE',
      token,
    });
    expect(unknown.status).toBe(404);
  }, 120_000);

  it('shuts down cleanly on SIGTERM', async () => {
    serve.kill('SIGTERM');
    const code = await Promise.race([
      serveExit,
      new Promise<'timeout'>((r) => {
        setTimeout(() => r('timeout'), 15_000);
      }),
    ]);
    expect(code).toBe(0);
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  }, 30_000);
});
