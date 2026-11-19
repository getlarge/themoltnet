import { createHash, randomUUID } from 'node:crypto';

import type { Context } from '@earendil-works/chord/context';
import {
  type CommitResult,
  type Id,
  MemoryStorage,
  type Seq,
  type StorageWrite,
} from '@earendil-works/pi-durable';

type PreparedCommit = ReturnType<MemoryStorage['prepareCommit']>;

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
 * Log-backed storage. Remote commits are authoritative; `open` replays the whole
 * log into the memory index, so open time and memory grow with store history.
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

  /**
   * Appends each batch as its own remote commit, in order. A batch the memory
   * index refuses ends the call with `refused`; it never reaches the remote log
   * or poisons the store. A transport failure is an unknown outcome: it poisons
   * the store and rejects, and the receipts of earlier batches still stand.
   */
  override async commit(
    batches: readonly (readonly StorageWrite[])[],
    receive: (index: number, seq: Seq) => void,
    context: Context,
  ): Promise<CommitResult> {
    this.assertWritable();
    const seqs: Seq[] = [];
    try {
      for (const writes of batches) {
        let prepared: PreparedCommit;
        try {
          prepared = this.prepareCommit(writes);
        } catch (refused) {
          return { stored: seqs.length, refused };
        }
        seqs.push(await this.append(prepared, context));
      }
      return { stored: seqs.length };
    } finally {
      for (const [index, seq] of seqs.entries()) receive(index, seq);
    }
  }

  private async append(
    prepared: PreparedCommit,
    context: Context,
  ): Promise<Seq> {
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
    try {
      await super.close(context);
    } finally {
      // Release the writer even when local teardown fails.
      await this.transport.close(context);
    }
  }

  private assertWritable() {
    if (this.released) throw new Error('Runtime storage is closed');
    if (this.poisoned)
      throw new Error(
        'Runtime storage must be reopened after an uncertain commit',
      );
  }
}
