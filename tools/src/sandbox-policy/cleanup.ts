import { sanitizeDiagnostic } from './sanitize.js';
import type { PersistentMutationEvidence } from './types.js';

interface CleanupItem {
  evidence: PersistentMutationEvidence;
  cleanup: () => Promise<void>;
}

export class CleanupManifest {
  readonly #items: CleanupItem[] = [];
  #closePromise: Promise<PersistentMutationEvidence[]> | null = null;

  add(
    kind: string,
    resource: string,
    cleanup: () => Promise<void>,
  ): PersistentMutationEvidence {
    if (this.#closePromise) {
      throw new Error('cleanup manifest is already closed');
    }
    const evidence: PersistentMutationEvidence = {
      kind,
      resource,
      cleanup: 'pending',
    };
    this.#items.push({ evidence, cleanup });
    return evidence;
  }

  snapshot(): PersistentMutationEvidence[] {
    return this.#items.map(({ evidence }) => ({ ...evidence }));
  }

  async close(): Promise<PersistentMutationEvidence[]> {
    if (!this.#closePromise) {
      this.#closePromise = (async () => {
        for (const item of [...this.#items].reverse()) {
          try {
            await item.cleanup();
            item.evidence.cleanup = 'cleaned';
            delete item.evidence.reason;
          } catch (error) {
            item.evidence.cleanup = 'residue';
            item.evidence.reason = sanitizeDiagnostic(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        return this.snapshot();
      })();
    }
    return this.#closePromise;
  }
}
