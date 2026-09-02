import { Button, Stack, Text } from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { abortableDelay } from '../abortable-delay.js';
import type { LocalRuntimeController } from './useLocalRuntime.js';

const MAX_LOG_LINES = 500;
const MAX_LOG_BYTES = 512 * 1024;
const LOG_FLUSH_INTERVAL_MS = 50;
const MAX_RECONNECT_ATTEMPTS = 4;
const textEncoder = new TextEncoder();

interface LogBuffer {
  bytes: number;
  lines: string[];
}

export function RunLogTail({
  runtime,
  runId,
}: {
  runtime: LocalRuntimeController;
  runId: string;
}) {
  const streamLogs = runtime.streamLogs;
  const [buffer, setBuffer] = useState<LogBuffer>({ bytes: 0, lines: [] });
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setBuffer({ bytes: 0, lines: [] });
    setError(null);
    const controller = new AbortController();
    const pending: string[] = [];
    let flushTimer: number | undefined;
    const flush = () => {
      flushTimer = undefined;
      if (pending.length === 0) return;
      const batch = pending.splice(0);
      setBuffer((current) => appendLogLines(current, batch));
    };
    const onLine = (line: string) => {
      pending.push(line);
      flushTimer ??= window.setTimeout(flush, LOG_FLUSH_INTERVAL_MS);
    };
    const follow = async () => {
      for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
        setBuffer({ bytes: 0, lines: [] });
        setError(null);
        try {
          await streamLogs(runId, onLine, controller.signal);
          if (controller.signal.aborted) return;
          throw new Error('The log stream closed unexpectedly.');
        } catch (streamError) {
          if (controller.signal.aborted) return;
          flush();
          const message =
            streamError instanceof Error
              ? streamError.message
              : 'The log stream disconnected.';
          if (attempt === MAX_RECONNECT_ATTEMPTS - 1) {
            setError(message);
            return;
          }
          const delay = Math.min(1_000 * 2 ** attempt, 8_000);
          setError(`${message} Retrying in ${delay / 1_000}s…`);
          await abortableDelay(delay, controller.signal).catch(() => undefined);
        }
      }
    };
    void follow();
    return () => {
      controller.abort();
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    };
  }, [streamLogs, runId, retryKey]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [buffer]);

  return (
    <Stack gap={2}>
      {error ? (
        <Stack direction="row" gap={2} align="center" wrap>
          <div role="alert">
            <Text variant="caption" color="error">
              {error}
            </Text>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            Retry log stream
          </Button>
        </Stack>
      ) : null}
      <pre
        id={runLogPanelId(runId)}
        ref={preRef}
        aria-label={`Logs for run ${runId}`}
        style={{
          maxHeight: 320,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          padding: 12,
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
        }}
      >
        {buffer.lines.length > 0
          ? buffer.lines.map((line, index) => (
              <span key={`${index}:${line.length}`}>
                {index > 0 ? '\n' : null}
                {line}
              </span>
            ))
          : 'Waiting for output…'}
      </pre>
    </Stack>
  );
}

export function runLogPanelId(runId: string): string {
  return `run-logs-${runId}`;
}

function appendLogLines(current: LogBuffer, incoming: string[]): LogBuffer {
  const lines = [...current.lines];
  let bytes = current.bytes;
  for (const line of incoming) {
    lines.push(line);
    bytes += textEncoder.encode(line).byteLength + 1;
  }
  while (
    lines.length > 0 &&
    (lines.length > MAX_LOG_LINES || bytes > MAX_LOG_BYTES)
  ) {
    const removed = lines.shift();
    if (removed !== undefined) {
      bytes -= textEncoder.encode(removed).byteLength + 1;
    }
  }
  return { bytes: Math.max(0, bytes), lines };
}
