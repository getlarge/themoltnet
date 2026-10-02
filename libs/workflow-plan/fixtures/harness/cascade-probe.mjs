import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const transport = new StdioClientTransport({
  command: 'node',
  args: ['index.js'],
  env: { ...process.env, WINDAGS_TELEMETRY: 'off' },
  stderr: 'pipe',
});
let stderr = '';
transport.stderr?.on('data', (c) => (stderr += c.toString()));
const client = new Client({ name: 'probe', version: '0.0.1' });
await client.connect(transport);
for (const q of [
  'Process evidence/set-a.json and write findings with per-item citations',
  'human approval gate',
]) {
  const t0 = Date.now();
  const res = await client.callTool({
    name: 'windags_skill_search',
    arguments: { query: q, limit: 5 },
  });
  console.log(
    q,
    '->',
    Date.now() - t0,
    'ms',
    res.content[0].text.slice(0, 700),
  );
}
await client.close();
console.log('STDERR:', stderr.slice(0, 1500));
process.exit(0);
