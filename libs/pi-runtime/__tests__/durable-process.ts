import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import type { ClaimedTask } from '@themoltnet/agent-runtime';

import { createDurableTaskExecutor } from '../src/durable-executor.js';
import {
  ApiDurableStorage,
  type DurableStoreTransport,
} from '../src/durable-storage.js';

// IPC is only the test transport. The log is owned by the parent process, so
// SIGKILL destroys every local runtime object without destroying committed state.
let next = 0;
const pending = new Map<number, (value: unknown) => void>();
process.on('message', (message: { id: number; value: unknown }) => {
  pending.get(message.id)?.(message.value);
  pending.delete(message.id);
});
function call<T>(method: string, input?: unknown): Promise<T> {
  const id = ++next;
  return new Promise((resolve) => {
    pending.set(id, (value) => resolve(value as T));
    process.send!({ id, method, input });
  });
}
const transport: DurableStoreTransport = {
  read: (afterSeq) => call('read', afterSeq),
  append: (input) => call('append', input),
  mintId: () => call('mintId'),
  close: () => Promise.resolve(),
  onUncertainCommit: (cause) => {
    throw cause;
  },
};
const faux = fauxProvider({ tokensPerSecond: 0 });
faux.setResponses([
  fauxAssistantMessage(
    fauxToolCall('submit_freeform_output', {
      summary: 'Persisted before process death',
    }),
    { stopReason: 'toolUse' },
  ),
]);
const models = createModels();
models.setProvider(faux.provider);
let preparations = 0;
const execute = createDurableTaskExecutor({
  models,
  model: { provider: faux.provider.id, modelId: faux.models[0].id },
  open: async (_task, signal) => ({
    storage: await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT),
    signal,
    check: () => signal.throwIfAborted(),
    prepare: () => {
      preparations++;
      return Promise.resolve({
        authorizeTool: () => Promise.resolve('blocked'),
        close: () => Promise.resolve(),
      });
    },
  }),
});
const task = {
  task: {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    teamId: 'team',
    taskType: 'freeform',
    input: { brief: 'Do it' },
    inputCid: 'bafy-input',
  },
  attemptN: 1,
  traceHeaders: {},
} as unknown as ClaimedTask;
const result = await execute(task, {
  open: () => Promise.resolve(),
  record: () => Promise.resolve(),
  close: () => Promise.resolve(),
  finalize: () => {
    if (process.argv[2] !== 'crash') return Promise.resolve();
    process.send!({ event: 'persisted' });
    return new Promise<void>(() => {
      /* Parent kills us before reporting completion. */
    });
  },
  cancelSignal: new AbortController().signal,
  cancelReason: null,
});
process.send!(
  { event: 'result', result, preparations, modelCalls: faux.state.callCount },
  () => process.disconnect(),
);
