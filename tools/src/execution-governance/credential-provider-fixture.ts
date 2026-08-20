import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

export interface SafeFixtureRequest {
  method: string;
  path: string;
  authorizationScheme: 'bearer' | 'x-api-key' | 'none' | 'other';
  credentialMatched: boolean;
}

export interface CredentialProviderFixture {
  port: number;
  requests: SafeFixtureRequest[];
  close(): Promise<void>;
}

function authorizationObservation(
  request: IncomingMessage,
  credential: string,
): Pick<SafeFixtureRequest, 'authorizationScheme' | 'credentialMatched'> {
  const authorization = request.headers.authorization;
  const apiKey = request.headers['x-api-key'];
  return {
    authorizationScheme: authorization?.startsWith('Bearer ')
      ? 'bearer'
      : typeof apiKey === 'string'
        ? 'x-api-key'
        : authorization
          ? 'other'
          : 'none',
    credentialMatched:
      authorization === `Bearer ${credential}` || apiKey === credential,
  };
}

function writeSse(
  response: ServerResponse,
  events: unknown[],
  includeDoneSentinel: boolean,
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const event of events) {
    const type =
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      typeof event.type === 'string'
        ? event.type
        : 'message';
    response.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  if (includeDoneSentinel) response.write('data: [DONE]\n\n');
  response.end();
}

function handleCodex(response: ServerResponse): void {
  const responseId = 'resp_moltnet_synthetic';
  const itemId = 'msg_moltnet_synthetic';
  const text = 'CODEX_SANDBOX_PROBE_OK';
  const outputItem = {
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  const completed = {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: 'moltnet-synthetic',
    output: [outputItem],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  writeSse(
    response,
    [
      {
        type: 'response.created',
        response: { ...completed, status: 'in_progress', output: [] },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...outputItem, status: 'in_progress', content: [] },
      },
      {
        type: 'response.content_part.added',
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      },
      {
        type: 'response.output_text.delta',
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        delta: text,
      },
      {
        type: 'response.output_text.done',
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        text,
      },
      {
        type: 'response.content_part.done',
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        part: outputItem.content[0],
      },
      { type: 'response.output_item.done', output_index: 0, item: outputItem },
      { type: 'response.completed', response: completed },
    ],
    true,
  );
}

function handleClaude(response: ServerResponse): void {
  const text = 'CLAUDE_SANDBOX_PROBE_OK';
  writeSse(
    response,
    [
      {
        type: 'message_start',
        message: {
          id: 'msg_moltnet_synthetic',
          type: 'message',
          role: 'assistant',
          model: 'moltnet-synthetic',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      { type: 'ping' },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ],
    false,
  );
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture did not receive a TCP port');
  }
  return address.port;
}

export async function startCredentialProviderFixture(
  credential: string,
): Promise<CredentialProviderFixture> {
  const requests: SafeFixtureRequest[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    const pathname = new URL(path, 'http://fixture.invalid').pathname;
    requests.push({
      method: request.method ?? 'UNKNOWN',
      path,
      ...authorizationObservation(request, credential),
    });
    if (pathname.endsWith('/responses')) {
      handleCodex(response);
      return;
    }
    if (pathname.endsWith('/messages')) {
      handleClaude(response);
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  const port = await listen(server);
  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
