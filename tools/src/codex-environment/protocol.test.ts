import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { JsonlRpcClient } from './protocol.js';

describe('JsonlRpcClient', () => {
  it('correlates JSONL responses and asynchronous notifications', async () => {
    const requests = new PassThrough();
    const responses = new PassThrough();
    const client = new JsonlRpcClient(requests, responses);
    const requestChunks: Buffer[] = [];
    requests.on('data', (chunk) => requestChunks.push(Buffer.from(chunk)));

    const result = client.request<{ status: string }>('environment/status', {
      environmentId: 'fixture',
    });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    const request = JSON.parse(
      Buffer.concat(requestChunks).toString('utf8'),
    ) as {
      id: number;
    };
    responses.write(
      `${JSON.stringify({ id: request.id, result: { status: 'ready' } })}\n`,
    );
    await expect(result).resolves.toEqual({ status: 'ready' });

    const completed = client.waitForNotification(
      (message) => message.method === 'turn/completed',
    );
    responses.write(
      `${JSON.stringify({ method: 'turn/completed', params: {} })}\n`,
    );
    await expect(completed).resolves.toMatchObject({
      method: 'turn/completed',
    });
    responses.end();
    requests.end();
  });
});
