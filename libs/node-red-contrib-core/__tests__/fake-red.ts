import { EventEmitter } from 'node:events';

import type { NodeInitializer } from 'node-red';

/**
 * Minimal in-memory Node-RED runtime for **unit** testing node logic.
 *
 * node-red-node-test-helper is the tool for full-runtime *integration* tests,
 * but it resolves Node-RED's internal submodules through npm's flat layout and
 * breaks under pnpm's symlinked store. For unit tests we only need the tiny
 * slice of the `RED` API our nodes touch (`registerType`, `createNode`,
 * `getNode`), so we implement it here and drive the real node constructors
 * directly. No network, no SDK, no Node-RED install.
 */

export interface FakeNode {
  id: string;
  on: EventEmitter['on'];
  emit: EventEmitter['emit'];
  status: (s?: Record<string, unknown>) => void;
  error: (e: unknown) => void;
  send: (m: unknown) => void;
  credentials: Record<string, unknown>;
  [key: string]: unknown;
}

type NodeConstructor = (this: FakeNode, def: Record<string, unknown>) => void;

export class FakeRed {
  private readonly types = new Map<string, NodeConstructor>();
  private readonly instances = new Map<string, FakeNode>();
  /** Captured `node.status(...)` calls, for asserting visual state. */
  readonly statuses: Record<string, unknown>[] = [];

  readonly nodes = {
    registerType: (type: string, ctor: NodeConstructor): void => {
      this.types.set(type, ctor);
    },
    createNode: (node: FakeNode): void => {
      const ee = new EventEmitter();
      node.on = ee.on.bind(ee) as EventEmitter['on'];
      node.emit = ee.emit.bind(ee) as EventEmitter['emit'];
      node.status = (s?: Record<string, unknown>): void => {
        if (s && Object.keys(s).length > 0) this.statuses.push(s);
      };
      node.error = (): void => {};
      node.send = (): void => {};
      node.credentials ??= {};
    },
    getNode: (id: string): FakeNode | null => this.instances.get(id) ?? null,
  };

  /** Minimal `RED.util` slice. `cloneMessage` is used by multi-emit nodes. */
  readonly util = {
    cloneMessage: (msg: Record<string, unknown>): Record<string, unknown> =>
      structuredClone(msg),
  };

  /** Run a node's initializer to register its type(s). */
  load(init: NodeInitializer): void {
    (init as unknown as (RED: FakeRed) => void)(this);
  }

  /** Instantiate a registered node type with a config def. */
  create(
    type: string,
    id: string,
    def: Record<string, unknown> = {},
  ): FakeNode {
    const ctor = this.types.get(type);
    if (!ctor) throw new Error(`type not registered: ${type}`);
    const node = { id, credentials: {}, ...def } as FakeNode;
    ctor.call(node, def);
    this.instances.set(id, node);
    return node;
  }

  /** Deliver a message to a node's `input` handler and collect outputs. */
  input(
    node: FakeNode,
    msg: Record<string, unknown>,
  ): Promise<{ outputs: Record<string, unknown>[] }> {
    const outputs: Record<string, unknown>[] = [];
    return new Promise((resolve, reject) => {
      const send = (m: unknown): void => {
        outputs.push(m as Record<string, unknown>);
      };
      const done = (err?: Error): void =>
        err ? reject(err) : resolve({ outputs });
      node.emit('input', msg, send, done);
    });
  }
}
