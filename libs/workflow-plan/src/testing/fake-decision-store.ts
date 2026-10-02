/**
 * FAKE — in-memory decision store. In an application this is a table written
 * by an authenticated reviewer UI/CLI; the executor only reads it.
 */
import type {
  DecisionOption,
  DecisionRecord,
  DecisionStore,
  OutputRevision,
} from '../executor/types.js';

export class FakeDecisionStore implements DecisionStore {
  readonly records: DecisionRecord[] = [];
  readonly reads: Array<{
    gate: string;
    reviewed: OutputRevision;
    found: boolean;
  }> = [];
  /** Script: decide automatically when a gate asks for revision N (1-based). */
  private readonly scripts = new Map<
    string,
    (reviewed: OutputRevision, askN: number) => DecisionOption | null
  >();
  private readonly asks = new Map<string, number>();

  record(record: DecisionRecord): void {
    this.records.push(record);
  }

  /** Register an automatic decider for a gate (simulates a person answering). */
  script(
    gate: string,
    decide: (reviewed: OutputRevision, askN: number) => DecisionOption | null,
  ): void {
    this.scripts.set(gate, decide);
  }

  find(args: {
    planId: string;
    gate: string;
    reviewed: OutputRevision;
  }): Promise<DecisionRecord | null> {
    const match = (r: DecisionRecord) =>
      r.planId === args.planId &&
      r.gate === args.gate &&
      r.reviewed.node === args.reviewed.node &&
      r.reviewed.taskId === args.reviewed.taskId &&
      r.reviewed.attemptN === args.reviewed.attemptN &&
      r.reviewed.outputCid === args.reviewed.outputCid;
    let found = this.records.find(match) ?? null;
    if (!found) {
      const script = this.scripts.get(args.gate);
      if (script) {
        const key = `${args.gate}:${args.reviewed.taskId}:${args.reviewed.attemptN}`;
        const askN = (this.asks.get(key) ?? 0) + 1;
        this.asks.set(key, askN);
        const option = script(args.reviewed, askN);
        if (option) {
          found = {
            planId: args.planId,
            planRevision: 1,
            gate: args.gate,
            reviewed: args.reviewed,
            option,
            decidedBy: 'scripted-reviewer',
            decidedAt: new Date().toISOString(),
            note: `scripted decision #${askN}`,
          };
          this.records.push(found);
        }
      }
    }
    this.reads.push({
      gate: args.gate,
      reviewed: args.reviewed,
      found: found !== null,
    });
    return Promise.resolve(found);
  }
}
