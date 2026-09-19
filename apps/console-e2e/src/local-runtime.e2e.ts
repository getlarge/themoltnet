import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  createClient as createLocalClient,
  enrollAgentServerTeam,
  getAgentServerCatalogue,
  signInAgentServerOperator,
} from '@moltnet/agent-daemon-api-client';
import {
  createRuntimeProfile,
  createTeam,
  createTeamInvite,
  listAgentKeys,
} from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createCookieSessionApiClient,
  createTestUser,
  expectConsoleOverview,
  getSessionCookie,
  loginViaBrowser,
  registerViaBrowser,
  REST_API_URL,
  submitKratosForm,
  waitForVerificationCode,
} from './helpers/index.js';
import {
  CONSOLE_CLIENT_ID,
  NATIVE_CLIENT_ID,
} from './helpers/operator-clients.js';

/**
 * Local runtime page E2E — the course-flow journey (#2061).
 *
 * Runs the real `moltnet-agent server` supervisor on the host (the Console
 * only ever talks to `http://127.0.0.1:17374`) and drives the page the way
 * a learner would: approve PKCE → create a managed
 * agent → configure a provider from discovered models → start a daemon
 * run → stop it. Model discovery hits a tiny local stub so the journey is
 * network-free beyond the e2e stack itself.
 */

/** The Console image and host-side Agent Server must use the same loopback URL. */
const AGENT_SERVER_URL =
  process.env['MOLTNET_AGENT_SERVER_URL'] ?? 'http://127.0.0.1:17374';
const AGENT_SERVER_PORT = Number(new URL(AGENT_SERVER_URL).port);
const DAEMON_BUNDLE_ROOT = resolve(
  import.meta.dirname,
  `../../../dist/agent-bundle/moltnet-agent-${process.platform}-${process.arch}`,
);
const MODEL_ID = 'e2e-fake';
const PROVIDER_ID = 'e2e-local';
const STDERR_TAIL_BYTES = 16 * 1024;

/**
 * This suite intentionally drives the Nx-built daemon bundle. Its target has
 * an explicit dependency on that bundle so source-tree resolution cannot hide
 * packaging or runtime regressions.
 */
