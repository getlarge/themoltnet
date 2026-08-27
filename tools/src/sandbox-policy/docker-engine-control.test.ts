import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { dockerEngineControl } from './docker-engine-control.js';

const sandboxName = 'moltnet-cancel';
const workspacePath = '/tmp/moltnet-workspace';
const containerId = 'immutable-container-id';

interface EngineFixture {
  requests: string[];
  root: string;
  server: Server;
  socketPath: string;
}

const fixtures: EngineFixture[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ root, server }) => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await rm(root, { force: true, recursive: true });
    }),
  );
});

describe('Docker Engine sandbox retirement', () => {
  it('kills only the immutable container with the exact sandbox identity', async () => {
    const fixture = await startEngineFixture();

    const retirement = await dockerEngineControl.retireSandbox({
      sandboxName,
      socketPath: fixture.socketPath,
      workspacePath,
    });

    expect(retirement).toEqual({
      confirmed: true,
      exitCode: 137,
      identityConfirmed: true,
      killStatus: 204,
    });
    expect(fixture.requests).toContain(
      `POST /v1.55/containers/${containerId}/kill?signal=KILL`,
    );
  });

  it('fails closed without issuing a kill when the workspace identity differs', async () => {
    const fixture = await startEngineFixture('/tmp/another-workspace');

    const retirement = await dockerEngineControl.retireSandbox({
      sandboxName,
      socketPath: fixture.socketPath,
      workspacePath,
    });

    expect(retirement).toMatchObject({
      confirmed: false,
      identityConfirmed: false,
      killStatus: null,
    });
    expect(fixture.requests.some((entry) => entry.includes('/kill'))).toBe(
      false,
    );
  });
});

async function startEngineFixture(
  actualWorkspacePath = workspacePath,
): Promise<EngineFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docker-engine-test-'));
  const socketPath = path.join(root, 'docker.sock');
  const requests: string[] = [];
  let running = true;
  const labels = {
    'com.docker.sandbox.name': sandboxName,
    'com.docker.sandbox.workingDirectory': actualWorkspacePath,
    'docker/sandbox': 'true',
  };
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === '/v1.55/containers/json?all=1') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify([
          { Id: containerId, Labels: labels, Names: [`/${sandboxName}`] },
        ]),
      );
      return;
    }
    if (request.url === `/v1.55/containers/${containerId}/json`) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          Config: { Labels: labels },
          Id: containerId,
          Name: sandboxName,
          State: { ExitCode: running ? 0 : 137, Running: running },
        }),
      );
      return;
    }
    if (
      request.method === 'POST' &&
      request.url === `/v1.55/containers/${containerId}/kill?signal=KILL`
    ) {
      running = false;
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
  const fixture = { requests, root, server, socketPath };
  fixtures.push(fixture);
  return fixture;
}
