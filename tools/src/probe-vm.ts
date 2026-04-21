/**
 * probe-vm.ts — boot a Gondolin VM and run a fixed list of shell probes
 * against the mounted /workspace. No LLM, no pi session. Purely to confirm
 * what the agent would see.
 *
 * Usage:
 *   pnpm exec tsx tools/src/probe-vm.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  activateAgentEnv,
  ensureSnapshot,
  findMainWorktree,
  resumeVm,
  type SandboxConfig,
} from '@themoltnet/pi-extension';

const AGENT = process.env.MOLTNET_AGENT_NAME ?? 'legreffier';

const PROBES: Array<[label: string, cmd: string[]]> = [
  ['whoami', ['/bin/sh', '-lc', 'whoami && id']],
  ['pwd + mount', ['/bin/sh', '-lc', 'pwd; mount | grep workspace || true']],
  ['ls /workspace', ['/bin/sh', '-lc', 'ls -la /workspace | head -40']],
  [
    'ls /workspace/.agents',
    ['/bin/sh', '-lc', 'ls -la /workspace/.agents 2>&1 | head -20'],
  ],
  [
    'ls /workspace/.agents/skills',
    ['/bin/sh', '-lc', 'ls -la /workspace/.agents/skills 2>&1 | head -40'],
  ],
  [
    'test SKILL.md',
    [
      '/bin/sh',
      '-lc',
      'f=/workspace/.agents/skills/legreffier/SKILL.md; [ -r "$f" ] && echo READABLE || echo "NOT READABLE ($(stat "$f" 2>&1))"; ls -la "$f" 2>&1',
    ],
  ],
  [
    'find .agents depth 3',
    ['/bin/sh', '-lc', 'find /workspace/.agents -maxdepth 3 2>&1 | head -30'],
  ],
];

async function main() {
  const cwd = process.cwd();
  const sandboxConfig = JSON.parse(
    readFileSync(join(cwd, 'sandbox.json'), 'utf8'),
  ) as SandboxConfig;

  console.error(`[probe] mountPath: ${cwd}`);
  console.error(`[probe] agent: ${AGENT}`);

  const checkpointPath = await ensureSnapshot({
    config: sandboxConfig.snapshot,
    onProgress: (m) => process.stderr.write(`[snapshot] ${m}\n`),
  });

  const managed = await resumeVm({
    checkpointPath,
    agentName: AGENT,
    mountPath: cwd,
    sandboxConfig,
  });

  try {
    const mainRepo = findMainWorktree();
    activateAgentEnv(managed.credentials.agentEnv, mainRepo);

    for (const [label, cmd] of PROBES) {
      console.log(`\n=== ${label} ===`);
      const r = await managed.vm.exec(cmd);
      process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(`[stderr] ${r.stderr}`);
      console.log(`[exit ${r.exitCode}]`);
    }

    // Host-side sanity: does the file exist at mountPath/.agents/... ?
    const hostCheck = execFileSync(
      '/bin/sh',
      ['-lc', `ls -la "${cwd}/.agents/skills/legreffier/SKILL.md" || echo NO`],
      { encoding: 'utf8' },
    );
    console.log(`\n=== host-side sanity ===\n${hostCheck}`);
  } finally {
    await managed.vm.close();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
