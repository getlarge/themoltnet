/**
 * Local runtime page E2E — the course-flow journey (#2061).
 *
 * Runs the real `moltnet-agent server` supervisor on the host (the Console
 * only ever talks to `http://127.0.0.1:17374`) and drives the page the way
 * a learner would: pair → provide a team invitation code → create a managed
 * agent → configure a provider from discovered models → start a daemon
 * run → stop it. Model discovery hits a tiny local stub so the journey is
 * network-free beyond the e2e stack itself.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  createRuntimeProfile,
  createTeam,
  createTeamInvite,
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
function spawnAgentServer(args: string[]): ChildProcess {
  const bundleRoot = process.env['MOLTNET_AGENT_BUNDLE'] ?? DAEMON_BUNDLE_ROOT;
  const bundledEntry = join(bundleRoot, 'bin/moltnet-agent');
  if (existsSync(bundledEntry)) {
    return spawn(bundledEntry, ['server', ...args], {
      cwd: tmpdir(),
      env: process.env,
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
    agentServer = spawnAgentServer([
      '--port',
      String(AGENT_SERVER_PORT),
      '--root',
      agentServerRoot,
      '--allowed-origins',
      CONSOLE_URL,
      '--api-url',
      REST_API_URL,
    ]);
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
    context,
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

    await test.step('pair the Console to the local supervisor', async () => {
      await page.goto(`${CONSOLE_URL}/runtime/local`);
      const teamSelect = page.locator('select[aria-label="Select team"]');
      await expect(teamSelect).toBeVisible();
      await teamSelect.selectOption({ label: teamName });

      const connect = page.getByRole('button', { name: 'Connect' });
      await expect(connect).toBeVisible();
      const approvalPagePromise = context.waitForEvent('page');
      await connect.click();
      const approval = await approvalPagePromise;
      await approval.waitForLoadState();
      await expect(approval).toHaveURL(
        new RegExp(`^${AGENT_SERVER_URL}/pairings/`),
      );
      await expect(approval.getByText(CONSOLE_URL)).toBeVisible();
      await approval.getByRole('button', { name: 'Approve' }).click();
      await expect(approval.getByText('Connection approved')).toBeVisible();
      await approval.close();

      await expect(page.getByRole('button', { name: 'Connect' })).toHaveCount(
        0,
      );
      await expect(page.getByText('LLM providers')).toBeVisible();
      await expect(page.getByText('Not paired')).toHaveCount(0);
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
      await expect(page.getByText('Runs', { exact: true })).toBeVisible();
      const teamSelect = page.locator('select[aria-label="Select team"]');
      await teamSelect.selectOption({ label: teamName });
      const agentSelect = page
        .locator('label', { hasText: 'Agent' })
        .locator('select')
        .first();
      const profileSelect = page
        .locator('label', { hasText: 'Runtime profile' })
        .locator('select')
        .first();
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

  test('pairing is per browser context: a fresh one must connect again', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/runtime/local`);
    // The pairing token lives in the browser, never on the server: a new
    // context finds the same supervisor but starts from "Not paired".
    await expect(page.getByText('Not paired')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(page.getByText('LLM providers')).toHaveCount(0);
  });
});
