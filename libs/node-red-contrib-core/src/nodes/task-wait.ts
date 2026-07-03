import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { withAgent } from './agent-call.js';
import { buildTaskSnapshot, isTerminalTaskStatus } from './task-snapshot.js';

/**
 * `moltnet-task-wait` — polls a MoltNet task until it settles, in one loop that
 * does double duty (the same shape the CLI's `task tail` uses):
 *
 *   - Output 1 (tail): emits each NEW task message as it arrives, advancing a
 *     monotonic `seq` cursor. Fires many times. Gated by the `tail` option so
 *     cheap waits skip the extra `listMessages` call entirely.
 *   - Output 2 (result): emits ONCE when the task reaches a terminal status,
 *     carrying the normalized `TaskSnapshot` (accepted + `state`, or failed with
 *     `error`). This is what the next lifecycle step branches on — and, on
 *     failure, what an agent/human reads to decide retry vs. escalate.
 *
 * Terminal status is checked AFTER draining each message page, so the final
 * `turn_end` / `error` messages land on the tail output before the result fires.
 */

interface TaskWaitDef extends NodeDef {
  agent?: string; // id of the referenced moltnet-agent config node
  taskId?: string;
  pollIntervalSec?: number;
  intervalMs?: number; // legacy field from older flows
  timeoutSec?: number;
  tail?: boolean;
  kinds?: string; // comma-separated message kinds to forward on the tail output
}

type AgentApi = Awaited<ReturnType<MoltnetAgentNode['getAgent']>>;
type TaskMessage = Awaited<
  ReturnType<AgentApi['tasks']['listMessages']>
>[number];

const DEFAULT_POLL_SEC = 5;
const DEFAULT_TIMEOUT_SEC = 1800; // 30 min; 0 disables the cap

const init: NodeInitializer = (RED): void => {
  function TaskWaitNode(this: Node, def: TaskWaitDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    const pollSec =
      def.pollIntervalSec ??
      (typeof def.intervalMs === 'number' ? def.intervalMs / 1000 : undefined);
    const pollMs = Math.max(1, pollSec || DEFAULT_POLL_SEC) * 1000;
    const timeoutMs =
      (def.timeoutSec ?? DEFAULT_TIMEOUT_SEC) > 0
        ? (def.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000
        : 0;
    const kindAllow = parseKinds(def.kinds);
    const active = new Map<string, string>();

    // Track timers so a redeploy/close cancels any in-flight wait.
    const pending = new Set<ReturnType<typeof setTimeout>>();
    this.on('close', () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    });

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      let taskIdForStatus: string | undefined;
      let label = describeMessage(msg);
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('task-wait: no moltnet-agent configured');
          }
          const taskId = resolveTaskId(msg, def.taskId);
          if (!taskId) {
            throw new Error('task-wait: taskId is required');
          }
          taskIdForStatus = taskId;
          label = describeWait(taskId, msg, label);
          active.set(taskId, label);
          const correlationId = resolveCorrelationId(msg);
          const startedAt = Date.now();
          // Exclusive cursor: only messages with seq > afterSeq are new.
          let afterSeq: number | undefined;
          let polls = 0;

          this.status({
            fill: 'blue',
            shape: 'dot',
            text: statusText('waiting', label, active.size),
          });

          for (;;) {
            if (def.tail) {
              afterSeq = await withAgent(agentNode, (agent) =>
                drainMessages({
                  agent,
                  taskId,
                  afterSeq,
                  kindAllow,
                  emit: (m) => {
                    // Clone the inbound msg per tail message so downstream
                    // edits don't bleed across emissions.
                    const tailMsg = RED.util.cloneMessage(msg);
                    tailMsg.payload = correlationId
                      ? { ...m, correlationId }
                      : m;
                    tailMsg.taskId = taskId;
                    if (correlationId) tailMsg.correlationId = correlationId;
                    send([tailMsg, null]);
                  },
                }),
              );
            }

            // Check terminal AFTER draining so trailing messages land first.
            const task = await withAgent(agentNode, (agent) =>
              agent.tasks.get(taskId),
            );
            if (isTerminalTaskStatus(task.status)) {
              const attempts = await withAgent(agentNode, (agent) =>
                agent.tasks.listAttempts(taskId),
              );
              const snapshot = buildTaskSnapshot(task, attempts);
              const resultMsg = RED.util.cloneMessage(msg);
              resultMsg.payload = correlationId
                ? { ...snapshot, correlationId }
                : snapshot;
              if (correlationId) resultMsg.correlationId = correlationId;
              active.delete(taskId);
              this.status({
                fill: snapshot.accepted ? 'green' : 'red',
                shape: 'dot',
                text: statusText(
                  `${snapshot.status}${snapshot.accepted ? ' ok' : ''}`,
                  label,
                  active.size,
                ),
              });
              send([null, resultMsg]);
              done();
              return;
            }

            polls += 1;
            if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
              throw new Error(
                `task-wait: timed out after ${Math.round(
                  (Date.now() - startedAt) / 1000,
                )}s (${polls} polls) waiting for task ${taskId} to settle`,
              );
            }
            this.status({
              fill: 'blue',
              shape: 'ring',
              text: statusText(`${task.status} ${polls}x`, label, active.size),
            });
            await sleep(pollMs, pending);
          }
        } catch (err) {
          if (taskIdForStatus) active.delete(taskIdForStatus);
          this.status({
            fill: 'red',
            shape: 'ring',
            text: statusText('error', label, active.size),
          });
          done(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void run();
    });
  }

  RED.nodes.registerType('moltnet-task-wait', TaskWaitNode);
};

