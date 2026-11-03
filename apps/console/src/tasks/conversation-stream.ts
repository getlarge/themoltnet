import {
  type Client,
  getTaskConversation,
  type GetTaskConversationResponse,
  watchTaskConversation,
} from '@moltnet/api-client';

import { abortableDelay } from '../abortable-delay.js';

export type ConversationSnapshot = GetTaskConversationResponse;

export interface WatchConversationOptions {
  client: Client;
  teamId: string;
  taskId: string;
  attemptN: number;
  conversationId: string;
  signal: AbortSignal;
  /** Called with each replacement snapshot, from the stream or from polling. */
  onSnapshot: (snapshot: ConversationSnapshot) => void;
  /** Called once when the stream fails and polling takes over. */
  onFallback?: (error: unknown) => void;
  onConnection?: (state: 'connected' | 'retrying') => void;
  /** Delay before reopening a stream the server closed normally. */
  reconnectDelayMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Normal closes in a row without a snapshot before switching to polling. */
const MAX_EMPTY_STREAMS = 3;

export function isLiveAttemptStatus(status: string | undefined): boolean {
  return status === 'claimed' || status === 'running';
}

function isSnapshot(value: unknown): value is ConversationSnapshot {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { messages?: unknown }).messages) &&
    typeof (value as { attemptStatus?: unknown }).attemptStatus === 'string'
  );
}

class ConversationReadError extends Error {
  constructor(readonly status: number) {
    super(`Conversation read failed (${status})`);
  }
}

export const isPermanentConversationError = (error: unknown) =>
  error instanceof ConversationReadError &&
  [401, 403, 404].includes(error.status);

export async function readConversation(
  options: Parameters<typeof getTaskConversation>[0],
): Promise<ConversationSnapshot> {
  const result = await getTaskConversation(options);
  if (!result.data) {
    if (result.response)
      throw new ConversationReadError(result.response.status);
    throw new Error('Conversation read failed', { cause: result.error });
  }
  return result.data;
}

/**
 * Follows a conversation until the attempt is terminal or `signal` aborts.
 *
 * The SSE endpoint sends full replacement snapshots and closes every five
 * minutes; a normal close reopens the stream, which starts with a fresh
 * snapshot. If the stream fails (HTTP error, network error, unreadable
 * frames), this switches to polling `getTaskConversation` for the rest of
 * the watch. Resolves without throwing on abort.
 */
export async function watchConversationSnapshots(
  options: WatchConversationOptions,
): Promise<void> {
  const {
    client,
    onSnapshot,
    reconnectDelayMs = 1_000,
    pollIntervalMs = 2_000,
    sleep = abortableDelay,
  } = options;
  const cancellation = new AbortController();
  const signal = AbortSignal.any([options.signal, cancellation.signal]);
  const request = {
    client,
    headers: { 'x-moltnet-team-id': options.teamId },
    path: {
      id: options.taskId,
      n: options.attemptN,
      conversationId: options.conversationId,
    },
    signal,
  };

  try {
    let emptyStreams = 0;
    let failure: unknown;
    while (!signal.aborted && failure === undefined) {
      let failed = false;
      const { stream } = await watchTaskConversation({
        ...request,
        // One attempt per connection: this loop owns reconnects, and an
        // HTTP error must fall back to polling instead of retrying forever.
        sseMaxRetryAttempts: 1,
        onSseError: (error) => {
          if (!signal.aborted) {
            failed = true;
            failure = error;
          }
        },
      });
      let received = false;
      for await (const data of stream as AsyncIterable<unknown>) {
        if (!isSnapshot(data)) continue;
        received = true;
        options.onConnection?.('connected');
        onSnapshot(data);
        if (!isLiveAttemptStatus(data.attemptStatus)) return;
      }
      if (signal.aborted || failed) break;
      emptyStreams = received ? 0 : emptyStreams + 1;
      if (emptyStreams >= MAX_EMPTY_STREAMS) {
        failure = new Error('Conversation stream closed without a snapshot');
        break;
      }
      await sleep(reconnectDelayMs, signal);
    }
    if (signal.aborted) return;

    options.onFallback?.(failure);
    options.onConnection?.('retrying');
    let failures = 0;
    while (!signal.aborted) {
      try {
        const data = await readConversation(request);
        options.onConnection?.('connected');
        onSnapshot(data);
        failures = 0;
        if (!isLiveAttemptStatus(data.attemptStatus)) return;
      } catch (error) {
        if (signal.aborted || isPermanentConversationError(error)) throw error;
        failures++;
        options.onConnection?.('retrying');
      }
      await sleep(
        Math.min(
          pollIntervalMs * 2 ** Math.min(Math.max(failures - 1, 0), 4),
          30_000,
        ),
        signal,
      );
    }
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  } finally {
    cancellation.abort();
  }
}
