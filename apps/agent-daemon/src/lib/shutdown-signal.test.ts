import { describe, expect, it, vi } from 'vitest';

import {
  installShutdownSignalHandlers,
  signalExitCode,
} from './shutdown-signal.js';

interface FakeProcess {
  exitCode?: string | number | null;
  writes: string[];
  listeners: Map<string, () => void>;
  stderr: { write: (message: string) => void };
  on: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => void;
  off: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => void;
}

function makeFakeProcess(): FakeProcess {
  const proc = {
    exitCode: undefined,
    writes: [] as string[],
    listeners: new Map<string, () => void>(),
    stderr: {
      write(message: string) {
        proc.writes.push(message);
      },
    },
    on(event: 'SIGINT' | 'SIGTERM', listener: () => void) {
      proc.listeners.set(event, listener);
    },
    off(event: 'SIGINT' | 'SIGTERM', listener: () => void) {
      if (proc.listeners.get(event) === listener) {
        proc.listeners.delete(event);
      }
    },
  };
  return proc;
}

describe('shutdown-signal', () => {
  it('maps signal exit codes', () => {
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
  });

  it('logs and drains on the first signal', () => {
    const proc = makeFakeProcess();
    const logDrain = vi.fn();
    const drain = vi.fn();

    installShutdownSignalHandlers({ logDrain, drain, proc });
    proc.listeners.get('SIGINT')?.();

    expect(proc.exitCode).toBe(130);
    expect(logDrain).toHaveBeenCalledWith('SIGINT');
    expect(drain).toHaveBeenCalledWith('SIGINT');
    expect(proc.writes).toEqual([]);
  });

  it('keeps draining on a repeated signal', () => {
    const proc = makeFakeProcess();
    installShutdownSignalHandlers({
      logDrain: vi.fn(),
      drain: vi.fn(),
      proc,
    });

    proc.listeners.get('SIGTERM')?.();

    proc.listeners.get('SIGINT')?.();

    expect(proc.exitCode).toBe(130);
    expect(proc.writes).toEqual([
      '[agent-daemon] SIGINT received while already draining from SIGTERM; waiting for cleanup.\n',
    ]);
  });

  it('falls back to stderr when drain logging throws', () => {
    const proc = makeFakeProcess();
    installShutdownSignalHandlers({
      logDrain: () => {
        throw new Error('worker exited');
      },
      drain: vi.fn(),
      proc,
    });

    proc.listeners.get('SIGTERM')?.();

    expect(proc.exitCode).toBe(143);
    expect(proc.writes).toEqual([
      '[agent-daemon] failed to log SIGTERM: worker exited\n',
    ]);
  });

  it('unregisters installed handlers', () => {
    const proc = makeFakeProcess();
    const handlers = installShutdownSignalHandlers({
      logDrain: vi.fn(),
      drain: vi.fn(),
      proc,
    });

    handlers.dispose();

    expect(proc.listeners.size).toBe(0);
  });
});
