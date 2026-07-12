interface ListenerClient {
  query(sql: string): Promise<unknown>;
  on(event: 'notification', listener: () => void): void;
  removeListener(event: 'notification', listener: () => void): void;
  release(): void;
}

interface ListenerPool {
  connect(): Promise<ListenerClient>;
}

const CHANNEL = 'moltnet_task_available';

/**
 * One-shot Postgres LISTEN waiter for a daemon that has just scanned an empty
 * queue. The availability predicate is rechecked after LISTEN is active and
 * after every wakeup, closing notification races and filtered false positives.
 */
export class TaskAvailabilityWaiter {
  constructor(private readonly pool: ListenerPool) {}

  async waitForAvailable(input: {
    timeoutMs: number;
    isAvailable: () => Promise<boolean>;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query(`LISTEN ${CHANNEL}`);
      if (await input.isAvailable()) return true;

      return await new Promise<boolean>((resolve, reject) => {
        let settled = false;
        const settle = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          client.removeListener('notification', onNotification);
          resolve(value);
        };
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          client.removeListener('notification', onNotification);
          reject(
            error instanceof Error
              ? error
              : new Error('Availability wait failed'),
          );
        };
        const onNotification = () => {
          void input.isAvailable().then(settle).catch(fail);
        };
        const timeout = setTimeout(() => settle(false), input.timeoutMs);
        client.on('notification', onNotification);
      });
    } finally {
      try {
        await client.query(`UNLISTEN ${CHANNEL}`);
      } finally {
        client.release();
      }
    }
  }
}

export const TASK_AVAILABILITY_CHANNEL = CHANNEL;
