import { createHash, randomUUID } from 'node:crypto';

import type { Context } from '@earendil-works/chord';
import {
  type Id,
  MemoryStorage,
  type Seq,
  type StorageWrite,
} from '@earendil-works/pi-durable';

export interface RuntimeCommit {
  seq: number;
  commitId: string;
  sha256: string;
  writes: readonly StorageWrite[];
}

/** Transport owns authentication, writer renewal, and cancellation. */
export interface DurableStoreTransport {
  read(
    this: void,
    afterSeq: number,
    context: Context,
  ): Promise<{
    headSeq: number;
    items: Iterable<RuntimeCommit> | AsyncIterable<RuntimeCommit>;
  }>;
  append(
    this: void,
    input: {
      commitId: string;
      expectedSeq: number;
      writes: readonly StorageWrite[];
    },
    context: Context,
  ): Promise<{ seq: number }>;
  mintId(this: void): Promise<number>;
  close(this: void, context: Context): Promise<void>;
  onUncertainCommit(this: void, error: unknown): void;
}

function digest(writes: readonly StorageWrite[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ format: 'pi-durable.v1', writes }))
    .digest('hex');
}

/**
 * Experimental log-backed storage. Remote commits are authoritative; the memory
 * index is rebuilt on open. Measure replay time/memory before production use.
 */
export class ApiDurableStorage extends MemoryStorage {
  private head = 0;
  private poisoned = false;
  private released = false;

  private constructor(private readonly transport: DurableStoreTransport) {
    super();
  }

  static async open(
    transport: DurableStoreTransport,
    context: Context,
  ): Promise<ApiDurableStorage> {
    const storage = new ApiDurableStorage(transport);
    try {
      for (;;) {
        const page = await transport.read(storage.head, context);
        const previousHead = storage.head;
        for await (const commit of page.items) {
          if (
            commit.seq !== storage.head + 1 ||
            digest(commit.writes) !== commit.sha256
          )
            throw new Error('Corrupt runtime commit log');
          storage.prepareCommit(commit.writes, commit.seq as Seq).apply();
          storage.head = commit.seq;
        }
        if (storage.head === page.headSeq) return storage;
        if (storage.head === previousHead || storage.head > page.headSeq)
          throw new Error('Incomplete runtime commit log');
      }
    } catch (error) {
      await storage.close(context).catch(() => undefined);
      throw error;
    }
  }

  override async mintId<I extends Id<string>>(): Promise<I> {
    this.assertWritable();
    const id = await this.transport.mintId();
    if (!Number.isSafeInteger(id) || id < 2)
      throw new Error('Invalid runtime store ID');
    return id as I;
  }

  override async commit(
    writes: readonly StorageWrite[],
    context: Context,
  ): Promise<Seq> {
    this.assertWritable();
    // Invalid commits never reach the remote log or poison the store.
    const prepared = this.prepareCommit(writes);
    const request = {
      commitId: randomUUID(),
      expectedSeq: this.head,
      writes: prepared.writes,
    };
    try {
      let seq: number;
      try {
        ({ seq } = await this.transport.append(request, context));
      } catch (error) {
        // A dropped acknowledgment may follow a successful commit. Inspect the
        // immutable log before deciding whether this process can continue.
        const page = await this.transport.read(this.head, context);
        let committed: RuntimeCommit | undefined;
        for await (const entry of page.items) {
          if (entry.commitId === request.commitId) committed = entry;
        }
        if (!committed || committed.sha256 !== digest(prepared.writes))
          throw error;
        seq = committed.seq;
      }
      if (seq !== prepared.seq)
        throw new Error('Runtime commit sequence mismatch');
      prepared.apply();
      this.head = seq;
      return seq as Seq;
    } catch (error) {
      this.poisoned = true;
      this.transport.onUncertainCommit(error);
      throw error;
    }
  }

  override async close(context: Context): Promise<void> {
    if (this.released) return;
    this.released = true;
    await super.close(context);
    await this.transport.close(context);
  }

  private assertWritable() {
    if (this.released) throw new Error('Runtime storage is closed');
    if (this.poisoned)
      throw new Error(
        'Runtime storage must be reopened after an uncertain commit',
      );
  }
}
