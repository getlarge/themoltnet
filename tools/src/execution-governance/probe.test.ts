import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractNativeExecutionId, sanitizeText } from './probe.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const hookPath = join(sourceDir, 'hook-recorder.mjs');
const mcpPath = join(sourceDir, 'mcp-probe-server.mjs');

async function runNode(
  script: string,
  input: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(input);
  const code = await new Promise<number | null>((resolve) => {
    child.once('close', resolve);
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

describe('execution-governance provider fixtures', () => {
  it('retains native identifiers while sanitizing host paths', () => {
    const input =
      '/private/tmp/probe/workspace -private-tmp-probe-workspace thread=01a01e6d-5620-7352-bdcc-72a0c77aefdf';

    expect(
      sanitizeText(input, {
        probeRoot: '/private/tmp/probe',
        home: '/Users/example',
      }),
    ).toBe(
      '$PROBE_ROOT/workspace $PROBE_ROOT_SLUG-workspace thread=01a01e6d-5620-7352-bdcc-72a0c77aefdf',
    );
  });

  it('extracts Codex and Claude native execution identifiers', () => {
    expect(
      extractNativeExecutionId(
        'codex',
        '{"type":"thread.started","thread_id":"codex-thread"}\n',
      ),
    ).toBe('codex-thread');
    expect(
      extractNativeExecutionId(
        'claude',
        '{"type":"system","session_id":"claude-session"}\n',
      ),
    ).toBe('claude-session');
  });

  it('records a provider payload and emits a synchronous denial', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'moltnet-hook-probe-'));
    const logPath = join(directory, 'hooks.jsonl');
    const input = {
      hook_event_name: 'PreToolUse',
      session_id: 'provider-session',
      tool_name: 'Bash',
      tool_input: { command: 'printf MOLTNET_PROBE_DENY' },
    };

    const result = await runNode(hookPath, JSON.stringify(input), {
      MOLTNET_PROBE_HOOK_LOG: logPath,
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
      },
    });
    expect(JSON.parse(await readFile(logPath, 'utf8'))).toEqual(input);
  });

  it('simulates an unavailable synchronous hook service', async () => {
    const result = await runNode(
      hookPath,
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_input: { command: 'MOLTNET_PROBE_HOOK_ERROR' },
      }),
    );

    expect(result.code).toBe(70);
    expect(result.stderr).toContain('simulated policy service unavailable');
  });

  it('serves MCP tools over provider-compatible stdio JSON-RPC', async () => {
    const messages = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'probe_echo', arguments: { value: 'coverage' } },
      },
    ];

    const result = await runNode(
      mcpPath,
      `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`,
    );
    const responses = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(result.code).toBe(0);
    expect(responses).toHaveLength(3);
    expect(
      responses[1].result.tools.map(({ name }: { name: string }) => name),
    ).toEqual(
      expect.arrayContaining([
        'probe_echo',
        'probe_write_host',
        'probe_network',
      ]),
    );
    expect(responses[2].result.content[0].text).toBe('echo:coverage');
  });
});
