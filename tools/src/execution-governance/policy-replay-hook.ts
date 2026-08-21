import { appendFile } from 'node:fs/promises';

import {
  loadPolicyReplayFixture,
  type ReplayPayload,
  replayPreToolUse,
  type ReplayProvider,
} from './policy-replay.js';

interface HookOptions {
  provider: ReplayProvider;
  policyPath: string;
  evidencePath?: string;
}

function parseOptions(argv: string[]): HookOptions {
  const valueAfter = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const provider = valueAfter('--provider');
  const policyPath = valueAfter('--policy');
  const evidencePath = valueAfter('--evidence');

  if (provider !== 'claude' && provider !== 'codex') {
    throw new Error('--provider must be claude or codex');
  }
  if (!policyPath) {
    throw new Error('--policy is required');
  }
  return { provider, policyPath, ...(evidencePath ? { evidencePath } : {}) };
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const fixture = await loadPolicyReplayFixture(options.policyPath);
  const payload = JSON.parse(await readStdin()) as ReplayPayload;
  const evidence = await replayPreToolUse(
    options.provider,
    payload,
    fixture.allowedToolsResponse,
  );

  if (options.evidencePath) {
    await appendFile(options.evidencePath, `${JSON.stringify(evidence)}\n`);
  }
  process.stdout.write(`${JSON.stringify(evidence.hookResponse)}\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`policy replay hook failed: ${message}\n`);
  process.exitCode = 1;
}
