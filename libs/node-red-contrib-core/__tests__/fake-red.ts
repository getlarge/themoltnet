import { EventEmitter } from 'node:events';

import type { NodeInitializer } from 'node-red';

/**
 * Minimal in-memory Node-RED runtime for **unit** testing node logic.
 *
 * node-red-node-test-helper is the tool for full-runtime *integration* tests,
 * but it resolves Node-RED's internal submodules through npm's flat layout and
 * breaks under pnpm's symlinked store. For unit tests we only need the slice of
 * the `RED` API our nodes touch, so we implement it here and drive the real node
 * constructors directly. No network, no SDK, no Node-RED install.
 *
 * The harness models enough real behavior to make assertions meaningful:
 * per-node status/error capture, a `this.send` that flows to the same sink as
 * the input-handler `send`, and an `httpAdmin` stub that records routes.
 */

export interface FakeNode {
  id: string;
  on: EventEmitter['on'];
  emit: EventEmitter['emit'];
  status: (s?: Record<string, unknown>) => void;
  error: (e: unknown, msg?: unknown) => void;
  send: (m: unknown) => void;
  credentials: Record<string, unknown>;
  /** Per-node captures (assert a *specific* node's behavior). */
  statuses: Record<string, unknown>[];
  errors: { error: unknown; msg?: unknown }[];
  sent: unknown[];
  [key: string]: unknown;
}

interface AdminRoute {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  /** True when wrapped in a RED.auth.needsPermission middleware. */
  guarded: boolean;
}

type NodeConstructor = (this: FakeNode, def: Record<string, unknown>) => void;
type Handler = (...args: unknown[]) => unknown;

export class FakeRed {
  private readonly types = new Map<string, NodeConstructor>();
  private readonly instances = new Map<string, FakeNode>();
  /** All `node.status(...)` calls across nodes (back-compat global view). */
  readonly statuses: Record<string, unknown>[] = [];
  /** Admin routes registered via `RED.httpAdmin.*`. */
  readonly adminRoutes: AdminRoute[] = [];

  readonly nodes = {
    registerType: (type: string, ctor: NodeConstructor): void => {
      this.types.set(type, ctor);
    },
    createNode: (node: FakeNode): void => {
      const ee = new EventEmitter();
      node.on = ee.on.bind(ee) as EventEmitter['on'];
      node.emit = ee.emit.bind(ee) as EventEmitter['emit'];
      node.statuses ??= [];
      node.errors ??= [];
      node.sent ??= [];
      node.status = (s?: Record<string, unknown>): void => {
        if (s && Object.keys(s).length > 0) {
          node.statuses.push(s);
          this.statuses.push(s);
        }
      };
      node.error = (error: unknown, msg?: unknown): void => {
        node.errors.push({ error, msg });
      };
      // `this.send` flows to the same per-node sink the input() helper reads,
      // so nodes that emit via this.send (not just the handler arg) are seen.
      node.send = (m: unknown): void => {
        node.sent.push(m);
      };
      node.credentials ??= {};
    },
    getNode: (id: string): FakeNode | null => this.instances.get(id) ?? null,
  };

  /** `RED.util` slice. `cloneMessage` is used by multi-emit nodes. */
  readonly util = {
    cloneMessage: (msg: Record<string, unknown>): Record<string, unknown> =>
      structuredClone(msg),
  };

  /** `RED.auth` slice — needsPermission returns a marker middleware. */
  readonly auth = {
    needsPermission:
      (_permission: string) =>
      (_req: unknown, _res: unknown, next?: () => void): void => {
        // Marker so httpAdmin can record the route as guarded; pass through.
        if (next) next();
      },
  };

  /** `RED.httpAdmin` stub — records routes (path + whether guarded). */
  readonly httpAdmin = {
    get: (path: string, ...handlers: Handler[]): void =>
      this.recordRoute('get', path, handlers),
    post: (path: string, ...handlers: Handler[]): void =>
      this.recordRoute('post', path, handlers),
  };

  private recordRoute(
    method: AdminRoute['method'],
    path: string,
    handlers: Handler[],
  ): void {
    // Guarded when more than just the final handler is present (a
    // needsPermission middleware sits in front).
    this.adminRoutes.push({ method, path, guarded: handlers.length > 1 });
  }

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

  /**
   * Deliver a message to a node's `input` handler and collect outputs.
   *
   * `outputs` are the raw arguments passed to `send(...)`: a single message for
   * one-output nodes, or an array `[out1, out2, ...]` for multi-output nodes.
   * Use the helpers on the returned object to assert without manual indexing.
   */
  input(
    node: FakeNode,
    msg: Record<string, unknown>,
  ): Promise<FakeInputResult> {
    // Each entry is a raw `send(...)` arg: a single message (one-output nodes)
    // or an array `[out1, out2, ...]` (multi-output nodes). Typed loosely as
    // the single-message shape for back-compat; multi-output tests use `port()`.
    const outputs: Record<string, unknown>[] = [];
    return new Promise((resolve, reject) => {
      const send = (m: unknown): void => {
        outputs.push(m as Record<string, unknown>);
      };
      const done = (err?: Error): void => {
        if (err) return reject(err);
        resolve(new FakeInputResult(outputs, node));
      };
      node.emit('input', msg, send, done);
    });
  }
}

/** Structured view over a node's emitted outputs. */
export class FakeInputResult {
  constructor(
    /** Raw `send(...)` args, in emission order. */
    readonly outputs: Record<string, unknown>[],
    readonly node: FakeNode,
  ) {}

  /** First emit, as a single message (one-output nodes). */
  get payload(): Record<string, unknown> {
    return this.outputs[0] ?? {};
  }

  /** All messages emitted on a given 0-based output port across emits. */
  port(index: number): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const emit of this.outputs) {
      const slot = Array.isArray(emit)
        ? (emit[index] as Record<string, unknown> | null)
        : index === 0
          ? emit
          : null;
      if (slot !== null && slot !== undefined) out.push(slot);
    }
    return out;
  }
}
