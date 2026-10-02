// Live planning run of the upstream /next-move pipeline (patched copy: only the
// claude-cli transport is added; stage prompts, parsing, normalization and the
// validator are upstream code). The skill cascade is the REAL upstream MCP
// server (590 bundled skills), called as an MCP client over stdio.
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const P = process.env.PATCHED_DIR;
const { runPipeline } = await import(
  path.join(P, 'mcp-server/run-pipeline.js')
);
const transport = new StdioClientTransport({
  command: 'node',
  args: [path.join(P, 'mcp-server/index.js')],
  env: { ...process.env, WINDAGS_TELEMETRY: 'off', WINDAGS_USER_SKILLS: 'off' },
  stderr: 'pipe',
});
const client = new Client({
  name: 'moltnet-research-harness',
  version: '0.0.1',
});
await client.connect(transport);
const cascadeLog = [];
const cascadeSearch = async (query, limit = 8) => {
  const t0 = Date.now();
  const res = await client.callTool({
    name: 'windags_skill_search',
    arguments: { query, limit },
  });
  const parsed = JSON.parse(res.content[0].text);
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed.results ??
      parsed.skills ??
      Object.values(parsed).find(Array.isArray) ??
      []);
  const results = list.map((r) => ({
    id: r.id,
    score: r.score,
    description: r.description,
  }));
  cascadeLog.push({
    query,
    limit,
    elapsed_ms: Date.now() - t0,
    stage: parsed.stage ?? null,
    top: results.slice(0, 3).map((r) => r.id),
  });
  return { results };
};
const task = process.env.TASK_HINT;
const t0 = Date.now();
let result,
  error = null;
try {
  result = await runPipeline({
    task,
    projectRoot: process.env.PROJECT_ROOT,
    fresh: true,
    cascadeSearch,
  });
} catch (err) {
  error = { message: err.message, stack: err.stack };
}
const out = {
  upstream_revision: process.env.WINDAGS_REV,
  patched: 'llm-client.js/provider-models.js claude-cli transport only',
  task_hint: task,
  elapsed_ms: Date.now() - t0,
  cascade_log: cascadeLog,
  error,
  result,
};
fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(out, null, 2));
await client.close();
console.log(
  error
    ? `FAILED: ${error.message}`
    : `ok halted=${result.halted} elapsed=${out.elapsed_ms}ms stages=${result.usage_log.length}`,
);
process.exit(0);