function spawnAgentServer(
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const bundleRoot = process.env['MOLTNET_AGENT_BUNDLE'] ?? DAEMON_BUNDLE_ROOT;
  const bundledEntry = join(bundleRoot, 'bin/moltnet-agent');
  if (existsSync(bundledEntry)) {
    return spawn(bundledEntry, ['server', ...args], {
      cwd: tmpdir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  throw new Error(
    `Daemon bundle is missing at ${bundledEntry}; run the console E2E target through Nx so its bundle dependency is built first.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function appendStderrTail(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString()}`.slice(-STDERR_TAIL_BYTES);
}

async function waitForAgentServerHealth(stderr: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const healthy = await fetch(`${AGENT_SERVER_URL}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) return;
    await sleep(250);
  }
  throw new Error(
    `agent server did not become healthy\n--- agent server stderr ---\n${stderr()}`,
  );
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = createNetServer();
    probe.once('error', () => resolveFree(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolveFree(true)));
  });
}

function startModelStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolveStub) => {
    const server = createServer((request, response) => {
      if ((request.url ?? '').endsWith('/models')) {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(
            JSON.stringify({ data: [{ id: MODEL_ID }, { id: 'e2e-other' }] }),
          );
        return;
      }
      response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolveStub({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test.describe.serial('Local runtime page', () => {
  const user = createTestUser({ prefix: 'local-runtime' });
  const nonce = Date.now().toString(36);
  const teamName = `local-runtime-${nonce}`;
  const agentName = `learner-agent-${nonce}`;
  const profileName = `local-profile-${nonce}`;
  let agentServer: ChildProcess;
  let agentServerRoot: string;
  let agentServerStderr = '';
  let modelStub: { server: Server; url: string };
  let teamId: string;
  let profileId: string;
  const nativeToken = randomBytes(32).toString('base64url');
  const localClient = createLocalClient({
    baseUrl: AGENT_SERVER_URL,
    headers: {
      origin: 'moltnet-agent-desktop://native',
      'x-moltnet-agent-server-token': nativeToken,
    },
  });
  let serverEnv: NodeJS.ProcessEnv;
  let serverArgs: string[];
  async function nativeApproval(
    page: import('@playwright/test').Page,
    start: () => Promise<unknown>,
  ) {
    const marker = join(agentServerRoot, 'authorization-url');
    rmSync(marker, { force: true });
    const pending = start();
    // Attach immediately so a transport failure cannot become unhandled while the browser navigates.
    const settled = pending.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await expect.poll(() => existsSync(marker)).toBe(true);
    const approval = await page.context().newPage();
    await approval.goto(readFileSync(marker, 'utf8'));
    await approval
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(
      approval.getByText('Approval received. Return to Desktop.'),
    ).toBeVisible();
    const result = await settled;
    await approval.close();
    if ('error' in result) throw result.error;
    return result.value;
  }
  async function connectConsole(page: import('@playwright/test').Page) {
    const popup = page.context().waitForEvent('page');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const approval = await popup;
    await approval
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(page.getByText('LLM providers')).toBeVisible();
  }

  test.beforeAll(async () => {
    if (!(await isPortFree(AGENT_SERVER_PORT))) {
      throw new Error(
        `Port ${AGENT_SERVER_PORT} is busy — stop any running \`moltnet-agent server\` before this suite.`,
      );
    }
    modelStub = await startModelStub();
    agentServerRoot = await mkdtemp(
      join(tmpdir(), 'moltnet-agent-server-console-e2e-'),
    );
    const browserBin = join(agentServerRoot, 'browser-bin');
    mkdirSync(browserBin);
    const launcher = `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.MOLTNET_E2E_APPROVAL_URL_FILE, process.argv[2]);\n`;
    writeFileSync(
      join(browserBin, process.platform === 'darwin' ? 'open' : 'xdg-open'),
      launcher,
      { mode: 0o700 },
    );
    serverEnv = {
      ...process.env,
      PATH: `${browserBin}:${process.env.PATH}`,
      MOLTNET_E2E_APPROVAL_URL_FILE: join(agentServerRoot, 'authorization-url'),
      MOLTNET_AGENT_SERVER_NATIVE_TOKEN: nativeToken,
      MOLTNET_OPERATOR_OAUTH_ISSUER: 'http://hydra:4444',
      MOLTNET_OPERATOR_OAUTH_PUBLIC_URL: 'http://localhost:4444',
      MOLTNET_NATIVE_OAUTH_CLIENT_ID: NATIVE_CLIENT_ID,
      MOLTNET_CONSOLE_OAUTH_CLIENT_ID: CONSOLE_CLIENT_ID,
      MOLTNET_OPERATOR_API_URL: REST_API_URL,
    };
    serverArgs = [
      '--port',
      String(AGENT_SERVER_PORT),
      '--root',
      agentServerRoot,
      '--allowed-origins',
      CONSOLE_URL,
      '--api-url',
      REST_API_URL,
    ];
    agentServer = spawnAgentServer(serverArgs, serverEnv);
    agentServer.stderr?.on('data', (chunk: Buffer) => {
      agentServerStderr = appendStderrTail(agentServerStderr, chunk);
    });
    await waitForAgentServerHealth(() => agentServerStderr);
  });

  test.afterAll(async () => {
    if (agentServer && agentServer.exitCode === null) {
      const exited = new Promise<void>((resolveExit) => {
        agentServer.once('exit', () => resolveExit());
      });
      agentServer.kill('SIGTERM');
      await Promise.race([exited, sleep(15_000)]);
      if (agentServer.exitCode === null) {
        agentServer.kill('SIGKILL');
        await exited;
      }
    }
    if (modelStub) {
      await new Promise<void>((resolveClose, rejectClose) => {
        modelStub.server.close((error) =>
          error ? rejectClose(error) : resolveClose(),
        );
      });
    }
    if (agentServerRoot)
      await rm(agentServerRoot, { recursive: true, force: true });
  });

  test('a learner pairs the console, enrols an agent, configures a provider, and runs a daemon', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    let humanClient!: ReturnType<typeof createCookieSessionApiClient>;
    await test.step('register and create the project team', async () => {
      await registerViaBrowser(page, user);
      const codeInput = page.locator('input[name="code"]');
      if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await codeInput.fill(await waitForVerificationCode(user.email));
        await submitKratosForm(page);
      }
      await page.goto(`${CONSOLE_URL}/`);
      await expectConsoleOverview(page);
      const cookieHeader = await getSessionCookie(page);
      humanClient = createCookieSessionApiClient(cookieHeader);
      const team = await createTeam({
        client: humanClient,
        body: { name: teamName },
      });
      if (!team.data?.id) {
        throw new Error(`createTeam failed: ${JSON.stringify(team.error)}`);
      }
      teamId = team.data.id;
    });

    await test.step('native operator approval followed by Console PKCE', async () => {
      const signedIn = await nativeApproval(page, () =>
        signInAgentServerOperator({ client: localClient }),
      );
      expect(signedIn).toMatchObject({ response: { status: 200 } });
      await page.goto(`${CONSOLE_URL}/runtime/local`);
      await page
        .locator('select[aria-label="Select team"]')
        .selectOption({ label: teamName });
      await connectConsole(page);
    });

    await test.step('create a managed agent from an invitation', async () => {
      const { data: invite, error } = await createTeamInvite({
        client: humanClient,
        path: { id: teamId },
        body: { role: 'member' },
      });
      if (!invite?.code) {
        throw new Error(`createTeamInvite failed: ${JSON.stringify(error)}`);
      }

      await page.getByLabel('Agent name').fill(agentName);
      await page.getByLabel('Team invite code').fill(invite.code);
      await page.getByRole('button', { name: 'Create identity' }).click();
      const agentRow = page.getByText(agentName, { exact: true }).first();
      await expect(agentRow).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel('Agent name')).toHaveValue('');
    });

    await test.step('enroll and renew through approval, Talos, protected storage and refreshed health', async () => {
      const team = await createTeam({
        client: humanClient,
        body: { name: `${teamName}-pkce` },
      });
      expect(team.response.status).toBe(201);
      const destination = team.data!.id;
      const enroll = await nativeApproval(page, () =>
        enrollAgentServerTeam({
          client: localClient,
          path: { agentName },
          body: {
            mode: 'enroll',
            teamId: destination,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      expect(enroll).toMatchObject({
        data: { state: 'persisted', teamId: destination },
      });
      const configPath = join(
        agentServerRoot,
        'identities',
        agentName,
        'moltnet.json',
      );
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.agent_key_refs[destination]).toMatchObject({
        provider: 'file',
      });
      const firstKey = (enroll as { data: { keyId: string } }).data.keyId;
      const renewal = await nativeApproval(page, () =>
        enrollAgentServerTeam({
          client: localClient,
          path: { agentName },
          body: {
            mode: 'replace',
            teamId: destination,
            idempotencyKey: randomUUID(),
          },
        }),
      );
      expect(renewal).toMatchObject({
        data: { state: 'persisted', teamId: destination },
      });
      expect((renewal as { data: { keyId: string } }).data.keyId).not.toBe(
        firstKey,
      );
      const health = await getAgentServerCatalogue({
        client: localClient,
        query: { identity: agentName },
      });
      expect(
        health.data?.teams.find((t) => t.teamId === destination),
      ).toMatchObject({ available: true });
      expect(JSON.stringify(enroll)).not.toContain('ory_ak_');
    });

    await test.step('configure the provider and runtime profile', async () => {
      await page
        .getByRole('button', { name: 'Custom (OpenAI-compatible)' })
        .click();
      await page.getByLabel('Provider id').fill(PROVIDER_ID);
      await page.getByLabel('Base URL').fill(`${modelStub.url}/v1`);
      await page.getByLabel('API key', { exact: true }).fill('e2e-key');
      await page.getByRole('button', { name: 'Fetch models' }).click();
      const modelCheckbox = page.getByRole('checkbox', { name: MODEL_ID });
      await expect(modelCheckbox).toBeVisible();
      await modelCheckbox.check();
      await page.getByRole('button', { name: 'Save provider' }).click();
      await expect(
        page.getByText(PROVIDER_ID, { exact: true }).first(),
      ).toBeVisible();

      // ── Runtime profile pinning that provider/model (via API, as an owner) ──
      const created = await createRuntimeProfile({
        client: humanClient,
        headers: { 'x-moltnet-team-id': teamId },
        body: {
          name: profileName,
          runtimeKind: 'gondolin_pi',
          provider: PROVIDER_ID,
          model: MODEL_ID,
          sandbox: {},
        },
      });
      expect(created.response.status).toBe(201);
      if (!created?.data?.id)
        throw new Error('createRuntimeProfile returned no id');
      profileId = created.data.id;
    });

    await test.step('start the daemon and verify a clean stop', async () => {
      await page.reload();
      await connectConsole(page);
      await expect(page.getByText('Runs', { exact: true })).toBeVisible();
      const teamSelect = page.locator('select[aria-label="Select team"]');
      await teamSelect.selectOption({ label: teamName });
      const agentSelect = page.getByLabel('Agent', { exact: true });
      const profileSelect = page.getByLabel('Runtime profile', {
        exact: true,
      });
      await expect(agentSelect).toBeVisible();
      await agentSelect.selectOption(agentName);
      await profileSelect.selectOption({
        label: `${profileName} · ${profileId.slice(0, 8)}`,
      });
      await page.getByRole('button', { name: 'Start run' }).click();

      const runRow = page.getByText(`poll · ${profileName} · freeform`);
      await expect(runRow).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('running', { exact: true })).toBeVisible();
      // Evidence the child daemon really came up and polls as the agent: the
      // live log tail shows the poll loop, and the run never flips to failed.
      await page.getByRole('button', { name: 'Logs' }).click();
      const logPanel = page.getByLabel(/Logs for run/);
      await expect(logPanel).toContainText(/agent-daemon\.starting|\[fatal\]/, {
        timeout: 240_000,
      });
      await expect(logPanel).not.toContainText('[fatal]');
      await expect(logPanel).toContainText('agent-daemon.starting');
      await expect(page.getByText('running', { exact: true })).toBeVisible();
      await expect(page.getByText('failed', { exact: true })).toHaveCount(0);

      // Renewal changes future credentials without stopping the predecessor worker.
      const identity = JSON.parse(
        readFileSync(
          join(agentServerRoot, 'identities', agentName, 'moltnet.json'),
          'utf8',
        ),
      );
      const before = await listAgentKeys({
        client: humanClient,
        headers: { 'x-moltnet-team-id': teamId },
        query: {
          agentId: identity.subject_id,
          bindingScope: 'team',
          status: 'active',
        },
      });
      expect(before.response.status).toBe(200);
      const renewed = await nativeApproval(page, () =>
        enrollAgentServerTeam({
          client: localClient,
          path: { agentName },
          body: { mode: 'replace', teamId, idempotencyKey: randomUUID() },
        }),
      );
      expect(renewed).toMatchObject({ data: { state: 'persisted', teamId } });
      const after = await listAgentKeys({
        client: humanClient,
        headers: { 'x-moltnet-team-id': teamId },
        query: {
          agentId: identity.subject_id,
          bindingScope: 'team',
          status: 'active',
        },
      });
      expect(after.response.status).toBe(200);
      for (const key of before.data!.items)
        expect(after.data!.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: key.id, status: 'active' }),
          ]),
        );
      await expect(page.getByText('running', { exact: true })).toBeVisible();
      await expect(logPanel).not.toContainText('[fatal]');

      await page.getByRole('button', { name: 'Stop' }).click();
      await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(page.getByText('running', { exact: true })).toHaveCount(0);
      await expect(page.getByText('stopped', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    });
  });

  test('server restart requires Console PKCE again while preserving the native operator', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/runtime/local`);
    await connectConsole(page);
    const stopped = new Promise<void>((resolve) =>
      agentServer.once('exit', () => resolve()),
    );
    agentServer.kill('SIGTERM');
    await stopped;
    agentServer = spawnAgentServer(serverArgs, serverEnv);
    agentServer.stderr?.on('data', (chunk: Buffer) => {
      agentServerStderr = appendStderrTail(agentServerStderr, chunk);
    });
    await waitForAgentServerHealth(() => agentServerStderr);
    await expect(
      page.getByRole('button', { name: 'Connect', exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await connectConsole(page);
    expect(
      JSON.parse(readFileSync(join(agentServerRoot, 'operator.json'), 'utf8')),
    ).toHaveProperty('subject');
  });
});
