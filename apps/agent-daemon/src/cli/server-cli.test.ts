import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { installSupervisedStdinGuard } from './server.js';

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
