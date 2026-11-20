import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/** Bind a provider/agent-server HTTP stub on an ephemeral loopback port. */
export async function startHttpStub(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('HTTP fixture did not bind a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}
