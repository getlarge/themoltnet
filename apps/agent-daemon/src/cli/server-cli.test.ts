import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { AgentServerLockError } from '../lib/agent-server/lock.js';
import {
  agentServerLockExitCode,
  installSupervisedStdinGuard,
  nativeSocketValidationOptions,
  validateNativeSocketOptions,
} from './server.js';

class FakeStdin extends EventEmitter {
  readableEnded = false;
  resumed = false;

  resume(): this {
    this.resumed = true;
    return this;
  }
}

describe('installSupervisedStdinGuard', () => {
  it('routes supervised stdin EOF through the supplied shutdown path', () => {
    const input = new FakeStdin();
    const shutdown = vi.fn();

    const guard = installSupervisedStdinGuard({
      enabled: true,
      shutdown,
      input,
    });
    input.emit('end');

    expect(input.resumed).toBe(true);
    expect(shutdown).toHaveBeenCalledOnce();
    guard.dispose();
  });

  it('does not observe stdin during an ordinary interactive server run', () => {
    const input = new FakeStdin();
    const shutdown = vi.fn();

    installSupervisedStdinGuard({
      enabled: false,
      shutdown,
      input,
    });
    input.emit('end');

    expect(input.resumed).toBe(false);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('queues shutdown when stdin already ended during initialization', async () => {
    const input = new FakeStdin();
    input.readableEnded = true;
    const shutdown = vi.fn();

    installSupervisedStdinGuard({
      enabled: true,
      shutdown,
      input,
    });
    await Promise.resolve();

    expect(input.resumed).toBe(true);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});

describe('native socket CLI configuration', () => {
  it('requires supervised mode', () => {
    expect(
      validateNativeSocketOptions({ nativeSocket: '/tmp/control.sock' }),
    ).toBe('--native-socket requires --supervised');
  });

  it.each([
    { port: '17374' },
    { allowedOrigins: 'https://console.themolt.net' },
  ])('rejects TCP configuration: %o', (tcp) => {
    expect(
      validateNativeSocketOptions({
        nativeSocket: '/tmp/control.sock',
        supervised: true,
        ...tcp,
      }),
    ).toBe('--native-socket cannot be combined with TCP options');
  });

  it('accepts a supervised socket without TCP configuration', () => {
    expect(
      validateNativeSocketOptions({
        nativeSocket: '/tmp/control.sock',
        supervised: true,
      }),
    ).toBeUndefined();
  });

  it('ignores inherited standalone TCP environment configuration', () => {
    const options = nativeSocketValidationOptions({
      nativeSocket: '/tmp/control.sock',
      supervised: true,
      envPort: '17374',
      envAllowedOrigins: 'https://console.themolt.net',
    });

    expect(options).toEqual({
      nativeSocket: '/tmp/control.sock',
      supervised: true,
    });
    expect(validateNativeSocketOptions(options)).toBeUndefined();
  });
});

describe('Agent Server lock exit status', () => {
  it('gives lock contention a stable process classification', () => {
    expect(
      agentServerLockExitCode(
        new AgentServerLockError('held', 'already running'),
      ),
    ).toBe(75);
    expect(
      agentServerLockExitCode(
        new AgentServerLockError('failed', 'lock storage failed'),
      ),
    ).toBe(1);
  });
});
