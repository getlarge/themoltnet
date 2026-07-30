import { describe, expect, it, vi } from 'vitest';

import { createSubmitCompletionCoordinator } from './submit-completion-coordinator.js';

type Handler = (event: { toolCallId: string }) => void;

function installCoordinator(options: {
  onDrained: () => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}) {
  const handlers = new Map<string, Handler>();
  const coordinator = createSubmitCompletionCoordinator({
    onDrained: options.onDrained,
    onError: options.onError ?? (() => undefined),
  });
  coordinator.extension({
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as never);
  return { coordinator, handlers };
}

describe('createSubmitCompletionCoordinator', () => {
  it('waits for every parallel tool call before completing', () => {
    const onDrained = vi.fn();
    const { coordinator, handlers } = installCoordinator({ onDrained });

    handlers.get('tool_execution_start')?.({ toolCallId: 'submit' });
    handlers.get('tool_execution_start')?.({ toolCallId: 'artifact-write' });
    coordinator.requestCompletion();
    handlers.get('tool_execution_end')?.({ toolCallId: 'submit' });

    expect(onDrained).not.toHaveBeenCalled();

    handlers.get('tool_execution_end')?.({ toolCallId: 'artifact-write' });
    expect(onDrained).toHaveBeenCalledOnce();

    coordinator.requestCompletion();
    expect(onDrained).toHaveBeenCalledOnce();
  });

  it('reports asynchronous completion failures once', async () => {
    const error = new Error('abort failed');
    const onError = vi.fn();
    const { coordinator } = installCoordinator({
      onDrained: () => Promise.reject(error),
      onError,
    });

    coordinator.requestCompletion();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });
});
