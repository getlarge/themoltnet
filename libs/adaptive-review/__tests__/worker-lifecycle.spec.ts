import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { stopProcessGroup } from '../src/process-group.js';
import type { StandaloneReviewInput } from '../src/standalone.js';
import { withReviewWorkers } from '../src/supervisor.js';

const input = {
  correlationId: 'review-fixture',
  teamId: 'team',
  profiles: { classifier: 'classifier' },
} as StandaloneReviewInput;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'review-life-'));
  dirs.push(dir);
  const binary = join(dir, 'worker.cjs');
  writeFileSync(binary, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  chmodSync(binary, 0o700);
  return { dir, binary };
}
async function waitUntil(check: () => boolean, timeout = 15_000) {
  const until = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > until) throw new Error('Lifecycle condition timed out');
    await setTimeout(20);
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    })
      .trim()
      .startsWith('Z');
  } catch {
    return true;
  } // Inability to inspect a process is not proof it exited.
}

function waiting(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('stopped')), {
      once: true,
    });
  });
}

it('passes the stripped environment to actual worker processes', async () => {
  const f = fixture(
    "require('node:fs').writeFileSync(process.env.ENV_FILE,JSON.stringify(process.env)); setInterval(()=>{},1000);",
  );
  const file = join(f.dir, 'env.json');
  await withReviewWorkers({
    input,
    cwd: f.dir,
    binary: f.binary,
    agent: 'fixture',
    env: {
      ...process.env,
      ENV_FILE: file,
      GH_TOKEN: 'dummy-token',
      GITHUB_TOKEN: 'dummy-token',
      MOLTNET_GITHUB_APP_PRIVATE_KEY: 'dummy-key',
      ADAPTIVE_GITHUB_APP_ID: 'dummy-app',
      ADAPTIVE_DATABASE_URL: 'dummy-db',
      MOLTNET_AGENT_KEY: 'dummy-agent',
    },
    run: async (_signal, start) => {
      await start();
      await waitUntil(() => {
        try {
          readFileSync(file);
          return true;
        } catch {
          return false;
        }
      });
      const env = JSON.parse(readFileSync(file, 'utf8')) as NodeJS.ProcessEnv;
      for (const name of [
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'MOLTNET_GITHUB_APP_PRIVATE_KEY',
        'ADAPTIVE_GITHUB_APP_ID',
        'ADAPTIVE_DATABASE_URL',
      ])
        expect(env[name]).toBeUndefined();
      expect(env.MOLTNET_AGENT_KEY).toBe('dummy-agent');
    },
  });
});
it.each(['missing', 'crash'])(
  'fails the host and aborts the coordinator after worker %s',
  async (kind) => {
    const f = fixture('process.exit(23)');
    await expect(
      withReviewWorkers({
        input,
        cwd: f.dir,
        binary: kind === 'missing' ? join(f.dir, 'missing') : f.binary,
        agent: 'fixture',
        env: process.env,
        run: async (signal, start) => {
          await start();
          return waiting(signal);
        },
      }),
    ).rejects.toThrow(/classifier#1 pid=/);
  },
);
it('stops workers before a slow coordinator drain completes', async () => {
  const f = fixture(
    "require('node:fs').writeFileSync(process.env.PID_FILE,String(process.pid));setInterval(()=>{},1000);",
  );
  const pidFile = join(f.dir, 'pid');
  const controller = new AbortController();
  let drain: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    drain = resolve;
  });
  const result = withReviewWorkers({
    input,
    cwd: f.dir,
    binary: f.binary,
    agent: 'fixture',
    env: { ...process.env, PID_FILE: pidFile },
    signal: controller.signal,
    run: async (signal, start) => {
      await start();
      await waiting(signal).catch(() => gate);
    },
  });
  const expected = expect(result).rejects.toThrow('host interrupted');
  await waitUntil(() => {
    try {
      readFileSync(pidFile);
      return true;
    } catch {
      return false;
    }
  });
  const pid = Number(readFileSync(pidFile, 'utf8'));
  controller.abort();
  try {
    await waitUntil(() => !alive(pid));
  } finally {
    drain();
  }
  await expected;
});

describe.skipIf(process.platform === 'win32')('process group ownership', () => {
  it('escalates a remaining descendant after the leader exits', async () => {
    const f = fixture(
      "const fs=require('node:fs'); const cp=require('node:child_process'); const c=cp.spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.env.READY_FILE,'ready');setInterval(()=>{},1000)\"],{stdio:'ignore'});fs.writeFileSync(process.env.PID_FILE,String(c.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);",
    );
    const pidFile = join(f.dir, 'pid');
    const readyFile = join(f.dir, 'ready');
    const child = spawn(f.binary, [], {
      detached: true,
      env: { ...process.env, PID_FILE: pidFile, READY_FILE: readyFile },
      stdio: 'ignore',
    });
    await waitUntil(() => {
      try {
        readFileSync(pidFile);
        return true;
      } catch {
        return false;
      }
    });
    const descendant = Number(readFileSync(pidFile, 'utf8'));
    await waitUntil(() => {
      try {
        readFileSync(readyFile);
        return true;
      } catch {
        return false;
      }
    });
    try {
      await stopProcessGroup(child.pid!, 150);
      await waitUntil(() => !alive(descendant));
    } finally {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* Exited. */
      }
    }
  });
  it('cleans worker groups when their host is SIGKILLed', async () => {
    const f = fixture(
      "require('node:fs').writeFileSync(process.env.PID_FILE,String(process.pid));setInterval(()=>{},1000);",
    );
    const pidFile = join(f.dir, 'pid');
    const loader = createRequire(import.meta.url).resolve('tsx');
    const host = spawn(
      process.execPath,
      [
        '--import',
        loader,
        fileURLToPath(
          new URL('./fixtures/supervisor-host.ts', import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          REVIEW_INPUT: JSON.stringify(input),
          TEST_BINARY: f.binary,
          PID_FILE: pidFile,
        },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    await once(host, 'message');
    await waitUntil(() => {
      try {
        readFileSync(pidFile);
        return true;
      } catch {
        return false;
      }
    });
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const exited = once(host, 'exit');
    host.kill('SIGKILL');
    await exited;
    try {
      await waitUntil(() => !alive(pid));
    } finally {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* Exited. */
      }
    }
  });
});
