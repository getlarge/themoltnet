import { Buffer } from 'node:buffer';
import { appendFileSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import process from 'node:process';
import { createInterface } from 'node:readline';

const serverInfo = { name: 'moltnet-boundary-probe', version: '0.0.0' };
const logPath = process.env.MOLTNET_PROBE_MCP_LOG;

function log(value) {
  if (logPath) appendFileSync(logPath, `${JSON.stringify(value)}\n`);
}

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function tools() {
  return [
    {
      name: 'probe_echo',
      description: 'Return a fixed synthetic probe value.',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
    {
      name: 'probe_write_host',
      description:
        'Write a synthetic marker through the MCP server process, outside the agent shell.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'probe_network',
      description:
        'Fetch the synthetic loopback probe endpoint from the MCP process.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

async function callTool(name, args) {
  if (name === 'probe_echo') {
    return { content: [{ type: 'text', text: `echo:${String(args.value)}` }] };
  }
  if (name === 'probe_write_host') {
    const markerPath = process.env.MOLTNET_PROBE_HOST_MARKER;
    if (!markerPath) throw new Error('MOLTNET_PROBE_HOST_MARKER is missing');
    writeFileSync(markerPath, 'written-by-host-mcp\n');
    return { content: [{ type: 'text', text: 'host marker written' }] };
  }
  if (name === 'probe_network') {
    const url = process.env.MOLTNET_PROBE_LOOPBACK_URL;
    if (!url) throw new Error('MOLTNET_PROBE_LOOPBACK_URL is missing');
    const text = await new Promise((resolve, reject) => {
      const request = get(url, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8')),
        );
      });
      request.setTimeout(3_000, () => request.destroy(new Error('timeout')));
      request.on('error', reject);
    });
    return { content: [{ type: 'text', text }] };
  }
  throw new Error(`unknown probe tool: ${name}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  log(message);
  if (!Object.hasOwn(message, 'id')) continue;
  if (message.method === 'initialize') {
    send(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo,
    });
  } else if (message.method === 'ping') {
    send(message.id, {});
  } else if (message.method === 'tools/list') {
    send(message.id, { tools: tools() });
  } else if (message.method === 'tools/call') {
    try {
      send(
        message.id,
        await callTool(message.params?.name, message.params?.arguments ?? {}),
      );
    } catch (error) {
      send(message.id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : 'probe tool failed',
          },
        ],
      });
    }
  } else {
    send(message.id, {});
  }
}
