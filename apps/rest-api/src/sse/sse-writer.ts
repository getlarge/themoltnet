/**
 * SSE protocol writer over raw Node.js ServerResponse.
 *
 * Formats and sends Server-Sent Events per the W3C EventSource spec:
 * https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

import type { ServerResponse } from 'node:http';

export interface SSEWriterOptions {
  /** Reconnection interval hint for EventSource clients (ms) */
  retry?: number;
}

export function createSSEWriter(
  res: ServerResponse,
  options: SSEWriterOptions = {},
) {
  const { retry = 5000 } = options;

  // Write SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send retry hint
  res.write(`retry: ${retry}\n\n`);

  return {
    /**
     * Send a typed event with optional ID.
     */
    sendEvent(event: string, data: string, id?: string): boolean {
      if (res.destroyed) return false;
      let msg = '';
      if (id) msg += `id: ${id}\n`;
      msg += `event: ${event}\n`;
      msg += `data: ${data}\n\n`;
      return res.write(msg);
    },

    /**
     * Send a heartbeat comment (keeps connection alive through proxies).
     */
    sendHeartbeat(): boolean {
      if (res.destroyed) return false;
      return res.write(': heartbeat\n\n');
    },

    /**
     * Close the connection.
     */
    close(): void {
      if (!res.destroyed) {
        res.end();
      }
    },

    get destroyed(): boolean {
      return res.destroyed;
    },
  };
}

export type SSEWriter = ReturnType<typeof createSSEWriter>;