/**
 * Fetch the latest attempt's new messages and emit the allowed ones. Returns
 * the advanced cursor. The cursor advances for EVERY message seen (even ones the
 * kind filter drops), otherwise a fully-filtered page would re-fetch forever.
 */
async function drainMessages(args: {
  agent: AgentApi;
  taskId: string;
  afterSeq: number | undefined;
  kindAllow: Set<string> | null;
  emit: (m: TaskMessage) => void;
}): Promise<number | undefined> {
  const { agent, taskId, kindAllow, emit } = args;
  let afterSeq = args.afterSeq;
  const attempts = await agent.tasks.listAttempts(taskId);
  if (attempts.length === 0) return afterSeq; // not claimed yet
  const latest = attempts.reduce((max, a) =>
    a.attemptN > max.attemptN ? a : max,
  );

  // Drain in pages: a single poll may have produced more than one page of new
  // messages. Keep fetching until a page comes back short of `limit`, advancing
  // the cursor across pages, so nothing is dropped regardless of how many
  // messages arrived since the last poll.
  const limit = 100;
  for (;;) {
    const messages = await agent.tasks.listMessages(taskId, latest.attemptN, {
      afterSeq,
      limit,
    });
    for (const m of messages) {
      if (afterSeq === undefined || m.seq > afterSeq) afterSeq = m.seq;
      if (kindAllow && !kindAllow.has(m.kind)) continue;
      emit(m);
    }
    if (messages.length < limit) break;
  }
  return afterSeq;
}

function parseKinds(raw: string | undefined): Set<string> | null {
  if (!raw || !raw.trim()) return null; // null = forward all kinds
  const kinds = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return kinds.length > 0 ? new Set(kinds) : null;
}

function resolveTaskId(
  msg: NodeMessageInFlow,
  configured: string | undefined,
): string | undefined {
  if (typeof msg.taskId === 'string' && msg.taskId) return msg.taskId;
  const payload = msg.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as { taskId?: unknown; id?: unknown };
    if (typeof p.taskId === 'string' && p.taskId) return p.taskId;
    if (typeof p.id === 'string' && p.id) return p.id;
  }
  return configured && configured.length > 0 ? configured : undefined;
}

function resolveCorrelationId(msg: NodeMessageInFlow): string | undefined {
  if (typeof msg.correlationId === 'string' && msg.correlationId) {
    return msg.correlationId;
  }
  const payload = msg.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as { correlationId?: unknown };
    if (typeof p.correlationId === 'string' && p.correlationId) {
      return p.correlationId;
    }
  }
  return undefined;
}

function describeMessage(msg: NodeMessageInFlow): string {
  if (typeof msg.reviewDimension === 'string' && msg.reviewDimension) {
    return msg.reviewDimension;
  }
  const payload = msg.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.dimension === 'string' && p.dimension) return p.dimension;
    if (typeof p.title === 'string' && p.title) return p.title;
  }
  return 'task';
}

function describeWait(
  taskId: string,
  msg: NodeMessageInFlow,
  fallback: string,
): string {
  if (fallback !== 'task') return fallback;
  const payload = msg.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.title === 'string' && p.title) return p.title;
  }
  return shortId(taskId);
}

function statusText(
  action: string,
  label: string,
  activeCount: number,
): string {
  const suffix = activeCount > 0 ? ` · ${activeCount} active` : '';
  return `${action} · ${truncate(label, 34)}${suffix}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function sleep(
  ms: number,
  pending: Set<ReturnType<typeof setTimeout>>,
): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      pending.delete(t);
      resolve();
    }, ms);
    pending.add(t);
  });
}

export default init;
