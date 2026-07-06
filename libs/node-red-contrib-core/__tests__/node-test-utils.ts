import type { NodeInitializer } from 'node-red';

import type { FakeNode, FakeRed } from './fake-red.js';

/**
 * Stub `moltnet-agent` config node: registers the type the real nodes
 * reference, but `getAgent()` returns an in-memory fake. This keeps the unit
 * tests free of network and the SDK — the SDK lives only in the real agent
 * node, which these tests intentionally replace.
 */
export function agentStub(agent: unknown): NodeInitializer {
  return ((RED: FakeRed) => {
    RED.nodes.registerType('moltnet-agent', function (this: FakeNode) {
      RED.nodes.createNode(this);
      this.getAgent = () => Promise.resolve(agent);
    });
  }) as unknown as NodeInitializer;
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
